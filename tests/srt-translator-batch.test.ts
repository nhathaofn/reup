import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLocalizationPayload,
  buildLocalizationSystemPrompt,
  runLocalizedTargetBatch,
  validateLocalizedRows,
  type PreparedLocalizationCue
} from '../src/main/services/srt-localization.ts'
import { extractNumberLiterals } from '../src/main/services/srt-number-literals.ts'
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

const japaneseRows = [
  { n: 1, t: '[SPEAKER_00] この列車は人を噛みますか？' },
  { n: 2, t: '価格は [[MONEY_money:2:0]] です。' }
]

test('prompt locks canonical meaning, social-video style and app conversion tokens', () => {
  const prompt = buildLocalizationSystemPrompt(viTargetFixture.profile)
  assert.match(prompt, /do not change.*canonical meaning/i)
  assert.match(prompt, /TikTok|Reels|Shorts/)
  assert.match(prompt, /never calculate.*money.*units/i)
  assert.match(prompt, /standard\/common.*target-locale/i)
  assert.match(prompt, /never substitute.*species/i)
  assert.match(prompt, /neutral reference/i)
  assert.match(prompt, /white swan/i)
  assert.match(prompt, /flying goose/i)
  assert.match(prompt, /Lionhead goose/i)
  assert.match(prompt, /proofread/i)
  assert.match(prompt, /same Arabic number|exact value/i)
  assert.match(prompt, /do not output timestamps/i)
  assert.match(prompt, /SPEAKER/)
  const japanesePrompt = buildLocalizationSystemPrompt(jaTargetFixture.profile)
  assert.match(japanesePrompt, /Japanese.*日本語/u)
  assert.match(japanesePrompt, /locale is authoritative/i)
})

test('validator rejects a Vietnamese result for the Thai target locale', () => {
  const thaiCues: PreparedLocalizationCue[] = [
    { n: 1, time: 'x', text: 'cue one', requiredTokens: [], allowedNumberLiterals: [] },
    { n: 2, time: 'x', text: 'cue two [[MONEY_money:2:0]]', requiredTokens: ['[[MONEY_money:2:0]]'], allowedNumberLiterals: [] }
  ]
  assert.throws(
    () => validateLocalizedRows([
      { n: 1, t: 'Con này có cắn người không?' },
      { n: 2, t: 'Giá [[MONEY_money:2:0]].' }
    ], thaiCues, { locale: 'th-TH' }),
    /TARGET_OUTPUT_INVALID: wrong-language-th-TH/
  )
  assert.doesNotThrow(() => validateLocalizedRows([
    { n: 1, t: 'ตัวนี้กัดคนไหม' },
    { n: 2, t: 'ราคา [[MONEY_money:2:0]]' }
  ], thaiCues, { locale: 'th-TH' }))
})

test('validator accepts equivalent Arabic digits for Chinese number words', () => {
  const cues: PreparedLocalizationCue[] = [
    { n: 1, time: 'x', text: '仅需三分三十秒', requiredTokens: [], allowedNumberLiterals: extractNumberLiterals('仅需三分三十秒') },
    { n: 2, time: 'x', text: '从零加速到时速600公里', requiredTokens: [], allowedNumberLiterals: extractNumberLiterals('从零加速到时速600公里') }
  ]
  assert.doesNotThrow(() => validateLocalizedRows([
    { n: 1, t: 'Chỉ mất 3 phút 30 giây.' },
    { n: 2, t: 'Tăng tốc từ 0 đến 600 km/h.' }
  ], cues))
})

test('number guard treats Chinese counters and country counts as facts', () => {
  assert.deepEqual(extractNumberLiterals('这是五国CR450列车'), ['5', '450'])
  assert.deepEqual(extractNumberLiterals('车身长六公里'), ['6'])
  assert.deepEqual(extractNumberLiterals('唯一商业化运营'), [])
})

test('number guard allows Japanese to make the implicit single carriage explicit', () => {
  const source = '单节车厢载客约200人'
  assert.deepEqual(extractNumberLiterals(source), ['1', '200'])
  assert.doesNotThrow(() => validateLocalizedRows([
    { n: 1, t: '1両あたり約200人を乗せられます。' }
  ], [{ n: 1, time: 'x', text: source, requiredTokens: [], allowedNumberLiterals: extractNumberLiterals(source) }], { locale: 'ja-JP' }))
})

test('number guard accepts locale decimal and grouping separators', () => {
  const source = '车身长2.6米，载客1000人'
  const cue = [{ n: 1, time: 'x', text: source, requiredTokens: [], allowedNumberLiterals: extractNumberLiterals(source) }]
  assert.doesNotThrow(() => validateLocalizedRows([
    { n: 1, t: 'Panjang badan 2,6 meter dan mampu membawa 1.000 orang.' }
  ], cue, { locale: 'id-ID' }))
  assert.doesNotThrow(() => validateLocalizedRows([
    { n: 1, t: 'Longueur de 2,6 mètres, capacité de 1\u202f000 personnes.' }
  ], cue, { locale: 'fr-FR' }))
  assert.doesNotThrow(() => validateLocalizedRows([
    { n: 1, t: 'Länge 2.6 Meter, Kapazität 1’000 Personen.' }
  ], cue, { locale: 'de-CH' }))
  assert.throws(() => validateLocalizedRows([
    { n: 1, t: 'Panjang badan 2,7 meter dan mampu membawa 1.000 orang.' }
  ], cue, { locale: 'id-ID' }), /TARGET_OUTPUT_INVALID: invented-number/)
})

test('validator catches a wrong script for Japanese and Korean targets', () => {
  const cues = [
    { n: 1, time: 'x', text: '列车是什么', requiredTokens: [], allowedNumberLiterals: [] },
    { n: 2, time: 'x', text: '这是一列列车', requiredTokens: [], allowedNumberLiterals: [] }
  ]
  assert.throws(() => validateLocalizedRows([
    { n: 1, t: 'Đây là loại tàu gì?' },
    { n: 2, t: 'Đây là một đoàn tàu.' }
  ], cues, { locale: 'ja-JP' }), /TARGET_OUTPUT_INVALID: wrong-language-ja-JP/)
  assert.doesNotThrow(() => validateLocalizedRows([
    { n: 1, t: 'この列車は何ですか？' },
    { n: 2, t: 'これは列車です。' }
  ], cues, { locale: 'ja-JP' }))
  assert.throws(() => validateLocalizedRows([
    { n: 1, t: 'Đây là loại tàu gì?' },
    { n: 2, t: 'Đây là một đoàn tàu.' }
  ], cues, { locale: 'ko-KR' }), /TARGET_OUTPUT_INVALID: wrong-language-ko-KR/)
  assert.doesNotThrow(() => validateLocalizedRows([
    { n: 1, t: '이 열차는 무엇인가요?' },
    { n: 2, t: '이것은 열차입니다.' }
  ], cues, { locale: 'ko-KR' }))
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
    ['blank line in text', [{ n: 1, t: '[SPEAKER_00] line one\n\nline two' }, validRows[1]]],
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
  const base = createFakeGeminiTransport([validRows, japaneseRows])
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
