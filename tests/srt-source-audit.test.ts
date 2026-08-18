import test from 'node:test'
import assert from 'node:assert/strict'
import { applyReviewSelections, auditRestoration, buildAuditSystemPrompt } from '../src/main/services/srt-source-audit.ts'
import type { GeminiGenerateRequest } from '../src/main/services/gemini-files.ts'
import { createFakeGeminiTransport, restorationDraftFixture, sourceCuesFixture, unresolvedCanonicalFixture, validatedSourceFixture } from './helpers/srt-localization-fixtures.ts'

test('audit prompt is reviewer-only and checks taxonomy/numbers/aliases', () => {
  const prompt = buildAuditSystemPrompt()
  assert.match(prompt, /reviewer/i)
  assert.match(prompt, /tên chính thức.*biệt danh/i)
  assert.match(prompt, /tiền tệ.*đơn vị/i)
  assert.match(prompt, /không tự chấp nhận.*low/i)
})

test('medium promoted to high is auto accepted; remaining ambiguity is unresolved', async () => {
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

test('changed cue without an audit decision fails after one repair', async () => {
  const missing = { cues: [acceptRows(2, 2).cues[0]] }
  await assert.rejects(() => auditRestoration({ jobId: 'job-1', source: validatedSourceFixture, draft: restorationDraftFixture, transport: createFakeGeminiTransport([missing, missing]) }), /Dữ liệu audit không hợp lệ/)
})

test('failed audit batch marks every affected cue unresolved', async () => {
  const base = createFakeGeminiTransport([])
  const canonical = await auditRestoration({ jobId: 'job-1', source: validatedSourceFixture, draft: restorationDraftFixture, transport: { ...base, generateJson: async () => { throw new Error('api_503') } } })
  assert.deepEqual(canonical.unresolvedCueNumbers, [1, 2])
  assert.equal(canonical.cues.every((cue) => cue.needsReview), true)
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
