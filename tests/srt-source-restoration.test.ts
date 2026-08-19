import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCueWindows,
  buildRestorationSystemPrompt,
  restoreSource,
  RESTORATION_ENTITY_CATEGORY_VALUES,
  RESTORATION_ISSUE_VALUES,
  RESTORATION_RESPONSE_SCHEMA
} from '../src/main/services/srt-source-restoration.ts'
import type { GeminiGenerateRequest } from '../src/main/services/gemini-files.ts'
import { serializeGeminiRequest, serializeGeminiTrace } from '../src/main/services/srt-translator-logging.ts'
import { createFakeGeminiTransport, validatedSourceFixture } from './helpers/srt-localization-fixtures.ts'

const validPassOneResponse = {
  topicVi: 'Tập tính và giá trị của chim',
  cues: [
    { n: 1, time: '99:99:99,999 --> 99:99:99,999', correctedZh: '[SPEAKER_00] 这种鹅咬人吗', meaningVi: 'Con này có cắn người không?', changed: true, confidence: 'high', issue: 'taxonomy', evidenceVi: 'Hình ảnh cho thấy nên dùng cách gọi trung tính.', visualContextVi: 'Một loài chim nước.', candidates: [{ id: 'model-id', correctedZh: '[SPEAKER_00] 这种鹅咬人吗', meaningVi: 'Con này có cắn người không?', evidenceVi: 'Khớp hình ảnh.' }], needsReview: false },
    { n: 2, correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', changed: true, confidence: 'medium', issue: 'number-or-currency', evidenceVi: 'Nghe rõ số tiền.', candidates: [{ id: 'model-id-2', correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', evidenceVi: 'Khớp âm thanh.' }], needsReview: false }
  ],
  entities: [{ id: 'model-entity', sourceForms: ['鹅'], category: 'species', canonicalMeaningVi: 'chim nước', confidence: 'medium', useNeutralReference: false }],
  moneyMentions: [{ id: 'model-money', cueNumber: 2, sourceAmount: 100, sourceCurrencyCode: 'CNY', sourceSurface: '一百元', confidence: 'high', shouldConvert: true }],
  measurementMentions: []
}

test('61 cues become 60 + 1 core windows with three-cue overlap', () => {
  const cues = Array.from({ length: 61 }, (_, index) => ({ n: index + 1, time: `00:00:${String(index).padStart(2, '0')},000 --> 00:00:${String(index + 1).padStart(2, '0')},000`, startSeconds: index, endSeconds: index + 1, text: `cue ${index + 1}` }))
  const windows = buildCueWindows(cues)
  assert.deepEqual(windows[0]?.core.map((cue) => cue.n), Array.from({ length: 60 }, (_, i) => i + 1))
  assert.deepEqual(windows[1]?.core.map((cue) => cue.n), [61])
  assert.deepEqual(windows[1]?.before.map((cue) => cue.n), [58, 59, 60])
})

test('restoration prompt requires audio, image, ASR evidence and Vietnamese meanings', () => {
  const prompt = buildRestorationSystemPrompt()
  for (const phrase of ['âm thanh', 'hình ảnh', 'đồng âm', 'tiếng lóng', 'meaningVi', 'không tự tạo']) assert.match(prompt, new RegExp(phrase, 'i'))
  assert.match(prompt, /issue.*none.*homophone.*asr-omission.*other/is)
  assert.doesNotMatch(prompt, /dịch correctedZh sang/)
})

test('restoration constrains issue codes and normalizes model labels', async () => {
  const issueSchema = (RESTORATION_RESPONSE_SCHEMA.properties.cues.items as { properties: { issue: { enum: readonly string[] } } }).properties.issue
  const entitySchema = (RESTORATION_RESPONSE_SCHEMA.properties.entities.items as { properties: { category: { enum: readonly string[] } } }).properties.category
  assert.deepEqual(issueSchema.enum, RESTORATION_ISSUE_VALUES)
  assert.deepEqual(entitySchema.enum, RESTORATION_ENTITY_CATEGORY_VALUES)
  const response = {
    ...validPassOneResponse,
    cues: [
      { ...validPassOneResponse.cues[0], issue: 'đồng âm' },
      { ...validPassOneResponse.cues[1], issue: 'nhãn không chắc' }
    ],
    entities: validPassOneResponse.entities.map((entity) => ({ ...entity, category: 'animal' }))
  }
  const result = await restoreSource({ source: validatedSourceFixture, transport: createFakeGeminiTransport([response]) })
  assert.equal(result.cues[0]?.issue, 'homophone')
  assert.equal(result.cues[1]?.issue, 'other')
  assert.equal(result.entities[0]?.category, 'species')
})

test('Gemini diagnostic payloads preserve content while redacting credentials and URIs', () => {
  const request = serializeGeminiRequest({
    systemInstruction: 'system prompt',
    userText: 'SRT payload',
    responseSchema: { type: 'OBJECT' },
    file: { name: 'files/abc', uri: 'https://secret/file/abc', mimeType: 'video/mp4', state: 'ACTIVE' }
  })
  assert.match(request, /system prompt/)
  assert.match(request, /SRT payload/)
  assert.doesNotMatch(request, /https:\/\/secret\/file\/abc/)
  const response = serializeGeminiTrace({ apiKey: 'SECRET_KEY', uri: 'https://secret/response', cues: [{ n: 1 }] })
  assert.match(response, /\[REDACTED\]/)
  assert.doesNotMatch(response, /SECRET_KEY|https:\/\/secret\/response/)
})

test('restoration keeps local time/speaker and rewrites model-owned IDs', async () => {
  const result = await restoreSource({ source: validatedSourceFixture, transport: createFakeGeminiTransport([validPassOneResponse]) })
  assert.equal(result.cues[0]?.time, validatedSourceFixture.cues[0]?.time)
  assert.match(result.cues[0]?.correctedZh ?? '', /^\[SPEAKER_00\]/)
  assert.deepEqual(result.cues[0]?.candidates.map((item) => item.id), ['1:0'])
  assert.equal(result.entities[0]?.id, 'entity:0')
  assert.equal(result.moneyMentions[0]?.id, 'money:2:0')
})

for (const [name, invalidCues] of [
  ['missing n', validPassOneResponse.cues.slice(0, 1)],
  ['duplicate n', [validPassOneResponse.cues[0], validPassOneResponse.cues[0]]],
  ['out-of-range n', [{ ...validPassOneResponse.cues[0], n: 3 }, validPassOneResponse.cues[1]]]
] as const) {
  test(`${name} consumes exactly one repair call`, async () => {
    let calls = 0
    const base = createFakeGeminiTransport([{ ...validPassOneResponse, cues: invalidCues }, validPassOneResponse])
    const transport = { ...base, generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => { calls += 1; return base.generateJson<T>(request) } }
    await restoreSource({ source: validatedSourceFixture, transport })
    assert.equal(calls, 2)
  })
}

test('a second structurally invalid restoration response salvages missing cues from source', async () => {
  const invalid = { ...validPassOneResponse, cues: validPassOneResponse.cues.slice(0, 1) }
  const result = await restoreSource({ source: validatedSourceFixture, transport: createFakeGeminiTransport([invalid, invalid]) })
  assert.equal(result.cues.length, validatedSourceFixture.cues.length)
  assert.equal(result.cues[1]?.correctedZh, validatedSourceFixture.cues[1]?.text)
  assert.equal(result.cues[1]?.confidence, 'low')
  assert.equal(result.cues[1]?.needsReview, true)
  assert.equal(result.cues[1]?.candidates[0]?.correctedZh, validatedSourceFixture.cues[1]?.text)
})

test('missing candidate metadata is synthesized locally without another Gemini call', async () => {
  let calls = 0
  const response = {
    ...validPassOneResponse,
    cues: validPassOneResponse.cues.map((cue) => ({ ...cue, candidates: [] }))
  }
  const base = createFakeGeminiTransport([response])
  const result = await restoreSource({
    source: validatedSourceFixture,
    transport: { ...base, generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => { calls += 1; return base.generateJson<T>(request) } }
  })
  assert.equal(calls, 1)
  assert.equal(result.cues.every((cue) => !cue.changed || cue.candidates.some((candidate) => candidate.correctedZh === cue.correctedZh)), true)
})

test('two transport failures keep the original SRT as low-confidence review cues', async () => {
  let calls = 0
  const result = await restoreSource({
    source: validatedSourceFixture,
    transport: {
      ...createFakeGeminiTransport([]),
      generateJson: async () => {
        calls += 1
        throw new Error('temporary Gemini failure')
      }
    }
  })
  assert.equal(calls, 2)
  assert.deepEqual(result.cues.map((cue) => cue.correctedZh), validatedSourceFixture.cues.map((cue) => cue.text))
  assert.equal(result.cues.every((cue) => cue.confidence === 'low' && cue.needsReview && cue.candidates.length === 1), true)
})
