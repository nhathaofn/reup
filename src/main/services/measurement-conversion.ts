import type {
  CanonicalMeasurementMention,
  LocaleProfile,
  MeasurementConversionInstruction
} from '../../shared/features/srt-translator.ts'

type UnitSystem = LocaleProfile['unitSystem']

const TO_US: Readonly<Record<string, { unitCode: string; convert: (value: number) => number }>> = {
  km: { unitCode: 'mi', convert: (value) => value * 0.62137119224 },
  m: { unitCode: 'ft', convert: (value) => value * 3.280839895 },
  cm: { unitCode: 'in', convert: (value) => value * 0.3937007874 },
  kg: { unitCode: 'lb', convert: (value) => value * 2.2046226218 },
  g: { unitCode: 'oz', convert: (value) => value * 0.03527396195 },
  celsius: { unitCode: 'fahrenheit', convert: (value) => value * 9 / 5 + 32 },
  l: { unitCode: 'gal-us', convert: (value) => value * 0.2641720524 },
  ml: { unitCode: 'fl-oz-us', convert: (value) => value * 0.0338140227 },
  m2: { unitCode: 'ft2', convert: (value) => value * 10.763910417 },
  km2: { unitCode: 'mi2', convert: (value) => value * 0.3861021585 },
  'km/h': { unitCode: 'mph', convert: (value) => value * 0.62137119224 }
}

export function measurementToken(id: string): string {
  return `[[MEASURE_${id.replace(/[^a-zA-Z0-9:_-]/g, '_')}]]`
}

export function convertMeasurement(
  sourceValue: number,
  sourceUnitCode: string,
  unitSystem: UnitSystem
): { value: number; unitCode: string } | null {
  if (!Number.isFinite(sourceValue)) return null
  const unit = sourceUnitCode.trim().toLowerCase()
  const mapping = TO_US[unit]
  if (!mapping) return null
  return unitSystem === 'us-customary'
    ? { value: mapping.convert(sourceValue), unitCode: mapping.unitCode }
    : { value: sourceValue, unitCode: unit }
}

function roundSignificant(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return value
  const exponent = Math.floor(Math.log10(Math.abs(value)))
  const factor = 10 ** (digits - 1 - exponent)
  return Math.round(value * factor) / factor
}

function formatMeasurement(value: number, unitCode: string, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value)} ${unitCode}`
}

export function buildMeasurementInstructions(
  mentions: readonly CanonicalMeasurementMention[],
  profile: LocaleProfile
): MeasurementConversionInstruction[] {
  const instructions: MeasurementConversionInstruction[] = []
  for (const mention of mentions) {
    if (mention.confidence === 'low' || !mention.shouldConvert) continue
    const converted = convertMeasurement(mention.sourceValue, mention.sourceUnitCode, profile.unitSystem)
    if (!converted) continue
    instructions.push({
      measurementMentionId: mention.id,
      cueNumber: mention.cueNumber,
      sourceDisplay: formatMeasurement(mention.sourceValue, mention.sourceUnitCode, profile.locale),
      targetDisplay: formatMeasurement(roundSignificant(converted.value, 3), converted.unitCode, profile.locale)
    })
  }
  return instructions
}
