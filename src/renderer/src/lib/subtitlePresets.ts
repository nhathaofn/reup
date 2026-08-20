export type SubtitlePreset = 'custom' | 'clean' | 'cinema' | 'tiktok' | 'highlight'

export interface SubtitlePresetValues {
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

export const SUBTITLE_PRESETS: Record<Exclude<SubtitlePreset, 'custom'>, SubtitlePresetValues> = {
  clean: {
    textColor: '#ffffff',
    outlineColor: '#111827',
    outlinePx: 2,
    bgEnabled: false,
    bgColor: '#111827',
    bgOpacity: 82,
    fontScale: 100,
    bold: true,
    italic: false,
    shadowPx: 1,
    bgPaddingPx: 10
  },
  cinema: {
    textColor: '#fff7d6',
    outlineColor: '#0f172a',
    outlinePx: 2.5,
    bgEnabled: false,
    bgColor: '#0f172a',
    bgOpacity: 78,
    fontScale: 95,
    bold: true,
    italic: false,
    shadowPx: 2,
    bgPaddingPx: 10
  },
  tiktok: {
    textColor: '#ffffff',
    outlineColor: '#0f172a',
    outlinePx: 0.5,
    bgEnabled: true,
    bgColor: '#0f172a',
    bgOpacity: 84,
    fontScale: 100,
    bold: true,
    italic: false,
    shadowPx: 0,
    bgPaddingPx: 10
  },
  highlight: {
    textColor: '#fff7ed',
    outlineColor: '#7c2d12',
    outlinePx: 1.5,
    bgEnabled: true,
    bgColor: '#ea580c',
    bgOpacity: 90,
    fontScale: 100,
    bold: true,
    italic: false,
    shadowPx: 0,
    bgPaddingPx: 9
  }
}
