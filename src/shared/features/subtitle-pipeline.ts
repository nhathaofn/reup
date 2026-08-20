import type { FeatureMetadata } from './contracts'
import type { SrtLocaleTargetInput } from './srt-translator'

/**
 * Unified subtitle acquisition workflow.
 *
 * ASR and OCR are deliberately modelled as different evidence sources.  A
 * visible caption is not automatically a spoken sentence and a Whisper
 * hypothesis is not automatically the text visible in the frame.
 */
export const FEATURE_ID = 'subtitle-pipeline' as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: 'Phụ đề thông minh',
  icon: '🎙️',
  title: 'Pipeline phụ đề thông minh',
  subtitle: 'Kết hợp lời nói, chữ trên hình và AI trong một quy trình',
  placement: 'main',
  keepAlive: true
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const FEATURE_CHANNELS = {
  run: `${FEATURE_ID}:run`,
  cancel: `${FEATURE_ID}:cancel`,
  progress: `${FEATURE_ID}:progress`
} as const

export type SubtitlePipelineSource = 'asr' | 'ocr' | 'srt'

export type SubtitlePipelinePhase =
  | 'validating'
  | 'asr'
  | 'ocr'
  | 'fusing'
  | 'restoring'
  | 'auditing'
  | 'translating'
  | 'exporting'
  | 'completed'
  | 'cancelled'
  | 'error'

export type SubtitlePipelineConfidence = 'high' | 'medium' | 'low'

export interface SubtitlePipelineRegion {
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface SubtitlePipelineAsrOptions {
  model: string
  language: string
  device: 'cpu' | 'cuda'
  quality: 'balanced' | 'accurate'
  diarize?: boolean
  speakers?: number
}

export interface SubtitlePipelineRequest {
  videoPath: string
  outputDir: string
  /** Optional existing SRT. It is retained as a separate evidence track. */
  sourceSrtPath?: string
  runAsr?: boolean
  runOcr?: boolean
  /** auto = lower subtitle band; full = scan the whole video frame. */
  ocrMode?: 'auto' | 'full'
  ocrRegion?: SubtitlePipelineRegion
  asr?: Partial<SubtitlePipelineAsrOptions>
  /** Gemini restoration/audit is optional; local fusion still produces an SRT. */
  ai?: {
    enabled?: boolean
    /** Legacy target IDs are accepted: vi, id, ja, th, ko, en. */
    targetLanguage?: string
    /** Full locale profile used by the integrated translation phase. */
    targetLocale?: SrtLocaleTargetInput
    /** Multiple locale profiles selected in the integrated translation UI. */
    targetLocales?: SrtLocaleTargetInput[]
    /** Keep ai-draft.srt and other diagnostic files. Default: true */
    keepDiagnosticFiles?: boolean
    /** Pipeline AI mode. Default: 'fusion-restore' */
    mode?: 'fusion-restore' | 'restore-only'
  }
  /** Keep raw ASR/OCR files beside the final output for diagnostics. */
  keepIntermediates?: boolean
}

export interface SubtitleEvidenceCue {
  id: string
  source: SubtitlePipelineSource
  n: number
  startMs: number
  endMs: number
  text: string
  /** 0..1 when supplied by an engine; null means the format had no score. */
  confidence: number | null
  language?: string | null
  speaker?: string | null
  region?: SubtitlePipelineRegion
  /** Number of raw frame recognitions deduplicated into this single cue (for OCR). */
  repeatCount?: number
}

export interface SubtitleEvidenceMatch extends SubtitleEvidenceCue {
  similarity: number
  overlapMs: number
  distanceMs: number
}

export interface SubtitleFusedCue {
  n: number
  startMs: number
  endMs: number
  text: string
  primarySource: SubtitlePipelineSource
  confidence: SubtitlePipelineConfidence
  conflict: boolean
  sources: SubtitleEvidenceMatch[]
}

export interface SubtitleFusionSummary {
  cues: SubtitleFusedCue[]
  sourceCounts: Record<SubtitlePipelineSource, number>
  conflictCueNumbers: number[]
}

/** Context passed to the AI restoration/audit passes. */
export interface SubtitlePipelineEvidenceContext {
  cues: SubtitleFusedCue[]
  sourceCounts: Record<SubtitlePipelineSource, number>
  conflictCueNumbers: number[]
}

export interface SubtitlePipelineProgress {
  jobId: string
  phase: SubtitlePipelinePhase
  percent: number
  message: string
  source?: SubtitlePipelineSource
  cues?: number
  conflicts?: number
  elapsedMs?: number
}

export interface SubtitlePipelineOutputPaths {
  /** Best canonical source SRT kept in the output root for the current run. */
  primarySrt?: string
  /** Directory containing all diagnostic/draft artifacts. */
  draftDir?: string
  /** Text sidecar and one-file-per-line Batch folder generated from each root SRT. */
  batchOutputs?: SubtitlePipelineBatchOutput[]
  /** One best successful SRT per selected locale, kept in the output root. */
  translatedOutputs?: SubtitlePipelineTranslatedOutput[]
  fusedSrt?: string
  /** AI proposal, including cues that still need review. */
  aiDraftSrt?: string
  /** Deliverable final canonical SRT. */
  finalSrt?: string
  /** TTS pronunciation variant derived from finalSrt; never the canonical transcript. */
  ttsReadySrt?: string
  /** Cues flagged for human review (optional diagnostic deliverable). */
  needsReviewSrt?: string
  /** Backward compatibility alias for finalSrt. */
  restoredSrt?: string
  translatedSrt?: string
  evidenceJson?: string
  asrSrt?: string
  ocrSrt?: string
}

export interface SubtitlePipelineBatchOutput {
  srtPath: string
  textPath: string
  splitDir: string
}

export interface SubtitlePipelineTranslatedOutput {
  target: SrtLocaleTargetInput
  path: string
  primary: boolean
}

export interface SubtitlePipelineResult {
  ok: boolean
  jobId: string
  outputs: SubtitlePipelineOutputPaths
  cueCount: number
  conflictCount: number
  warnings: string[]
  error?: string
}

export interface SubtitlePipelineCancelRequest {
  jobId?: string
}

export interface SubtitlePipelineCancelResult {
  ok: boolean
  wasRunning: boolean
  error?: string
}
