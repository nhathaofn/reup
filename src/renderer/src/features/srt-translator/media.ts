import type { SrtReviewCue } from '../../../../shared/features/srt-translator.ts'

export function localMediaUrl(path: string): string {
  const bytes = new TextEncoder().encode(path)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `tediapros://b64/${b64}`
}

export function reviewClipRange(cue: Pick<SrtReviewCue, 'startSeconds' | 'endSeconds'>): {
  startSeconds: number
  endSeconds: number
} {
  return {
    startSeconds: Math.max(0, cue.startSeconds - 1.5),
    endSeconds: cue.endSeconds + 2
  }
}
