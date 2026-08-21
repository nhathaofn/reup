import {
  CONTENT_BLOCK_DEFAULTS,
  type LocaleAssetManifest,
  type RenderTimeline,
  type RenderTimelineItem,
  type SourceBlockManifest,
  type VariantPlan
} from '../../shared/features/content-blocks.ts'
import {
  assertLocaleMatchesSource,
  assertVariantMatchesSource,
  fingerprintSourceManifest,
  validateRenderTimeline,
  validateSourceBlockManifest,
  validateVariantPlan,
  validateLocaleAssetManifest
} from './contentBlockManifest.ts'

export interface TimelinePolicy {
  preRollUs: number
  postRollUs: number
  cueGapUs: number
  softSpeedMin: number
  softSpeedMax: number
  hardSpeedMin: number
  hardSpeedMax: number
}

export function validateTimelinePolicy(input: Partial<TimelinePolicy> = {}): TimelinePolicy {
  const policy: TimelinePolicy = {
    preRollUs: input.preRollUs ?? CONTENT_BLOCK_DEFAULTS.preRollUs,
    postRollUs: input.postRollUs ?? CONTENT_BLOCK_DEFAULTS.postRollUs,
    cueGapUs: input.cueGapUs ?? CONTENT_BLOCK_DEFAULTS.cueGapUs,
    softSpeedMin: input.softSpeedMin ?? CONTENT_BLOCK_DEFAULTS.softSpeedMin,
    softSpeedMax: input.softSpeedMax ?? CONTENT_BLOCK_DEFAULTS.softSpeedMax,
    hardSpeedMin: input.hardSpeedMin ?? CONTENT_BLOCK_DEFAULTS.hardSpeedMin,
    hardSpeedMax: input.hardSpeedMax ?? CONTENT_BLOCK_DEFAULTS.hardSpeedMax
  }
  if (![policy.preRollUs, policy.postRollUs, policy.cueGapUs].every(Number.isSafeInteger)) {
    throw new Error('Pre-roll, post-roll và cue gap phải là integer microseconds.')
  }
  if (policy.preRollUs < 0 || policy.preRollUs > 100_000 || policy.postRollUs < 0 || policy.cueGapUs < 0) {
    throw new Error('Timing policy nằm ngoài giới hạn V1.')
  }
  if (![policy.softSpeedMin, policy.softSpeedMax, policy.hardSpeedMin, policy.hardSpeedMax].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Speed policy không hợp lệ.')
  }
  if (!(policy.hardSpeedMin <= policy.softSpeedMin && policy.softSpeedMin <= 1 &&
        1 <= policy.softSpeedMax && policy.softSpeedMax <= policy.hardSpeedMax)) {
    throw new Error('Speed policy không hợp lệ.')
  }
  return policy
}

function classifySpeed(speed: number, policy: TimelinePolicy): RenderTimelineItem['adaptation'] {
  if (speed >= policy.softSpeedMin && speed <= policy.softSpeedMax) return 'stretch-within-soft-limit'
  if (speed >= policy.hardSpeedMin && speed <= policy.hardSpeedMax) return 'stretch-with-warning'
  return 'needs-review'
}

export function buildRenderTimeline(
  source: SourceBlockManifest,
  locale: LocaleAssetManifest,
  variant: VariantPlan,
  policyInput: Partial<TimelinePolicy> = {}
): RenderTimeline {
  validateSourceBlockManifest(source)
  validateLocaleAssetManifest(locale)
  validateVariantPlan(variant)
  assertVariantMatchesSource(variant, source)
  assertLocaleMatchesSource(locale, source)
  const policy = validateTimelinePolicy(policyInput)
  const sourceById = new Map(source.blocks.map((block) => [block.id, block]))
  let cursorUs = 0
  const items: RenderTimelineItem[] = []
  for (const blockId of variant.blockOrder) {
    const sourceBlock = sourceById.get(blockId)
    if (!sourceBlock) throw new Error(`Variant trỏ tới block không tồn tại: ${blockId}.`)
    const localeBlock = locale.blocks[blockId]
    const targetDurationUs = policy.preRollUs +
      localeBlock.cues.reduce((sum, cue) => sum + cue.voiceDurationUs, 0) +
      policy.cueGapUs * Math.max(0, localeBlock.cues.length - 1) +
      policy.postRollUs
    if (!Number.isSafeInteger(targetDurationUs) || targetDurationUs <= 0) throw new Error(`Block ${blockId} có duration locale không hợp lệ.`)
    const sourceDurationUs = sourceBlock.sourceRange.endUs - sourceBlock.sourceRange.startUs
    const mediaSpeed = Number((sourceDurationUs / targetDurationUs).toFixed(6))
    const adaptation = classifySpeed(mediaSpeed, policy)
    const warnings = adaptation === 'stretch-with-warning'
      ? [`Block ${blockId} cần speed ${mediaSpeed.toFixed(6)}, vượt vùng mềm nhưng còn trong vùng cứng.`]
      : adaptation === 'needs-review'
        ? [`Block ${blockId} cần review vì speed ${mediaSpeed.toFixed(6)} vượt vùng cứng.`]
        : []
    let subtitleCursorUs = cursorUs + policy.preRollUs
    const subtitleCues = localeBlock.cues.map((cue, index) => {
      const startUs = subtitleCursorUs
      const endUs = startUs + cue.voiceDurationUs
      subtitleCursorUs = endUs + (index < localeBlock.cues.length - 1 ? policy.cueGapUs : 0)
      return { cueId: cue.cueId, startUs, endUs, text: cue.text }
    })
    const timelineEndUs = cursorUs + targetDurationUs
    items.push({
      blockId,
      timelineStartUs: cursorUs,
      timelineEndUs,
      sourceStartUs: sourceBlock.sourceRange.startUs,
      sourceEndUs: sourceBlock.sourceRange.endUs,
      mediaSpeed,
      adaptation,
      subtitleCues,
      warnings
    })
    cursorUs = timelineEndUs
  }
  const sourceManifestFingerprint = fingerprintSourceManifest(source)
  const timeline: RenderTimeline = {
    schemaVersion: 1,
    sourceManifestFingerprint,
    variantId: variant.variantId,
    locale: locale.locale,
    durationUs: cursorUs,
    items,
    reviewBlockIds: items.filter((item) => item.adaptation === 'needs-review').map((item) => item.blockId)
  }
  return validateRenderTimeline(timeline)
}
