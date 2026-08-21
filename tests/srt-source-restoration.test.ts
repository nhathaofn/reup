import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCueWindows,
  buildEvidenceRestorationSystemPrompt,
  buildRestorationSystemPrompt,
  hasSuspiciousCueTiming,
  isSafeStructuralCompletion,
  requiresRestorationReview,
  restoreSource,
  RESTORATION_ENTITY_CATEGORY_VALUES,
  RESTORATION_ISSUE_VALUES,
  RESTORATION_RESPONSE_SCHEMA,
  restoreQuestionPunctuation
} from '../src/main/services/srt-source-restoration.ts'
import type { GeminiGenerateRequest } from '../src/main/services/gemini-files.ts'
import type { SubtitlePipelineEvidenceContext } from '../src/shared/features/subtitle-pipeline.ts'
import { serializeGeminiRequest, serializeGeminiTrace } from '../src/main/services/srt-translator-logging.ts'
import { createFakeGeminiTransport, pipelineEvidenceFixture, validatedSourceFixture } from './helpers/srt-localization-fixtures.ts'

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
  assert.match(prompt, /307.*300/is)
  assert.match(prompt, /cue.*trước\/sau/is)
  assert.match(prompt, /mọi sửa đổi nội dung.*audit\/review/is)
  assert.match(prompt, /không tự chèn từ nối.*hoặc/is)
  assert.doesNotMatch(prompt, /dịch correctedZh sang/)
})

test('evidence restoration sends provenance rows and distinguishes OCR from spoken ASR', async () => {
  const prompt = buildEvidenceRestorationSystemPrompt()
  assert.match(prompt, /OCR chỉ chứng minh chữ xuất hiện/u)
  assert.match(prompt, /hai provenance độc lập/u)

  const requests: GeminiGenerateRequest[] = []
  const base = createFakeGeminiTransport([validPassOneResponse])
  await restoreSource({
    source: validatedSourceFixture,
    evidence: pipelineEvidenceFixture,
    transport: {
      ...base,
      generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => {
        requests.push(request)
        return base.generateJson<T>(request)
      }
    }
  })

  assert.equal(requests.length, 1)
  const payload = JSON.parse(requests[0]!.userText) as { evidence?: Array<{ evidence?: { sources?: Array<{ source?: string }> } }> }
  assert.deepEqual(payload.evidence?.[0]?.evidence?.sources?.map((source) => source.source), ['srt', 'asr', 'ocr'])
  assert.match(requests[0]!.systemInstruction, /provenance/u)
})

test('fusion-restore mode inlines OCR candidates and uses spoken narration prompt', async () => {
  const requests: GeminiGenerateRequest[] = []
  const base = createFakeGeminiTransport([validPassOneResponse])
  await restoreSource({
    source: validatedSourceFixture,
    evidence: pipelineEvidenceFixture,
    mode: 'fusion-restore',
    transport: {
      ...base,
      generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => {
        requests.push(request)
        return base.generateJson<T>(request)
      }
    }
  })

  assert.equal(requests.length, 1)
  assert.match(requests[0]!.systemInstruction, /SPOKEN NARRATION MODE/u)
  assert.match(requests[0]!.systemInstruction, /GOA3/u)
  const payload = JSON.parse(requests[0]!.userText) as { cues: Array<{ asrHypothesis?: string; ocrEvidence?: Array<{ text: string }> }> }
  assert.equal(payload.cues[0]?.asrHypothesis, '[SPEAKER_00] 这种鹅咬人吗')
  assert.equal(payload.cues[0]?.ocrEvidence?.[0]?.text, '[SPEAKER_00] 这种鹅咬人吗')
})

test('source-only safety gate allows only mechanical suffix completion', () => {
  assert.equal(isSafeStructuralCompletion('由四到八节车厢组', '由四到八节车厢组成'), true)
  assert.equal(isSafeStructuralCompletion('这是哪个城市业奖', '这是哪个城市夜景'), false)
  assert.equal(requiresRestorationReview('这是哪个城市业奖', '这是哪个城市夜景'), true)
  assert.equal(requiresRestorationReview('由四到八节车厢组', '由四到八节车厢组成'), false)
  assert.equal(hasSuspiciousCueTiming({ startSeconds: 1, endSeconds: 1.05, text: '尾部' }), true)
  assert.equal(restoreQuestionPunctuation('这是哪国空姐？', '这是东京', undefined, 1), '这是东京')
})

test('restoration preserves an evidence-backed question mark when the model omits it', async () => {
  const source = {
    ...validatedSourceFixture,
    cues: [
      { ...validatedSourceFixture.cues[0]!, n: 1, text: '这是哪国空姐', speakerLabel: undefined },
      { ...validatedSourceFixture.cues[1]!, n: 2, text: '这是泰国空姐' }
    ]
  }
  const evidence: SubtitlePipelineEvidenceContext = {
    sourceCounts: { srt: 2, asr: 2, ocr: 2 },
    conflictCueNumbers: [1],
    cues: source.cues.map((cue) => {
      const ocrText = cue.n === 1 ? '这是哪国空姐？ DAX' : cue.text
      const surfaces = cue.n === 1
        ? [['asr', cue.text], ['ocr', ocrText]] as const
        : [['asr', cue.text], ['ocr', cue.text]] as const
      return {
        n: cue.n,
        startMs: cue.startSeconds * 1_000,
        endMs: cue.endSeconds * 1_000,
        text: cue.text,
        primarySource: 'asr' as const,
        confidence: cue.n === 1 ? 'low' as const : 'high' as const,
        conflict: cue.n === 1,
        sources: surfaces.map(([track, text]) => ({
          id: `${track}:${cue.n}`,
          source: track,
          n: cue.n,
          startMs: cue.startSeconds * 1_000,
          endMs: cue.endSeconds * 1_000,
          text,
          confidence: null,
          similarity: text === cue.text ? 1 : 0.9,
          overlapMs: (cue.endSeconds - cue.startSeconds) * 1_000,
          distanceMs: 0
        }))
      }
    })
  }
  const response = {
    ...validPassOneResponse,
    cues: [
      {
        ...validPassOneResponse.cues[0],
        n: 1,
        correctedZh: '这是哪国空姐',
        meaningVi: 'Đây là tiếp viên hàng không nước nào?',
        changed: false,
        issue: 'none',
        candidates: []
      },
      {
        ...validPassOneResponse.cues[1],
        n: 2,
        correctedZh: '这是泰国空姐',
        meaningVi: 'Đây là tiếp viên hàng không Thái Lan.',
        changed: false,
        issue: 'none',
        candidates: []
      }
    ],
    entities: [],
    moneyMentions: [],
    measurementMentions: []
  }

  const result = await restoreSource({ source, evidence, transport: createFakeGeminiTransport([response]) })

  assert.equal(result.cues[0]?.correctedZh, '这是哪国空姐？')
  assert.equal(result.cues[1]?.correctedZh, '这是泰国空姐')
})

test('two independent evidence tracks can corroborate a semantic ASR repair', async () => {
  const source = {
    ...validatedSourceFixture,
    cues: [
      { ...validatedSourceFixture.cues[0]!, n: 1, text: '这是哪个城市业奖', speakerLabel: undefined },
      { ...validatedSourceFixture.cues[1]!, n: 2, text: '这是东京' }
    ]
  }
  const evidence: SubtitlePipelineEvidenceContext = {
    sourceCounts: { srt: 2, asr: 2, ocr: 2 },
    conflictCueNumbers: [1],
    cues: source.cues.map((cue) => {
      const repaired = cue.n === 1 ? '这是哪个城市夜景' : cue.text
      const surfaces = cue.n === 1
        ? [['srt', cue.text], ['asr', repaired], ['ocr', repaired]] as const
        : [['srt', cue.text], ['asr', cue.text], ['ocr', cue.text]] as const
      return {
        n: cue.n,
        startMs: cue.startSeconds * 1_000,
        endMs: cue.endSeconds * 1_000,
        text: cue.text,
        primarySource: 'srt' as const,
        confidence: cue.n === 1 ? 'low' as const : 'high' as const,
        conflict: cue.n === 1,
        sources: surfaces.map(([track, text]) => ({
          id: `${track}:${cue.n}`, source: track, n: cue.n,
          startMs: cue.startSeconds * 1_000, endMs: cue.endSeconds * 1_000,
          text, confidence: null, similarity: text === cue.text ? 1 : 0.8,
          overlapMs: (cue.endSeconds - cue.startSeconds) * 1_000, distanceMs: 0
        }))
      }
    })
  }
  const response = {
    topicVi: 'Cảnh đêm thành phố',
    cues: [
      { n: 1, correctedZh: '这是哪个城市夜景', meaningVi: 'Đây là cảnh đêm của thành phố nào?', changed: true, confidence: 'high', issue: 'homophone', evidenceVi: 'ASR và OCR cùng khớp 夜景.', candidates: [{ correctedZh: '这是哪个城市夜景', meaningVi: 'Đây là cảnh đêm của thành phố nào?', evidenceVi: 'Hai nguồn độc lập cùng khớp.' }], needsReview: false },
      { n: 2, correctedZh: '这是东京', meaningVi: 'Đây là Tokyo.', changed: false, confidence: 'high', issue: 'none', evidenceVi: 'Các nguồn khớp.', candidates: [], needsReview: false }
    ],
    entities: [], moneyMentions: [], measurementMentions: []
  }
  const result = await restoreSource({ source, evidence, transport: createFakeGeminiTransport([response]) })
  assert.equal(result.cues[0]?.correctedZh, '这是哪个城市夜景')
  assert.equal(result.cues[0]?.confidence, 'high')
  assert.equal(result.cues[0]?.needsReview, false)
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

test('numeric and dangling-fragment restorations stay explicit review choices', async () => {
  const source = {
    ...validatedSourceFixture,
    cues: [
      { ...validatedSourceFixture.cues[0]!, n: 1, text: '三节载客量约307人', speakerLabel: undefined },
      { ...validatedSourceFixture.cues[1]!, n: 2, text: '采用有人之手' }
    ]
  }
  const response = {
    topicVi: 'Tàu điện',
    cues: [
      { n: 1, correctedZh: '三节载客量约300人', meaningVi: 'Sức chứa khoảng 300 người.', changed: true, confidence: 'high', issue: 'number-or-currency', evidenceVi: 'Suy đoán số liệu.', candidates: [{ correctedZh: '三节载客量约300人', meaningVi: 'Sức chứa khoảng 300 người.', evidenceVi: 'Suy đoán số liệu.' }], needsReview: false },
      { n: 2, correctedZh: '采用智能或', meaningVi: 'Dùng chế độ thông minh hoặc…', changed: true, confidence: 'high', issue: 'homophone', evidenceVi: 'Suy luận theo câu sau.', candidates: [{ correctedZh: '采用智能或', meaningVi: 'Dùng chế độ thông minh hoặc…', evidenceVi: 'Suy luận theo câu sau.' }], needsReview: false }
    ],
    entities: [], moneyMentions: [], measurementMentions: []
  }
  const result = await restoreSource({ source, transport: createFakeGeminiTransport([response]) })
  assert.equal(result.cues[0]?.needsReview, true)
  assert.equal(result.cues[0]?.confidence, 'medium')
  assert.equal(result.cues[0]?.issue, 'number-or-currency')
  assert.ok(result.cues[0]?.candidates.some((candidate) => candidate.correctedZh === '三节载客量约307人'))
  assert.equal(result.cues[1]?.needsReview, true)
  assert.equal(result.cues[1]?.issue, 'asr-segmentation')
})

test('near-zero-duration tail cues are retained but cannot be auto-approved', async () => {
  const source = {
    ...validatedSourceFixture,
    cues: [{ ...validatedSourceFixture.cues[0]!, n: 1, startSeconds: 2, endSeconds: 2.04, time: '00:00:02,000 --> 00:00:02,040', text: '二十秒钟' }]
  }
  const response = {
    ...validPassOneResponse,
    cues: [{ ...validPassOneResponse.cues[0]!, n: 1, correctedZh: '二十秒钟', meaningVi: 'Hai mươi giây.', changed: false, confidence: 'high', issue: 'none', candidates: [], needsReview: false }]
  }
  const result = await restoreSource({ source, transport: createFakeGeminiTransport([response]) })
  assert.equal(result.cues[0]?.needsReview, true)
  assert.equal(result.cues[0]?.issue, 'asr-segmentation')
  assert.ok(result.cues[0]?.candidates.some((candidate) => candidate.correctedZh === '二十秒钟'))
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
