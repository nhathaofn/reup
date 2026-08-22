import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  CONTENT_BLOCK_SCHEMA_VERSION,
  type BoundaryReason,
  type ContentBlockIssue,
  type ContentBlockRole,
  type ContentCueRole,
  type MediaAdaptation,
  type LocaleAssetManifest,
  type RenderTimeline,
  type ReviewState,
  type SourceBlockManifest,
  type SourceContentBlock,
  type VariantPlan
} from '../../shared/features/content-blocks.ts'

type JsonRecord = Record<string, unknown>

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u
const BOUNDARY_REASONS: ReadonlySet<BoundaryReason> = new Set(['exact-scene-match', 'scene-near-srt', 'srt-fallback', 'manual-adjusted'])
const REVIEW_STATES: ReadonlySet<ReviewState> = new Set(['accepted', 'needs-review', 'locked'])
const BLOCK_ROLES: ReadonlySet<ContentBlockRole> = new Set(['normal', 'intro', 'outro', 'cta'])
const CUE_ROLES: ReadonlySet<ContentCueRole> = new Set(['question', 'answer', 'statement'])
const BLOCK_ISSUES: ReadonlySet<ContentBlockIssue> = new Set(['odd-unpaired-cue', 'grouping-review', 'srt-fallback', 'manual-adjusted'])
const ADAPTATIONS: ReadonlySet<MediaAdaptation> = new Set(['stretch-within-soft-limit', 'stretch-with-warning', 'needs-review'])

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(message: string): never {
  throw new Error(message)
}

function requiredRecord(value: unknown, label: string): JsonRecord {
  return isRecord(value) ? value : fail(`${label} phải là object.`)
}

function requiredString(value: unknown, label: string): string {
  return typeof value === 'string' && value.trim() ? value : fail(`${label} phải là chuỗi không rỗng.`)
}

function requiredInteger(value: unknown, label: string, minimum = 0): number {
  return Number.isSafeInteger(value) && (value as number) >= minimum
    ? value as number
    : fail(`${label} phải là microseconds integer an toàn và không âm.`)
}

function requiredPositiveInteger(value: unknown, label: string): number {
  return requiredInteger(value, label, 1)
}

function requiredFinitePositive(value: unknown, label: string): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fail(`${label} phải là số dương hữu hạn.`)
}

function requiredSha(value: unknown, label: string): `sha256:${string}` {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
    ? value as `sha256:${string}`
    : fail(`${label} phải có dạng sha256:<64 ký tự hex>.`)
}

function requiredArray(value: unknown, label: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${label} phải là array.`)
}

function requiredEnum<T extends string>(value: unknown, values: ReadonlySet<T>, label: string): T {
  return typeof value === 'string' && values.has(value as T)
    ? value as T
    : fail(`${label} không hợp lệ.`)
}

function uniqueStrings(values: unknown[], label: string): string[] {
  const strings = values.map((value, index) => requiredString(value, `${label}[${index}]`))
  if (new Set(strings).size !== strings.length) fail(`${label} chứa giá trị trùng.`)
  return strings
}

function validateRange(value: unknown, label: string): { startUs: number; endUs: number } {
  const range = requiredRecord(value, label)
  const startUs = requiredInteger(range.startUs, `${label}.startUs`)
  const endUs = requiredInteger(range.endUs, `${label}.endUs`)
  if (endUs <= startUs) fail(`${label} phải có endUs lớn hơn startUs.`)
  return { startUs, endUs }
}

function validateSourceBlock(value: unknown, index: number, durationUs: number): SourceContentBlock {
  const block = requiredRecord(value, `blocks[${index}]`)
  const id = requiredString(block.id, `blocks[${index}].id`)
  const sourceRange = validateRange(block.sourceRange, `blocks[${index}].sourceRange`)
  if (sourceRange.endUs > durationUs) fail(`Block ${id} vượt quá thời lượng source.`)

  const cueIds = uniqueStrings(requiredArray(block.cueIds, `blocks[${index}].cueIds`), `blocks[${index}].cueIds`)
  const dialogueValues = requiredArray(block.dialogue, `blocks[${index}].dialogue`)
  if (dialogueValues.length !== cueIds.length || dialogueValues.length === 0) {
    fail(`Block ${id} có cueIds và dialogue không khớp.`)
  }
  const dialogue = dialogueValues.map((candidate, cueIndex) => {
    const cue = requiredRecord(candidate, `blocks[${index}].dialogue[${cueIndex}]`)
    const cueId = requiredString(cue.cueId, `blocks[${index}].dialogue[${cueIndex}].cueId`)
    const sourceIndex = requiredPositiveInteger(cue.sourceIndex, `blocks[${index}].dialogue[${cueIndex}].sourceIndex`)
    const role = requiredEnum(cue.role, CUE_ROLES, `blocks[${index}].dialogue[${cueIndex}].role`)
    const text = requiredString(cue.text, `blocks[${index}].dialogue[${cueIndex}].text`)
    const sourceStartUs = requiredInteger(cue.sourceStartUs, `blocks[${index}].dialogue[${cueIndex}].sourceStartUs`)
    const sourceEndUs = requiredInteger(cue.sourceEndUs, `blocks[${index}].dialogue[${cueIndex}].sourceEndUs`)
    if (sourceEndUs <= sourceStartUs) fail(`Cue ${cueId} có thời lượng không hợp lệ.`)
    if (sourceStartUs < sourceRange.startUs || sourceEndUs > sourceRange.endUs) {
      fail(`Cue ${cueId} nằm ngoài source range của block.`)
    }
    return { cueId, sourceIndex, role, text, sourceStartUs, sourceEndUs }
  })
  if (cueIds.some((cueId, cueIndex) => cueId !== dialogue[cueIndex].cueId)) {
    fail(`Block ${id} có cueIds không trùng thứ tự dialogue.`)
  }
  for (let cueIndex = 1; cueIndex < dialogue.length; cueIndex += 1) {
    const previous = dialogue[cueIndex - 1]
    const current = dialogue[cueIndex]
    if (current.sourceStartUs < previous.sourceStartUs || current.sourceIndex <= previous.sourceIndex) {
      fail(`Dialogue của block ${id} phải theo thứ tự source.`)
    }
  }

  const boundary = requiredRecord(block.boundary, `blocks[${index}].boundary`)
  const targetUs = requiredInteger(boundary.targetUs, `blocks[${index}].boundary.targetUs`)
  const selectedUs = requiredInteger(boundary.selectedUs, `blocks[${index}].boundary.selectedUs`)
  if (selectedUs !== sourceRange.endUs) fail(`Boundary selectedUs của block ${id} phải bằng sourceRange.endUs.`)
  if (targetUs > selectedUs) fail(`Boundary targetUs của block ${id} không được vượt selectedUs.`)
  const reason = requiredEnum(boundary.reason, BOUNDARY_REASONS, `blocks[${index}].boundary.reason`)
  const reviewState = requiredEnum(boundary.reviewState, REVIEW_STATES, `blocks[${index}].boundary.reviewState`)

  const semantic = requiredRecord(block.semantic, `blocks[${index}].semantic`)
  const role = requiredEnum(semantic.role, BLOCK_ROLES, `blocks[${index}].semantic.role`)
  if (typeof semantic.shuffleEligible !== 'boolean') fail(`Block ${id} có shuffleEligible không hợp lệ.`)
  const requiresPreviousBlockId = semantic.requiresPreviousBlockId === null
    ? null
    : requiredString(semantic.requiresPreviousBlockId, `blocks[${index}].semantic.requiresPreviousBlockId`)

  const issues = requiredArray(block.issues, `blocks[${index}].issues`).map((issue, issueIndex) =>
    requiredEnum(issue, BLOCK_ISSUES, `blocks[${index}].issues[${issueIndex}]`)
  )
  if (new Set(issues).size !== issues.length) fail(`Block ${id} có issue trùng.`)

  return {
    id,
    sourceRange,
    cueIds,
    dialogue,
    boundary: { targetUs, selectedUs, reason, reviewState },
    semantic: { role, shuffleEligible: semantic.shuffleEligible, requiresPreviousBlockId },
    issues
  }
}

export function validateSourceBlockManifest(value: unknown): SourceBlockManifest {
  const manifest = requiredRecord(value, 'SourceBlockManifest')
  if (manifest.schemaVersion !== CONTENT_BLOCK_SCHEMA_VERSION) fail('SourceBlockManifest schemaVersion không hỗ trợ.')
  const source = requiredRecord(manifest.source, 'source')
  const path = requiredString(source.path, 'source.path')
  const fingerprint = requiredSha(source.fingerprint, 'source.fingerprint')
  const durationUs = requiredPositiveInteger(source.durationUs, 'source.durationUs')
  const fps = requiredFinitePositive(source.fps, 'source.fps')
  const revision = requiredPositiveInteger(manifest.revision, 'revision')
  const values = requiredArray(manifest.blocks, 'blocks')
  if (values.length === 0) fail('SourceBlockManifest phải có ít nhất một block.')
  const blocks = values.map((block, index) => validateSourceBlock(block, index, durationUs))

  const blockIds = new Set<string>()
  const cueIds = new Set<string>()
  let previousEndUs = 0
  let previousSourceIndex = 0
  for (const block of blocks) {
    if (blockIds.has(block.id)) fail(`block ID bị trùng: ${block.id}.`)
    blockIds.add(block.id)
    if (block.sourceRange.startUs !== previousEndUs) fail('Source block ranges phải liên tục, không có gap/overlap.')
    previousEndUs = block.sourceRange.endUs
    for (const cue of block.dialogue) {
      if (cueIds.has(cue.cueId)) fail(`cue ID bị trùng: ${cue.cueId}.`)
      cueIds.add(cue.cueId)
      if (cue.sourceIndex <= previousSourceIndex) fail('Cue sourceIndex phải tăng dần trên toàn source.')
      previousSourceIndex = cue.sourceIndex
    }
    if (block.semantic.requiresPreviousBlockId !== null && !blockIds.has(block.semantic.requiresPreviousBlockId)) {
      const referenced = blocks.some((candidate) => candidate.id === block.semantic.requiresPreviousBlockId)
      if (!referenced) fail(`Dependency của block ${block.id} trỏ tới block không tồn tại.`)
    }
  }
  if (blocks[0].sourceRange.startUs !== 0 || previousEndUs !== durationUs) {
    fail('Source block ranges phải bắt đầu từ 0 và phủ đủ source duration.')
  }
  for (const block of blocks) {
    if (block.semantic.requiresPreviousBlockId === block.id) fail(`Block ${block.id} không được dependency chính nó.`)
    if (block.semantic.requiresPreviousBlockId !== null && !blockIds.has(block.semantic.requiresPreviousBlockId)) {
      fail(`Dependency của block ${block.id} trỏ tới block không tồn tại.`)
    }
  }
  return {
    schemaVersion: CONTENT_BLOCK_SCHEMA_VERSION,
    source: { path, fingerprint, durationUs, fps },
    revision,
    blocks
  }
}

export function validateLocaleAssetManifest(value: unknown): LocaleAssetManifest {
  const manifest = requiredRecord(value, 'LocaleAssetManifest')
  if (manifest.schemaVersion !== CONTENT_BLOCK_SCHEMA_VERSION) fail('LocaleAssetManifest schemaVersion không hỗ trợ.')
  const sourceManifestFingerprint = requiredSha(manifest.sourceManifestFingerprint, 'sourceManifestFingerprint')
  const locale = requiredString(manifest.locale, 'locale')
  const blocksRecord = requiredRecord(manifest.blocks, 'blocks')
  const blocks: LocaleAssetManifest['blocks'] = {}
  const cueIds = new Set<string>()
  for (const [blockId, candidate] of Object.entries(blocksRecord)) {
    const block = requiredRecord(candidate, `blocks.${blockId}`)
    const cues = requiredArray(block.cues, `blocks.${blockId}.cues`).map((cueValue, index) => {
      const cue = requiredRecord(cueValue, `blocks.${blockId}.cues[${index}]`)
      const cueId = requiredString(cue.cueId, `blocks.${blockId}.cues[${index}].cueId`)
      if (cueIds.has(cueId)) fail(`cue ID bị trùng trong locale: ${cueId}.`)
      cueIds.add(cueId)
      return {
        cueId,
        text: requiredString(cue.text, `blocks.${blockId}.cues[${index}].text`),
        voicePath: requiredString(cue.voicePath, `blocks.${blockId}.cues[${index}].voicePath`),
        voiceDurationUs: requiredPositiveInteger(cue.voiceDurationUs, `blocks.${blockId}.cues[${index}].voiceDurationUs`)
      }
    })
    if (cues.length === 0) fail(`Locale block ${blockId} phải có cue.`)
    blocks[blockId] = { cues }
  }
  if (Object.keys(blocks).length === 0) fail('LocaleAssetManifest phải có block.')
  return { schemaVersion: CONTENT_BLOCK_SCHEMA_VERSION, sourceManifestFingerprint, locale, blocks }
}

export function validateVariantPlan(value: unknown): VariantPlan {
  const plan = requiredRecord(value, 'VariantPlan')
  if (plan.schemaVersion !== CONTENT_BLOCK_SCHEMA_VERSION) fail('VariantPlan schemaVersion không hỗ trợ.')
  const variantId = requiredString(plan.variantId, 'variantId')
  const seed = requiredString(plan.seed, 'seed')
  if (seed.length > 128) fail('seed không được dài hơn 128 ký tự.')
  const sourceManifestFingerprint = requiredSha(plan.sourceManifestFingerprint, 'sourceManifestFingerprint')
  const blockOrder = uniqueStrings(requiredArray(plan.blockOrder, 'blockOrder'), 'blockOrder')
  if (blockOrder.length === 0) fail('blockOrder không được rỗng.')
  const constraints = requiredRecord(plan.constraints, 'constraints')
  const lockedStartBlockIds = uniqueStrings(requiredArray(constraints.lockedStartBlockIds, 'constraints.lockedStartBlockIds'), 'constraints.lockedStartBlockIds')
  const lockedEndBlockIds = uniqueStrings(requiredArray(constraints.lockedEndBlockIds, 'constraints.lockedEndBlockIds'), 'constraints.lockedEndBlockIds')
  if (constraints.preserveDependencyChains !== true) fail('constraints.preserveDependencyChains phải là true.')
  if (lockedStartBlockIds.some((id) => lockedEndBlockIds.includes(id))) fail('Một block không được khóa ở cả đầu và cuối.')
  return {
    schemaVersion: CONTENT_BLOCK_SCHEMA_VERSION,
    variantId,
    sourceManifestFingerprint,
    seed,
    blockOrder,
    constraints: { lockedStartBlockIds, lockedEndBlockIds, preserveDependencyChains: true }
  }
}

export function validateRenderTimeline(value: unknown): RenderTimeline {
  const timeline = requiredRecord(value, 'RenderTimeline')
  if (timeline.schemaVersion !== CONTENT_BLOCK_SCHEMA_VERSION) fail('RenderTimeline schemaVersion không hỗ trợ.')
  const sourceManifestFingerprint = requiredSha(timeline.sourceManifestFingerprint, 'sourceManifestFingerprint')
  const variantId = requiredString(timeline.variantId, 'variantId')
  const locale = requiredString(timeline.locale, 'locale')
  const durationUs = requiredInteger(timeline.durationUs, 'durationUs')
  const itemValues = requiredArray(timeline.items, 'items')
  const items: RenderTimeline['items'] = []
  const blockIds = new Set<string>()
  const cueIds = new Set<string>()
  let cursorUs = 0
  for (const [index, itemValue] of itemValues.entries()) {
    const item = requiredRecord(itemValue, `items[${index}]`)
    const blockId = requiredString(item.blockId, `items[${index}].blockId`)
    if (blockIds.has(blockId)) fail(`Timeline block ID bị trùng: ${blockId}.`)
    blockIds.add(blockId)
    const target = validateRange({ startUs: item.timelineStartUs, endUs: item.timelineEndUs }, `items[${index}]`)
    if (target.startUs !== cursorUs) fail('Timeline items phải liên tục từ 0.')
    cursorUs = target.endUs
    const source = validateRange({ startUs: item.sourceStartUs, endUs: item.sourceEndUs }, `items[${index}].sourceRange`)
    const mediaSpeed = requiredFinitePositive(item.mediaSpeed, `items[${index}].mediaSpeed`)
    const adaptation = requiredEnum(item.adaptation, ADAPTATIONS, `items[${index}].adaptation`)
    let previousSubtitleEndUs = target.startUs
    const subtitleCues = requiredArray(item.subtitleCues, `items[${index}].subtitleCues`).map((cueValue, cueIndex) => {
      const cue = requiredRecord(cueValue, `items[${index}].subtitleCues[${cueIndex}]`)
      const cueId = requiredString(cue.cueId, `items[${index}].subtitleCues[${cueIndex}].cueId`)
      if (cueIds.has(cueId)) fail(`Subtitle cue ID bị trùng: ${cueId}.`)
      cueIds.add(cueId)
      const cueRange = validateRange({ startUs: cue.startUs, endUs: cue.endUs }, `items[${index}].subtitleCues[${cueIndex}]`)
      if (cueRange.startUs < target.startUs || cueRange.endUs > target.endUs) fail(`Subtitle ${cueId} nằm ngoài block timeline.`)
      if (cueRange.startUs < previousSubtitleEndUs) fail(`Subtitle ${cueId} không monotonic.`)
      previousSubtitleEndUs = cueRange.endUs
      return { cueId, startUs: cueRange.startUs, endUs: cueRange.endUs, text: requiredString(cue.text, `items[${index}].subtitleCues[${cueIndex}].text`) }
    })
    const warnings = requiredArray(item.warnings, `items[${index}].warnings`).map((warning, warningIndex) =>
      requiredString(warning, `items[${index}].warnings[${warningIndex}]`)
    )
    items.push({
      blockId,
      timelineStartUs: target.startUs,
      timelineEndUs: target.endUs,
      sourceStartUs: source.startUs,
      sourceEndUs: source.endUs,
      mediaSpeed,
      adaptation,
      subtitleCues,
      warnings
    })
  }
  if (cursorUs !== durationUs) fail('Timeline durationUs phải bằng thời điểm kết thúc item cuối.')
  const reviewBlockIds = uniqueStrings(requiredArray(timeline.reviewBlockIds, 'reviewBlockIds'), 'reviewBlockIds')
  const expectedReviewIds = items.filter((item) => item.adaptation === 'needs-review').map((item) => item.blockId)
  if (reviewBlockIds.length !== expectedReviewIds.length || reviewBlockIds.some((id, index) => id !== expectedReviewIds[index])) {
    fail('reviewBlockIds phải đúng bằng các block needs-review.')
  }
  return { schemaVersion: CONTENT_BLOCK_SCHEMA_VERSION, sourceManifestFingerprint, variantId, locale, durationUs, items, reviewBlockIds }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Artifact không được chứa số vô hạn hoặc NaN.')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalize(child)])
    )
  }
  throw new Error(`Artifact chứa kiểu không hỗ trợ: ${typeof value}.`)
}

export function canonicalJson(value: unknown): string {
  const result = JSON.stringify(canonicalize(value))
  if (result === undefined) throw new Error('Không thể canonicalize artifact.')
  return result
}

export function sha256Text(text: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

export function sha256File(path: string): Promise<`sha256:${string}`> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk))
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`))
  })
}

export function fingerprintSourceManifest(manifest: SourceBlockManifest): `sha256:${string}` {
  validateSourceBlockManifest(manifest)
  return sha256Text(canonicalJson(manifest))
}

export function assertSourceFingerprint(
  actual: `sha256:${string}`,
  declared: `sha256:${string}`,
  artifactLabel: string
): void {
  if (actual !== declared) fail(`${artifactLabel} fingerprint không khớp source manifest.`)
}

export function assertVariantMatchesSource(variant: VariantPlan, source: SourceBlockManifest): void {
  validateSourceBlockManifest(source)
  validateVariantPlan(variant)
  const fingerprint = fingerprintSourceManifest(source)
  assertSourceFingerprint(variant.sourceManifestFingerprint, fingerprint, 'Variant')
  const sourceIds = source.blocks.map((block) => block.id)
  const orderIds = variant.blockOrder
  if (orderIds.length !== sourceIds.length || new Set(orderIds).size !== sourceIds.length || orderIds.some((id) => !sourceIds.includes(id))) {
    fail('Variant phải chứa mỗi block đúng một lần theo source manifest.')
  }
  for (const id of [...variant.constraints.lockedStartBlockIds, ...variant.constraints.lockedEndBlockIds]) {
    if (!sourceIds.includes(id)) fail(`Variant lock trỏ tới block không tồn tại: ${id}.`)
  }
}

export function assertLocaleMatchesSource(locale: LocaleAssetManifest, source: SourceBlockManifest): void {
  validateSourceBlockManifest(source)
  validateLocaleAssetManifest(locale)
  const fingerprint = fingerprintSourceManifest(source)
  assertSourceFingerprint(locale.sourceManifestFingerprint, fingerprint, 'Locale')
  const sourceIds = source.blocks.map((block) => block.id)
  const localeIds = Object.keys(locale.blocks)
  if (localeIds.length !== sourceIds.length || sourceIds.some((id) => !Object.hasOwn(locale.blocks, id))) {
    fail('Locale phải có đúng các block và cue IDs của source.')
  }
  for (const block of source.blocks) {
    const actualCueIds = locale.blocks[block.id].cues.map((cue) => cue.cueId)
    if (actualCueIds.length !== block.cueIds.length || actualCueIds.some((id, index) => id !== block.cueIds[index])) {
      fail(`Locale block ${block.id} có cue IDs không khớp source.`)
    }
  }
}

export async function writeArtifactAtomic<T>(
  path: string,
  value: T,
  validate: (candidate: unknown) => T
): Promise<void> {
  const validated = validate(value)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readArtifact<T>(path: string, validate: (value: unknown) => T): Promise<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`Không đọc được artifact JSON "${path}": ${error instanceof Error ? error.message : String(error)}`)
  }
  return validate(parsed)
}

export const readSourceBlockManifest = (path: string): Promise<SourceBlockManifest> =>
  readArtifact(path, validateSourceBlockManifest)
export const readLocaleAssetManifest = (path: string): Promise<LocaleAssetManifest> =>
  readArtifact(path, validateLocaleAssetManifest)
export const readVariantPlan = (path: string): Promise<VariantPlan> =>
  readArtifact(path, validateVariantPlan)
export const readRenderTimeline = (path: string): Promise<RenderTimeline> =>
  readArtifact(path, validateRenderTimeline)
