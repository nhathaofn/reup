import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTargetLanguage,
  dedupeTargetLanguages,
  FEATURE_CHANNELS,
  makeOutputFileName,
  SRT_LOCALE_PRESETS,
  adaptLegacyTarget,
  makeLocalizedOutputFileName,
  validateLocaleTargetInput,
  type SrtTargetLanguage
} from '../src/shared/features/srt-translator.ts'

test('chuẩn hóa ngôn ngữ tự nhập và mã preset', () => {
  assert.deepEqual(createTargetLanguage('  Tiếng Thái  '), {
    id: 'tieng-thai',
    label: 'Tiếng Thái'
  })
  assert.deepEqual(createTargetLanguage('Tiếng Nhật', 'ja'), {
    id: 'ja',
    label: 'Tiếng Nhật',
    code: 'ja'
  })
  assert.equal(createTargetLanguage('   '), null)
})

test('loại target trùng theo mã hoặc nhãn chuẩn hóa', () => {
  const targets = [
    { id: 'vi', label: 'Tiếng Việt', code: 'vi' },
    { id: 'vi-2', label: ' tiếng việt ' },
    { id: 'tieng-thai', label: 'Tiếng Thái' }
  ] satisfies SrtTargetLanguage[]

  assert.deepEqual(dedupeTargetLanguages(targets), [
    { id: 'vi', label: 'Tiếng Việt', code: 'vi' },
    { id: 'tieng-thai', label: 'Tiếng Thái' }
  ])
})

test('tạo tên file không chứa path traversal và giữ basename nguồn', () => {
  assert.equal(
    makeOutputFileName('C:\\subs\\video.srt', { id: 'ja', label: 'Tiếng Nhật', code: 'ja' }, 0),
    'video.ja.srt'
  )
  assert.equal(
    makeOutputFileName('/tmp/clip.srt', { id: 'tieng-thai', label: 'Tiếng Thái' }, 1),
    'clip.tieng-thai.srt'
  )
  assert.equal(
    makeOutputFileName('../clip.srt', { id: 'x', label: '../../' }, 2),
    'clip.lang-3.srt'
  )
})

test('locale presets carry country and currency', () => {
  assert.deepEqual(
    SRT_LOCALE_PRESETS.map((target) => [
      target.profile.locale,
      target.profile.currencyCode
    ]),
    [
      ['vi-VN', 'VND'],
      ['id-ID', 'IDR'],
      ['ja-JP', 'JPY'],
      ['th-TH', 'THB'],
      ['ko-KR', 'KRW'],
      ['en-US', 'USD']
    ]
  )
})

test('custom target requires BCP-47 locale, region and ISO currency', () => {
  assert.equal(validateLocaleTargetInput({
    id: 'en-gb',
    languageLabel: 'Tiếng Anh',
    locale: 'en-GB',
    regionLabel: 'Vương quốc Anh',
    currencyCode: 'GBP'
  }).ok, true)
  assert.equal(validateLocaleTargetInput({
    id: 'custom',
    languageLabel: 'Khác',
    locale: 'x',
    regionLabel: '',
    currencyCode: '12'
  }).ok, false)
})

test('legacy preset maps one way without changing legacy type', () => {
  assert.equal(adaptLegacyTarget({ id: 'vi', label: 'Tiếng Việt', code: 'vi' })?.profile.locale, 'vi-VN')
  assert.equal(adaptLegacyTarget({ id: 'unknown', label: 'Tiếng khác' }), null)
})

test('localized filename marks text-only result', () => {
  assert.equal(
    makeLocalizedOutputFileName('C:\\subs\\clip.srt', SRT_LOCALE_PRESETS[0], true),
    'clip.vi-vn_unverified.srt'
  )
})

test('job channels are complete and namespaced', () => {
  assert.deepEqual(Object.keys(FEATURE_CHANNELS), [
    'load', 'analyze', 'resolve', 'translate',
    'cancel', 'release', 'progress', 'exportOne', 'exportAll'
  ])
  for (const channel of Object.values(FEATURE_CHANNELS)) {
    assert.match(channel, /^srt-translator:/)
  }
})
