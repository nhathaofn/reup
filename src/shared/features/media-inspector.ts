import type { FeatureMetadata } from './contracts'

export const FEATURE_ID = 'media-inspector' as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: "Kiểm tra media",
  icon: '🧩',
  title: "Kiểm tra media",
  subtitle: 'Feature được tạo từ cấu trúc mở rộng an toàn.',
  placement: 'main',
  keepAlive: false
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const FEATURE_CHANNELS = {
  run: `${FEATURE_ID}:run`,
  progress: `${FEATURE_ID}:progress`
} as const

export interface MediaInspectorRequest {
  input: string
}

export interface MediaInspectorResult {
  output: string
  completedAt: string
}

export interface MediaInspectorProgress {
  percent: number
  message: string
}
