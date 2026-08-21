import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SRT_COUNTRY_TARGETS,
  normalizeCountrySearchText,
  searchCountryTargets,
  toLocaleTargetInput
} from '../src/shared/locale-catalog.ts'

test('country search ignores Vietnamese accents and matches English aliases', () => {
  assert.equal(normalizeCountrySearchText('Pháp'), 'phap')
  assert.deepEqual(
    searchCountryTargets('phap').map((option) => option.id),
    ['fr-fr-eur']
  )
  assert.deepEqual(
    searchCountryTargets('France').map((option) => option.id),
    ['fr-fr-eur']
  )
})

test('country search returns both language profiles when a country is ambiguous', () => {
  assert.deepEqual(
    searchCountryTargets('Canada').map((option) => [option.languageLabel, option.currencyCode]),
    [
      ['Tiếng Anh', 'CAD'],
      ['Tiếng Pháp', 'CAD']
    ]
  )
})

test('country search returns no result for an unknown country', () => {
  assert.deepEqual(searchCountryTargets('Atlantis'), [])
})

test('country profile maps to the existing locale target contract', () => {
  const france = SRT_COUNTRY_TARGETS.find((option) => option.id === 'fr-fr-eur')
  assert.ok(france)
  assert.deepEqual(toLocaleTargetInput(france), {
    id: 'fr-fr-eur',
    languageLabel: 'Tiếng Pháp',
    locale: 'fr-FR',
    regionLabel: 'Pháp',
    currencyCode: 'EUR'
  })
})

test('catalog keeps the existing preset ids so quick picks and search do not duplicate targets', () => {
  assert.deepEqual(
    SRT_COUNTRY_TARGETS.slice(0, 6).map((option) => [option.id, option.locale]),
    [
      ['vi-vn', 'vi-VN'],
      ['id-id', 'id-ID'],
      ['ja-jp', 'ja-JP'],
      ['th-th', 'th-TH'],
      ['ko-kr', 'ko-KR'],
      ['en-us', 'en-US']
    ]
  )
})
