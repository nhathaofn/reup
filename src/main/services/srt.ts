import { readFileSync } from 'node:fs'

/** Mot cue SRT sau khi da tach timestamp va noi dung. */
export interface ParsedSrtCue {
  a: string
  b: string
  chu: string
}

/** Tach SRT thanh danh sach cue, khong phu thuoc vao so thu tu cua cue. */
export function parseSrt(srtRaw: string): ParsedSrtCue[] {
  const out: ParsedSrtCue[] = []
  const cleanText = srtRaw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = cleanText.split('\n')

  let currentCue: { a: string; b: string; textLines: string[] } | null = null

  const pushCurrent = (): void => {
    if (!currentCue || currentCue.textLines.length === 0) return
    while (
      currentCue.textLines.length > 1 &&
      /^\d+$/.test(currentCue.textLines[currentCue.textLines.length - 1])
    ) {
      currentCue.textLines.pop()
    }
    out.push({
      a: currentCue.a,
      b: currentCue.b,
      chu: currentCue.textLines.join('\\N').replace(/[{}]/g, '')
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.includes('-->')) {
      pushCurrent()
      const parts = line.split('-->')
      currentCue = {
        a: parts[0].trim(),
        b: parts[1].trim(),
        textLines: []
      }
    } else if (currentCue) {
      if (/^\d+$/.test(line) && currentCue.textLines.length === 0) continue
      if (line.length > 0) currentCue.textLines.push(line)
    }
  }

  pushCurrent()
  return out
}

/** SRT timestamp (HH:MM:SS,mmm) -> giay. */
export function srtTimeToSeconds(timestamp: string): number {
  const match = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(timestamp.trim())
  if (!match) return 0
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  )
}

/** Doc SRT va thu tu nhan dien UTF-8/UTF-16/EUC-KR nhu luong burn hien tai. */
export function readSrtFile(filePath: string): string {
  const buffer = readFileSync(filePath)
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    try {
      return new TextDecoder('utf-16be').decode(buffer)
    } catch {
      return buffer.toString('utf16le')
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8').slice(1)
  }

  const utf8 = buffer.toString('utf8')
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('euc-kr').decode(buffer)
    } catch {
      return buffer.toString('latin1')
    }
  }
  return utf8
}

/**
 * Chuyen doi danh sach cue SRT sang bieu thuc enable cho filter overlay cua FFmpeg.
 * Gop cac khoang thoi gian lien ke/chong lap de toi uu bieu thuc.
 */
export function buildSrtTimelineExpression(cues: ParsedSrtCue[]): string {
  if (!cues || cues.length === 0) return ''

  const intervals: Array<{ start: number; end: number }> = []
  for (const c of cues) {
    const start = srtTimeToSeconds(c.a)
    const end = srtTimeToSeconds(c.b)
    if (end > start) {
      intervals.push({ start, end })
    }
  }

  if (intervals.length === 0) return ''

  intervals.sort((a, b) => a.start - b.start)

  const merged: Array<{ start: number; end: number }> = [intervals[0]]
  for (let i = 1; i < intervals.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = intervals[i]
    if (curr.start <= prev.end + 0.05) {
      prev.end = Math.max(prev.end, curr.end)
    } else {
      merged.push(curr)
    }
  }

  const parts = merged.map((inv) => {
    const s = Number(inv.start.toFixed(3))
    const e = Number(inv.end.toFixed(3))
    return `between(t,${s},${e})`
  })

  return parts.join('+')
}
