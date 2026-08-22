import type { FeatureMetadata } from './contracts'

export const FEATURE_ID = 'multilang-short' as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: 'Đa ngôn ngữ',
  icon: '🌍',
  title: 'Video Short đa ngôn ngữ',
  subtitle: 'N video → phụ đề, bản địa hóa, ElevenLabs voice và video đầu ra theo từng ngôn ngữ',
  placement: 'main',
  keepAlive: true
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const FEATURE_CHANNELS = {
  run: `${FEATURE_ID}:run`,
  cancel: `${FEATURE_ID}:cancel`,
  progress: `${FEATURE_ID}:progress`,
  saveElevenLabsKey: `${FEATURE_ID}:save-elevenlabs-key`,
  saveElevenLabsKeys: `${FEATURE_ID}:save-elevenlabs-keys`,
  hasElevenLabsKey: `${FEATURE_ID}:has-elevenlabs-key`,
  checkElevenLabsKey: `${FEATURE_ID}:check-elevenlabs-key`,
  saveGeminiKeys: `${FEATURE_ID}:save-gemini-keys`,
  hasGeminiKeys: `${FEATURE_ID}:has-gemini-keys`,
  checkGeminiKeys: `${FEATURE_ID}:check-gemini-keys`,
  checkOllama: `${FEATURE_ID}:check-ollama`
} as const

export type MultiLangProvider = 'gemini' | 'openai' | 'ollama'
export type MultiLangStyle = 'natural' | 'social' | 'news' | 'dramatic'
export type MultiLangVoiceMode = 'auto' | 'manual'

export interface MultiLangTarget {
  language: string
  locale: string
  style: MultiLangStyle
  /** Optional per-locale override. Empty means automatic selection. */
  voiceId?: string
  voiceModel?: string
}

export interface MultiLangRegion {
  /** Normalized coordinates in the first source preview, all values 0..1. */
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Style phụ đề được chọn từ các preset của tab Đọc chữ video. */
export interface MultiLangSubtitleStyle {
  textColor: string
  outlineColor: string
  outlinePx: number
  bgEnabled: boolean
  bgColor: string
  bgOpacity: number
  fontScale: number
  bold: boolean
  italic: boolean
  shadowPx: number
  bgPaddingPx: number
}

export interface MultiLangWhisperOptions {
  model: string
  sourceLanguage: string
  preferGpu: boolean
}

export interface MultiLangRequest {
  videos: string[]
  outputDir: string
  targets: MultiLangTarget[]
  translationProvider: MultiLangProvider
  /** Ollama model/base URL used only when translationProvider is ollama. */
  translationModel?: string
  translationBaseUrl?: string
  voiceMode: MultiLangVoiceMode
  voiceId: string
  voiceModel: string
  blurRegion: MultiLangRegion | null
  /** Vùng hiển thị phụ đề, tọa độ chuẩn hóa 0..1 theo video preview. */
  subtitleRegion?: MultiLangRegion | null
  /** Style preset tương ứng với bộ chọn của tab Đọc chữ video. */
  subtitleStyle?: MultiLangSubtitleStyle
  originalAudioVolume: number
  sceneSplit: boolean
  variantShuffle: boolean
  whisper: MultiLangWhisperOptions
}

export type MultiLangPhase =
  | 'preparing'
  | 'transcribing'
  | 'translating'
  | 'voicing'
  | 'blurring'
  | 'splitting'
  | 'mapping'
  | 'rendering'
  | 'done'
  | 'cancelled'
  | 'error'

export interface MultiLangProgress {
  phase: MultiLangPhase
  percent: number
  message: string
  sourceIndex?: number
  sourceCount?: number
  targetLanguage?: string
  targetIndex?: number
  targetCount?: number
  completedOutputs: number
  totalOutputs: number
  gpuMode?: 'cuda' | 'encoder-gpu' | 'cpu-fallback'
}

export interface MultiLangOutput {
  sourceVideo: string
  language: string
  locale: string
  srtPath: string
  voiceDir: string
  videoPath?: string
  sceneCount?: number
  voiceId?: string
  voiceModel?: string
}

export interface MultiLangResult {
  ok: boolean
  cancelled?: boolean
  outputDir: string
  runDir?: string
  originalSubtitles: string[]
  outputs: MultiLangOutput[]
  scenesManifest?: string
  error?: string
}

export interface MultiLangCancelResult {
  ok: boolean
  wasRunning: boolean
}

export interface MultiLangKeyStatus {
  ok: boolean
  hasKey: boolean
  keyCount?: number
  healthyKeyCount?: number
  message: string
}
