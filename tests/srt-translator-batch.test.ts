import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFactTokenReplacements,
  buildLocalizationPayload,
  buildLocalizationSystemPrompt,
  buildPreparedLocalizationCues,
  runLocalizedTargetBatch,
  validateLocalizedRows,
  type PreparedLocalizationCue
} from '../src/main/services/srt-localization.ts'
import * as localizationModule from '../src/main/services/srt-localization.ts'
import { buildMeasurementInstructions } from '../src/main/services/measurement-conversion.ts'
import { extractNumberLiterals } from '../src/main/services/srt-number-literals.ts'
import type { GeminiGenerateRequest } from '../src/main/services/gemini-files.ts'
import * as translatorLogging from '../src/main/services/srt-translator-logging.ts'
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

test('localized titles use independent country-native clickbait briefs and the full localized script', async () => {
  const generateLocalizedTitle = (localizationModule as Record<string, unknown>).generateLocalizedTitle
  assert.equal(typeof generateLocalizedTitle, 'function')
  const requests: GeminiGenerateRequest[] = []
  const responses = [
    { title: 'Đoàn tàu này đang khiến cả thế giới sửng sốt!' },
    { title: '이 열차의 정체를 알면 모두가 놀랍니다!' }
  ]
  const transport = {
    ...createFakeGeminiTransport([]),
    generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => {
      requests.push(request)
      return responses.shift() as T
    }
  }
  const koreanTarget = {
    id: 'ko-kr',
    profile: {
      id: 'ko-kr',
      languageLabel: 'Tiếng Hàn',
      locale: 'ko-KR',
      regionLabel: 'Hàn Quốc',
      currencyCode: 'KRW',
      unitSystem: 'metric' as const,
      styleGuide: '자연스러운 한국어 보이스오버.'
    }
  }
  const run = generateLocalizedTitle as (input: {
    canonical: typeof resolvedCanonicalFixture
    target: typeof viTargetFixture
    localizedSrt: string
    transport: typeof transport
  }) => Promise<{ ok: boolean; title?: string; error?: string }>

  const vietnamese = await run({
    canonical: resolvedCanonicalFixture,
    target: viTargetFixture,
    localizedSrt: '1\n00:00:00,000 --> 00:00:02,000\nĐây là một đoàn tàu đặc biệt.\n',
    transport
  })
  const korean = await run({
    canonical: resolvedCanonicalFixture,
    target: koreanTarget,
    localizedSrt: '1\n00:00:00,000 --> 00:00:02,000\n이것은 특별한 열차입니다.\n',
    transport
  })

  assert.equal(vietnamese.title, 'Đoàn tàu này đang khiến cả thế giới sửng sốt!')
  assert.equal(korean.title, '이 열차의 정체를 알면 모두가 놀랍니다!')
  assert.equal(requests.length, 2)
  assert.notEqual(requests[0]?.systemInstruction, requests[1]?.systemInstruction)
  assert.match(requests[0]?.systemInstruction ?? '', /Việt Nam/u)
  assert.match(requests[1]?.systemInstruction ?? '', /Hàn Quốc/u)
  assert.match(requests[0]?.userText ?? '', /Đây là một đoàn tàu đặc biệt/u)
  assert.match(requests[1]?.userText ?? '', /이것은 특별한 열차입니다/u)
})

test('localized title retries multiline output once and isolates a transport failure', async () => {
  const generateLocalizedTitle = (localizationModule as Record<string, unknown>).generateLocalizedTitle
  assert.equal(typeof generateLocalizedTitle, 'function')
  const run = generateLocalizedTitle as (input: {
    canonical: typeof resolvedCanonicalFixture
    target: typeof viTargetFixture
    localizedSrt: string
    transport: ReturnType<typeof createFakeGeminiTransport>
  }) => Promise<{ ok: boolean; title?: string; error?: string }>
  const repaired = await run({
    canonical: resolvedCanonicalFixture,
    target: viTargetFixture,
    localizedSrt: '1\n00:00:00,000 --> 00:00:02,000\nNội dung kịch bản.\n',
    transport: createFakeGeminiTransport([
      { title: 'Dòng một\nDòng hai' },
      { title: 'Sự thật khó tin đang khiến tất cả phải xem đến cuối!' }
    ])
  })

  let calls = 0
  const failed = await run({
    canonical: resolvedCanonicalFixture,
    target: viTargetFixture,
    localizedSrt: '1\n00:00:00,000 --> 00:00:02,000\nNội dung kịch bản.\n',
    transport: {
      ...createFakeGeminiTransport([]),
      generateJson: async (): Promise<never> => {
        calls += 1
        throw new Error('api_503')
      }
    }
  })

  assert.equal(repaired.ok, true)
  assert.equal(repaired.title, 'Sự thật khó tin đang khiến tất cả phải xem đến cuối!')
  assert.equal(failed.ok, false)
  assert.match(failed.error ?? '', /api_503/u)
  assert.equal(calls, 1)
})

test('localized title retries a short wrong-script Korean headline', async () => {
  const generateLocalizedTitle = (localizationModule as Record<string, unknown>).generateLocalizedTitle
  assert.equal(typeof generateLocalizedTitle, 'function')
  const koreanTarget = {
    id: 'ko-kr',
    profile: {
      id: 'ko-kr',
      languageLabel: 'Tiếng Hàn',
      locale: 'ko-KR',
      regionLabel: 'Hàn Quốc',
      currencyCode: 'KRW',
      unitSystem: 'metric' as const,
      styleGuide: '자연스러운 한국어 보이스오버.'
    }
  }
  const result = await (generateLocalizedTitle as (input: {
    canonical: typeof resolvedCanonicalFixture
    target: typeof koreanTarget
    localizedSrt: string
    transport: ReturnType<typeof createFakeGeminiTransport>
  }) => Promise<{ ok: boolean; title?: string; error?: string }>)({
    canonical: resolvedCanonicalFixture,
    target: koreanTarget,
    localizedSrt: '1\n00:00:00,000 --> 00:00:02,000\n이것은 특별한 열차입니다.\n',
    transport: createFakeGeminiTransport([
      { title: 'Wow!' },
      { title: '이 열차의 정체가 모두를 놀라게 했다!' }
    ])
  })

  assert.equal(result.title, '이 열차의 정체가 모두를 놀라게 했다!')
})

test('localized title honors cancellation that happens while receiving the response', async () => {
  const generateLocalizedTitle = (localizationModule as Record<string, unknown>).generateLocalizedTitle
  assert.equal(typeof generateLocalizedTitle, 'function')
  const controller = new AbortController()
  const transport = {
    ...createFakeGeminiTransport([]),
    generateJson: async <T>(): Promise<T> => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return { title: 'Tiêu đề không được xuất sau khi hủy!' } as T
    }
  }

  await assert.rejects(
    () => (generateLocalizedTitle as (input: {
      canonical: typeof resolvedCanonicalFixture
      target: typeof viTargetFixture
      localizedSrt: string
      transport: typeof transport
      signal: AbortSignal
    }) => Promise<unknown>)({
      canonical: resolvedCanonicalFixture,
      target: viTargetFixture,
      localizedSrt: '1\n00:00:00,000 --> 00:00:02,000\nNội dung kịch bản.\n',
      transport,
      signal: controller.signal
    }),
    { name: 'AbortError' }
  )
})

test('pipeline localization logs include target and batch context', () => {
  const formatter = (translatorLogging as Record<string, unknown>).formatSubtitlePipelineLogLine
  assert.equal(typeof formatter, 'function')
  const line = (formatter as (
    jobId: string,
    event: Record<string, unknown>,
    modelName: string
  ) => string)('job-korean', {
    phase: 'translating',
    kind: 'operation-progress',
    operation: 'validate-gemini-localization',
    message: 'TARGET_OUTPUT_INVALID: unknown-token',
    targetId: 'ko-kr',
    targetIndex: 5,
    targetCount: 10,
    done: 2,
    total: 2,
    attempt: 2
  }, 'gemini-test')

  assert.match(line, /targetId=ko-kr/u)
  assert.match(line, /target=5\/10/u)
  assert.match(line, /step=2\/2/u)
  assert.match(line, /TARGET_OUTPUT_INVALID: unknown-token/u)
})

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

test('fact tokens distinguish a standalone zero from the zero inside a larger measurement', () => {
  const cue = {
    n: 3,
    time: '00:00:05,000 --> 00:00:07,000',
    originalZh: '从0加速到时速600公里',
    correctedZh: '从0加速到时速600公里',
    meaningVi: 'Tăng tốc từ 0 đến 600 km/h.',
    changed: false,
    confidence: 'high' as const,
    issue: 'none' as const,
    evidenceVi: '',
    candidates: [],
    needsReview: false,
    finalAction: 'keep' as const
  }
  const canonical = {
    ...resolvedCanonicalFixture,
    cues: [...resolvedCanonicalFixture.cues, cue],
    measurementMentions: [
      { id: 'measurement:3:0', cueNumber: 3, sourceValue: 0, sourceUnitCode: 'other', sourceSurface: '0', confidence: 'high' as const, shouldConvert: false },
      { id: 'measurement:3:1', cueNumber: 3, sourceValue: 600, sourceUnitCode: 'km/h', sourceSurface: '600公里', confidence: 'high' as const, shouldConvert: false }
    ]
  }
  const instructions = buildMeasurementInstructions(canonical.measurementMentions, viTargetFixture.profile)
  const replacements = buildFactTokenReplacements(canonical, viTargetFixture.profile, [], instructions)
  const prepared = buildPreparedLocalizationCues(canonical, replacements)
  const preparedCue = prepared.find((item) => item.n === 3)

  assert.ok(preparedCue)
  assert.equal(preparedCue.text.includes('[[MEASURE_measurement:3:0]]'), true)
  assert.equal(preparedCue.text.includes('[[MEASURE_measurement:3:1]]'), true)
  assert.equal(replacements.find((item) => item.token === '[[MEASURE_measurement:3:0]]')?.renderedText, '0')
  assert.equal(replacements.find((item) => item.token === '[[MEASURE_measurement:3:1]]')?.renderedText, '600公里')
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

test('long targets are translated in bounded cue batches', async () => {
  const cues = Array.from({ length: 25 }, (_, index) => ({
    ...resolvedCanonicalFixture.cues[1]!,
    n: index + 1,
    time: '00:00:01,000 --> 00:00:02,000',
    originalZh: '这是列车',
    correctedZh: '这是列车',
    meaningVi: 'Đây là một đoàn tàu.',
    changed: false,
    issue: 'none' as const,
    evidenceVi: '',
    candidates: [],
    needsReview: false,
    finalAction: 'keep' as const
  }))
  const canonical = {
    ...resolvedCanonicalFixture,
    cues,
    entities: [],
    moneyMentions: [],
    measurementMentions: []
  }
  const requestCueCounts: number[] = []
  const transport = {
    ...createFakeGeminiTransport([]),
    generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => {
      const payload = JSON.parse(request.userText) as { cues: Array<{ n: number }> }
      requestCueCounts.push(payload.cues.length)
      return payload.cues.map((cue) => ({ n: cue.n, t: 'Đây là một đoàn tàu.' })) as T
    }
  }

  const result = await runLocalizedTargetBatch({
    canonical,
    targets: [viTargetFixture],
    transport,
    rateSnapshot: null
  })

  assert.equal(result.translations[0]?.ok, true)
  assert.deepEqual(requestCueCounts, [24, 1])
})

test('repair retries only invalid and missing Korean cues while preserving valid rows', async () => {
  const thirdCue = {
    ...resolvedCanonicalFixture.cues[1]!,
    n: 3,
    time: '00:00:05,000 --> 00:00:06,000',
    originalZh: '这是列车',
    correctedZh: '这是列车',
    meaningVi: 'Đây là một đoàn tàu.',
    changed: false,
    issue: 'none' as const,
    evidenceVi: '',
    candidates: [],
    needsReview: false,
    finalAction: 'keep' as const
  }
  const canonical = {
    ...resolvedCanonicalFixture,
    cues: [...resolvedCanonicalFixture.cues, thirdCue]
  }
  const koreanTarget = {
    id: 'ko-kr',
    profile: {
      id: 'ko-kr',
      languageLabel: 'Tiếng Hàn',
      locale: 'ko-KR',
      regionLabel: 'Hàn Quốc',
      currencyCode: 'KRW',
      unitSystem: 'metric' as const,
      styleGuide: '자연스러운 한국어 보이스오버.'
    }
  }
  const responses = [
    [
      { n: 1, t: '[SPEAKER_00] 이 새는 사람을 무나요?' },
      { n: 2, t: '가격은 [[MONEY_wrong]]입니다.' }
    ],
    [
      { n: 2, t: '가격은 [[MONEY_money:2:0]]입니다.' },
      { n: 3, t: '이것은 열차입니다.' }
    ]
  ]
  const requests: GeminiGenerateRequest[] = []
  const transport = {
    ...createFakeGeminiTransport([]),
    generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => {
      requests.push(request)
      return responses.shift() as T
    }
  }

  const result = await runLocalizedTargetBatch({
    canonical,
    targets: [koreanTarget],
    transport,
    rateSnapshot: rateFixture
  })

  assert.equal(result.translations[0]?.ok, true)
  assert.equal(requests.length, 2)
  const repairPayloadText = requests[1]!.userText.split('\n').at(-1)
  assert.ok(repairPayloadText)
  const repairPayload = JSON.parse(repairPayloadText) as {
    cues: Array<{ n: number }>
    factTokens: Array<{ token: string }>
  }
  assert.deepEqual(repairPayload.cues.map((cue) => cue.n), [2, 3])
  assert.deepEqual(repairPayload.factTokens.map((item) => item.token), ['[[MONEY_money:2:0]]'])
  assert.match(result.translations[0]?.srt ?? '', /이것은 열차입니다/u)
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
