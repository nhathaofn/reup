import type { RenderTimeline } from '../../shared/features/content-blocks.ts'
import { validateRenderTimeline } from './contentBlockManifest.ts'

export function formatSrtTimestampUs(valueUs: number): string {
  if (!Number.isSafeInteger(valueUs) || valueUs < 0) throw new Error('Timestamp SRT phải là integer microseconds không âm.')
  const milliseconds = Math.round(valueUs / 1_000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const millis = milliseconds % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function serializeRenderTimelineSrt(timeline: RenderTimeline): string {
  validateRenderTimeline(timeline)
  const cues = timeline.items.flatMap((item) => item.subtitleCues)
  let previousEndUs = 0
  const blocks = cues.map((cue, index) => {
    if (cue.startUs < previousEndUs || cue.endUs > timeline.durationUs) {
      throw new Error(`Subtitle ${cue.cueId} overlap hoặc vượt output duration.`)
    }
    previousEndUs = cue.endUs
    return `${index + 1}\n${formatSrtTimestampUs(cue.startUs)} --> ${formatSrtTimestampUs(cue.endUs)}\n${cue.text}`
  })
  return `${blocks.join('\n\n')}\n`
}
