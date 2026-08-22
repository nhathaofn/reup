import type { SrtLocaleTargetInput } from './features/srt-translator.ts'

export interface CountryTargetOption {
  id: string
  countryCode: string
  countryLabel: string
  aliases: readonly string[]
  languageLabel: string
  locale: string
  regionLabel: string
  currencyCode: string
  unitSystem: 'metric' | 'us-customary'
}

export const SRT_COUNTRY_TARGETS = [
  {
    id: 'vi-vn', countryCode: 'VN', countryLabel: 'Việt Nam', aliases: ['Việt Nam', 'Viet Nam', 'Vietnam', 'Viet'],
    languageLabel: 'Tiếng Việt', locale: 'vi-VN', regionLabel: 'Việt Nam', currencyCode: 'VND', unitSystem: 'metric'
  },
  {
    id: 'id-id', countryCode: 'ID', countryLabel: 'Indonesia', aliases: ['Indonesia'],
    languageLabel: 'Tiếng Indonesia', locale: 'id-ID', regionLabel: 'Indonesia', currencyCode: 'IDR', unitSystem: 'metric'
  },
  {
    id: 'ja-jp', countryCode: 'JP', countryLabel: 'Nhật Bản', aliases: ['Nhật Bản', 'Nhat Ban', 'Japan'],
    languageLabel: 'Tiếng Nhật', locale: 'ja-JP', regionLabel: 'Nhật Bản', currencyCode: 'JPY', unitSystem: 'metric'
  },
  {
    id: 'th-th', countryCode: 'TH', countryLabel: 'Thái Lan', aliases: ['Thái Lan', 'Thai Lan', 'Thailand'],
    languageLabel: 'Tiếng Thái', locale: 'th-TH', regionLabel: 'Thái Lan', currencyCode: 'THB', unitSystem: 'metric'
  },
  {
    id: 'ko-kr', countryCode: 'KR', countryLabel: 'Hàn Quốc', aliases: ['Hàn Quốc', 'Han Quoc', 'South Korea', 'Korea'],
    languageLabel: 'Tiếng Hàn', locale: 'ko-KR', regionLabel: 'Hàn Quốc', currencyCode: 'KRW', unitSystem: 'metric'
  },
  {
    id: 'en-us', countryCode: 'US', countryLabel: 'Hoa Kỳ', aliases: ['Hoa Kỳ', 'Hoa Ky', 'Mỹ', 'My', 'United States', 'USA', 'US'],
    languageLabel: 'Tiếng Anh', locale: 'en-US', regionLabel: 'Hoa Kỳ', currencyCode: 'USD', unitSystem: 'us-customary'
  },
  {
    id: 'fr-fr-eur', countryCode: 'FR', countryLabel: 'Pháp', aliases: ['Pháp', 'Phap', 'France'],
    languageLabel: 'Tiếng Pháp', locale: 'fr-FR', regionLabel: 'Pháp', currencyCode: 'EUR', unitSystem: 'metric'
  },
  {
    id: 'de-de-eur', countryCode: 'DE', countryLabel: 'Đức', aliases: ['Đức', 'Duc', 'Germany', 'Deutschland'],
    languageLabel: 'Tiếng Đức', locale: 'de-DE', regionLabel: 'Đức', currencyCode: 'EUR', unitSystem: 'metric'
  },
  {
    id: 'es-es-eur', countryCode: 'ES', countryLabel: 'Tây Ban Nha', aliases: ['Tây Ban Nha', 'Tay Ban Nha', 'Spain', 'España'],
    languageLabel: 'Tiếng Tây Ban Nha', locale: 'es-ES', regionLabel: 'Tây Ban Nha', currencyCode: 'EUR', unitSystem: 'metric'
  },
  {
    id: 'pt-pt-eur', countryCode: 'PT', countryLabel: 'Bồ Đào Nha', aliases: ['Bồ Đào Nha', 'Bo Dao Nha', 'Portugal'],
    languageLabel: 'Tiếng Bồ Đào Nha', locale: 'pt-PT', regionLabel: 'Bồ Đào Nha', currencyCode: 'EUR', unitSystem: 'metric'
  },
  {
    id: 'en-ca-cad', countryCode: 'CA', countryLabel: 'Canada', aliases: ['Canada', 'Canadian English'],
    languageLabel: 'Tiếng Anh', locale: 'en-CA', regionLabel: 'Canada', currencyCode: 'CAD', unitSystem: 'metric'
  },
  {
    id: 'fr-ca-cad', countryCode: 'CA', countryLabel: 'Canada', aliases: ['Canada', 'Canadian French'],
    languageLabel: 'Tiếng Pháp', locale: 'fr-CA', regionLabel: 'Canada', currencyCode: 'CAD', unitSystem: 'metric'
  }
] as const satisfies readonly CountryTargetOption[]

export function normalizeCountrySearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .trim()
    .replace(/\s+/g, ' ')
}

export function searchCountryTargets(
  query: string,
  options: readonly CountryTargetOption[] = SRT_COUNTRY_TARGETS
): CountryTargetOption[] {
  const normalizedQuery = normalizeCountrySearchText(query)
  if (!normalizedQuery) return []

  const countryMatches = options.filter((option) => [
    option.countryCode,
    option.countryLabel,
    ...option.aliases
  ].some((value) => normalizeCountrySearchText(value).includes(normalizedQuery)))
  if (countryMatches.length) return countryMatches

  return options.filter((option) => [
    option.languageLabel,
    option.locale,
    option.currencyCode
  ].some((value) => normalizeCountrySearchText(value).includes(normalizedQuery)))
}

export function toLocaleTargetInput(option: CountryTargetOption): SrtLocaleTargetInput {
  return {
    id: option.id,
    languageLabel: option.languageLabel,
    locale: option.locale,
    regionLabel: option.regionLabel,
    currencyCode: option.currencyCode
  }
}
