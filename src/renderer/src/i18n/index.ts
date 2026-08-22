import { vi } from './vi'

export const DEFAULT_LOCALE = 'vi' as const
export const FALLBACK_LOCALE = 'vi' as const

const dictionaries = { vi } as const

export type Locale = keyof typeof dictionaries
export type AppMessageKey = keyof typeof vi

export function translate(
  key: AppMessageKey,
  locale: string = DEFAULT_LOCALE
): string {
  const dictionary = dictionaries[locale as Locale] ?? dictionaries[FALLBACK_LOCALE]
  return dictionary[key] ?? dictionaries[FALLBACK_LOCALE][key]
}

export const t = translate
