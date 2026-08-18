import {
  validateLocaleTargetInput,
  type LocalizedTarget,
  type SrtLocaleTargetInput
} from '../../shared/features/srt-translator.ts'

const STYLE_GUIDES: Readonly<Record<string, string>> = {
  'vi-VN': [
    'Văn nói nhanh, gọn, giàu biểu cảm như reviewer/TikToker Việt.',
    'Tránh Hán–Việt và cấu trúc dịch máy khi có cách phổ thông tự nhiên.',
    'Nếu taxonomy chưa chắc, dùng “con này/loài này”.'
  ].join('\n'),
  'id-ID': [
    'Bahasa Gaul tự nhiên: nggak, banget, bakal, nih/sih có chọn lọc.',
    'Tránh apakah, ini adalah, memiliki, berinisiatif trong lời nói đời thường.',
    'Không lạm dụng slang hoặc rải trợ từ máy móc.'
  ].join('\n'),
  'ja-JP': 'Văn nói thân thiện; chọn Tameguchi hoặc Desu/Masu nhẹ theo ngữ cảnh và giữ register nhất quán; tránh giọng documentary; taxonomy chưa chắc dùng この子/この鳥.',
  'th-TH': 'Thân thiện, sống động; dùng trợ từ tự nhiên như นะ, จ้า, สิ, เนอะ nhưng không rải máy móc; taxonomy chưa chắc dùng ตัวนี้.',
  'ko-KR': 'Voice-over tự nhiên; chọn Banmal hoặc lịch sự nhẹ theo ngữ cảnh và không trộn register.',
  'en-US': 'Spoken English for Reels/Shorts; concise, catchy, natural slang only; use US customary units.'
}

const DEFAULT_CURRENCY_BY_LOCALE: Readonly<Record<string, string>> = {
  'vi-VN': 'VND',
  'id-ID': 'IDR',
  'ja-JP': 'JPY',
  'th-TH': 'THB',
  'ko-KR': 'KRW',
  'en-US': 'USD'
}

function canonicalLocale(locale: string): string {
  const trimmed = locale.trim()
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? trimmed
  } catch {
    return trimmed
  }
}

export function buildLocaleStyleGuide(locale: string): string {
  const canonical = canonicalLocale(locale)
  return STYLE_GUIDES[canonical] ??
    `Use conversational social-video language natural for locale ${canonical}; avoid literal translation and caricature slang.`
}

export function defaultCurrencyForLocale(locale: string): string | null {
  return DEFAULT_CURRENCY_BY_LOCALE[canonicalLocale(locale)] ?? null
}

export function approximationMarkerForLocale(locale: string): string {
  const language = canonicalLocale(locale).split('-')[0]?.toLowerCase()
  return ({
    vi: 'khoảng',
    id: 'sekitar',
    ja: '約',
    th: 'ประมาณ',
    ko: '약',
    en: 'approximately'
  } as const)[language as 'vi' | 'id' | 'ja' | 'th' | 'ko' | 'en'] ?? 'approximately'
}

export function resolveLocalizedTarget(input: SrtLocaleTargetInput): LocalizedTarget {
  const checked = validateLocaleTargetInput(input)
  if (!checked.ok) throw new Error(checked.error)
  const value = checked.value
  return {
    id: value.id,
    profile: {
      ...value,
      unitSystem: value.locale === 'en-US' ? 'us-customary' : 'metric',
      styleGuide: buildLocaleStyleGuide(value.locale)
    }
  }
}
