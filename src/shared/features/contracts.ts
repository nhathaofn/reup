/** Metadata toi thieu de mot tinh nang co the gan vao giao dien. */
export type FeaturePlacement = 'main' | 'bottom'

export interface FeatureMetadata<Id extends string = string> {
  id: Id
  label: string
  icon: string
  title: string
  subtitle: string
  placement?: FeaturePlacement
  /**
   * true = component van duoc mount khi doi tab. Dung cho hang doi/tien trinh
   * dang chay; false = chi mount khi tab dang mo.
   */
  keepAlive?: boolean
}

/**
 * ID da duoc core su dung cho tab, IPC namespace hoac ha tang noi bo.
 * Feature moi phai dung namespace rieng de khong ghi de handler/API hien tai.
 */
export const RESERVED_FEATURE_IDS = [
  'app',
  'audiotext',
  'burn',
  'cookies',
  'deps',
  'dialog',
  'douyin',
  'download',
  'eco',
  'enhance',
  'feature',
  'fonts',
  'gemini',
  'license',
  'logs',
  'ocr',
  'openai',
  'proxy',
  'screen',
  'shell',
  'translate',
  'update',
  'video2x',
  'whisper',
  'ytdlp'
] as const

const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED_FEATURE_IDS)

export function isReservedFeatureId(id: string): boolean {
  return RESERVED_SET.has(id)
}
