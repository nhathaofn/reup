import { extname } from 'node:path'
import type {
  LocaleAssetManifest,
  RenderTimeline,
  SourceBlockManifest
} from '../../shared/features/content-blocks.ts'
import {
  assertSourceFingerprint,
  assertLocaleMatchesSource,
  fingerprintSourceManifest,
  validateRenderTimeline,
  validateSourceBlockManifest
} from './contentBlockManifest.ts'
import type {
  NativeCapCutAudioItem,
  NativeCapCutTextItem,
  NativeCapCutVideoItem
} from './nativeCapCutGenerator.ts'

export interface CapCutBlockAdapterInput {
  source: SourceBlockManifest
  locale: LocaleAssetManifest
  timeline: RenderTimeline
  width: number
  height: number
  muteOriginalVideo: boolean
}

export interface CapCutBlockItems {
  videoItems: NativeCapCutVideoItem[]
  audioItems: NativeCapCutAudioItem[]
  textItems: NativeCapCutTextItem[]
  warnings: string[]
}

export function adaptRenderTimelineToCapCut(input: CapCutBlockAdapterInput): CapCutBlockItems {
  validateSourceBlockManifest(input.source)
  assertLocaleMatchesSource(input.locale, input.source)
  validateRenderTimeline(input.timeline)
  assertSourceFingerprint(input.timeline.sourceManifestFingerprint, fingerprintSourceManifest(input.source), 'Timeline')
  if (!Number.isInteger(input.width) || input.width <= 0 || !Number.isInteger(input.height) || input.height <= 0) {
    throw new Error('Kích thước CapCut phải là số nguyên dương.')
  }
  if (input.timeline.reviewBlockIds.length) throw new Error(`Timeline còn block needs-review: ${input.timeline.reviewBlockIds.join(', ')}.`)

  const localeByCueId = new Map(
    Object.values(input.locale.blocks).flatMap((block) => block.cues.map((cue) => [cue.cueId, cue] as const))
  )
  const videoExtension = extname(input.source.source.path) || '.mp4'
  const videoAssetName = `tblao-source-video${videoExtension}`
  const videoItems: NativeCapCutVideoItem[] = []
  const audioItems: NativeCapCutAudioItem[] = []
  const textItems: NativeCapCutTextItem[] = []
  const warnings: string[] = []
  for (const item of input.timeline.items) {
    const sourceDurationSeconds = (item.sourceEndUs - item.sourceStartUs) / 1_000_000
    videoItems.push({
      sourcePath: input.source.source.path,
      assetName: videoAssetName,
      startSeconds: item.timelineStartUs / 1_000_000,
      durationSeconds: (item.timelineEndUs - item.timelineStartUs) / 1_000_000,
      sourceStartSeconds: item.sourceStartUs / 1_000_000,
      sourceDurationSeconds,
      assetDurationSeconds: input.source.source.durationUs / 1_000_000,
      speed: item.mediaSpeed,
      width: input.width,
      height: input.height,
      volume: input.muteOriginalVideo ? 0 : 1
    })
    if (item.adaptation === 'stretch-with-warning') warnings.push(...item.warnings)
    for (const cue of item.subtitleCues) {
      const localeCue = localeByCueId.get(cue.cueId)
      if (!localeCue) throw new Error(`Không tìm thấy voice asset cho cue ${cue.cueId}.`)
      const durationSeconds = localeCue.voiceDurationUs / 1_000_000
      const extension = extname(localeCue.voicePath) || '.wav'
      audioItems.push({
        sourcePath: localeCue.voicePath,
        assetName: `tblao-${cue.cueId}${extension}`,
        startSeconds: cue.startUs / 1_000_000,
        durationSeconds,
        sourceDurationSeconds: durationSeconds,
        speed: 1,
        volume: 1
      })
      textItems.push({
        startSeconds: cue.startUs / 1_000_000,
        durationSeconds: (cue.endUs - cue.startUs) / 1_000_000,
        text: cue.text
      })
    }
  }
  return { videoItems, audioItems, textItems, warnings }
}
