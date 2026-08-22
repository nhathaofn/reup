import test from 'node:test'
import assert from 'node:assert/strict'
import { applyReviewSelections, auditRestoration, buildAuditSystemPrompt, buildEvidenceAuditSystemPrompt, AUDIT_RESPONSE_SCHEMA } from '../src/main/services/srt-source-audit.ts'
import type { GeminiGenerateRequest } from '../src/main/services/gemini-files.ts'
import type { SubtitlePipelineEvidenceContext } from '../src/shared/features/subtitle-pipeline.ts'
import { createFakeGeminiTransport, pipelineEvidenceFixture, restorationDraftFixture, sourceCuesFixture, unresolvedCanonicalFixture, validatedSourceFixture } from './helpers/srt-localization-fixtures.ts'
import { buildCanonicalSrt } from '../src/main/services/subtitle-pipeline-output.ts'

test('audit prompt is reviewer-only and checks taxonomy/numbers/aliases', () => {
  const prompt = buildAuditSystemPrompt()
  assert.match(prompt, /reviewer/i)
  assert.match(prompt, /tên chính thức.*biệt danh/i)
  assert.match(prompt, /tiền tệ.*đơn vị/i)
  assert.match(prompt, /không tự chấp nhận.*low/i)
  assert.match(prompt, /không trả cues:\[\{\}\]/i)
  assert.match(prompt, /không làm tròn.*307.*300/i)
  assert.match(prompt, /cue liên tiếp/i)
  assert.deepEqual(AUDIT_RESPONSE_SCHEMA.properties.cues.items.required, [
    'n', 'decision', 'correctedZh', 'meaningVi', 'confidence', 'issue', 'evidenceVi', 'candidates'
  ])
})

test('evidence audit prompt and payload preserve independent source provenance', async () => {
  const prompt = buildEvidenceAuditSystemPrompt()
  assert.match(prompt, /OCR chỉ là chữ nhìn thấy/u)
  assert.match(prompt, /hai provenance độc lập/u)
  const requests: GeminiGenerateRequest[] = []
  const response = { cues: [
    { n: 1, decision: 'accept', correctedZh: sourceCuesFixture[0]!.text, meaningVi: 'Con này có cắn người không?', confidence: 'high', issue: 'taxonomy', evidenceVi: 'Ba track khớp.', candidates: [] },
    { n: 2, decision: 'accept', correctedZh: sourceCuesFixture[1]!.text, meaningVi: 'Nó có giá một trăm nhân dân tệ.', confidence: 'high', issue: 'number-or-currency', evidenceVi: 'Ba track khớp.', candidates: [] }
  ] }
  const base = createFakeGeminiTransport([response])
  await auditRestoration({
    jobId: 'job-evidence-payload',
    source: validatedSourceFixture,
    draft: restorationDraftFixture,
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
  const payload = JSON.parse(requests[0]!.userText) as { evidence?: Array<{ sources?: Array<{ source?: string }> }> }
  assert.deepEqual(payload.evidence?.[0]?.sources?.map((source) => source.source), ['srt', 'asr', 'ocr'])
})

test('high-confidence audit is accepted while low-confidence ambiguity remains unresolved', async () => {
  const canonical = await auditRestoration({
    jobId: 'job-1', source: validatedSourceFixture, draft: restorationDraftFixture,
    transport: createFakeGeminiTransport([{ cues: [
      { n: 1, decision: 'accept', correctedZh: '[SPEAKER_00] 这种鹅咬人吗', meaningVi: 'Con này có cắn người không?', confidence: 'high', issue: 'taxonomy', evidenceVi: 'Hình ảnh và âm thanh khớp.', candidates: [] },
      { n: 2, decision: 'review', correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', confidence: 'low', issue: 'number-or-currency', evidenceVi: 'Đơn vị tiền nghe chưa rõ.', candidates: [{ correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', evidenceVi: 'Nghe giống 一百元.' }, { correctedZh: '它值一百块', meaningVi: 'Nó có giá một trăm tệ.', evidenceVi: 'Có thể là cách nói khẩu ngữ.' }] }
    ] }])
  })
  assert.deepEqual(canonical.unresolvedCueNumbers, [2])
  assert.equal(canonical.cues[0]?.needsReview, false)
  assert.equal(canonical.cues[1]?.needsReview, true)
})

test('audit restores an evidence-backed question mark before canonical export', async () => {
  const source = {
    ...validatedSourceFixture,
    cues: [
      { ...validatedSourceFixture.cues[0]!, n: 1, text: '这是哪国空姐', speakerLabel: undefined },
      { ...validatedSourceFixture.cues[1]!, n: 2, text: '这是泰国空姐' }
    ]
  }
  const draft = {
    ...restorationDraftFixture,
    cues: source.cues.map((cue) => ({
      ...restorationDraftFixture.cues[cue.n - 1]!,
      n: cue.n,
      time: cue.time,
      originalZh: cue.text,
      correctedZh: cue.text,
      meaningVi: cue.n === 1 ? 'Đây là tiếp viên hàng không nước nào?' : 'Đây là tiếp viên hàng không Thái Lan.',
      changed: false,
      confidence: 'high' as const,
      issue: 'none' as const,
      candidates: [],
      needsReview: false
    }))
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
  const canonical = await auditRestoration({
    jobId: 'job-question-punctuation',
    source,
    draft,
    evidence,
    transport: createFakeGeminiTransport([{ cues: [
      { n: 1, decision: 'accept', correctedZh: '这是哪国空姐', meaningVi: 'Đây là tiếp viên hàng không nước nào?', confidence: 'high', issue: 'none', evidenceVi: 'OCR khớp.', candidates: [] },
      { n: 2, decision: 'accept', correctedZh: '这是泰国空姐', meaningVi: 'Đây là tiếp viên hàng không Thái Lan.', confidence: 'high', issue: 'none', evidenceVi: 'Khớp.', candidates: [] }
    ] }])
  })

  assert.equal(canonical.cues[0]?.correctedZh, '这是哪国空姐？')
  assert.deepEqual(canonical.unresolvedCueNumbers, [])
  assert.match(buildCanonicalSrt(canonical), /这是哪国空姐？/u)
})

test('medium replace is retained but routed to review instead of invalidating the batch', async () => {
  const canonical = await auditRestoration({
    jobId: 'job-medium-replace', source: validatedSourceFixture, draft: restorationDraftFixture,
    transport: createFakeGeminiTransport([{ cues: [
      { n: 1, decision: 'replace', correctedZh: '[SPEAKER_00] 这种鹅咬人吗', meaningVi: 'Con này có cắn người không?', confidence: 'medium', issue: 'homophone', evidenceVi: 'Có thể là cách nói khác.', candidates: [{ correctedZh: '[SPEAKER_00] 这种鹅咬人吗', meaningVi: 'Con này có cắn người không?', evidenceVi: 'Ứng viên.' }] },
      { n: 2, decision: 'accept', correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', confidence: 'high', issue: 'number-or-currency', evidenceVi: 'Giữ đúng số.', candidates: [] }
    ] }])
  })
  assert.deepEqual(canonical.unresolvedCueNumbers, [1])
  assert.equal(canonical.cues[0]?.needsReview, true)
  assert.equal(canonical.cues[1]?.needsReview, false)
})

test('semantic ASR replacement is never auto-promoted even when audit says high', async () => {
  const source = {
    ...validatedSourceFixture,
    cues: [
      { ...validatedSourceFixture.cues[0]!, n: 1, text: '这是哪个城市业奖', speakerLabel: undefined },
      { ...validatedSourceFixture.cues[1]!, n: 2, text: '这是东京' }
    ]
  }
  const draft = {
    ...restorationDraftFixture,
    cues: source.cues.map((cue) => ({
      n: cue.n,
      time: cue.time,
      originalZh: cue.text,
      correctedZh: cue.n === 1 ? '这是哪个城市夜景' : cue.text,
      meaningVi: cue.n === 1 ? 'Đây là cảnh đêm của thành phố nào?' : 'Đây là Tokyo.',
      changed: cue.n === 1,
      confidence: 'high' as const,
      issue: cue.n === 1 ? 'homophone' as const : 'none' as const,
      evidenceVi: 'Có ngữ cảnh.',
      candidates: cue.n === 1 ? [{ id: '1:0', correctedZh: '这是哪个城市夜景', meaningVi: 'Đây là cảnh đêm của thành phố nào?', evidenceVi: 'Ứng viên.' }] : [],
      needsReview: cue.n === 1
    }))
  }
  const canonical = await auditRestoration({
    jobId: 'job-semantic-safety',
    source,
    draft,
    transport: createFakeGeminiTransport([{ cues: [
      { n: 1, decision: 'replace', correctedZh: '这是哪个城市夜景', meaningVi: 'Đây là cảnh đêm của thành phố nào?', confidence: 'high', issue: 'homophone', evidenceVi: 'Ngữ cảnh danh sách thành phố.', candidates: [{ correctedZh: '这是哪个城市夜景', meaningVi: 'Đây là cảnh đêm của thành phố nào?', evidenceVi: 'Ứng viên.' }] },
      { n: 2, decision: 'accept', correctedZh: '这是东京', meaningVi: 'Đây là Tokyo.', confidence: 'high', issue: 'none', evidenceVi: 'Giữ nguyên.', candidates: [] }
    ] }])
  })
  assert.deepEqual(canonical.unresolvedCueNumbers, [1])
  assert.equal(canonical.cues[0]?.confidence, 'medium')
  assert.ok(canonical.cues[0]?.candidates.some((candidate) => candidate.correctedZh === source.cues[0]?.text))
})

test('audit auto-promotes a semantic repair only when two evidence tracks corroborate it', async () => {
  const source = {
    ...validatedSourceFixture,
    cues: [
      { ...validatedSourceFixture.cues[0]!, n: 1, text: '这是哪个城市业奖', speakerLabel: undefined },
      { ...validatedSourceFixture.cues[1]!, n: 2, text: '这是东京' }
    ]
  }
  const draft = {
    ...restorationDraftFixture,
    cues: source.cues.map((cue) => ({
      n: cue.n,
      time: cue.time,
      originalZh: cue.text,
      correctedZh: cue.n === 1 ? '这是哪个城市夜景' : cue.text,
      meaningVi: cue.n === 1 ? 'Đây là cảnh đêm của thành phố nào?' : 'Đây là Tokyo.',
      changed: cue.n === 1,
      confidence: 'high' as const,
      issue: cue.n === 1 ? 'homophone' as const : 'none' as const,
      evidenceVi: 'Đã đối chiếu evidence.',
      candidates: [],
      needsReview: cue.n === 1
    }))
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
  const canonical = await auditRestoration({
    jobId: 'job-evidence-corroborated',
    source,
    draft,
    evidence,
    transport: createFakeGeminiTransport([{ cues: [
      { n: 1, decision: 'replace', correctedZh: '这是哪个城市夜景', meaningVi: 'Đây là cảnh đêm của thành phố nào?', confidence: 'high', issue: 'homophone', evidenceVi: 'ASR và OCR cùng khớp 夜景.', candidates: [] },
      { n: 2, decision: 'accept', correctedZh: '这是东京', meaningVi: 'Đây là Tokyo.', confidence: 'high', issue: 'none', evidenceVi: 'Các nguồn khớp.', candidates: [] }
    ] }])
  })
  assert.deepEqual(canonical.unresolvedCueNumbers, [])
  assert.equal(canonical.cues[0]?.correctedZh, '这是哪个城市夜景')
  assert.equal(canonical.cues[0]?.confidence, 'high')
  assert.equal(canonical.cues[0]?.needsReview, false)
})

test('an evidence conflict triggers audit even when restoration left the primary text unchanged', async () => {
  const draft = {
    ...restorationDraftFixture,
    cues: restorationDraftFixture.cues.map((cue) => ({ ...cue, changed: false, confidence: 'high' as const, needsReview: false }))
  }
  const evidence: SubtitlePipelineEvidenceContext = {
    ...pipelineEvidenceFixture,
    conflictCueNumbers: [1],
    cues: pipelineEvidenceFixture.cues.map((cue) => cue.n === 1 ? { ...cue, conflict: true, confidence: 'low' as const } : cue)
  }
  const requests: GeminiGenerateRequest[] = []
  const base = createFakeGeminiTransport([{ cues: [
    { n: 1, decision: 'accept', correctedZh: sourceCuesFixture[0]!.text, meaningVi: 'Con này có cắn người không?', confidence: 'high', issue: 'none', evidenceVi: 'Giữ primary sau audit.', candidates: [] },
    { n: 2, decision: 'accept', correctedZh: sourceCuesFixture[1]!.text, meaningVi: 'Nó có giá một trăm nhân dân tệ.', confidence: 'high', issue: 'none', evidenceVi: 'Khớp.', candidates: [] }
  ] }])
  const canonical = await auditRestoration({
    jobId: 'job-conflict-audit',
    source: validatedSourceFixture,
    draft,
    evidence,
    transport: {
      ...base,
      generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => {
        requests.push(request)
        return base.generateJson<T>(request)
      }
    }
  })
  assert.equal(requests.length, 1)
  assert.deepEqual(canonical.unresolvedCueNumbers, [])
})

test('unresolved source fallback keeps fact metadata until the user chooses', async () => {
  const draft = {
    ...restorationDraftFixture,
    cues: restorationDraftFixture.cues.map((cue) => cue.n === 2
      ? {
          ...cue,
          correctedZh: '它值一百块',
          changed: true,
          confidence: 'medium' as const,
          needsReview: true,
          candidates: [
            { id: '2:0', correctedZh: '它值一百块', meaningVi: 'Nó có giá một trăm tệ.', evidenceVi: 'Ứng viên.' },
            { id: '2:1', correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', evidenceVi: 'Giữ source.' }
          ]
        }
      : cue)
  }
  const canonical = await auditRestoration({
    jobId: 'job-fact-fallback',
    source: validatedSourceFixture,
    draft,
    transport: createFakeGeminiTransport([{ cues: [
      { n: 1, decision: 'accept', correctedZh: sourceCuesFixture[0]!.text, meaningVi: 'Con này có cắn người không?', confidence: 'high', issue: 'none', evidenceVi: 'Giữ nguyên.', candidates: [] },
      { n: 2, decision: 'review', correctedZh: '它值一百块', meaningVi: 'Nó có giá một trăm tệ.', confidence: 'low', issue: 'number-or-currency', evidenceVi: 'Cần xác minh đơn vị.', candidates: [
        { correctedZh: '它值一百块', meaningVi: 'Nó có giá một trăm tệ.', evidenceVi: 'Ứng viên.' },
        { correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', evidenceVi: 'Giữ source.' }
      ] }
    ] }])
  })
  assert.equal(canonical.moneyMentions.length, 1)
  const sourceCandidate = canonical.cues[1]!.candidates.find((candidate) => candidate.correctedZh === '它值一百元')!
  const resolved = applyReviewSelections(canonical, [{ cueNumber: 2, candidateId: sourceCandidate.id }])
  assert.equal(resolved.moneyMentions.length, 1)
})

test('audit salvages valid rows when one row is malformed', async () => {
  const response = { cues: [
    { n: 1, decision: 'accept', correctedZh: '[SPEAKER_00] 这种鹅咬人吗', meaningVi: 'Con này có cắn người không?', confidence: 'high', issue: 'taxonomy', evidenceVi: 'Khớp.', candidates: [] },
    { n: 2, decision: 'review', correctedZh: '', meaningVi: '', confidence: 'low', issue: 'other', evidenceVi: '', candidates: [] }
  ] }
  const canonical = await auditRestoration({
    jobId: 'job-partial-audit', source: validatedSourceFixture, draft: restorationDraftFixture,
    transport: createFakeGeminiTransport([response, response])
  })
  assert.deepEqual(canonical.unresolvedCueNumbers, [2])
  assert.equal(canonical.cues[0]?.needsReview, false)
  assert.equal(canonical.cues[1]?.needsReview, true)
})

test('high-confidence revert restores the original cue without creating a dead-end review', async () => {
  const canonical = await auditRestoration({
    jobId: 'job-revert',
    source: validatedSourceFixture,
    draft: restorationDraftFixture,
    transport: createFakeGeminiTransport([{
      cues: [
        { n: 1, decision: 'revert', correctedZh: sourceCuesFixture[0]!.text, meaningVi: 'Nội dung gốc được xác nhận.', confidence: 'high', issue: 'taxonomy', evidenceVi: 'Bản sửa không có đủ bằng chứng.', candidates: [] },
        { n: 2, decision: 'accept', correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', confidence: 'high', issue: 'number-or-currency', evidenceVi: 'Đối chiếu rõ.', candidates: [] }
      ]
    }])
  })
  assert.deepEqual(canonical.unresolvedCueNumbers, [])
  assert.equal(canonical.cues[0]?.correctedZh, sourceCuesFixture[0]?.text)
})

function makeAuditFixture(count: number) {
  const sourceCues = Array.from({ length: count }, (_, index) => ({ n: index + 1, time: `00:00:${String(index).padStart(2, '0')},000 --> 00:00:${String(index + 1).padStart(2, '0')},000`, startSeconds: index, endSeconds: index + 1, text: `原文${index + 1}` }))
  const restored = sourceCues.map((cue) => ({ n: cue.n, time: cue.time, originalZh: cue.text, correctedZh: cue.text, meaningVi: `Nghĩa ${cue.n}`, changed: true, confidence: 'medium' as const, issue: 'homophone' as const, evidenceVi: 'Cần audit.', candidates: [], needsReview: false }))
  return { source: { ...validatedSourceFixture, cues: sourceCues, lastCueEndSeconds: count, videoDurationSeconds: count + 1 }, draft: { ...restorationDraftFixture, cues: restored, entities: [], moneyMentions: [], measurementMentions: [] } }
}

const acceptRows = (from: number, to: number) => ({ cues: Array.from({ length: to - from + 1 }, (_, offset) => { const n = from + offset; return { n, decision: 'accept', correctedZh: `原文${n}`, meaningVi: `Nghĩa ${n}`, confidence: 'high', issue: 'homophone', evidenceVi: 'Đã đối chiếu.', candidates: [] } }) })

test('audit batches 61 eligible cues as 60 + 1 and sends three prior cues as context', async () => {
  const fixture = makeAuditFixture(61)
  const prompts: string[] = []
  const base = createFakeGeminiTransport([acceptRows(1, 60), acceptRows(61, 61)])
  const transport = { ...base, generateJson: async <T>(request: GeminiGenerateRequest): Promise<T> => { prompts.push(request.userText); return base.generateJson<T>(request) } }
  const result = await auditRestoration({ jobId: 'job-61', source: fixture.source, draft: fixture.draft, transport })
  assert.equal(prompts.length, 2)
  for (const n of [58, 59, 60]) assert.match(prompts[1]!, new RegExp(`"n":${n}`))
  assert.deepEqual(result.unresolvedCueNumbers, [])
})

test('malformed audit response falls back to review after one repair', async () => {
  const missing = { cues: [acceptRows(2, 2).cues[0]] }
  const canonical = await auditRestoration({ jobId: 'job-1', source: validatedSourceFixture, draft: restorationDraftFixture, transport: createFakeGeminiTransport([missing, missing]) })
  assert.deepEqual(canonical.unresolvedCueNumbers, [1, 2])
  assert.equal(canonical.cues.every((cue) => cue.needsReview), true)
  assert.equal(canonical.cues.every((cue) => cue.candidates.length > 0), true)
})

test('failed audit batch marks every affected cue unresolved', async () => {
  const base = createFakeGeminiTransport([])
  const canonical = await auditRestoration({ jobId: 'job-1', source: validatedSourceFixture, draft: restorationDraftFixture, transport: { ...base, generateJson: async () => { throw new Error('api_503') } } })
  assert.deepEqual(canonical.unresolvedCueNumbers, [1, 2])
  assert.equal(canonical.cues.every((cue) => cue.needsReview), true)
})

test('audit transport failure does not downgrade untouched high-confidence cues', async () => {
  const draft = {
    ...restorationDraftFixture,
    cues: restorationDraftFixture.cues.map((cue) => cue.n === 2
      ? { ...cue, changed: true, confidence: 'medium' as const, needsReview: true }
      : { ...cue, changed: false, confidence: 'high' as const, needsReview: false })
  }
  const base = createFakeGeminiTransport([])
  const canonical = await auditRestoration({
    jobId: 'job-audit-failure-partial',
    source: validatedSourceFixture,
    draft,
    transport: { ...base, generateJson: async () => { throw new Error('api_503') } }
  })
  assert.deepEqual(canonical.unresolvedCueNumbers, [2])
  assert.equal(canonical.cues[0]?.needsReview, false)
})

test('review resolution requires one local candidate for every unresolved cue', () => {
  assert.throws(() => applyReviewSelections(unresolvedCanonicalFixture, []), /chọn phương án cho tất cả cue/)
  assert.throws(() => applyReviewSelections(unresolvedCanonicalFixture, [{ cueNumber: 2, candidateId: 'foreign' }]), /Phương án không hợp lệ/)
  const resolved = applyReviewSelections(unresolvedCanonicalFixture, [{ cueNumber: 2, candidateId: '2:0' }])
  assert.deepEqual(resolved.unresolvedCueNumbers, [])
  assert.equal(resolved.cues[1]?.meaningVi, 'Nó có giá một trăm nhân dân tệ.')
  assert.equal(resolved.moneyMentions.length, 1)
  const alternate = applyReviewSelections(unresolvedCanonicalFixture, [{ cueNumber: 2, candidateId: '2:1' }])
  assert.equal(alternate.moneyMentions.length, 0)
})

test('sample-style audit auto-approves OCR homophone/number normalization and drops the ASR tail', async () => {
  const sourceCues = [
    { n: 1, time: '00:00:00,000 --> 00:00:01,000', startSeconds: 0, endSeconds: 1, text: '采用有人之手' },
    { n: 2, time: '00:00:01,000 --> 00:00:02,000', startSeconds: 1, endSeconds: 2, text: '由二到六节车厢组成' },
    { n: 3, time: '00:00:02,000 --> 00:00:02,320', startSeconds: 2, endSeconds: 2.32, text: '居家' },
    { n: 4, time: '00:00:02,320 --> 00:00:02,380', startSeconds: 2.32, endSeconds: 2.38, text: '感谢观看' }
  ]
  const source = {
    ...validatedSourceFixture,
    cues: sourceCues,
    sourceText: sourceCues.map((cue) => `${cue.n}\n${cue.time}\n${cue.text}\n`).join('\n'),
    lastCueEndSeconds: 2.38,
    videoDurationSeconds: 2.38
  }
  const draft = {
    ...restorationDraftFixture,
    cues: sourceCues.map((cue) => ({
      n: cue.n,
      time: cue.time,
      originalZh: cue.text,
      correctedZh: cue.text,
      meaningVi: 'Nghĩa nguồn',
      changed: cue.n <= 2,
      confidence: cue.n <= 2 ? 'medium' as const : 'high' as const,
      issue: cue.n <= 2 ? 'homophone' as const : 'none' as const,
      evidenceVi: 'model prose',
      candidates: [],
      needsReview: cue.n <= 2
    })),
    entities: [],
    moneyMentions: [],
    measurementMentions: []
  }
  const match = (sourceName: 'asr' | 'ocr', n: number, text: string, repeatCount?: number) => ({
    id: `${sourceName}:${n}`,
    source: sourceName,
    n,
    startMs: sourceCues[n - 1]!.startSeconds * 1000,
    endMs: sourceCues[n - 1]!.endSeconds * 1000,
    text,
    confidence: null,
    similarity: sourceName === 'asr' ? 1 : 0.6,
    overlapMs: (sourceCues[n - 1]!.endSeconds - sourceCues[n - 1]!.startSeconds) * 1000,
    distanceMs: 0,
    ...(repeatCount !== undefined ? { repeatCount } : {})
  })
  const evidence: SubtitlePipelineEvidenceContext = {
    sourceCounts: { asr: 4, ocr: 2, srt: 0 },
    conflictCueNumbers: [1, 2],
    cues: sourceCues.map((cue) => ({
      n: cue.n,
      startMs: cue.startSeconds * 1000,
      endMs: cue.endSeconds * 1000,
      text: cue.text,
      primarySource: 'asr' as const,
      confidence: cue.n <= 2 ? 'low' as const : 'low' as const,
      conflict: cue.n <= 2,
      sources: cue.n === 1
        ? [match('asr', 1, cue.text), match('ocr', 1, '采用（GOA3）有人值守 无人驾驶模式', 3)]
        : cue.n === 2
          ? [match('asr', 2, cue.text), match('ocr', 2, '由2～6节车厢组成', 2)]
          : [match('asr', cue.n, cue.text)]
    }))
  }
  const canonical = await auditRestoration({
    jobId: 'job-sample-tail',
    source,
    draft,
    evidence,
    transport: createFakeGeminiTransport([{
      cues: [
        { n: 1, decision: 'review', correctedZh: '采用有人值守', meaningVi: 'Dùng chế độ có người trực.', confidence: 'medium', issue: 'homophone', evidenceVi: 'model prose', candidates: [{ correctedZh: '采用有人值守', meaningVi: 'Dùng chế độ có người trực.', evidenceVi: 'model prose' }] },
        { n: 2, decision: 'review', correctedZh: '由2～6节车厢组成', meaningVi: 'Gồm 2 đến 6 toa.', confidence: 'medium', issue: 'asr-segmentation', evidenceVi: 'model prose', candidates: [{ correctedZh: '由2～6节车厢组成', meaningVi: 'Gồm 2 đến 6 toa.', evidenceVi: 'model prose' }] },
        { n: 3, decision: 'accept', correctedZh: '居家', meaningVi: 'Nhiễu.', confidence: 'high', issue: 'other', evidenceVi: 'model prose', candidates: [] },
        { n: 4, decision: 'accept', correctedZh: '感谢观看', meaningVi: 'Cảm ơn đã xem.', confidence: 'high', issue: 'other', evidenceVi: 'model prose', candidates: [] }
      ]
    }])
  })

  assert.deepEqual(canonical.unresolvedCueNumbers, [3, 4])
  assert.equal(canonical.cues[0]?.needsReview, false)
  assert.equal(canonical.cues[0]?.confidence, 'high')
  assert.equal(canonical.cues[0]?.sourceSupport?.asr?.supportsFinal, false)
  assert.equal(canonical.cues[0]?.sourceSupport?.ocr?.supportsFinal, true)
  assert.equal(canonical.cues[1]?.needsReview, false)
  assert.equal(canonical.cues[1]?.finalAction, 'normalize')
  assert.equal(canonical.cues[2]?.disposition, 'hard_failure')
  assert.equal(canonical.cues[2]?.finalAction, 'drop')
  assert.equal(canonical.cues[3]?.finalAction, 'drop')
  assert.match(canonical.cues[0]?.evidenceVi ?? '', /ASR:.*有人之手/u)
  assert.match(canonical.cues[0]?.evidenceVi ?? '', /OCR:.*有人值守/u)
  assert.doesNotMatch(canonical.cues[0]?.evidenceVi ?? '', /ASR nhận nhầm/u)
})
