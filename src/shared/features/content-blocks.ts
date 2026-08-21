import type { FeatureMetadata } from './contracts'

export const FEATURE_ID = 'content-blocks' as const
export const CONTENT_BLOCK_SCHEMA_VERSION = 1 as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: 'Khối nội dung',
  icon: '🧱',
  title: 'Phân tích và xáo trộn khối nội dung',
  subtitle: 'Manifest-first → timeline riêng từng ngôn ngữ → draft CapCut',
  placement: 'main',
  keepAlive: true
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const CONTENT_BLOCK_DEFAULTS = {
  boundaryWindowUs: 500_000,
  minimumBlockDurationUs: 500_000,
  srtFallbackPaddingUs: 100_000,
  preRollUs: 0,
  postRollUs: 100_000,
  cueGapUs: 100_000,
  softSpeedMin: 0.92,
  softSpeedMax: 1.08,
  hardSpeedMin: 0.9,
  hardSpeedMax: 1.12
} as const

export type Microseconds = number
export type ContentCueRole = 'question' | 'answer' | 'statement'
export type ContentBlockRole = 'normal' | 'intro' | 'outro' | 'cta'
export type BoundaryReason =
  | 'exact-scene-match'
  | 'scene-near-srt'
  | 'srt-fallback'
  | 'manual-adjusted'
export type ReviewState = 'accepted' | 'needs-review' | 'locked'
export type ContentBlockIssue = 'odd-unpaired-cue' | 'grouping-review' | 'srt-fallback' | 'manual-adjusted'
export type MediaAdaptation =
  | 'stretch-within-soft-limit'
  | 'stretch-with-warning'
  | 'needs-review'

export interface SourceDialogueCue {
  cueId: string
  sourceIndex: number
  role: ContentCueRole
  text: string
  sourceStartUs: Microseconds
  sourceEndUs: Microseconds
}

export interface SourceContentBlock {
  id: string
  sourceRange: { startUs: Microseconds; endUs: Microseconds }
  cueIds: string[]
  dialogue: SourceDialogueCue[]
  boundary: {
    targetUs: Microseconds
    selectedUs: Microseconds
    reason: BoundaryReason
    reviewState: ReviewState
  }
  semantic: {
    role: ContentBlockRole
    shuffleEligible: boolean
    requiresPreviousBlockId: string | null
  }
  issues: ContentBlockIssue[]
}

export interface SourceBlockManifest {
  schemaVersion: typeof CONTENT_BLOCK_SCHEMA_VERSION
  source: {
    path: string
    fingerprint: `sha256:${string}`
    durationUs: Microseconds
    fps: number
  }
  revision: number
  blocks: SourceContentBlock[]
}

export interface LocaleCueAsset {
  cueId: string
  text: string
  voicePath: string
  voiceDurationUs: Microseconds
}

export interface LocaleAssetManifest {
  schemaVersion: typeof CONTENT_BLOCK_SCHEMA_VERSION
  sourceManifestFingerprint: `sha256:${string}`
  locale: string
  blocks: Record<string, { cues: LocaleCueAsset[] }>
}

export interface VariantConstraints {
  lockedStartBlockIds: string[]
  lockedEndBlockIds: string[]
  preserveDependencyChains: true
}

export interface VariantPlan {
  schemaVersion: typeof CONTENT_BLOCK_SCHEMA_VERSION
  variantId: string
  sourceManifestFingerprint: `sha256:${string}`
  seed: string
  blockOrder: string[]
  constraints: VariantConstraints
}

export interface RenderSubtitleCue {
  cueId: string
  startUs: Microseconds
  endUs: Microseconds
  text: string
}

export interface RenderTimelineItem {
  blockId: string
  timelineStartUs: Microseconds
  timelineEndUs: Microseconds
  sourceStartUs: Microseconds
  sourceEndUs: Microseconds
  mediaSpeed: number
  adaptation: MediaAdaptation
  subtitleCues: RenderSubtitleCue[]
  warnings: string[]
}

export interface RenderTimeline {
  schemaVersion: typeof CONTENT_BLOCK_SCHEMA_VERSION
  sourceManifestFingerprint: `sha256:${string}`
  variantId: string
  locale: string
  durationUs: Microseconds
  items: RenderTimelineItem[]
  reviewBlockIds: string[]
}

export type ContentBlockEditOperation =
  | { kind: 'merge'; leftBlockId: string; rightBlockId: string }
  | { kind: 'split'; blockId: string; afterCueId: string }
  | { kind: 'set-boundary'; blockId: string; selectedUs: Microseconds; locked: boolean }
  | {
      kind: 'set-semantic'
      blockId: string
      role: ContentBlockRole
      shuffleEligible: boolean
      requiresPreviousBlockId: string | null
    }

export type ContentBlockPickKind = 'video' | 'srt' | 'json' | 'directory'

export interface ContentBlockAnalyzeRequest {
  projectDir: string
  videoPath: string
  srtPath: string
  sceneManifestPath: string
  existingManifestPath?: string | null
  boundaryWindowUs?: Microseconds
  minimumBlockDurationUs?: Microseconds
  srtFallbackPaddingUs?: Microseconds
}

export interface ContentBlockAnalyzeResult {
  ok: boolean
  manifestPath?: string
  manifest?: SourceBlockManifest
  sourceManifestFingerprint?: `sha256:${string}`
  warnings: string[]
  error?: string
}

export interface ContentBlockEditRequest {
  manifestPath: string
  operations: ContentBlockEditOperation[]
}

export interface ContentBlockEditResult extends ContentBlockAnalyzeResult {}

export interface LocaleAssetImportRequest {
  projectDir: string
  sourceManifestPath: string
  locale: string
  localizedSrtPath: string
  voiceDir: string
  voiceMapPath?: string | null
}

export interface LocaleAssetImportResult {
  ok: boolean
  manifestPath?: string
  manifest?: LocaleAssetManifest
  missingCueIds: string[]
  invalidCueIds: string[]
  extraFiles: string[]
  error?: string
}

export interface VariantCreateRequest {
  projectDir: string
  sourceManifestPath: string
  variantId: string
  seed: string
  constraints: VariantConstraints
}

export interface VariantCreateResult {
  ok: boolean
  variantPath?: string
  variant?: VariantPlan
  error?: string
}

export interface TimelineBuildRequest {
  projectDir: string
  sourceManifestPath: string
  localeManifestPath: string
  variantPath: string
  preRollUs?: Microseconds
  postRollUs?: Microseconds
  cueGapUs?: Microseconds
}

export interface TimelineBuildResult {
  ok: boolean
  timelinePath?: string
  subtitlePath?: string
  timeline?: RenderTimeline
  error?: string
}

export interface ContentBlockCapCutExportRequest {
  sourceManifestPath: string
  localeManifestPath: string
  timelinePath: string
  draftsDir: string
  templateDir: string
  projectName: string
  muteOriginalVideo?: boolean
}

export interface ContentBlockCapCutExportResult {
  ok: boolean
  cancelled?: boolean
  projectPath?: string
  portableManifestPath?: string
  provenanceManifestPath?: string
  videoSegmentCount?: number
  audioSegmentCount?: number
  textSegmentCount?: number
  warnings: string[]
  error?: string
}

export type ContentBlockPhase =
  | 'validating'
  | 'hashing'
  | 'analyzing'
  | 'probing-voice'
  | 'planning'
  | 'building-timeline'
  | 'creating-capcut'
  | 'done'
  | 'cancelled'
  | 'error'

export interface ContentBlockProgress {
  phase: ContentBlockPhase
  percent: number
  message: string
  currentId?: string
}

export interface ContentBlockCancelResult {
  ok: boolean
  wasRunning: boolean
}

export const CONTENT_BLOCK_FEATURE_CHANNELS = {
  pickPath: `${FEATURE_ID}:pick-path`,
  analyze: `${FEATURE_ID}:analyze`,
  editManifest: `${FEATURE_ID}:edit-manifest`,
  importLocale: `${FEATURE_ID}:import-locale`,
  createVariant: `${FEATURE_ID}:create-variant`,
  buildTimeline: `${FEATURE_ID}:build-timeline`,
  exportCapCut: `${FEATURE_ID}:export-capcut`,
  cancel: `${FEATURE_ID}:cancel`,
  progress: `${FEATURE_ID}:progress`
} as const
