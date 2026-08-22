import {
  CONTENT_BLOCK_DEFAULTS,
  type SourceContentBlock,
  type SourceDialogueCue
} from '../../shared/features/content-blocks.ts'
import type { DialogueGroup } from './dialogueGrouper.ts'

export interface BoundaryResolverConfig {
  boundaryWindowUs: number
  minimumBlockDurationUs: number
  srtFallbackPaddingUs: number
}

export interface ResolveBlockBoundariesInput {
  groups: readonly DialogueGroup[]
  allCues: readonly SourceDialogueCue[]
  sceneBoundaryUs: readonly number[]
  sourceDurationUs: number
  lockedBoundaryUs?: Readonly<Record<string, number>>
  config?: Partial<BoundaryResolverConfig>
}

const isInsideCue = (pointUs: number, cue: SourceDialogueCue): boolean =>
  cue.sourceStartUs < pointUs && pointUs < cue.sourceEndUs

function validateConfig(input: Partial<BoundaryResolverConfig> = {}): BoundaryResolverConfig {
  const config: BoundaryResolverConfig = {
    boundaryWindowUs: input.boundaryWindowUs ?? CONTENT_BLOCK_DEFAULTS.boundaryWindowUs,
    minimumBlockDurationUs: input.minimumBlockDurationUs ?? CONTENT_BLOCK_DEFAULTS.minimumBlockDurationUs,
    srtFallbackPaddingUs: input.srtFallbackPaddingUs ?? CONTENT_BLOCK_DEFAULTS.srtFallbackPaddingUs
  }
  if (![config.boundaryWindowUs, config.minimumBlockDurationUs, config.srtFallbackPaddingUs].every(Number.isSafeInteger)) {
    throw new Error('Boundary configuration phải là integer microseconds.')
  }
  if (config.boundaryWindowUs < 0 || config.srtFallbackPaddingUs < 0 || config.minimumBlockDurationUs <= 0) {
    throw new Error('Boundary configuration không hợp lệ.')
  }
  return config
}

function legalBoundary(
  pointUs: number,
  startUs: number,
  nextCueStartUs: number,
  allCues: readonly SourceDialogueCue[],
  config: BoundaryResolverConfig
): boolean {
  return Number.isSafeInteger(pointUs) &&
    pointUs - startUs >= config.minimumBlockDurationUs &&
    pointUs <= nextCueStartUs &&
    !allCues.some((cue) => isInsideCue(pointUs, cue))
}

function chooseCandidate(
  targetUs: number,
  startUs: number,
  nextCueStartUs: number,
  sourceDurationUs: number,
  sceneBoundaryUs: readonly number[],
  allCues: readonly SourceDialogueCue[],
  config: BoundaryResolverConfig
): { selectedUs: number; reason: 'exact-scene-match' | 'scene-near-srt' | 'srt-fallback'; reviewState: 'accepted' | 'needs-review' } {
  const candidates = sceneBoundaryUs
    .filter((pointUs) => Number.isSafeInteger(pointUs) && pointUs >= 0 && pointUs <= sourceDurationUs)
    .filter((pointUs) => Math.abs(pointUs - targetUs) <= config.boundaryWindowUs)
    .filter((pointUs) => legalBoundary(pointUs, startUs, nextCueStartUs, allCues, config))
    .sort((left, right) => Math.abs(left - targetUs) - Math.abs(right - targetUs) || left - right)

  const selectedUs = candidates[0]
  if (selectedUs !== undefined) {
    return {
      selectedUs,
      reason: selectedUs === targetUs ? 'exact-scene-match' : 'scene-near-srt',
      reviewState: 'accepted'
    }
  }

  const padded = Math.min(targetUs + config.srtFallbackPaddingUs, nextCueStartUs, sourceDurationUs)
  const fallback = legalBoundary(padded, startUs, nextCueStartUs, allCues, config)
    ? padded
    : targetUs
  if (!legalBoundary(fallback, startUs, nextCueStartUs, allCues, config)) {
    throw new Error(`Không tìm được boundary hợp lệ sau cue kết thúc tại ${targetUs} us.`)
  }
  return { selectedUs: fallback, reason: 'srt-fallback', reviewState: 'needs-review' }
}

export function resolveBlockBoundaries(input: ResolveBlockBoundariesInput): SourceContentBlock[] {
  const config = validateConfig(input.config)
  if (!Number.isSafeInteger(input.sourceDurationUs) || input.sourceDurationUs <= 0) {
    throw new Error('sourceDurationUs phải là integer dương.')
  }
  if (input.groups.length === 0) throw new Error('Không có dialogue group để tạo block.')
  if (input.allCues.length === 0) throw new Error('Không có source cue để tạo block.')

  const blocks: SourceContentBlock[] = []
  let startUs = 0
  for (const [index, group] of input.groups.entries()) {
    if (group.dialogue.length === 0) throw new Error(`Group ${group.id} không có dialogue.`)
    const firstCue = group.dialogue[0]
    const lastCue = group.dialogue[group.dialogue.length - 1]
    if (lastCue.sourceEndUs > input.sourceDurationUs) {
      throw new Error(`Cue ${lastCue.cueId} vượt quá source duration.`)
    }
    if (firstCue.sourceStartUs < startUs) {
      throw new Error(`Group ${group.id} chồng lên boundary trước.`)
    }
    const targetUs = lastCue.sourceEndUs
    const nextCueStartUs = index + 1 < input.groups.length
      ? input.groups[index + 1].dialogue[0].sourceStartUs
      : input.sourceDurationUs
    if (nextCueStartUs < targetUs) throw new Error(`Group ${group.id} bị overlap với group tiếp theo.`)

    const locked = input.lockedBoundaryUs?.[group.id]
    let selectedUs: number
    let reason: SourceContentBlock['boundary']['reason']
    let reviewState: SourceContentBlock['boundary']['reviewState']
    if (locked !== undefined) {
      if (!legalBoundary(locked, startUs, nextCueStartUs, input.allCues, config)) {
        throw new Error(`Locked boundary của block ${group.id} nằm trong cue hoặc không hợp lệ.`)
      }
      selectedUs = locked
      reason = 'manual-adjusted'
      reviewState = 'locked'
    } else if (index === input.groups.length - 1) {
      const final = chooseCandidate(
        input.sourceDurationUs,
        startUs,
        input.sourceDurationUs,
        input.sourceDurationUs,
        input.sceneBoundaryUs,
        input.allCues,
        config
      )
      selectedUs = final.selectedUs
      reason = final.reason
      reviewState = final.reviewState
    } else {
      const chosen = chooseCandidate(
        targetUs,
        startUs,
        nextCueStartUs,
        input.sourceDurationUs,
        input.sceneBoundaryUs,
        input.allCues,
        config
      )
      selectedUs = chosen.selectedUs
      reason = chosen.reason
      reviewState = chosen.reviewState
    }
    if (selectedUs <= startUs || selectedUs > nextCueStartUs || selectedUs > input.sourceDurationUs) {
      throw new Error(`Boundary của block ${group.id} không tạo được range liên tục.`)
    }
    const block: SourceContentBlock = {
      id: group.id,
      sourceRange: { startUs, endUs: selectedUs },
      cueIds: [...group.cueIds],
      dialogue: group.dialogue.map((cue) => ({ ...cue })),
      boundary: { targetUs, selectedUs, reason, reviewState },
      semantic: { ...group.semantic },
      issues: reason === 'srt-fallback'
        ? [...new Set([...group.issues, 'srt-fallback' as const])]
        : [...group.issues]
    }
    blocks.push(block)
    startUs = selectedUs
  }
  if (startUs !== input.sourceDurationUs) throw new Error('Boundary cuối không phủ đủ source duration.')
  return blocks
}
