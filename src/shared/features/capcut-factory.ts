import type { FeatureMetadata } from './contracts'

export const FEATURE_ID = 'capcut-factory' as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: 'CapCut đa ngôn ngữ',
  icon: '🎬',
  title: 'Tạo project CapCut đa ngôn ngữ',
  subtitle: 'Một video nền + nhiều bộ SRT/voice → nhiều project CapCut có thể chỉnh sửa',
  placement: 'main',
  keepAlive: true
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const FEATURE_CHANNELS = {
  detectEnvironment: `${FEATURE_ID}:detect-environment`,
  pickPath: `${FEATURE_ID}:pick-path`,
  inspect: `${FEATURE_ID}:inspect`,
  run: `${FEATURE_ID}:run`,
  cancel: `${FEATURE_ID}:cancel`,
  progress: `${FEATURE_ID}:progress`
} as const

export type CapCutFactoryPickKind = 'video' | 'srt' | 'directory'

export interface CapCutFactoryEnvironment {
  detectedDraftsDir: string | null
  candidates: string[]
  capCutVersion: string | null
  platform: NodeJS.Platform
}

export interface CapCutFactoryInputSet {
  id: string
  label: string
  srtPath: string
  voiceDir: string
}

export interface CapCutFactoryRequest {
  videoPath: string
  /** Optional output directory from the Tách cảnh feature. */
  sceneDir?: string | null
  draftsDir: string
  templateDir?: string | null
  projectPrefix?: string | null
  muteOriginalVideo?: boolean
  sets: CapCutFactoryInputSet[]
}

export interface CapCutFactoryVideoInfo {
  path: string
  fileName: string
  durationSeconds: number
  width: number
  height: number
  fps: number
}

export interface CapCutFactoryPreflightSet {
  id: string
  label: string
  projectName: string
  cueCount: number
  audioCount: number
  matchedCount: number
  warnings: string[]
  error?: string
}

export interface CapCutFactoryPreflightResult {
  ok: boolean
  video?: CapCutFactoryVideoInfo
  sceneCount?: number
  sceneDir?: string
  sets: CapCutFactoryPreflightSet[]
  warnings: string[]
  errors: string[]
}

export type CapCutFactoryPhase =
  | 'validating'
  | 'preparing'
  | 'creating'
  | 'verifying'
  | 'done'
  | 'cancelled'
  | 'error'

export interface CapCutFactoryProgress {
  phase: CapCutFactoryPhase
  percent: number
  message: string
  currentSetId?: string
  currentProjectName?: string
  completedProjects: number
  totalProjects: number
}

export interface CapCutFactoryProjectResult {
  inputSetId: string
  label: string
  projectName: string
  projectPath?: string
  ok: boolean
  warnings: string[]
  error?: string
}

export interface CapCutFactoryResult {
  ok: boolean
  cancelled?: boolean
  draftsDir?: string
  projects: CapCutFactoryProjectResult[]
  error?: string
}

export interface CapCutFactoryCancelResult {
  ok: boolean
  wasRunning: boolean
}
