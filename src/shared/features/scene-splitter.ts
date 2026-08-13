import type { FeatureMetadata } from './contracts'

export const FEATURE_ID = 'scene-splitter' as const

export const PYSCENEDETECT_VERSION = '0.7.1' as const
export const PYSCENEDETECT_WINDOWS_ASSET_SIZE = 188_301_242

export const SCENE_SPLITTER_DEFAULTS = {
  detectorMode: 'content',
  contentThreshold: 27,
  hybridContentThreshold: 27,
  hybridAdaptiveThreshold: 3,
  minSceneDuration: 0.6
} as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: 'Tách cảnh',
  icon: '✂️',
  title: 'Tách cảnh video',
  subtitle: 'Tự động cắt mỗi lần video chuyển cảnh bằng PySceneDetect',
  placement: 'main',
  keepAlive: true
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const FEATURE_CHANNELS = {
  engineStatus: `${FEATURE_ID}:engine-status`,
  installEngine: `${FEATURE_ID}:install-engine`,
  run: `${FEATURE_ID}:run`,
  cancel: `${FEATURE_ID}:cancel`,
  installProgress: `${FEATURE_ID}:install-progress`,
  progress: `${FEATURE_ID}:progress`
} as const

export type SceneSplitterDetectorMode = 'content' | 'hybrid'

export interface SceneSplitterEngineStatus {
  has: boolean
  version: string | null
  expectedVersion: typeof PYSCENEDETECT_VERSION
  managed: boolean
  needsUpdate: boolean
  installSupported: boolean
  platform: NodeJS.Platform
}

export type SceneSplitterInstallPhase =
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'installing'
  | 'done'
  | 'error'

export interface SceneSplitterInstallProgress {
  phase: SceneSplitterInstallPhase
  message: string
  percent: number
}

export interface SceneSplitterInstallResult {
  ok: boolean
  error?: string
}

export interface SceneSplitterRequest {
  sourceVideos: string[]
  outputDir: string
  detectorMode?: SceneSplitterDetectorMode
  thresholdValue?: number
  minSceneDuration?: number
}

export interface SceneSplitterScene {
  index: number
  fileName: string
  filePath: string
  sourceVideo: string
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

export type SceneSplitterPhase =
  | 'detecting'
  | 'cutting'
  | 'finalizing'
  | 'done'
  | 'cancelled'
  | 'error'

export interface SceneSplitterProgress {
  phase: SceneSplitterPhase
  percent: number
  message: string
  currentVideo?: string
  currentVideoIndex?: number
  totalVideos?: number
  scenesCreated?: number
}

export interface SceneSplitterResult {
  ok: boolean
  cancelled?: boolean
  outputDir?: string
  manifestFile?: string
  totalScenes?: number
  scenes?: SceneSplitterScene[]
  error?: string
}

export interface SceneSplitterCancelResult {
  ok: boolean
  wasRunning: boolean
}
