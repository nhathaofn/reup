import test from 'node:test'
import assert from 'node:assert/strict'
import {
  approximationMarkerForLocale,
  buildLocaleStyleGuide,
  defaultCurrencyForLocale,
  resolveLocalizedTarget
} from '../src/main/services/srt-locale-profiles.ts'
import { SRT_LOCALE_PRESETS } from '../src/shared/features/srt-translator.ts'

test('Vietnamese profile is spoken, short-form and taxonomy-safe', () => {
  const target = resolveLocalizedTarget({
    id: 'vi-vn',
    languageLabel: 'Tiếng Việt',
    locale: 'vi-VN',
    regionLabel: 'Việt Nam',
    currencyCode: 'VND'
  })

  assert.equal(target.profile.unitSystem, 'metric')
  assert.match(target.profile.styleGuide, /reviewer\/TikToker Việt/)
  assert.match(target.profile.styleGuide, /con này\/loài này/)
})

test('Indonesian profile requires Bahasa Gaul but forbids mechanical slang', () => {
  const target = resolveLocalizedTarget({
    id: 'id-id',
    languageLabel: 'Tiếng Indonesia',
    locale: 'id-ID',
    regionLabel: 'Indonesia',
    currencyCode: 'IDR'
  })

  assert.match(target.profile.styleGuide, /nggak/)
  assert.match(target.profile.styleGuide, /không lạm dụng/i)
})

test('US profile chooses customary units and custom locale uses safe fallback', () => {
  assert.equal(resolveLocalizedTarget({
    id: 'en-us',
    languageLabel: 'English',
    locale: 'en-US',
    regionLabel: 'United States',
    currencyCode: 'USD'
  }).profile.unitSystem, 'us-customary')

  assert.equal(resolveLocalizedTarget({
    id: 'fr-fr',
    languageLabel: 'Français',
    locale: 'fr-FR',
    regionLabel: 'France',
    currencyCode: 'EUR'
  }).profile.unitSystem, 'metric')
  assert.match(buildLocaleStyleGuide('fr-FR'), /Français parlé|mord/)
})

test('trusted locale guides keep the approved register and reference terms', () => {
  for (const [locale, required] of [
    ['ja-JP', [/register nhất quán/i, /documentary/i, /この子/]],
    ['th-TH', [/trợ từ tự nhiên/i, /ตัวนี้/]],
    ['ko-KR', [/Banmal/i, /không trộn register/i]],
    ['en-US', [/Reels\/Shorts/i, /US customary/i]]
  ] as const) {
    test(`${locale} uses its approved social-video guide`, () => {
      const preset = SRT_LOCALE_PRESETS.find((item) => item.profile.locale === locale)
      assert.ok(preset)
      const target = resolveLocalizedTarget(preset.profile)
      for (const pattern of required) assert.match(target.profile.styleGuide, pattern)
    })
  }
})

test('approximation marker follows target locale and falls back safely', () => {
  assert.equal(approximationMarkerForLocale('vi-VN'), 'khoảng')
  assert.equal(approximationMarkerForLocale('id-ID'), 'sekitar')
  assert.equal(approximationMarkerForLocale('ja-JP'), '約')
  assert.equal(approximationMarkerForLocale('th-TH'), 'ประมาณ')
  assert.equal(approximationMarkerForLocale('ko-KR'), '약')
  assert.equal(approximationMarkerForLocale('en-US'), 'approximately')
  assert.equal(approximationMarkerForLocale('fr-FR'), 'approximately')
  assert.equal(approximationMarkerForLocale(' vi-vn '), 'khoảng')
})

test('default currency mapping is exact and unknown locales require user input', () => {
  assert.deepEqual(
    ['vi-VN', 'id-ID', 'ja-JP', 'th-TH', 'ko-KR', 'en-US'].map(defaultCurrencyForLocale),
    ['VND', 'IDR', 'JPY', 'THB', 'KRW', 'USD']
  )
  assert.equal(defaultCurrencyForLocale('fr-FR'), null)
  assert.equal(defaultCurrencyForLocale(' vi-vn '), 'VND')
})

test('resolver validates and canonicalizes locale target input before building profile', () => {
  const target = resolveLocalizedTarget({
    id: '  custom-target ',
    languageLabel: '  Français  ',
    locale: ' fr-fr ',
    regionLabel: '  France  ',
    currencyCode: ' eur '
  })

  assert.equal(target.id, 'custom-target')
  assert.equal(target.profile.locale, 'fr-FR')
  assert.equal(target.profile.currencyCode, 'EUR')
  assert.equal(target.profile.unitSystem, 'metric')
  assert.throws(() => resolveLocalizedTarget({
    id: 'invalid',
    languageLabel: 'Unknown',
    locale: 'not-a-locale',
    regionLabel: 'Unknown',
    currencyCode: 'USD'
  }))
})
