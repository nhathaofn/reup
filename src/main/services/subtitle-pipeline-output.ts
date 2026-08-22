import type { CanonicalSource } from '../../shared/features/srt-translator.ts'

/**
 * Materialize the canonical transcript. Rows marked `drop` stay available in
 * evidence/review artifacts but are excluded here; SRT indices are then
 * renumbered so the deliverable is valid and contiguous.
 */
export function buildCanonicalSrt(canonical: CanonicalSource): string {
  const finalCues = canonical.cues.filter((cue) => cue.finalAction !== 'drop')
  return finalCues.map((cue, index) => {
    const text = cue.finalAction === 'fallback' ? cue.originalZh : cue.correctedZh
    return `${index + 1}\n${cue.time}\n${text}\n`
  }).join('\n')
}
