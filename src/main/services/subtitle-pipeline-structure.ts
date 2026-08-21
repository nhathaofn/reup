import type {
  CanonicalMeasurementMention,
  CanonicalMoneyMention,
  CanonicalSource,
  RestoredCue
} from '../../shared/features/srt-translator.ts'
import type {
  SubtitleEvidenceMatch,
  SubtitleFusionSummary
} from '../../shared/features/subtitle-pipeline.ts'
import { normalizeEvidenceText } from './subtitle-pipeline-fusion.ts'
import type { RestorationDraft } from './srt-source-restoration.ts'

export interface SubtitleOcrStructureCue {
  startMs: number
  endMs: number
  text: string
  repeatCount?: number
}

interface CueRange {
  startMs: number
  endMs: number
}

interface AlignedCue {
  cue: RestoredCue
  sourceCueNumber: number
}

const OCR_FRAME_MERGE_GAP_MS = 1_000
const STRUCTURE_CHARACTER_PATTERN = /[㐀-鿿぀-ヿ가-힯0-9]/u
const STRUCTURE_SCRIPT_PATTERN = /[㐀-鿿぀-ヿ가-힯]/u

function overlapMs(left: CueRange, right: CueRange): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs))
}

function ocrStructureSignature(value: string): string {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const compact = Array.from(normalized).filter((character) => STRUCTURE_CHARACTER_PATTERN.test(character)).join('')
  return compact.length >= 2 ? compact : normalizeEvidenceText(value)
}

function ocrScriptSignature(value: string): string {
  return Array.from(value.normalize('NFKC')).filter((character) => STRUCTURE_SCRIPT_PATTERN.test(character)).join('')
}

function sameDominantScript(left: string, right: string): boolean {
  const leftRuns = left.normalize('NFKC').match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu) ?? []
  const rightRuns = right.normalize('NFKC').match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu) ?? []
  const leftDominant = [...leftRuns].sort((a, b) => b.length - a.length)[0] ?? ''
  const rightDominant = [...rightRuns].sort((a, b) => b.length - a.length)[0] ?? ''
  if (Math.min(leftDominant.length, rightDominant.length) < 4) return false
  return leftDominant === rightDominant || leftDominant.includes(rightDominant) || rightDominant.includes(leftDominant)
}

function sameVisibleSurface(left: string, right: string): boolean {
  const leftSignature = ocrStructureSignature(left)
  const rightSignature = ocrStructureSignature(right)
  if (!leftSignature || !rightSignature) return false
  if (sameDominantScript(left, right)) return true
  if (leftSignature === rightSignature) return true
  if (leftSignature.includes(rightSignature) || rightSignature.includes(leftSignature)) {
    return Math.min(leftSignature.length, rightSignature.length) / Math.max(leftSignature.length, rightSignature.length) >= 0.70
  }
  return false
}

function representativeText(left: SubtitleOcrStructureCue, right: SubtitleOcrStructureCue): string {
  const leftSignature = ocrStructureSignature(left.text)
  const rightSignature = ocrStructureSignature(right.text)
  if (leftSignature === rightSignature) return left.text.length <= right.text.length ? left.text : right.text
  return leftSignature.length >= rightSignature.length ? left.text : right.text
}

function asStructureCue(source: SubtitleEvidenceMatch): SubtitleOcrStructureCue {
  return {
    startMs: source.startMs,
    endMs: source.endMs,
    text: source.text,
    ...(source.repeatCount !== undefined ? { repeatCount: source.repeatCount } : {})
  }
}

/**
 * Build a timing-only OCR template. OCR frames with the same visible script
 * are merged even when the recognizer appends changing background text such as
 * cabin safety instructions. The OCR words never become canonical output.
 */
export function buildOcrStructure(summary: SubtitleFusionSummary): SubtitleOcrStructureCue[] {
  const raw = summary.cues
    .flatMap((cue) => cue.sources.filter((source) => source.source === 'ocr').map(asStructureCue))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
  if (!raw.length) return []

  const hasScriptEvidence = raw.some((cue) => ocrScriptSignature(cue.text).length >= 2)
  const filtered = hasScriptEvidence
    ? raw.filter((cue) => ocrScriptSignature(cue.text).length >= 2)
    : raw

  const merged: SubtitleOcrStructureCue[] = []
  for (const cue of filtered) {
    const previous = merged[merged.length - 1]
    if (!previous) {
      merged.push({ ...cue })
      continue
    }
    const gapMs = cue.startMs - previous.endMs
    if (gapMs <= OCR_FRAME_MERGE_GAP_MS && sameVisibleSurface(previous.text, cue.text)) {
      previous.endMs = Math.max(previous.endMs, cue.endMs)
      previous.text = representativeText(previous, cue)
      if (previous.repeatCount !== undefined || cue.repeatCount !== undefined) {
        previous.repeatCount = (previous.repeatCount ?? 1) + (cue.repeatCount ?? 1)
      }
      continue
    }
    merged.push({ ...cue })
  }
  return merged
}

function parseSrtTimestamp(value: string): number | null {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/u)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const millis = Number(match[4])
  if (minutes > 59 || seconds > 59) return null
  return ((hours * 60 + minutes) * 60 + seconds) * 1_000 + millis
}

function parseCueRange(time: string): CueRange | null {
  const [start, end] = time.split('-->').map((value) => parseSrtTimestamp(value ?? ''))
  if (start === null || end === null || end <= start) return null
  return { startMs: start, endMs: end }
}

function formatSrtTimestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms))
  const hours = Math.floor(safe / 3_600_000)
  const minutes = Math.floor((safe % 3_600_000) / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1_000)
  const millis = safe % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function rangeForCue(cue: RestoredCue, summary: SubtitleFusionSummary): CueRange | null {
  const fused = summary.cues.find((item) => item.n === cue.n)
  if (fused) return { startMs: fused.startMs, endMs: fused.endMs }
  return parseCueRange(cue.time)
}

function structureAssignments(
  summary: SubtitleFusionSummary,
  structure: readonly SubtitleOcrStructureCue[]
): Map<number, SubtitleOcrStructureCue[]> {
  const assignments = new Map<number, SubtitleOcrStructureCue[]>()
  for (const structureCue of structure) {
    let bestCueNumber: number | undefined
    let bestOverlap = 0
    for (const fused of summary.cues) {
      const overlap = overlapMs(structureCue, fused)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestCueNumber = fused.n
      }
    }
    if (bestCueNumber === undefined || bestOverlap <= 0) continue
    const assigned = assignments.get(bestCueNumber) ?? []
    assigned.push(structureCue)
    assignments.set(bestCueNumber, assigned)
  }
  return assignments
}

function internalBoundaries(range: CueRange, structure: readonly SubtitleOcrStructureCue[]): number[] {
  const starts = structure
    .slice(1)
    .map((cue) => cue.startMs)
    .filter((startMs) => startMs > range.startMs && startMs < range.endMs)
  return [...new Set(starts)].sort((left, right) => left - right)
}

function isBoundaryPunctuation(character: string, nextCharacter: string | undefined): boolean {
  if ('，,、。！？!?；;：:'.includes(character)) return true
  return character === '.' && nextCharacter !== undefined && !/\d/u.test(nextCharacter)
}

function splitByPunctuation(text: string, count: number): string[] | null {
  if (count === 1) return [text.trim()]
  const parts: string[] = []
  let start = 0
  const characters = Array.from(text)
  let offset = 0
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!
    const nextCharacter = characters[index + 1]
    offset += character.length
    if (!isBoundaryPunctuation(character, nextCharacter)) continue
    const part = text.slice(start, offset).trim()
    if (part) parts.push(part)
    start = offset
  }
  const tail = text.slice(start).trim()
  if (tail) parts.push(tail)
  return parts.length === count ? parts : null
}

function normalizedWithOffsets(value: string): { text: string; endOffsets: number[] } {
  let text = ''
  const endOffsets: number[] = []
  let offset = 0
  for (const character of Array.from(value)) {
    const normalized = normalizeEvidenceText(character)
    for (const atom of Array.from(normalized)) {
      text += atom
      endOffsets.push(offset + character.length)
    }
    offset += character.length
  }
  return { text, endOffsets }
}

function splitByStructureText(
  text: string,
  structure: readonly SubtitleOcrStructureCue[],
  count: number
): string[] | null {
  if (count === 1) return [text.trim()]
  const indexed = normalizedWithOffsets(text)
  const boundaries: number[] = []
  let searchFrom = 0
  for (let index = 0; index < count - 1; index += 1) {
    const target = ocrStructureSignature(structure[index]?.text ?? '')
    if (!target) return null
    const position = indexed.text.indexOf(target, searchFrom)
    if (position < 0) return null
    const endOffset = indexed.endOffsets[position + target.length - 1]
    if (endOffset === undefined || endOffset <= (boundaries[boundaries.length - 1] ?? 0) || endOffset >= text.length) return null
    let boundary = endOffset
    while (boundary < text.length && /[\s，,、；;：:]/u.test(text[boundary] ?? '')) boundary += 1
    boundaries.push(boundary)
    searchFrom = position + target.length
  }

  const parts: string[] = []
  let start = 0
  for (const boundary of boundaries) {
    const part = text.slice(start, boundary).trim()
    if (!part) return null
    parts.push(part)
    start = boundary
  }
  const tail = text.slice(start).trim()
  if (!tail) return null
  parts.push(tail)
  return parts.length === count ? parts : null
}

function splitByRelativeLengths(text: string, referenceParts: readonly string[]): string[] | null {
  if (referenceParts.length <= 1) return [text.trim()]
  const characters = Array.from(text.trim())
  if (characters.length < referenceParts.length) return null
  const totalReferenceLength = referenceParts.reduce((sum, part) => sum + Math.max(1, Array.from(part).length), 0)
  const parts: string[] = []
  let cursor = 0
  for (let index = 0; index < referenceParts.length; index += 1) {
    if (index === referenceParts.length - 1) {
      const tail = characters.slice(cursor).join('').trim()
      if (!tail) return null
      parts.push(tail)
      break
    }
    const referenceLength = Math.max(1, Array.from(referenceParts[index] ?? '').length)
    const remainingParts = referenceParts.length - index - 1
    const remainingCharacters = characters.length - cursor
    const proposed = Math.round((referenceLength / totalReferenceLength) * characters.length)
    const end = Math.min(remainingCharacters - remainingParts, Math.max(1, proposed)) + cursor
    const part = characters.slice(cursor, end).join('').trim()
    if (!part) return null
    parts.push(part)
    cursor = end
  }
  return parts.length === referenceParts.length ? parts : null
}

function splitText(
  text: string,
  structure: readonly SubtitleOcrStructureCue[],
  partCount: number
): string[] | null {
  const punctuationParts = splitByPunctuation(text, partCount)
  if (punctuationParts) return punctuationParts
  const structureParts = splitByStructureText(text, structure, partCount)
  if (structureParts) return structureParts
  return null
}

function splitCue(
  cue: RestoredCue,
  range: CueRange,
  structure: readonly SubtitleOcrStructureCue[]
): RestoredCue[] {
  if (cue.finalAction === 'drop') return [cue]
  const boundaries = internalBoundaries(range, structure)
  if (!boundaries.length) return [cue]
  const partCount = boundaries.length + 1
  const correctedParts = splitText(cue.correctedZh, structure, partCount)
  if (!correctedParts) return [cue]
  const originalParts = splitText(cue.originalZh, structure, partCount) ?? splitByRelativeLengths(cue.originalZh, correctedParts)
  if (!originalParts) return [cue]
  const meaningParts = splitByPunctuation(cue.meaningVi, partCount)
  const timeBoundaries = [range.startMs, ...boundaries, range.endMs]

  return correctedParts.map((correctedZh, index) => {
    const originalZh = originalParts[index] ?? cue.originalZh
    return {
      ...cue,
      n: 0,
      time: `${formatSrtTimestamp(timeBoundaries[index]!)} --> ${formatSrtTimestamp(timeBoundaries[index + 1]!)}`,
      originalZh,
      correctedZh,
      meaningVi: meaningParts?.[index] ?? (index === 0 ? cue.meaningVi : ''),
      changed: originalZh !== correctedZh,
      candidates: []
    }
  })
}

function alignCuesWithOrigins(
  cues: readonly RestoredCue[],
  summary: SubtitleFusionSummary
): AlignedCue[] {
  const structure = buildOcrStructure(summary)
  if (!structure.length) return cues.map((cue) => ({ cue: { ...cue }, sourceCueNumber: cue.n }))
  const assignments = structureAssignments(summary, structure)
  const aligned: AlignedCue[] = []
  for (const cue of cues) {
    const range = rangeForCue(cue, summary)
    const assigned = assignments.get(cue.n) ?? []
    const pieces = range ? splitCue(cue, range, assigned) : [cue]
    for (const piece of pieces) aligned.push({ cue: piece, sourceCueNumber: cue.n })
  }
  return aligned.map((item, index) => ({
    ...item,
    cue: { ...item.cue, n: index + 1 }
  }))
}

function normalizedIncludes(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeEvidenceText(needle)
  return Boolean(normalizedNeedle) && normalizeEvidenceText(haystack).includes(normalizedNeedle)
}

function remapMentionCueNumbers<T extends CanonicalMoneyMention | CanonicalMeasurementMention>(
  mentions: readonly T[],
  piecesBySourceCue: ReadonlyMap<number, RestoredCue[]>
): T[] {
  return mentions.map((mention) => {
    const pieces = piecesBySourceCue.get(mention.cueNumber)
    if (!pieces?.length) return { ...mention }
    const target = pieces.find((piece) => normalizedIncludes(piece.correctedZh, mention.sourceSurface) || normalizedIncludes(piece.originalZh, mention.sourceSurface))
    return { ...mention, cueNumber: target?.n ?? pieces[pieces.length - 1]!.n }
  })
}

function remapUnresolvedCueNumbers(
  unresolvedCueNumbers: readonly number[],
  piecesBySourceCue: ReadonlyMap<number, RestoredCue[]>
): number[] {
  return [...new Set(unresolvedCueNumbers.flatMap((cueNumber) => piecesBySourceCue.get(cueNumber)?.map((cue) => cue.n) ?? [cueNumber]))].sort((left, right) => left - right)
}

export function alignRestoredCuesToOcrStructure(
  cues: readonly RestoredCue[],
  summary: SubtitleFusionSummary
): RestoredCue[] {
  return alignCuesWithOrigins(cues, summary).map((item) => item.cue)
}

export function alignRestorationDraftToOcrStructure(
  draft: RestorationDraft,
  summary: SubtitleFusionSummary
): RestorationDraft {
  const aligned = alignCuesWithOrigins(draft.cues, summary)
  const piecesBySourceCue = new Map<number, RestoredCue[]>()
  for (const item of aligned) {
    const pieces = piecesBySourceCue.get(item.sourceCueNumber) ?? []
    pieces.push(item.cue)
    piecesBySourceCue.set(item.sourceCueNumber, pieces)
  }
  return {
    ...draft,
    cues: aligned.map((item) => item.cue),
    moneyMentions: remapMentionCueNumbers(draft.moneyMentions, piecesBySourceCue),
    measurementMentions: remapMentionCueNumbers(draft.measurementMentions, piecesBySourceCue)
  }
}

export function alignCanonicalToOcrStructure(
  canonical: CanonicalSource,
  summary: SubtitleFusionSummary
): CanonicalSource {
  const aligned = alignCuesWithOrigins(canonical.cues, summary)
  const piecesBySourceCue = new Map<number, RestoredCue[]>()
  for (const item of aligned) {
    const pieces = piecesBySourceCue.get(item.sourceCueNumber) ?? []
    pieces.push(item.cue)
    piecesBySourceCue.set(item.sourceCueNumber, pieces)
  }
  return {
    ...canonical,
    cues: aligned.map((item) => item.cue),
    moneyMentions: remapMentionCueNumbers(canonical.moneyMentions, piecesBySourceCue),
    measurementMentions: remapMentionCueNumbers(canonical.measurementMentions, piecesBySourceCue),
    unresolvedCueNumbers: remapUnresolvedCueNumbers(canonical.unresolvedCueNumbers, piecesBySourceCue)
  }
}
