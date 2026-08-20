import type { FeatureMetadata } from './contracts'
import type { SrtBlock } from '../types'

export const FEATURE_ID = 'srt-translator' as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: 'Dịch SRT',
  icon: '🌐',
  title: 'Dịch file SRT bằng Gemini',
  subtitle: 'Dịch phụ đề tiếng Trung sang nhiều ngôn ngữ và xem trước trước khi xuất',
  placement: 'main',
  keepAlive: true
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const FEATURE_CHANNELS = {
  load: FEATURE_ID + ':load',
  analyze: FEATURE_ID + ':analyze',
  resolve: FEATURE_ID + ':resolve',
  translate: FEATURE_ID + ':translate',
  cancel: FEATURE_ID + ':cancel',
  release: FEATURE_ID + ':release',
  progress: FEATURE_ID + ':progress',
  exportOne: FEATURE_ID + ':export-one',
  exportAll: FEATURE_ID + ':export-all'
} as const

export type Confidence = 'high' | 'medium' | 'low'

export type RestorationBasis =
  | 'asr'
  | 'ocr'
  | 'context'
  | 'language_model'
  | 'normalization'

export type RestorationChangeType =
  | 'asr_correction'
  | 'ocr_correction'
  | 'proper_noun'
  | 'number'
  | 'unit'
  | 'homophone'
  | 'grammar'
  | 'completion'
  | 'noise_removal'
  | 'normalization'

/** Machine-readable outcome of the deterministic review gate. */
export type RestorationDisposition = 'pass' | 'soft_warning' | 'hard_failure'

/** Action used when materializing the canonical final SRT. */
export type RestorationFinalAction = 'keep' | 'normalize' | 'fallback' | 'drop'

export interface RestorationSourceSupportItem {
  /** Raw text from the corresponding evidence track, when available. */
  text?: string
  /** Whether the track supports the exact canonical surface or its safe representation. */
  supportsFinal: boolean
  /** Number of repeated OCR observations represented by this item. */
  repeatCount?: number
}

/** Structured provenance generated/validated by code, not free-form model prose. */
export interface RestorationSourceSupport {
  asr?: RestorationSourceSupportItem
  ocr?: RestorationSourceSupportItem
  srt?: RestorationSourceSupportItem
  context?: Pick<RestorationSourceSupportItem, 'supportsFinal'>
  languageModel?: Pick<RestorationSourceSupportItem, 'supportsFinal'>
  normalization?: Pick<RestorationSourceSupportItem, 'supportsFinal'>
}

export type RestorationIssue =
  | 'none'
  | 'homophone'
  | 'asr-omission'
  | 'asr-segmentation'
  | 'dialect'
  | 'slang'
  | 'taxonomy'
  | 'proper-name'
  | 'technical-term'
  | 'number-or-currency'
  | 'other'

export interface SourceFingerprint {
  path: string
  size: number
  modifiedMs: number
}

export interface SrtSourceCue {
  n: number
  time: string
  startSeconds: number
  endSeconds: number
  text: string
  speakerLabel?: string
}

export interface RestorationCandidate {
  id: string
  correctedZh: string
  meaningVi: string
  evidenceVi: string
}

export interface RestoredCue {
  n: number
  time: string
  originalZh: string
  correctedZh: string
  meaningVi: string
  changed: boolean
  confidence: Confidence
  issue: RestorationIssue
  evidenceVi: string
  visualContextVi?: string
  candidates: RestorationCandidate[]
  needsReview: boolean
  /** New structured review state; needsReview remains for IPC/UI compatibility. */
  disposition?: RestorationDisposition
  finalAction?: RestorationFinalAction
  sourceSupport?: RestorationSourceSupport
  basis?: RestorationBasis[]
  changeType?: RestorationChangeType[]
}

export interface SrtReviewCue extends RestoredCue {
  startSeconds: number
  endSeconds: number
}

export interface CanonicalEntity {
  id: string
  sourceForms: string[]
  category: 'species' | 'person' | 'place' | 'brand' | 'food' | 'technical' | 'other'
  canonicalMeaningVi: string
  scientificName?: string
  confidence: Confidence
  useNeutralReference: boolean
}

export interface CanonicalMoneyMention {
  id: string
  cueNumber: number
  sourceAmount: number
  sourceCurrencyCode: string
  sourceSurface: string
  confidence: Confidence
  shouldConvert: boolean
}

export interface CanonicalMeasurementMention {
  id: string
  cueNumber: number
  sourceValue: number
  sourceUnitCode: string
  sourceSurface: string
  confidence: Confidence
  shouldConvert: boolean
}

export interface CanonicalSource {
  jobId: string
  topicVi: string
  cues: RestoredCue[]
  entities: CanonicalEntity[]
  moneyMentions: CanonicalMoneyMention[]
  measurementMentions: CanonicalMeasurementMention[]
  unresolvedCueNumbers: number[]
}

export interface SrtTargetLanguage {
  id: string
  label: string
  code?: string
}

export interface LocaleProfile {
  id: string
  languageLabel: string
  locale: string
  regionLabel: string
  currencyCode: string
  unitSystem: 'metric' | 'us-customary'
  styleGuide: string
}

export interface SrtLocaleTargetInput {
  id: string
  languageLabel: string
  locale: string
  regionLabel: string
  currencyCode: string
}

export interface LocalizedTarget {
  id: string
  profile: LocaleProfile
}

export interface ExchangeRateSnapshot {
  provider: 'exchange-rate-api-open'
  baseCode: 'USD'
  capturedAt: string
  sourceUpdatedAt: string
  rates: Record<string, number>
  attributionUrl: string
}

export interface CurrencyConversionInstruction {
  moneyMentionId: string
  cueNumber: number
  sourceDisplay: string
  targetDisplay: string
  approximationMarker: string
  rateCapturedAt: string
}

export interface MeasurementConversionInstruction {
  measurementMentionId: string
  cueNumber: number
  sourceDisplay: string
  targetDisplay: string
}

export interface SrtAnalyzeRequest {
  sourcePath: string
  /**
   * The SRT-only workflow intentionally does not require media. These fields
   * remain optional so older callers can still be rejected/handled safely.
   */
  videoPath?: string
  verificationMode?: 'video' | 'text-only-confirmed'
}

export type SrtAnalyzeErrorCode =
  | 'source-invalid'
  | 'video-invalid'
  | 'key-missing'
  | 'upload-failed'
  | 'processing-failed'
  | 'restoration-failed'
  | 'cancelled'
  | 'unknown'

export interface SrtAnalyzeResult {
  ok: boolean
  jobId?: string
  sourcePath: string
  videoPath?: string
  sourceText?: string
  cueCount?: number
  videoDurationSeconds?: number
  topicVi?: string
  changedCount?: number
  reviewCues?: SrtReviewCue[]
  unresolvedCueNumbers?: number[]
  unverified?: boolean
  cleanupWarning?: string
  errorCode?: SrtAnalyzeErrorCode
  error?: string
}

export interface ReviewSelection {
  cueNumber: number
  candidateId: string
}

export interface SrtResolveRequest {
  jobId: string
  selections: ReviewSelection[]
}

export interface SrtResolveResult {
  ok: boolean
  unresolvedCueNumbers: number[]
  error?: string
}

export interface SrtLocalizationTranslateRequest {
  jobId: string
  targets: SrtLocaleTargetInput[]
}

export type SrtRateStatus = 'not-applicable' | 'converted' | 'source-preserved' | 'unavailable'

export interface SrtLocalizedTranslationResult {
  target: SrtLocaleTargetInput
  ok: boolean
  srt?: string
  count?: number
  unverified: boolean
  rateStatus: SrtRateStatus
  error?: string
}

export interface SrtLocalizationTranslateResult {
  ok: boolean
  translations: SrtLocalizedTranslationResult[]
  rateSnapshot?: Pick<ExchangeRateSnapshot, 'sourceUpdatedAt' | 'attributionUrl'>
  cancelled?: boolean
  cleanupWarning?: string
  error?: string
}

export type SrtLocalizationPhase =
  | 'validating'
  | 'uploading-video'
  | 'processing-video'
  | 'restoring-source'
  | 'auditing-source'
  | 'review-required'
  | 'fetching-rates'
  | 'translating'
  | 'cleaning-up'
  | 'completed'
  | 'cancelled'
  | 'error'

export interface SrtLocalizationProgress {
  jobId: string
  phase: SrtLocalizationPhase
  message: string
  percent?: number
  targetId?: string
  targetIndex?: number
  totalTargets?: number
}

export interface SrtLoadRequest {
  sourcePath: string
}

export interface SrtLoadResult {
  ok: boolean
  sourcePath: string
  sourceText?: string
  count?: number
  lastCueEndSeconds?: number
  fingerprint?: SourceFingerprint
  error?: string
}

export interface SrtTranslateRequest {
  sourcePath: string
  targets: SrtTargetLanguage[]
}

export interface SrtTranslationResult {
  target: SrtTargetLanguage
  ok: boolean
  srt?: string
  count?: number
  error?: string
}

export interface SrtTranslateResult {
  ok: boolean
  sourcePath: string
  sourceText?: string
  translations: SrtTranslationResult[]
  error?: string
}

export interface SrtTranslateProgress {
  targetId: string
  targetLabel: string
  targetIndex: number
  totalTargets: number
  done: number
  total: number
  percent: number
  message: string
}

export interface SrtExportItem {
  /**
   * The legacy target is retained while the IPC adapter is migrated. New
   * callers should send SrtLocaleTargetInput.
   */
  target: SrtTargetLanguage | SrtLocaleTargetInput
  ok: boolean
  srt?: string
  count?: number
  unverified?: boolean
  rateStatus?: SrtRateStatus
  error?: string
}

export interface SrtExportOneRequest {
  sourceName: string
  item: SrtExportItem
}

export interface SrtExportAllRequest {
  sourceName: string
  items: SrtExportItem[]
}

export interface SrtExportResult {
  ok: boolean
  cancelled?: boolean
  paths?: string[]
  error?: string
}

export interface SrtCancelRequest {
  jobId: string
}

export interface SrtCancelResult {
  ok: boolean
  wasRunning: boolean
  cleanupWarning?: string
  error?: string
}

export interface SrtReleaseRequest {
  jobId: string
}

export interface SrtReleaseResult {
  ok: boolean
  released: boolean
  cleanupWarning?: string
  error?: string
}

export function mergeTranslatedBlocks(
  blocks: readonly SrtBlock[],
  rows: readonly { n: number; t: string }[]
): SrtBlock[] {
  const map = new Map(rows.map((row) => [row.n, row.t]))
  return blocks.map((block, index) => ({
    time: block.time,
    text: map.get(index + 1) || block.text
  }))
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

export function slugifyLanguage(
  target: Pick<SrtTargetLanguage, 'label' | 'code'>,
  fallbackIndex = 0
): string {
  const raw = (target.code?.trim() || target.label).normalize('NFD')
  const slug = raw
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `lang-${fallbackIndex + 1}`
}

export function createTargetLanguage(label: string, code?: string): SrtTargetLanguage | null {
  const normalizedLabel = normalizeLabel(label)
  if (!normalizedLabel) return null
  const normalizedCode = code?.trim().toLowerCase() || undefined
  return {
    id: normalizedCode || slugifyLanguage({ label: normalizedLabel }, 0),
    label: normalizedLabel,
    ...(normalizedCode ? { code: normalizedCode } : {})
  }
}

export function dedupeTargetLanguages(
  targets: readonly SrtTargetLanguage[]
): SrtTargetLanguage[] {
  const seen = new Set<string>()
  const unique: SrtTargetLanguage[] = []
  for (const target of targets) {
    const keys = [target.code?.trim().toLowerCase(), normalizeLabel(target.label).toLowerCase()]
      .filter((key): key is string => Boolean(key))
    if (keys.some((key) => seen.has(key))) continue
    keys.forEach((key) => seen.add(key))
    unique.push(target)
  }
  return unique
}

export function makeOutputFileName(
  sourceName: string,
  target: Pick<SrtTargetLanguage, 'label' | 'code'> | SrtLocaleTargetInput,
  fallbackIndex = 0
): string {
  const basename = sourceName.replace(/^.*[\\/]/, '')
  const base = basename.replace(/\.srt$/i, '') || 'subtitle'
  const slug = 'languageLabel' in target
    ? target.id
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'lang-' + (fallbackIndex + 1)
    : slugifyLanguage(target, fallbackIndex)
  return `${base}.${slug}.srt`
}

export const SRT_LOCALE_PRESETS: readonly LocalizedTarget[] = [
  {
    id: 'vi-vn',
    profile: {
      id: 'vi-vn',
      languageLabel: 'Tiếng Việt',
      locale: 'vi-VN',
      regionLabel: 'Việt Nam',
      currencyCode: 'VND',
      unitSystem: 'metric',
      styleGuide: ''
    }
  },
  {
    id: 'id-id',
    profile: {
      id: 'id-id',
      languageLabel: 'Tiếng Indonesia',
      locale: 'id-ID',
      regionLabel: 'Indonesia',
      currencyCode: 'IDR',
      unitSystem: 'metric',
      styleGuide: ''
    }
  },
  {
    id: 'ja-jp',
    profile: {
      id: 'ja-jp',
      languageLabel: 'Tiếng Nhật',
      locale: 'ja-JP',
      regionLabel: 'Nhật Bản',
      currencyCode: 'JPY',
      unitSystem: 'metric',
      styleGuide: ''
    }
  },
  {
    id: 'th-th',
    profile: {
      id: 'th-th',
      languageLabel: 'Tiếng Thái',
      locale: 'th-TH',
      regionLabel: 'Thái Lan',
      currencyCode: 'THB',
      unitSystem: 'metric',
      styleGuide: ''
    }
  },
  {
    id: 'ko-kr',
    profile: {
      id: 'ko-kr',
      languageLabel: 'Tiếng Hàn',
      locale: 'ko-KR',
      regionLabel: 'Hàn Quốc',
      currencyCode: 'KRW',
      unitSystem: 'metric',
      styleGuide: ''
    }
  },
  {
    id: 'en-us',
    profile: {
      id: 'en-us',
      languageLabel: 'Tiếng Anh',
      locale: 'en-US',
      regionLabel: 'Hoa Kỳ',
      currencyCode: 'USD',
      unitSystem: 'us-customary',
      styleGuide: ''
    }
  }
]

const LEGACY_TARGET_TO_LOCALE_ID: Readonly<Record<string, string>> = {
  vi: 'vi-vn',
  id: 'id-id',
  ja: 'ja-jp',
  th: 'th-th',
  ko: 'ko-kr',
  en: 'en-us'
}

const CONTROL_OR_NEWLINE = /[\u0000-\u001f\u007f-\u009f\r\n]/
const ISO_CURRENCY = /^[A-Z]{3}$/

function normalizeInputField(
  value: unknown,
  label: string,
  maximum: number
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: label + ' không hợp lệ.' }
  }
  if (CONTROL_OR_NEWLINE.test(value)) {
    return { ok: false, error: label + ' không được chứa ký tự điều khiển.' }
  }
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return { ok: false, error: label + ' không được để trống.' }
  if (normalized.length > maximum) {
    return { ok: false, error: label + ' vượt quá giới hạn.' }
  }
  return { ok: true, value: normalized }
}

function hasLocaleExtensionOrPrivateUse(locale: string): boolean {
  return locale.split('-').some((subtag) => subtag.length === 1)
}

export function validateLocaleTargetInput(
  input: SrtLocaleTargetInput
): { ok: true; value: SrtLocaleTargetInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Target locale không hợp lệ.' }
  }

  const id = normalizeInputField(input.id, 'Mã target', 64)
  if (!id.ok) return id
  const languageLabel = normalizeInputField(input.languageLabel, 'Tên ngôn ngữ', 80)
  if (!languageLabel.ok) return languageLabel
  const regionLabel = normalizeInputField(input.regionLabel, 'Tên khu vực', 80)
  if (!regionLabel.ok) return regionLabel
  const localeInput = normalizeInputField(input.locale, 'Locale', 80)
  if (!localeInput.ok) return localeInput
  const currencyInput = normalizeInputField(input.currencyCode, 'Mã tiền tệ', 3)
  if (!currencyInput.ok) return currencyInput

  const currencyCode = currencyInput.value.toUpperCase()
  if (!ISO_CURRENCY.test(currencyCode)) {
    return { ok: false, error: 'Mã tiền tệ phải có dạng ISO 4217.' }
  }

  let locale: string
  try {
    locale = Intl.getCanonicalLocales(localeInput.value)[0]
    if (!locale || hasLocaleExtensionOrPrivateUse(locale)) {
      return { ok: false, error: 'Locale phải có ngôn ngữ và region hợp lệ.' }
    }
    if (!new Intl.Locale(locale).region) {
      return { ok: false, error: 'Locale phải có region.' }
    }
  } catch {
    return { ok: false, error: 'Locale phải theo chuẩn BCP-47.' }
  }

  return {
    ok: true,
    value: {
      id: id.value,
      languageLabel: languageLabel.value,
      locale,
      regionLabel: regionLabel.value,
      currencyCode
    }
  }
}

export function adaptLegacyTarget(target: SrtTargetLanguage): LocalizedTarget | null {
  if (!target || typeof target !== 'object') return null
  const candidates = [target.id, target.code]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
  const localeId = candidates
    .map((candidate) => LEGACY_TARGET_TO_LOCALE_ID[candidate])
    .find((value): value is string => Boolean(value))
  if (!localeId) return null

  const preset = SRT_LOCALE_PRESETS.find((item) => item.id === localeId)
  if (!preset) return null
  return {
    id: preset.id,
    profile: { ...preset.profile }
  }
}

export function makeLocalizedOutputFileName(
  sourceName: string,
  target: LocalizedTarget | SrtLocaleTargetInput,
  unverified: boolean
): string {
  const fileName = sourceName.split(/[\\/]/).pop() || 'subtitles.srt'
  const stem = fileName.replace(/\.srt$/i, '')
  const rawId = 'profile' in target ? target.profile.id : target.id
  const targetSlug = rawId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stem + '.' + (targetSlug || 'localized') + (unverified ? '_unverified' : '') + '.srt'
}
