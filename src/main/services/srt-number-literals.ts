/**
 * Extract numeric facts from SRT text in a representation that is stable
 * across Chinese number words and the Arabic digits normally used by a target
 * translation.  This is deliberately conservative: a bare 一 in a lexical
 * word such as 唯一 is not treated as the number 1 unless a counter/unit or a
 * numeric context makes that reading explicit.
 */

const FACT_TOKEN_PATTERN = /\[\[(?:MONEY|MEASURE)_[A-Za-z0-9:_-]+\]\]/gu
const DECIMAL_ZERO_RANGES = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66,
  0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0e50, 0x0ed0, 0x0f20, 0x1040,
  0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50,
  0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0,
  0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30, 0x11066, 0x110f0, 0x11136,
  0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650, 0x116c0, 0x11730, 0x118e0,
  0x11950, 0x11c50, 0x11d50, 0x11da0, 0x11f50, 0x1e140, 0x1e2f0, 0x1e950
] as const

const CJK_DIGITS: Readonly<Record<string, number>> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9
}
const CJK_UNITS: Readonly<Record<string, number>> = {
  十: 10, 百: 100, 千: 1_000, 万: 10_000, 亿: 100_000_000
}
const CJK_NUMERAL_PATTERN = /[零〇一二两三四五六七八九十百千万亿]+/gu
// Include common counters and semantic suffixes. The suffix set is used only
// when a Chinese numeral has no multiplier (for example 六公里, 三分钟),
// so ordinary lexical words such as 唯一, 我国 are still ignored.
const CJK_COUNTERS = new Set('个名只头匹条节辆列车人度米公里元块斤分秒年层号位岁国种款件次台月日周幅'.split(''))
const CJK_RANGE_OR_CONTEXT = new Set('第从到至约近共'.split(''))
// Some translations make the implicit "single" in phrases such as
// 单节车厢 explicit (for example Japanese 1両あたり). Treat only clear
// classifier forms as the value 1; do not treat lexical uses such as 单轨 or
// 单一 as numeric facts.
const CJK_SINGLETON_PATTERN = /[单單](?=个|只|頭|头|匹|條|条|節|节|輛|辆|列|人|層|层|位|種|种|款|件|次|臺|台)/gu

function normalizeDecimalDigits(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0
    const zero = DECIMAL_ZERO_RANGES.find((candidate) => code >= candidate && code < candidate + 10)
    return zero === undefined ? character : String(code - zero)
  }).join('')
}

function parseCjkNumeral(run: string): number | null {
  if (!run) return null
  // A run without a multiplier unit is commonly a sequence such as 二〇二五.
  if (![...run].some((character) => character in CJK_UNITS)) {
    const digits = [...run].map((character) => CJK_DIGITS[character])
    if (digits.some((digit) => digit === undefined)) return null
    return Number(digits.join(''))
  }

  let total = 0
  let section = 0
  let number = 0
  for (const character of run) {
    const digit = CJK_DIGITS[character]
    if (digit !== undefined) {
      number = digit
      continue
    }
    const unit = CJK_UNITS[character]
    if (unit === undefined) return null
    if (unit < 10_000) {
      section += (number || 1) * unit
      number = 0
    } else {
      section = (section + number) * unit
      total += section
      section = 0
      number = 0
    }
  }
  return total + section + number
}

function isMeaningfulCjkNumber(text: string, start: number, end: number, run: string): boolean {
  const previous = [...text.slice(0, start)].at(-1)
  const next = [...text.slice(end)].at(0)
  if ([...run].some((character) => character in CJK_UNITS)) {
    // If it is a bare single unit character (e.g. bare "十" without adjacent numbers),
    // require a surrounding counter, range word, or digit so words like "十幅", "万一" are not misclassified.
    if (run.length === 1) {
      return (next !== undefined && (CJK_COUNTERS.has(next) || CJK_RANGE_OR_CONTEXT.has(next) || next in CJK_DIGITS || /[\p{Nd}]/u.test(next))) ||
        (previous !== undefined && (CJK_RANGE_OR_CONTEXT.has(previous) || previous in CJK_DIGITS || /[\p{Nd}]/u.test(previous)))
    }
    return true
  }
  return (next !== undefined && (CJK_COUNTERS.has(next) || CJK_RANGE_OR_CONTEXT.has(next))) ||
    (previous !== undefined && CJK_RANGE_OR_CONTEXT.has(previous))
}

interface NumberMatch {
  index: number
  value: string
}

/** Return numeric facts with Chinese and Arabic spellings normalized. */
export function extractNumberLiterals(text: string): string[] {
  const source = text.replace(FACT_TOKEN_PATTERN, '')
  const matches: NumberMatch[] = []
  const decimalPattern = /[\p{Nd}]+(?:[.,][\p{Nd}]+)?/gu
  for (const match of source.matchAll(decimalPattern)) {
    matches.push({ index: match.index ?? 0, value: normalizeDecimalDigits(match[0]) })
  }
  for (const match of source.matchAll(CJK_NUMERAL_PATTERN)) {
    const index = match.index ?? 0
    if (!isMeaningfulCjkNumber(source, index, index + match[0].length, match[0])) continue
    const value = parseCjkNumeral(match[0])
    if (value !== null && Number.isFinite(value)) matches.push({ index, value: String(value) })
  }
  for (const match of source.matchAll(CJK_SINGLETON_PATTERN)) {
    matches.push({ index: match.index ?? 0, value: '1' })
  }
  return matches.sort((left, right) => left.index - right.index).map((item) => item.value)
}

export function sameNumberMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const counts = new Map<string, number>()
  for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1)
  for (const value of right) {
    const count = counts.get(value) ?? 0
    if (count <= 0) return false
    if (count === 1) counts.delete(value)
    else counts.set(value, count - 1)
  }
  return counts.size === 0
}

/** Extract the non-matching changed spans between two strings */
export function findChangedSpans(source: string, candidate: string): { sourceSpan: string; candidateSpan: string } {
  let prefixLen = 0
  while (prefixLen < source.length && prefixLen < candidate.length && source[prefixLen] === candidate[prefixLen]) {
    prefixLen++
  }
  let sourceSuffix = source.length - 1
  let candidateSuffix = candidate.length - 1
  while (sourceSuffix >= prefixLen && candidateSuffix >= prefixLen && source[sourceSuffix] === candidate[candidateSuffix]) {
    sourceSuffix--
    candidateSuffix--
  }
  const sourceSpan = source.slice(prefixLen, sourceSuffix + 1)
  const candidateSpan = candidate.slice(prefixLen, candidateSuffix + 1)
  return { sourceSpan, candidateSpan }
}

export function numericFactsChanged(source: string, candidate: string): boolean {
  const sourceNumbers = extractNumberLiterals(source)
  const candidateNumbers = extractNumberLiterals(candidate)
  if (sameNumberMultiset(sourceNumbers, candidateNumbers)) return false

  // If the raw extraction differed, perform changed-span analysis to avoid false positives
  // from CJK homophones (e.g. 五国 -> 我国, 十幅 -> 磁浮) in sentences containing numbers (CR450, 600).
  const { sourceSpan, candidateSpan } = findChangedSpans(source, candidate)
  const sourceSpanNumbers = extractNumberLiterals(sourceSpan)
  const candidateSpanNumbers = extractNumberLiterals(candidateSpan)

  if (sourceSpanNumbers.length === 0 && candidateSpanNumbers.length === 0) {
    return false
  }

  return true
}
