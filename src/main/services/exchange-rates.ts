import {
  approximationMarkerForLocale
} from './srt-locale-profiles.ts'
import type {
  CanonicalMoneyMention,
  CurrencyConversionInstruction,
  ExchangeRateSnapshot,
  LocaleProfile
} from '../../shared/features/srt-translator.ts'

const RATE_URL = 'https://open.er-api.com/v6/latest/USD'
const CACHE_MS = 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 3
const RETRY_AFTER_CAP_MS = 30_000

export interface ExchangeRateProvider {
  getSnapshot(signal?: AbortSignal): Promise<ExchangeRateSnapshot | null>
}

export interface ExchangeRateProviderDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Đã hủy lấy tỷ giá.'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Đã hủy lấy tỷ giá.'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function retryAfterMs(response: Response, now: () => number): number | null {
  const value = response.headers.get('retry-after')
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(RETRY_AFTER_CAP_MS, seconds * 1000)
  }
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return null
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, date - now()))
}

function backoffMs(
  attempt: number,
  response: Response | null,
  random: () => number,
  now: () => number
): number {
  const retryAfter = response ? retryAfterMs(response, now) : null
  if (retryAfter !== null) return retryAfter
  const base = attempt === 1 ? 1_000 : 2_000
  return Math.min(RETRY_AFTER_CAP_MS, base + Math.floor(Math.max(0, random()) * 251))
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function cleanAbort(signal?: AbortSignal): Error | null {
  if (!signal?.aborted) return null
  return signal.reason instanceof Error ? signal.reason : new Error('Đã hủy lấy tỷ giá.')
}

function parseSnapshot(payload: unknown, capturedAtMs: number): ExchangeRateSnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  if (value.result !== 'success' || value.base_code !== 'USD') return null
  const updatedUnix = value.time_last_update_unix
  if (typeof updatedUnix !== 'number' || !Number.isFinite(updatedUnix) || updatedUnix <= 0) {
    return null
  }
  if (!value.rates || typeof value.rates !== 'object') return null

  const rates: Record<string, number> = {}
  for (const [rawCode, rawRate] of Object.entries(value.rates as Record<string, unknown>)) {
    const code = rawCode.toUpperCase()
    if (!/^[A-Z]{3}$/u.test(code)) return null
    if (typeof rawRate !== 'number' || !Number.isFinite(rawRate) || rawRate <= 0) return null
    rates[code] = rawRate
  }
  if (!(rates.USD > 0)) return null

  const sourceUpdatedAt = new Date(updatedUnix * 1000)
  const capturedAt = new Date(capturedAtMs)
  if (!Number.isFinite(sourceUpdatedAt.getTime()) || !Number.isFinite(capturedAt.getTime())) {
    return null
  }

  const frozenRates = Object.freeze(rates)
  return Object.freeze({
    provider: 'exchange-rate-api-open',
    baseCode: 'USD',
    capturedAt: capturedAt.toISOString(),
    sourceUpdatedAt: sourceUpdatedAt.toISOString(),
    rates: frozenRates,
    attributionUrl: 'https://www.exchangerate-api.com'
  })
}

export function createExchangeRateProvider(
  deps: ExchangeRateProviderDeps = {}
): ExchangeRateProvider {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  const random = deps.random ?? Math.random
  let cached: { snapshot: ExchangeRateSnapshot; capturedAtMs: number } | null = null

  return {
    async getSnapshot(signal) {
      const aborted = cleanAbort(signal)
      if (aborted) throw aborted
      const currentTime = now()
      if (cached && currentTime - cached.capturedAtMs < CACHE_MS) {
        return cached.snapshot
      }

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const beforeFetchAbort = cleanAbort(signal)
        if (beforeFetchAbort) throw beforeFetchAbort
        let response: Response | null = null
        try {
          response = await fetchImpl(RATE_URL, { signal })
          if (!response.ok) {
            if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) return null
            await sleep(backoffMs(attempt, response, random, now), signal)
            continue
          }
          let payload: unknown
          try {
            payload = await response.json()
          } catch {
            return null
          }
          const capturedAtMs = now()
          const snapshot = parseSnapshot(payload, capturedAtMs)
          if (!snapshot) return null
          cached = { snapshot, capturedAtMs }
          return snapshot
        } catch (reason) {
          const abortError = cleanAbort(signal)
          if (abortError) throw abortError
          if (attempt === MAX_ATTEMPTS) return null
          await sleep(backoffMs(attempt, response, random, now), signal)
        }
      }
      return null
    }
  }
}

export function convertCurrencyAmount(
  sourceAmount: number,
  sourceCode: string,
  targetCode: string,
  rates: Readonly<Record<string, number>>
): number | null {
  if (!Number.isFinite(sourceAmount)) return null
  const source = sourceCode.trim().toUpperCase()
  const target = targetCode.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(source) || !/^[A-Z]{3}$/u.test(target)) return null
  if (source === target) return sourceAmount
  const sourceRate = rates[source]
  const targetRate = rates[target]
  if (
    typeof sourceRate !== 'number' || !Number.isFinite(sourceRate) || sourceRate <= 0 ||
    typeof targetRate !== 'number' || !Number.isFinite(targetRate) || targetRate <= 0
  ) return null
  return (sourceAmount / sourceRate) * targetRate
}

export function currencyToken(id: string): string {
  return `[[MONEY_${id.replace(/[^a-zA-Z0-9:_-]/g, '_')}]]`
}

function roundSignificant(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return value
  const exponent = Math.floor(Math.log10(Math.abs(value)))
  const factor = 10 ** (digits - 1 - exponent)
  return Math.round(value * factor) / factor
}

function formatNumber(value: number, locale: string, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

export function buildCurrencyInstructions(
  mentions: readonly CanonicalMoneyMention[],
  profile: LocaleProfile,
  snapshot: ExchangeRateSnapshot | null
): CurrencyConversionInstruction[] {
  if (!snapshot) return []
  const instructions: CurrencyConversionInstruction[] = []
  const targetCode = profile.currencyCode.toUpperCase()
  for (const mention of mentions) {
    if (mention.confidence === 'low' || !mention.shouldConvert) continue
    const sourceCode = mention.sourceCurrencyCode.trim().toUpperCase()
    const targetAmount = convertCurrencyAmount(
      mention.sourceAmount,
      sourceCode,
      targetCode,
      snapshot.rates
    )
    if (targetAmount === null) continue
    const roundedTarget = roundSignificant(targetAmount, 2)
    instructions.push({
      moneyMentionId: mention.id,
      cueNumber: mention.cueNumber,
      sourceDisplay: `${formatNumber(mention.sourceAmount, profile.locale, 2)} ${sourceCode} (${mention.sourceSurface})`,
      targetDisplay: `${formatNumber(roundedTarget, profile.locale, 2)} ${targetCode}`,
      approximationMarker: approximationMarkerForLocale(profile.locale),
      rateCapturedAt: snapshot.capturedAt
    })
  }
  return instructions
}
