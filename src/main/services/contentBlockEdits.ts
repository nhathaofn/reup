import { randomUUID } from 'node:crypto'
import {
  CONTENT_BLOCK_DEFAULTS,
  type ContentBlockEditOperation,
  type SourceBlockManifest,
  type SourceContentBlock,
  type SourceDialogueCue
} from '../../shared/features/content-blocks.ts'
import { validateSourceBlockManifest } from './contentBlockManifest.ts'

function findBlockIndex(blocks: readonly SourceContentBlock[], id: string): number {
  const index = blocks.findIndex((block) => block.id === id)
  if (index < 0) throw new Error(`Không tìm thấy block ${id}.`)
  return index
}

function regroupDialogue(dialogue: readonly SourceDialogueCue[]): { dialogue: SourceDialogueCue[]; issues: SourceContentBlock['issues'] } {
  if (dialogue.length === 2) {
    return {
      dialogue: [
        { ...dialogue[0], role: 'question' },
        { ...dialogue[1], role: 'answer' }
      ],
      issues: []
    }
  }
  return {
    dialogue: dialogue.map((cue) => ({ ...cue, role: 'statement' })),
    issues: ['odd-unpaired-cue']
  }
}

function mergeAdjacent(
  manifest: SourceBlockManifest,
  operation: Extract<ContentBlockEditOperation, { kind: 'merge' }>
): SourceBlockManifest {
  const leftIndex = findBlockIndex(manifest.blocks, operation.leftBlockId)
  const rightIndex = findBlockIndex(manifest.blocks, operation.rightBlockId)
  if (rightIndex !== leftIndex + 1) throw new Error('Chỉ được merge hai block liền kề.')
  const left = manifest.blocks[leftIndex]
  const right = manifest.blocks[rightIndex]
  const dialogue = [...left.dialogue, ...right.dialogue]
  const regrouped = regroupDialogue(dialogue)
  const issues = [...new Set([
    ...left.issues.filter((issue) => issue !== 'srt-fallback'),
    ...right.issues,
    ...regrouped.issues
  ])]
  const merged: SourceContentBlock = {
    id: left.id,
    sourceRange: { startUs: left.sourceRange.startUs, endUs: right.sourceRange.endUs },
    cueIds: [...left.cueIds, ...right.cueIds],
    dialogue: regrouped.dialogue,
    boundary: { ...right.boundary },
    semantic: {
      role: 'normal',
      shuffleEligible: left.semantic.shuffleEligible && right.semantic.shuffleEligible,
      requiresPreviousBlockId: null
    },
    issues
  }
  const blocks = [...manifest.blocks]
  blocks.splice(leftIndex, 2, merged)
  return { ...manifest, blocks }
}

function splitAfterCue(
  manifest: SourceBlockManifest,
  operation: Extract<ContentBlockEditOperation, { kind: 'split' }>,
  makeBlockId: () => string
): SourceBlockManifest {
  const index = findBlockIndex(manifest.blocks, operation.blockId)
  const block = manifest.blocks[index]
  const cueIndex = block.cueIds.indexOf(operation.afterCueId)
  if (cueIndex < 0 || cueIndex >= block.cueIds.length - 1) {
    throw new Error('Điểm split phải nằm giữa hai cue trong block.')
  }
  const leftDialogue = block.dialogue.slice(0, cueIndex + 1)
  const rightDialogue = block.dialogue.slice(cueIndex + 1)
  const leftEndUs = leftDialogue[leftDialogue.length - 1].sourceEndUs
  if (leftEndUs <= block.sourceRange.startUs || leftEndUs >= block.sourceRange.endUs) {
    throw new Error('Split phải tạo hai range có thời lượng dương.')
  }
  const leftRegrouped = regroupDialogue(leftDialogue)
  const rightRegrouped = regroupDialogue(rightDialogue)
  const left: SourceContentBlock = {
    id: block.id,
    sourceRange: { startUs: block.sourceRange.startUs, endUs: leftEndUs },
    cueIds: leftDialogue.map((cue) => cue.cueId),
    dialogue: leftRegrouped.dialogue,
    boundary: { targetUs: leftEndUs, selectedUs: leftEndUs, reason: 'srt-fallback', reviewState: 'needs-review' },
    semantic: { role: 'normal', shuffleEligible: block.semantic.shuffleEligible, requiresPreviousBlockId: null },
    issues: [...new Set([...leftRegrouped.issues, 'srt-fallback' as const])]
  }
  const right: SourceContentBlock = {
    id: makeBlockId(),
    sourceRange: { startUs: leftEndUs, endUs: block.sourceRange.endUs },
    cueIds: rightDialogue.map((cue) => cue.cueId),
    dialogue: rightRegrouped.dialogue,
    boundary: { ...block.boundary },
    semantic: { role: 'normal', shuffleEligible: block.semantic.shuffleEligible, requiresPreviousBlockId: null },
    issues: [...new Set([...block.issues, ...rightRegrouped.issues])]
  }
  const blocks = [...manifest.blocks]
  blocks.splice(index, 1, left, right)
  return { ...manifest, blocks }
}

function setBoundary(
  manifest: SourceBlockManifest,
  operation: Extract<ContentBlockEditOperation, { kind: 'set-boundary' }>
): SourceBlockManifest {
  const index = findBlockIndex(manifest.blocks, operation.blockId)
  if (index >= manifest.blocks.length - 1) throw new Error('Không thể chỉnh boundary của block cuối.')
  const left = manifest.blocks[index]
  const right = manifest.blocks[index + 1]
  if (!Number.isSafeInteger(operation.selectedUs) || operation.selectedUs < 0) {
    throw new Error('Boundary phải là integer microseconds không âm.')
  }
  if (operation.selectedUs - left.sourceRange.startUs < CONTENT_BLOCK_DEFAULTS.minimumBlockDurationUs ||
      right.sourceRange.endUs - operation.selectedUs < CONTENT_BLOCK_DEFAULTS.minimumBlockDurationUs) {
    throw new Error('Boundary phải giữ thời lượng tối thiểu cho cả hai block.')
  }
  if (left.dialogue.some((cue) => cue.sourceEndUs > operation.selectedUs) ||
      right.dialogue.some((cue) => cue.sourceStartUs < operation.selectedUs)) {
    throw new Error('Boundary không được cắt giữa cue.')
  }
  const updatedLeft: SourceContentBlock = {
    ...left,
    sourceRange: { ...left.sourceRange, endUs: operation.selectedUs },
    boundary: {
      ...left.boundary,
      selectedUs: operation.selectedUs,
      reason: 'manual-adjusted',
      reviewState: operation.locked ? 'locked' : 'accepted'
    },
    issues: [...new Set([
      ...left.issues.filter((issue) => issue !== 'srt-fallback'),
      'manual-adjusted' as const
    ])]
  }
  const updatedRight: SourceContentBlock = {
    ...right,
    sourceRange: { ...right.sourceRange, startUs: operation.selectedUs }
  }
  const blocks = [...manifest.blocks]
  blocks.splice(index, 2, updatedLeft, updatedRight)
  return { ...manifest, blocks }
}

function setSemantic(
  manifest: SourceBlockManifest,
  operation: Extract<ContentBlockEditOperation, { kind: 'set-semantic' }>
): SourceBlockManifest {
  const index = findBlockIndex(manifest.blocks, operation.blockId)
  const dependency = operation.role === 'intro' || operation.role === 'outro' || operation.role === 'cta'
    ? null
    : operation.requiresPreviousBlockId
  const blocks = [...manifest.blocks]
  blocks[index] = {
    ...blocks[index],
    semantic: {
      role: operation.role,
      shuffleEligible: operation.role === 'intro' ? false : operation.shuffleEligible,
      requiresPreviousBlockId: dependency
    },
    issues: blocks[index].issues.filter((issue) => issue !== 'odd-unpaired-cue')
  }
  return { ...manifest, blocks }
}

function applyOne(
  manifest: SourceBlockManifest,
  operation: ContentBlockEditOperation,
  makeBlockId: () => string
): SourceBlockManifest {
  if (operation.kind === 'merge') return mergeAdjacent(manifest, operation)
  if (operation.kind === 'split') return splitAfterCue(manifest, operation, makeBlockId)
  if (operation.kind === 'set-boundary') return setBoundary(manifest, operation)
  return setSemantic(manifest, operation)
}

function assertLinearDependencyGraph(blocks: readonly SourceContentBlock[]): void {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const children = new Map<string, string[]>()
  for (const block of blocks) {
    const dependency = block.semantic.requiresPreviousBlockId
    if (dependency === null) continue
    if (!byId.has(dependency)) throw new Error(`Dependency của ${block.id} trỏ tới block không tồn tại.`)
    if (dependency === block.id) throw new Error('Dependency cycle detected.')
    const list = children.get(dependency) ?? []
    list.push(block.id)
    children.set(dependency, list)
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
  for (const [dependency, dependentIds] of children) {
    if (dependentIds.length > 1) throw new Error(`Dependency branch tại ${dependency}.`)
    const dependencyIndex = blocks.findIndex((block) => block.id === dependency)
    for (const dependentId of dependentIds) {
      const dependentIndex = blocks.findIndex((block) => block.id === dependentId)
      if (dependencyIndex >= dependentIndex) throw new Error('Dependency phải trỏ tới block đứng trước.')
    }
  }
}

export function applyContentBlockEdits(
  input: SourceBlockManifest,
  operations: readonly ContentBlockEditOperation[],
  makeBlockId: () => string = () => `block-${randomUUID()}`
): SourceBlockManifest {
  if (operations.length === 0) throw new Error('Phải có ít nhất một thao tác chỉnh sửa.')
  let next = structuredClone(validateSourceBlockManifest(input))
  for (const operation of operations) next = applyOne(next, operation, makeBlockId)
  assertLinearDependencyGraph(next.blocks)
  next.revision = input.revision + 1
  return validateSourceBlockManifest(next)
}
