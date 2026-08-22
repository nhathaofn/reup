import {
  type SourceBlockManifest,
  type SourceContentBlock,
  type VariantConstraints,
  type VariantPlan
} from '../../shared/features/content-blocks.ts'
import {
  assertVariantMatchesSource,
  fingerprintSourceManifest,
  validateSourceBlockManifest,
  validateVariantPlan
} from './contentBlockManifest.ts'

interface DependencyUnit {
  blockIds: string[]
  fixed: boolean
}

function seedToUint32(seed: string): number {
  let hash = 0x811c9dc5
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

function buildDependencyUnits(blocks: readonly SourceContentBlock[]): DependencyUnit[] {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const indexById = new Map(blocks.map((block, index) => [block.id, index]))
  const children = new Map<string, string[]>()
  for (const block of blocks) {
    const dependency = block.semantic.requiresPreviousBlockId
    if (dependency === null) continue
    if (!byId.has(dependency)) throw new Error(`Dependency trỏ tới block missing: ${dependency}.`)
    const list = children.get(dependency) ?? []
    list.push(block.id)
    children.set(dependency, list)
  }
  for (const [dependency, dependentIds] of children) {
    if (dependentIds.length > 1) throw new Error(`Dependency branch tại ${dependency}.`)
  }

  const state = new Map<string, 'visiting' | 'visited'>()
  const visit = (id: string): void => {
    const current = state.get(id)
    if (current === 'visiting') throw new Error('Dependency cycle detected.')
    if (current === 'visited') return
    state.set(id, 'visiting')
    const dependency = byId.get(id)?.semantic.requiresPreviousBlockId
    if (dependency) visit(dependency)
    state.set(id, 'visited')
  }
  for (const block of blocks) visit(block.id)

  const roots = blocks.filter((block) => block.semantic.requiresPreviousBlockId === null)
  const units: DependencyUnit[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const blockIds: string[] = []
    let current: SourceContentBlock | undefined = root
    while (current) {
      if (seen.has(current.id)) throw new Error('Dependency cycle detected.')
      seen.add(current.id)
      blockIds.push(current.id)
      const childId: string | undefined = children.get(current.id)?.[0]
      if (childId !== undefined && indexById.get(childId)! <= indexById.get(current.id)!) {
        throw new Error('Dependency phải trỏ tới block đứng trước.')
      }
      current = childId ? byId.get(childId) : undefined
    }
    units.push({
      blockIds,
      fixed: blockIds.some((id) => !byId.get(id)!.semantic.shuffleEligible)
    })
  }
  if (seen.size !== blocks.length) throw new Error('Dependency cycle detected.')
  units.sort((left, right) => indexById.get(left.blockIds[0])! - indexById.get(right.blockIds[0])!)
  return units
}

function normalizeVariantConstraints(
  blocks: readonly SourceContentBlock[],
  input: VariantConstraints
): VariantConstraints {
  const ids = new Set(blocks.map((block) => block.id))
  const requestedStart = new Set(input.lockedStartBlockIds)
  const requestedEnd = new Set(input.lockedEndBlockIds)
  for (const id of [...requestedStart, ...requestedEnd]) {
    if (!ids.has(id)) throw new Error(`Variant lock trỏ tới block missing: ${id}.`)
  }
  for (const block of blocks) {
    if (block.semantic.role === 'intro') requestedStart.add(block.id)
    if (block.semantic.role === 'outro' || block.semantic.role === 'cta') requestedEnd.add(block.id)
  }
  for (const id of requestedStart) {
    if (requestedEnd.has(id)) throw new Error(`Block ${id} bị khóa ở cả đầu và cuối.`)
  }
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const dependencyUnit = new Map<string, string[]>()
  for (const block of blocks) {
    const chain: string[] = [block.id]
    let current = block
    while (current.semantic.requiresPreviousBlockId) {
      const previous = byId.get(current.semantic.requiresPreviousBlockId)
      if (!previous) throw new Error(`Dependency trỏ tới block missing: ${current.semantic.requiresPreviousBlockId}.`)
      chain.unshift(previous.id)
      current = previous
    }
    for (const id of chain) dependencyUnit.set(id, chain)
  }
  for (const locks of [requestedStart, requestedEnd]) {
    for (const id of locks) {
      const chain = dependencyUnit.get(id) ?? [id]
      if (chain.some((member) => !locks.has(member))) {
        throw new Error(`Lock phải bao phủ toàn bộ dependency unit của ${id}.`)
      }
    }
  }
  const sourceOrder = new Map(blocks.map((block, index) => [block.id, index]))
  const ordered = (set: Set<string>): string[] => [...set].sort((left, right) => sourceOrder.get(left)! - sourceOrder.get(right)!)
  return {
    lockedStartBlockIds: ordered(requestedStart),
    lockedEndBlockIds: ordered(requestedEnd),
    preserveDependencyChains: true
  }
}

function orderUnits(
  units: readonly DependencyUnit[],
  blocks: readonly SourceContentBlock[],
  constraints: VariantConstraints,
  random: () => number
): string[] {
  const unitByBlock = new Map(units.flatMap((unit) => unit.blockIds.map((id) => [id, unit] as const)))
  const startUnitSet = new Set(constraints.lockedStartBlockIds.map((id) => unitByBlock.get(id)!))
  const endUnitSet = new Set(constraints.lockedEndBlockIds.map((id) => unitByBlock.get(id)!))
  for (const unit of startUnitSet) if (endUnitSet.has(unit)) throw new Error('Một dependency unit bị khóa ở cả hai mép.')

  const startUnits = units.filter((unit) => startUnitSet.has(unit))
  const endUnits = units.filter((unit) => endUnitSet.has(unit))
  const middleUnits = units.filter((unit) => !startUnitSet.has(unit) && !endUnitSet.has(unit))
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const middle: DependencyUnit[] = []
  let region: DependencyUnit[] = []
  const flushRegion = (): void => {
    middle.push(...shuffle(region, random))
    region = []
  }
  for (const unit of middleUnits) {
    if (unit.fixed) {
      flushRegion()
      middle.push(unit)
    } else {
      region.push(unit)
    }
  }
  flushRegion()
  const result = [...startUnits, ...middle, ...endUnits].flatMap((unit) => unit.blockIds)
  const sourceIds = blocks.map((block) => block.id)
  if (result.length !== sourceIds.length || new Set(result).size !== sourceIds.length || result.some((id) => !byId.has(id))) {
    throw new Error('Variant order không khớp source blocks.')
  }
  return result
}

export function createVariantPlan(
  source: SourceBlockManifest,
  input: { variantId: string; seed: string; constraints: VariantConstraints }
): VariantPlan {
  validateSourceBlockManifest(source)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(input.variantId)) throw new Error('variantId không hợp lệ.')
  if (!input.seed.trim() || input.seed.length > 128) throw new Error('seed phải có từ 1 đến 128 ký tự.')
  const units = buildDependencyUnits(source.blocks)
  const constraints = normalizeVariantConstraints(source.blocks, input.constraints)
  const blockOrder = orderUnits(units, source.blocks, constraints, mulberry32(seedToUint32(input.seed))).flatMap((id) => [id])
  const plan: VariantPlan = {
    schemaVersion: 1,
    variantId: input.variantId,
    sourceManifestFingerprint: fingerprintSourceManifest(source),
    seed: input.seed,
    blockOrder,
    constraints
  }
  assertVariantMatchesSource(plan, source)
  return validateVariantPlan(plan)
}
