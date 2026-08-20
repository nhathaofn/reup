import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMeasurementInstructions,
  convertMeasurement,
  measurementToken
} from '../src/main/services/measurement-conversion.ts'

test('metric distance becomes US customary for en-US', () => {
  assert.deepEqual(convertMeasurement(10, 'km', 'us-customary'), {
    value: 6.2137119224,
    unitCode: 'mi'
  })
})

test('Celsius becomes Fahrenheit and unsupported unit stays unchanged', () => {
  assert.deepEqual(convertMeasurement(20, 'celsius', 'us-customary'), {
    value: 68,
    unitCode: 'fahrenheit'
  })
  assert.equal(convertMeasurement(2, 'unknown-unit', 'us-customary'), null)
})

for (const [value, unit, expected] of [
  [1, 'm', { value: 3.280839895, unitCode: 'ft' }],
  [1, 'cm', { value: 0.3937007874, unitCode: 'in' }],
  [1, 'kg', { value: 2.2046226218, unitCode: 'lb' }],
  [1, 'g', { value: 0.03527396195, unitCode: 'oz' }],
  [20, 'celsius', { value: 68, unitCode: 'fahrenheit' }],
  [1, 'l', { value: 0.2641720524, unitCode: 'gal-us' }],
  [1, 'ml', { value: 0.0338140227, unitCode: 'fl-oz-us' }],
  [1, 'm2', { value: 10.763910417, unitCode: 'ft2' }],
  [1, 'km2', { value: 0.3861021585, unitCode: 'mi2' }],
  [10, 'km/h', { value: 6.2137119224, unitCode: 'mph' }]
] as const) {
  test(`${unit} maps to the approved US customary unit`, () => {
    assert.deepEqual(convertMeasurement(value, unit, 'us-customary'), expected)
  })
}

test('metric profile preserves supported source value and unit', () => {
  assert.deepEqual(convertMeasurement(2.5, 'kg', 'metric'), { value: 2.5, unitCode: 'kg' })
})

test('measurement instructions skip uncertain values and use locale formatting', () => {
  const result = buildMeasurementInstructions([
    { id: 'measure:1', cueNumber: 1, sourceValue: 10, sourceUnitCode: 'km', confidence: 'high', shouldConvert: true },
    { id: 'measure:2', cueNumber: 2, sourceValue: 2, sourceUnitCode: 'kg', confidence: 'low', shouldConvert: true },
    { id: 'measure:3', cueNumber: 3, sourceValue: 2, sourceUnitCode: 'unknown', confidence: 'high', shouldConvert: true }
  ], {
    id: 'en-us', languageLabel: 'English', locale: 'en-US', regionLabel: 'United States',
    currencyCode: 'USD', unitSystem: 'us-customary', styleGuide: ''
  })
  assert.equal(result.length, 1)
  assert.equal(result[0]?.measurementMentionId, 'measure:1')
  assert.match(result[0]?.targetDisplay ?? '', /mi/)
})

test('measurement token sanitizes ids', () => {
  assert.equal(measurementToken('measure:1/secret'), '[[MEASURE_measure:1_secret]]')
})
