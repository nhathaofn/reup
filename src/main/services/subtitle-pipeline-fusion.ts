import type {
  SubtitleEvidenceCue,
  SubtitleEvidenceMatch,
  SubtitleFusedCue,
  SubtitleFusionSummary,
  SubtitlePipelineRegion,
  SubtitlePipelineSource
} from '../../shared/features/subtitle-pipeline.ts'
import { parseStrictSrtText } from './srt-source-validation.ts'

export interface SubtitleEvidenceTrackInput {
  source: SubtitlePipelineSource
  text: string
  path?: string
  language?: string | null
  region?: SubtitlePipelineRegion
}

export interface SubtitleFusionOptions {
  /** Source used for the canonical text when more than one track is present. */
  primarySource?: SubtitlePipelineSource
  /** Maximum cross-source distance used to associate cues. */
  maxDistanceMs?: number
}

const DEFAULT_MAX_DISTANCE_MS = 700
const SOURCE_ORDER: SubtitlePipelineSource[] = ['srt', 'asr', 'ocr']

function emptySourceCounts(): Record<SubtitlePipelineSource, number> {
  return { asr: 0, ocr: 0, srt: 0 }
}

function safeText(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim()
}

/** Normalize only for comparison; the original text is never rewritten here. */
export function normalizeEvidenceText(value: string): string {
  return safeText(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\[speaker_\d+\]/giu, '')
    .replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, '')
}

function editDistance(left: readonly string[], right: readonly string[]): number {
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1]
    for (let j = 0; j < right.length; j += 1) {
      current.push(
        Math.min(
          current[j] + 1,
          previous[j + 1] + 1,
          previous[j] + (left[i] === right[j] ? 0 : 1)
        )
      )
    }
    previous = current
  }
  return previous[right.length] ?? Math.max(left.length, right.length)
}

/** A conservative text similarity score in the range 0..1. */
export function evidenceTextSimilarity(left: string, right: string): number {
  const a = normalizeEvidenceText(left)
  const b = normalizeEvidenceText(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  const distance = editDistance([...a], [...b])
  return Math.max(0, 1 - distance / Math.max(a.length, b.length))
}

/**
 * A semantic replacement is independently corroborated only when the exact
 * normalized surface appears in at least two different evidence tracks. This
 * lets ASR + OCR overrule a bad reference SRT while keeping a one-versus-one
 * disagreement reviewable.
 */
export function isTextCorroboratedByEvidence(
  evidence: Pick<SubtitleFusionSummary, 'cues'> | undefined,
  cueNumber: number,
  candidate: string,
  minimumSources = 2
): boolean {
  const normalized = normalizeEvidenceText(candidate)
  if (!normalized || minimumSources < 1) return false
  const cue = evidence?.cues.find((item) => item.n === cueNumber)
  if (!cue) return false
  const matchingSources = cue.sources
    .filter((source) => {
      const srcNorm = normalizeEvidenceText(source.text)
      if (!srcNorm) return false
      if (srcNorm === normalized) return true
      if (srcNorm.includes(normalized) || normalized.includes(srcNorm)) {
        return evidenceTextSimilarity(srcNorm, normalized) >= 0.70
      }
      return evidenceTextSimilarity(srcNorm, normalized) >= 0.85
    })
  const sources = new Set(matchingSources.map((source) => source.source))
  return sources.size >= minimumSources
}

function overlapMs(left: SubtitleEvidenceCue, right: SubtitleEvidenceCue): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs))
}

function distanceMs(left: SubtitleEvidenceCue, right: SubtitleEvidenceCue): number {
  if (left.endMs < right.startMs) return right.startMs - left.endMs
  if (right.endMs < left.startMs) return left.startMs - right.endMs
  return 0
}

function isRelated(left: SubtitleEvidenceCue, right: SubtitleEvidenceCue, maxDistance: number): boolean {
  const overlap = overlapMs(left, right)
  const shorter = Math.max(1, Math.min(left.endMs - left.startMs, right.endMs - right.startMs))
  const similarity = evidenceTextSimilarity(left.text, right.text)
  // Matching time ranges are the strongest signal.  This intentionally allows
  // low text similarity: a title or an ASR homophone can be a genuine conflict
  // that the AI/review stage must see rather than being silently discarded.
  if (overlap / shorter >= 0.2) return true
  const distance = distanceMs(left, right)
  if (distance <= maxDistance && similarity >= 0.35) return true
  return distance <= Math.min(180, maxDistance) && (left.source === 'ocr' || right.source === 'ocr')
}

/**
 * Deduplicate and temporally group raw frame-by-frame OCR recognitions.
 * Consecutively repeated OCR cues with high text similarity (>= 0.70 or substring)
 * and close timestamps (gap <= 2000ms) are merged into a single consolidated cue
 * with `repeatCount` reflecting the number of frames it appeared in.
 * Isolated single-frame noise (e.g. text length < 2 or duration <= 200ms) is filtered out.
 */
export function dedupOcrCues(cues: readonly SubtitleEvidenceCue[]): SubtitleEvidenceCue[] {
  const ocrCues = cues.filter((c) => c.text.trim())
  if (!ocrCues.length) return []

  const sorted = [...ocrCues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const groups: SubtitleEvidenceCue[][] = []

  for (const cue of sorted) {
    const currentGroup = groups[groups.length - 1]
    if (!currentGroup || !currentGroup.length) {
      groups.push([cue])
      continue
    }
    const last = currentGroup[currentGroup.length - 1]
    const gap = cue.startMs - last.endMs
    const overlaps = cue.startMs <= last.endMs || gap <= 2000
    const firstText = currentGroup[0].text
    const similarityFirst = evidenceTextSimilarity(firstText, cue.text)
    const similarityLast = evidenceTextSimilarity(last.text, cue.text)
    const normFirst = normalizeEvidenceText(firstText)
    const normCue = normalizeEvidenceText(cue.text)
    const isSimilar = similarityFirst >= 0.70 || similarityLast >= 0.70 ||
      (normFirst.length >= 2 && normCue.includes(normFirst)) ||
      (normCue.length >= 2 && normFirst.includes(normCue))

    if (overlaps && isSimilar) {
      currentGroup.push(cue)
    } else {
      groups.push([cue])
    }
  }

  const result: SubtitleEvidenceCue[] = []
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    if (!group || !group.length) continue
    const first = group[0]
    const minStart = Math.min(...group.map((c) => c.startMs))
    const maxEnd = Math.max(...group.map((c) => c.endMs))
    const duration = maxEnd - minStart
    const repeatCount = group.reduce((sum, c) => sum + (c.repeatCount ?? 1), 0)

    // Select the best representative text: longest normalized string or most frequent
    const textScores = group.map((c) => {
      const norm = normalizeEvidenceText(c.text)
      const freq = group.filter((o) => normalizeEvidenceText(o.text) === norm).length
      return { text: c.text, score: freq * 100 + norm.length }
    })
    textScores.sort((a, b) => b.score - a.score)
    const bestText = textScores[0]?.text ?? first.text

    // Filter isolated single-frame noise: repeatCount === 1 AND (length < 2 or duration <= 200ms)
    const normalizedBest = normalizeEvidenceText(bestText)
    if (repeatCount === 1 && (normalizedBest.length < 2 || duration <= 200)) {
      continue
    }

    result.push({
      ...first,
      id: `ocr:${i + 1}`,
      n: i + 1,
      startMs: minStart,
      endMs: maxEnd,
      text: bestText,
      repeatCount
    })
  }

  return result
}

function toEvidenceCues(input: SubtitleEvidenceTrackInput): SubtitleEvidenceCue[] {
  const path = input.path ?? `${input.source}.srt`
  const cues = parseStrictSrtText(input.text, path)
  const parsed = cues.map((cue) => ({
    id: `${input.source}:${cue.n}`,
    source: input.source,
    n: cue.n,
    startMs: Math.round(cue.startSeconds * 1_000),
    endMs: Math.round(cue.endSeconds * 1_000),
    text: safeText(cue.text),
    confidence: null,
    language: input.language ?? null,
    speaker: cue.speakerLabel ?? null,
    ...(input.region ? { region: input.region } : {})
  }))
  if (input.source === 'ocr') {
    return dedupOcrCues(parsed)
  }
  return parsed
}

export function parseEvidenceTracks(inputs: readonly SubtitleEvidenceTrackInput[]): SubtitleEvidenceCue[] {
  const result: SubtitleEvidenceCue[] = []
  for (const input of inputs) result.push(...toEvidenceCues(input))
  return result
}

function sourcePriority(source: SubtitlePipelineSource, preferred: SubtitlePipelineSource): number {
  if (source === preferred) return 0
  const index = SOURCE_ORDER.indexOf(source)
  return index < 0 ? SOURCE_ORDER.length : index + 1
}

function choosePreferredSource(
  cues: readonly SubtitleEvidenceCue[],
  preferred?: SubtitlePipelineSource
): SubtitlePipelineSource {
  if (preferred && cues.some((cue) => cue.source === preferred)) return preferred
  for (const source of SOURCE_ORDER) if (cues.some((cue) => cue.source === source)) return source
  return 'asr'
}

function asMatch(cue: SubtitleEvidenceCue, primary: SubtitleEvidenceCue): SubtitleEvidenceMatch {
  return {
    ...cue,
    similarity: cue.id === primary.id ? 1 : evidenceTextSimilarity(primary.text, cue.text),
    overlapMs: overlapMs(primary, cue),
    distanceMs: distanceMs(primary, cue),
    ...(cue.repeatCount !== undefined ? { repeatCount: cue.repeatCount } : {})
  }
}

function clusterConfidence(cluster: readonly SubtitleEvidenceCue[], conflict: boolean): SubtitleFusedCue['confidence'] {
  if (conflict) return 'low'
  if (cluster.length >= 2) return 'high'
  const only = cluster[0]
  if (!only || only.text.length < 2 || only.endMs - only.startMs <= 100) return 'low'
  return 'medium'
}

function clusterConflict(cluster: readonly SubtitleEvidenceCue[], primary: SubtitleEvidenceCue): boolean {
  const normPrimary = normalizeEvidenceText(primary.text)
  const otherTexts = cluster
    .filter((cue) => cue.id !== primary.id && cue.text.trim())

  // In CJK languages, even a single ideograph difference (e.g. 五 vs 我, 手 vs 守)
  // in a sentence is a significant homophone conflict that must be exposed for review.
  return otherTexts.some((cue) => {
    const normOther = normalizeEvidenceText(cue.text)
    if (!normOther || normPrimary === normOther) return false
    return true
  })
}

/**
 * Align and fuse independently timed evidence tracks without throwing away
 * disagreements.  The function is deterministic and contains no AI/network
 * calls, which makes it safe to use as the first pipeline stage and easy to
 * test with synthetic SRTs.
 *
 * The assignment strategy is **maximum-overlap-wins**: each secondary cue
 * (OCR / SRT) is pre-assigned to the preferred-source anchor (ASR cue) that
 * maximises temporal overlap.  This prevents an OCR cue that starts just
 * after one anchor from being stolen by that anchor when it actually has
 * massive overlap with the next one.
 */
export function fuseSubtitleEvidence(
  tracks: readonly SubtitleEvidenceTrackInput[],
  options: SubtitleFusionOptions = {}
): SubtitleFusionSummary {
  const all = parseEvidenceTracks(tracks).filter((cue) => cue.text.trim())
  const sourceCounts = emptySourceCounts()
  for (const cue of all) sourceCounts[cue.source] += 1
  if (!all.length) return { cues: [], sourceCounts, conflictCueNumbers: [] }

  const maxDistance = Number.isFinite(options.maxDistanceMs) && (options.maxDistanceMs ?? 0) >= 0
    ? Math.round(options.maxDistanceMs as number)
    : DEFAULT_MAX_DISTANCE_MS
  const preferred = choosePreferredSource(all, options.primarySource)
  const ordered = [...all].sort((left, right) =>
    left.startMs - right.startMs ||
    sourcePriority(left.source, preferred) - sourcePriority(right.source, preferred) ||
    left.n - right.n
  )
  const used = new Set<string>()
  const fused: Omit<SubtitleFusedCue, 'n'>[] = []

  // ---------------------------------------------------------------------------
  // MAXIMUM-OVERLAP PRE-ASSIGNMENT
  //
  // For each non-preferred cue, find the preferred-source anchor with the
  // highest temporal overlap.  Ties broken by minimum distance.  During the
  // greedy loop below a candidate is only claimed by a base when that base
  // IS the candidate's best anchor — this guarantees an OCR cue 80 ms after
  // ASR cue A (overlap 0) is NOT stolen by A when ASR cue B overlaps it by
  // 2000 ms.
  // ---------------------------------------------------------------------------
  const bases = ordered.filter((cue) => cue.source === preferred)
  const bestAnchorForSecondary = new Map<string, string>()

  for (const sec of ordered) {
    if (sec.source === preferred) continue
    let bestId: string | null = null
    let bestOv = 0
    let bestDist = Infinity
    for (const anchor of bases) {
      if (!isRelated(anchor, sec, maxDistance)) continue
      const ov = overlapMs(anchor, sec)
      const dist = distanceMs(anchor, sec)
      if (ov > bestOv || (ov === bestOv && dist < bestDist)) {
        bestId = anchor.id
        bestOv = ov
        bestDist = dist
      }
    }
    if (bestId) bestAnchorForSecondary.set(sec.id, bestId)
  }

  // ---------------------------------------------------------------------------
  // GREEDY CLUSTERING (with best-anchor constraint)
  // ---------------------------------------------------------------------------
  for (const base of [...bases, ...ordered.filter((cue) => cue.source !== preferred)]) {
    if (used.has(base.id)) continue
    const cluster: SubtitleEvidenceCue[] = [base]
    used.add(base.id)
    for (const candidate of ordered) {
      if (used.has(candidate.id) || candidate.source === base.source) continue
      if (!isRelated(base, candidate, maxDistance)) continue
      // Only claim this candidate when this base IS its best anchor.
      // If a better-overlapping anchor exists, let that anchor claim it instead.
      const best = bestAnchorForSecondary.get(candidate.id)
      if (best && best !== base.id) continue
      cluster.push(candidate)
      used.add(candidate.id)
    }
    const primary = cluster.find((cue) => cue.source === preferred) ?? base
    const conflict = cluster.length > 1 && clusterConflict(cluster, primary)

    // SMART HEURISTIC SELECTION:
    // When ASR and OCR conflict (and no user SRT is present):
    // If OCR has sustained multi-frame evidence (repeatCount >= 2) and ASR shows
    // homophone/phonetic relationship to OCR, choose the corroborated OCR text
    // for the fallback fused SRT while anchoring timestamps to narration ASR.
    let selectedText = primary.text
    let selectedSource = primary.source
    if (conflict && preferred === 'asr' && !cluster.some((c) => c.source === 'srt')) {
      const ocrCandidate = cluster.find((c) => c.source === 'ocr')
      const asrCandidate = cluster.find((c) => c.source === 'asr')
      if (ocrCandidate && asrCandidate) {
        const ocrRep = ocrCandidate.repeatCount ?? 1
        const sim = evidenceTextSimilarity(asrCandidate.text, ocrCandidate.text)

        // HARD GUARD: OCR must not replace ASR when both overlap and similarity
        // are too weak.  This prevents a wrongly-clustered OCR remnant from
        // overwriting a perfectly good ASR cue.
        const ov = overlapMs(asrCandidate, ocrCandidate)
        const shorter = Math.max(1, Math.min(
          asrCandidate.endMs - asrCandidate.startMs,
          ocrCandidate.endMs - ocrCandidate.startMs
        ))
        const overlapRatio = ov / shorter
        const canReplace = overlapRatio >= 0.25 || sim >= 0.30

        if (canReplace && ocrRep >= 2 && (sim >= 0.30 || Math.abs(ocrCandidate.text.length - asrCandidate.text.length) <= 3)) {
          selectedText = ocrCandidate.text
          selectedSource = 'ocr'
        }
      }
    }

    fused.push({
      startMs: primary.startMs,
      endMs: primary.endMs,
      text: selectedText,
      primarySource: selectedSource,
      confidence: clusterConfidence(cluster, conflict),
      conflict,
      sources: cluster
        .sort((left, right) => sourcePriority(left.source, preferred) - sourcePriority(right.source, preferred))
        .map((cue) => asMatch(cue, primary))
    })
  }

  fused.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
  const cues = fused.map((cue, index) => ({ ...cue, n: index + 1 }))
  return {
    cues,
    sourceCounts,
    conflictCueNumbers: cues.filter((cue) => cue.conflict).map((cue) => cue.n)
  }
}

function timestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms))
  const hours = Math.floor(safe / 3_600_000)
  const minutes = Math.floor((safe % 3_600_000) / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1_000)
  const millis = safe % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function buildFusedSrt(cues: readonly SubtitleFusedCue[]): string {
  return cues.map((cue) => `${cue.n}\n${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${cue.text}\n`).join('\n')
}

export function serializeFusionEvidence(summary: SubtitleFusionSummary): string {
  return JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceCounts: summary.sourceCounts,
    conflictCueNumbers: summary.conflictCueNumbers,
    cues: summary.cues
  }, null, 2)
}
