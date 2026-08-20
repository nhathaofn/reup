import type { FeatureMetadata } from './contracts'

export const FEATURE_ID = 'auto-short' as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: 'Auto Short',
  icon: '✂️',
  title: 'Tạo Auto Short',
  subtitle: 'Tự chia video thành các đoạn ngắn dọc 9:16 bằng FFmpeg',
  placement: 'main',
  keepAlive: true
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const FEATURE_CHANNELS = {
  run: `${FEATURE_ID}:run`,
  cancel: `${FEATURE_ID}:cancel`,
  progress: `${FEATURE_ID}:progress`
} as const

export type AutoShortLayout = 'vertical' | 'source'

export interface AutoShortRequest {
  videos: string[]
  outputDir: string
  clipSeconds: 15 | 30 | 60
  layout: AutoShortLayout
}

export type AutoShortPhase = 'preparing' | 'processing' | 'done' | 'cancelled' | 'error'

export interface AutoShortProgress {
  phase: AutoShortPhase
  percent: number
  message: string
  currentVideo?: string
  currentClip?: number
  totalClips: number
  completedClips: number
}

export interface AutoShortClip {
  source: string
  output: string
  startSeconds: number
  durationSeconds: number
}

export interface AutoShortResult {
  ok: boolean
  cancelled?: boolean
  outputDir: string
  files: string[]
  clips: AutoShortClip[]
  error?: string
}

export interface AutoShortCancelResult {
  ok: boolean
  wasRunning: boolean
}
