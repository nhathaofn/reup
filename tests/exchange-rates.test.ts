import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCurrencyInstructions,
  convertCurrencyAmount,
  createExchangeRateProvider,
  currencyToken
} from '../src/main/services/exchange-rates.ts'

test('USD-base cross conversion is deterministic', () => {
  assert.equal(convertCurrencyAmount(100, 'CNY', 'VND', {
    USD: 1, CNY: 7, VND: 25_000
  }), 357142.85714285716)
})

test('provider validates and caches one snapshot for 24 hours', async () => {
  let calls = 0
  const provider = createExchangeRateProvider({
    fetchImpl: async () => {
      calls += 1
      return new Response(JSON.stringify({
        result: 'success', base_code: 'USD', time_last_update_unix: 1_700_000_000,
        rates: { USD: 1, CNY: 7, VND: 25_000 }
      }), { status: 200 })
    },
    now: () => 1_700_000_100_000
  })
  const first = await provider.getSnapshot()
  const second = await provider.getSnapshot()
  assert.equal(first?.baseCode, 'USD')
  assert.equal(second, first)
  assert.equal(calls, 1)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first?.rates), true)
})

test('instruction is local-first, approximate and keeps source in parentheses', () => {
  const instructions = buildCurrencyInstructions(
    [{
      id: 'money:1:0', cueNumber: 1, sourceAmount: 100,
      sourceCurrencyCode: 'CNY', sourceSurface: '100元',
      confidence: 'high', shouldConvert: true
    }],
    { id: 'vi-vn', languageLabel: 'Tiếng Việt', locale: 'vi-VN', regionLabel: 'Việt Nam', currencyCode: 'VND', unitSystem: 'metric', styleGuide: '' },
    {
      provider: 'exchange-rate-api-open', baseCode: 'USD',
      capturedAt: '2026-08-18T00:00:00.000Z', sourceUpdatedAt: '2026-08-18T00:00:00.000Z',
      rates: { USD: 1, CNY: 7, VND: 25_000 }, attributionUrl: 'https://www.exchangerate-api.com'
    }
  )
  assert.equal(instructions.length, 1)
  assert.equal(instructions[0]?.approximationMarker, 'khoảng')
  assert.match(instructions[0]?.sourceDisplay ?? '', /CNY|Nhân dân tệ/i)
  assert.match(instructions[0]?.sourceDisplay ?? '', /\(100元\)/)
})

for (const [name, payload] of [
  ['malformed response', { result: 'error' }],
  ['wrong base', { result: 'success', base_code: 'EUR', time_last_update_unix: 1, rates: { USD: 1 } }],
  ['non-positive rate', { result: 'success', base_code: 'USD', time_last_update_unix: 1, rates: { USD: 1, CNY: 0 } }]
] as const) {
  test(`provider returns null for ${name}`, async () => {
    const provider = createExchangeRateProvider({
      fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
      now: () => 1_700_000_100_000
    })
    assert.equal(await provider.getSnapshot(), null)
  })
}

test('missing currency code cannot be converted', () => {
  assert.equal(convertCurrencyAmount(100, 'CNY', 'VND', { USD: 1, CNY: 7 }), null)
})

test('network failure retries twice and never exposes response details', async () => {
  let calls = 0
  const waits: number[] = []
  const provider = createExchangeRateProvider({
    fetchImpl: async () => { calls += 1; throw new Error('SECRET_RESPONSE_BODY') },
    sleep: async (ms) => { waits.push(ms) },
    random: () => 0
  })
  assert.equal(await provider.getSnapshot(), null)
  assert.equal(calls, 3)
  assert.deepEqual(waits, [1000, 2000])
})

test('429 and 5xx retry, 4xx does not retry, and Retry-After is capped', async () => {
  let calls = 0
  const waits: number[] = []
  const provider = createExchangeRateProvider({
    fetchImpl: async () => {
      calls += 1
      if (calls < 3) return new Response('', { status: calls === 1 ? 429 : 503 })
      return new Response(JSON.stringify({
        result: 'success', base_code: 'USD', time_last_update_unix: 1_700_000_000,
        rates: { USD: 1, CNY: 7, VND: 25_000 }
      }), { status: 200 })
    },
    sleep: async (ms) => waits.push(ms),
    random: () => 1,
    now: () => 1_700_000_100_000
  })
  assert.ok(await provider.getSnapshot())
  assert.equal(calls, 3)
  assert.deepEqual(waits, [1251, 2251])

  let clientErrorCalls = 0
  const clientErrorProvider = createExchangeRateProvider({
    fetchImpl: async () => {
      clientErrorCalls += 1
      return new Response('SECRET', { status: 400 })
    },
    sleep: async () => { throw new Error('must not sleep') }
  })
  assert.equal(await clientErrorProvider.getSnapshot(), null)
  assert.equal(clientErrorCalls, 1)

  const retryAfterWaits: number[] = []
  let retryAfterCalls = 0
  const retryAfterProvider = createExchangeRateProvider({
    fetchImpl: async () => {
      retryAfterCalls += 1
      if (retryAfterCalls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '120' } })
      return new Response(JSON.stringify({
        result: 'success', base_code: 'USD', time_last_update_unix: 1_700_000_000,
        rates: { USD: 1, CNY: 7 }
      }), { status: 200 })
    },
    sleep: async (ms) => retryAfterWaits.push(ms),
    now: () => 1_700_000_100_000
  })
  assert.ok(await retryAfterProvider.getSnapshot())
  assert.deepEqual(retryAfterWaits, [30_000])
})

test('snapshot expires exactly after 24 hours', async () => {
  let now = 1_700_000_100_000
  let calls = 0
  const provider = createExchangeRateProvider({
    fetchImpl: async () => {
      calls += 1
      return new Response(JSON.stringify({
        result: 'success', base_code: 'USD', time_last_update_unix: 1_700_000_000,
        rates: { USD: 1, CNY: 7, VND: 25_000 }
      }), { status: 200 })
    },
    now: () => now
  })
  await provider.getSnapshot()
  now += 24 * 60 * 60 * 1000 - 1
  await provider.getSnapshot()
  assert.equal(calls, 1)
  now += 2
  await provider.getSnapshot()
  assert.equal(calls, 2)
})

test('tokens sanitize ids without allowing prompt delimiters', () => {
  assert.equal(currencyToken('money:1/secret'), '[[MONEY_money:1_secret]]')
})
