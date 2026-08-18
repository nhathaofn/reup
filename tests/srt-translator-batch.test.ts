import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLocalizationPayload,
  buildLocalizationSystemPrompt,
  runLocalizedTargetBatch,
  validateLocalizedRows,
  type PreparedLocalizationCue
} from '../src/main/services/srt-localization.ts'
import type { GeminiGenerateRequest } from '../src/main/services/gemini-files.ts'
import {
  createFakeGeminiTransport,
  jaTargetFixture,
  rateFixture,
  remoteFileFixture,
  resolvedCanonicalFixture,
  unresolvedCanonicalFixture,
  viTargetFixture
} from './helpers/srt-localization-fixtures.ts'

const preparedCues: PreparedLocalizationCue[] = [
  { n: 1, time: '00:00:01,000 --> 00:00:02,000', text: '[SPEAKER_00] canonical one', speakerLabel: '[SPEAKER_00]', requiredTokens: [], allowedNumberLiterals: [] },
  { n: 2, time: '00:00:03,000 --> 00:00:04,000', text: 'canonical [[MONEY_money:2:0]]', requiredTokens: ['[[MONEY_money:2:0]]'], allowedNumberLiterals: [] }
]

const validRows = [
  { n: 1, t: '[SPEAKER_00] Con này có cắn người không?' },
  { n: 2, t: 'Giá [[MONEY_money:2:0]].' }
]

test('prompt locks canonical meaning, social-video style and app conversion tokens', () => {
  const prompt = buildLocalizationSystemPrompt(viTargetFixture.profile)
  assert.match(prompt, /do not change.*canonical meaning/i)
  assert.match(prompt, /TikTok|Reels|Shorts/)
  assert.match(prompt, /never calculate.*money.*units/i)
  assert.match(prompt, /standard\/common.*target-locale/i)
  assert.match(prompt, /never substitute.*species/i)
  assert.match(prompt, /neutral reference/i)
  assert.match(prompt, /do not output timestamps/i)
  assert.match(prompt, /SPEAKER/)
})

test('payload carries entity identity and local timestamps only as input metadata', () => {
  const canonical = {
    ...resolvedCanonicalFixture,
    entities: [{ id: 'entity:0', sourceForms: ['鹅'], category: 'species' as const, canonicalMeaningVi: 'một loài chim nước', scientificName: 'Anser anser', confidence: 'high' as const, useNeutralReference: false }]
  }
  const payload = buildLocalizationPayload(canonical, preparedCues, [], [], [{ token: '[[MONEY_money:2:0]]', cueNumber: 2, sourceSurface: '一百元', renderedText: '100 CNY', mode: 'preserved' }])
  assert.equal(payload.entities[0]?.scientificName, 'Anser anser')
  assert.equal(payload.entities[0]?.useNeutralReference, false)
  assert.equal(payload.cues[0]?.time, resolvedCanonicalFixture.cues[0]?.time)
})

test('validator rejects malformed target rows and invented values', () => {
  for (const [name, rows] of [
    ['duplicate n', [validRows[0], validRows[0]]],
    ['missing n', [validRows[0]]],
    ['out-of-range n', [validRows[0], { n: 3, t: 'x' }]],
    ['changed speaker', [{ n: 1, t: '[SPEAKER_01] x' }, validRows[1]]],
    ['missing token', [validRows[0], { n: 2, t: 'Giá.' }]],
    ['duplicate token', [validRows[0], { n: 2, t: '[[MONEY_money:2:0]] [[MONEY_money:2:0]]' }]],
    ['unknown token', [validRows[0], { n: 2, t: '[[MONEY_unknown]] [[MONEY_money:2:0]]' }]],
    ['malformed money token', [validRows[0], { n: 2, t: '[[MONEY_money:2:0]] [[MONEY_bad!]]' }]],
    ['malformed measure token', [validRows[0], { n: 2, t: '[[MONEY_money:2:0]] [[MEASURE_bad!]]' }]],
    ['timestamp in text', [{ n: 1, t: '[SPEAKER_00] 00:00:01,000' }, validRows[1]]],
    ['invented direct number', [{ n: 1, t: '[SPEAKER_00] Có 999 con.' }, validRows[1]]]
  ] as const) {
    assert.throws(() => validateLocalizedRows(rows, preparedCues), new RegExp(`TARGET_OUTPUT_INVALID`), name)
  }
})

test('validator rejects timestamps made from Unicode decimal digits', () => {
  const timestampCue = [{ n: 1, time: 'x', text: 'x', requiredTokens: [], allowedNumberLiterals: ['00', '00', '01,000'] }]
  for (const timestamp of ['٠٠:٠٠:٠١,٠٠٠', '００:００:０１,０００', '๐๐:๐๐:๐๑,๐๐๐']) {
    assert.throws(() => validateLocalizedRows([{ n: 1, t: timestamp }], timestampCue), /TARGET_OUTPUT_INVALID: timestamp/)
  }
})

test('validator rejects a speaker label when the source cue has none', () => {
  assert.throws(() => validateLocalizedRows(
    [{ n: 1, t: '[SPEAKER_00] Nội dung' }],
    [{ n: 1, time: 'x', text: 'Nội dung 00', requiredTokens: [], allowedNumberLiterals: ['00'] }]
  ), /TARGET_OUTPUT_INVALID: unexpected-speaker-prefix/)
})

test('sequential batch keeps success when later target fails', async () => {
  const calls: string[] = []
  let generation = 0
  const baseTransport = createFakeGeminiTransport([])
  const transport = {
    ...baseTransport,
    generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => {
      generation += 1
      calls.push(request.systemInstruction.includes('vi-VN') ? 'vi-vn' : 'ja-jp')
      if (generation === 2) throw new Error('api_429')
      return validRows as T
    }
  }
  const result = await runLocalizedTargetBatch({ canonical: resolvedCanonicalFixture, targets: [viTargetFixture, jaTargetFixture], transport, file: remoteFileFixture, rateSnapshot: rateFixture })
  assert.deepEqual(calls, ['vi-vn', 'ja-jp'])
  assert.equal(result.translations[0]?.ok, true)
  assert.equal(result.translations[1]?.ok, false)
  assert.equal(result.translations[1]?.rateStatus, 'converted')
  assert.match(result.translations[0]?.srt ?? '', /00:00:01,000 --> 00:00:02,000/)
})

test('unresolved canonical source is rejected before model generation', async () => {
  let calls = 0
  const base = createFakeGeminiTransport([])
  await assert.rejects(() => runLocalizedTargetBatch({ canonical: unresolvedCanonicalFixture, targets: [viTargetFixture], transport: { ...base, generateJson: async () => { calls += 1; return [] } }, rateSnapshot: rateFixture }), /còn cue chưa được duyệt/)
  assert.equal(calls, 0)
})

test('invalid target output gets exactly one repair attempt', async () => {
  let calls = 0
  const base = createFakeGeminiTransport([[validRows[0]], validRows])
  const result = await runLocalizedTargetBatch({
    canonical: resolvedCanonicalFixture, targets: [viTargetFixture], rateSnapshot: rateFixture,
    transport: { ...base, generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => { calls += 1; return base.generateJson<T>(request) } }
  })
  assert.equal(calls, 2)
  assert.equal(result.translations[0]?.ok, true)
})

test('transport error is not retried even when its message resembles a validator error', async () => {
  let calls = 0
  const result = await runLocalizedTargetBatch({
    canonical: resolvedCanonicalFixture,
    targets: [viTargetFixture],
    rateSnapshot: rateFixture,
    transport: {
      ...createFakeGeminiTransport([]),
      generateJson: async () => {
        calls += 1
        throw new Error('TARGET_OUTPUT_INVALID: upstream transport')
      }
    }
  })
  assert.equal(calls, 1)
  assert.equal(result.translations[0]?.ok, false)
  assert.equal(result.translations[0]?.rateStatus, 'converted')
})

test('every verified target reuses one file URI and text-only omits it', async () => {
  const uris: Array<string | undefined> = []
  const base = createFakeGeminiTransport([validRows, validRows])
  const verified = await runLocalizedTargetBatch({
    canonical: resolvedCanonicalFixture, targets: [viTargetFixture, jaTargetFixture], file: remoteFileFixture, rateSnapshot: rateFixture,
    transport: { ...base, generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => { uris.push(request.file?.uri); return base.generateJson<T>(request) } }
  })
  assert.deepEqual(uris, [remoteFileFixture.uri, remoteFileFixture.uri])
  assert.equal(verified.translations.every((item) => item.unverified), false)

  const files: unknown[] = []
  const textOnly = await runLocalizedTargetBatch({
    canonical: resolvedCanonicalFixture, targets: [viTargetFixture], unverified: false, rateSnapshot: rateFixture,
    transport: { ...createFakeGeminiTransport([validRows]), generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => { files.push(request.file); return validRows as T } }
  })
  assert.deepEqual(files, [undefined])
  assert.equal(textOnly.translations[0]?.unverified, true)
})

test('source without money reports rate as not applicable', async () => {
  const canonical = { ...resolvedCanonicalFixture, moneyMentions: [] }
  const result = await runLocalizedTargetBatch({
    canonical, targets: [viTargetFixture], rateSnapshot: null,
    transport: createFakeGeminiTransport([[{ n: 1, t: '[SPEAKER_00] Con này có cắn người không?' }, { n: 2, t: 'Nó có giá một trăm tệ.' }]])
  })
  assert.equal(result.translations[0]?.rateStatus, 'not-applicable')
})
