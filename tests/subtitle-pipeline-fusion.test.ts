import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFusedSrt,
  dedupOcrCues,
  evidenceTextSimilarity,
  fuseSubtitleEvidence,
  isTextCorroboratedByEvidence,
  serializeFusionEvidence
} from '../src/main/services/subtitle-pipeline-fusion.ts'
import {
  hasHallucinationRisk,
  hasUnsupportedQuantityOrUnitRisk
} from '../src/main/services/srt-source-audit.ts'
import {
  buildEvidenceSource,
  buildFusionRestoreSystemPrompt,
  buildEvidenceVi,
  buildSourceSupport,
  hasStrongOcrSupport,
  isLikelyTailHallucination,
  isNumericRepresentationOnlyChange
} from '../src/main/services/srt-source-restoration.ts'
import { buildCanonicalSrt } from '../src/main/services/subtitle-pipeline-output.ts'
import type { CanonicalSource } from '../src/shared/features/srt-translator.ts'

const srt = (text: string, start = '00:00:00,000', end = '00:00:02,000'): string =>
  `1\n${start} --> ${end}\n${text}\n`

test('fuses agreeing ASR and OCR cues as high-confidence evidence', () => {
  const result = fuseSubtitleEvidence([
    { source: 'asr', text: srt('这是加拿大鹅'), language: 'zh' },
    { source: 'ocr', text: srt('这是加拿大鹅'), language: 'zh' }
  ])

  assert.equal(result.cues.length, 1)
  assert.equal(result.cues[0]?.text, '这是加拿大鹅')
  assert.equal(result.cues[0]?.confidence, 'high')
  assert.equal(result.cues[0]?.conflict, false)
  assert.deepEqual(result.cues[0]?.sources.map((cue) => cue.source), ['asr', 'ocr'])
  assert.deepEqual(result.conflictCueNumbers, [])
})

test('keeps contradictory sources in one reviewable cue instead of overwriting one', () => {
  const result = fuseSubtitleEvidence([
    { source: 'asr', text: srt('这是白天鹅') },
    { source: 'ocr', text: srt('这是黑天鹅') }
  ])

  assert.equal(result.cues.length, 1)
  assert.equal(result.cues[0]?.text, '这是白天鹅')
  assert.equal(result.cues[0]?.primarySource, 'asr')
  assert.equal(result.cues[0]?.conflict, true)
  assert.equal(result.cues[0]?.confidence, 'low')
  assert.deepEqual(result.conflictCueNumbers, [1])
  assert.deepEqual(result.cues[0]?.sources.map((cue) => cue.text), ['这是白天鹅', '这是黑天鹅'])
})

test('uses supplied SRT as primary when it exists and preserves unmatched OCR cues', () => {
  const result = fuseSubtitleEvidence([
    { source: 'srt', text: srt('这是狮头鹅') },
    { source: 'asr', text: srt('这是石头鹅') },
    { source: 'ocr', text: '1\n00:00:04,000 --> 00:00:05,000\n加拿大鹅\n' }
  ])

  assert.equal(result.cues.length, 2)
  assert.equal(result.cues[0]?.primarySource, 'srt')
  assert.equal(result.cues[0]?.text, '这是狮头鹅')
  assert.equal(result.cues[0]?.conflict, true)
  assert.equal(result.cues[1]?.primarySource, 'ocr')
  assert.equal(result.cues[1]?.text, '加拿大鹅')
  assert.equal(result.sourceCounts.srt, 1)
  assert.equal(result.sourceCounts.asr, 1)
  assert.equal(result.sourceCounts.ocr, 1)
})

test('does not alter exact numbers or timestamps when building the fused SRT', () => {
  const result = fuseSubtitleEvidence([
    { source: 'asr', text: srt('时速600公里') }
  ])
  const output = buildFusedSrt(result.cues)
  assert.match(output, /00:00:00,000 --> 00:00:02,000/u)
  assert.match(output, /时速600公里/u)
  assert.equal(evidenceTextSimilarity('白天鹅', '白天鹅'), 1)
  assert.ok(evidenceTextSimilarity('白天鹅', '黑天鹅') < 1)
  assert.match(serializeFusionEvidence(result), /"sourceCounts"/u)
})

test('requires two independent tracks before a semantic replacement is corroborated', () => {
  const result = fuseSubtitleEvidence([
    { source: 'srt', text: srt('这是哪个城市业奖') },
    { source: 'asr', text: srt('这是哪个城市夜景') },
    { source: 'ocr', text: srt('这是哪个城市夜景') }
  ])

  assert.equal(isTextCorroboratedByEvidence(result, 1, '这是哪个城市夜景'), true)
  assert.equal(isTextCorroboratedByEvidence(result, 1, '这是哪个城市业奖'), false)

  const twoWayConflict = fuseSubtitleEvidence([
    { source: 'asr', text: srt('这是白天鹅') },
    { source: 'ocr', text: srt('这是黑天鹅') }
  ])
  assert.equal(isTextCorroboratedByEvidence(twoWayConflict, 1, '这是黑天鹅'), false)
})

test('deduplicates consecutive OCR frames into a single cue with repeatCount', () => {
  const rawOcr = [
    { id: 'ocr:1', source: 'ocr' as const, n: 1, startMs: 3500, endMs: 4000, text: '采用（GOA3）有人值守 无人驾驶模式', confidence: null },
    { id: 'ocr:2', source: 'ocr' as const, n: 2, startMs: 5500, endMs: 6000, text: '采用（GOA3)有人值守 无人驾驶模式', confidence: null },
    { id: 'ocr:3', source: 'ocr' as const, n: 3, startMs: 6000, endMs: 6500, text: '采用（GOA3）有人值守 无人驾驶模式', confidence: null },
    { id: 'ocr:4', source: 'ocr' as const, n: 4, startMs: 6500, endMs: 7000, text: '采用（G0A3）有人值守 无人驾驶模式', confidence: null },
    // Isolated 1-character noise
    { id: 'ocr:5', source: 'ocr' as const, n: 5, startMs: 9000, endMs: 9100, text: '0', confidence: null }
  ]

  const deduped = dedupOcrCues(rawOcr)
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0]?.text, '采用（GOA3）有人值守 无人驾驶模式')
  assert.equal(deduped[0]?.startMs, 3500)
  assert.equal(deduped[0]?.endMs, 7000)
  assert.equal(deduped[0]?.repeatCount, 4)
})

test('smart fusion selects stable repeated OCR over ASR homophone error in fallback text', () => {
  const ocrTrack = [
    '1\n00:00:00,000 --> 00:00:01,000\n这是我国CR450高铁列车\n',
    '2\n00:00:01,000 --> 00:00:02,000\n这是我国CR450高铁列车\n'
  ].join('\n')
  const asrTrack = '1\n00:00:00,100 --> 00:00:02,100\n这是五国CR450高铁列车\n'

  const result = fuseSubtitleEvidence([
    { source: 'asr', text: asrTrack },
    { source: 'ocr', text: ocrTrack }
  ])

  assert.equal(result.cues.length, 1)
  assert.equal(result.cues[0]?.text, '这是我国CR450高铁列车')
  assert.equal(result.cues[0]?.primarySource, 'ocr')
  assert.equal(result.cues[0]?.conflict, true)
  assert.equal(result.cues[0]?.sources.find((s) => s.source === 'ocr')?.repeatCount, 2)
})

test('deterministic validator detects hallucination and quantifier change risks', () => {
  assert.equal(hasUnsupportedQuantityOrUnitRisk('单节载客量约300人', '三节载客量约300人'), true)
  assert.equal(hasUnsupportedQuantityOrUnitRisk('单节载客量约300人', '单节载客量约300人'), false)

  assert.equal(hasHallucinationRisk('单节载客量约300人', '每节可以搭载350人'), true)
  assert.equal(hasHallucinationRisk('这是我国CR450高铁列车', '这是我国CR450高铁列车'), false)
})

test('assigns OCR to best-overlapping ASR cue instead of stealing by prior adjacent cue', () => {
  // Exact sequence from Zhuzhou test case:
  // Cue 24: 50.040 -> 51.920 "这是珠洲智慧列车"
  // Cue 25: 51.920 -> 54.100 "采用虚拟轨道控制技术"
  // Cue 26: 54.100 -> 56.040 "由2-6节车厢组成"
  // OCR 1:  52.000 -> 54.000 "采用虚拟轨道控制技术" (dist to 24 is 80ms, but overlap with 25 is 2000ms)
  // OCR 2:  54.000 -> 56.000 "由2~6节车厢组成"     (dist to 25 is 0ms, but overlap with 26 is 1940ms)
  const asrTrack = [
    '1\n00:00:50,040 --> 00:00:51,920\n这是珠洲智慧列车\n',
    '2\n00:00:51,920 --> 00:00:54,100\n采用虚拟轨道控制技术\n',
    '3\n00:00:54,100 --> 00:00:56,040\n由2-6节车厢组成\n'
  ].join('\n')

  const ocrTrack = [
    '1\n00:00:52,000 --> 00:00:54,000\n采用虚拟轨道控制技术\n',
    '2\n00:00:54,000 --> 00:00:56,000\n由2~6节车厢组成\n'
  ].join('\n')

  const result = fuseSubtitleEvidence([
    { source: 'asr', text: asrTrack },
    { source: 'ocr', text: ocrTrack }
  ])

  assert.equal(result.cues.length, 3)

  // Cue 1 (ASR 24): Should NOT steal OCR 1
  assert.equal(result.cues[0]?.text, '这是珠洲智慧列车')
  assert.equal(result.cues[0]?.sources.length, 1)
  assert.equal(result.cues[0]?.sources[0]?.source, 'asr')

  // Cue 2 (ASR 25): Must receive OCR 1 (2000ms overlap)
  assert.equal(result.cues[1]?.text, '采用虚拟轨道控制技术')
  assert.equal(result.cues[1]?.sources.some((s) => s.source === 'ocr' && s.text === '采用虚拟轨道控制技术'), true)

  // Cue 3 (ASR 26): Must receive OCR 2 (1940ms overlap)
  assert.match(result.cues[2]?.text ?? '', /由2[-~]6节车厢组成/u)
  assert.equal(result.cues[2]?.sources.some((s) => s.source === 'ocr' && s.text === '由2~6节车厢组成'), true)
})

test('hard guard blocks OCR replacement when overlap ratio < 0.25 and similarity < 0.30', () => {
  // ASR cue: 51.920 -> 54.100 (2180ms) "采用虚拟轨道控制技术"
  // Weakly overlapping OCR: 54.000 -> 56.000 (overlap = 100ms, ratio = 100/2000 = 0.05, similarity = 0) "由2~6节车厢组成"
  const asrTrack = '1\n00:00:51,920 --> 00:00:54,100\n采用虚拟轨道控制技术\n'
  // 2 OCR frames to trigger repeatCount = 2
  const ocrTrack = [
    '1\n00:00:54,000 --> 00:00:55,000\n由2~6节车厢组成\n',
    '2\n00:00:55,000 --> 00:00:56,000\n由2~6节车厢组成\n'
  ].join('\n')

  const result = fuseSubtitleEvidence([
    { source: 'asr', text: asrTrack },
    { source: 'ocr', text: ocrTrack }
  ])

  // Even if OCR has repeatCount = 2, because overlap ratio (100ms / 2180ms < 0.25) AND similarity (0 < 0.30) are both low,
  // OCR MUST NOT replace ASR text
  assert.equal(result.cues[0]?.text, '采用虚拟轨道控制技术')
  assert.equal(result.cues[0]?.primarySource, 'asr')
})

test('buildEvidenceSource extracts raw ASR text and timestamps from fusion summary', () => {
  const asrTrack = '1\n00:00:00,100 --> 00:00:02,100\n这是五国CR450高铁列车\n'
  const ocrTrack = '1\n00:00:00,000 --> 00:00:02,000\n这是我国CR450高铁列车\n'

  const summary = fuseSubtitleEvidence([
    { source: 'asr', text: asrTrack },
    { source: 'ocr', text: ocrTrack }
  ])

  const source = buildEvidenceSource(summary, 'test_video.mp4')
  assert.equal(source.cues.length, 1)
  assert.equal(source.cues[0]?.n, 1)
  // Base text must be raw ASR hypothesis (这是五国CR450高铁列车), allowing AI to restore it with evidence
  assert.equal(source.cues[0]?.text, '这是五国CR450高铁列车')
  assert.equal(source.cues[0]?.startSeconds, 0.1)
  assert.equal(source.cues[0]?.endSeconds, 2.1)
  assert.match(source.sourceText, /这是五国CR450高铁列车/u)
})

test('buildFusionRestoreSystemPrompt contains spoken-mode rules and GOA3 exclusion principle', () => {
  const prompt = buildFusionRestoreSystemPrompt()
  assert.match(prompt, /SPOKEN NARRATION MODE/u)
  assert.match(prompt, /GOA3/u)
  assert.match(prompt, /TUYỆT ĐỐI KHÔNG tự động chèn thông tin chỉ xuất hiện trên màn hình mà narrator không nói/u)
  assert.match(prompt, /basis/u)
  assert.match(prompt, /changeType/u)
})

test('changed span homophone repair does not trigger false positive numeric risk', () => {
  // Cue 31: 五国 -> 我国 in sentence containing CR450
  const summary31 = fuseSubtitleEvidence([
    { source: 'asr', text: '1\n00:01:05,520 --> 00:01:08,300\n这是五国CR450高铁列车\n' },
    { source: 'ocr', text: '1\n00:01:05,520 --> 00:01:08,300\n这是我国CR450高铁列车\n' }
  ])
  assert.equal(hasHallucinationRisk('这是五国CR450高铁列车', '这是我国CR450高铁列车', summary31, 1), false)
  assert.equal(isTextCorroboratedByEvidence(summary31, 1, '这是我国CR450高铁列车', 1), true)

  // Cue 36: 十幅 -> 磁浮 in sentence containing 600
  const summary36 = fuseSubtitleEvidence([
    { source: 'asr', text: '1\n00:01:18,500 --> 00:01:21,000\n时速600公里高速十幅列车\n' },
    { source: 'ocr', text: '1\n00:01:18,500 --> 00:01:21,000\n时速600公里高速磁浮列车\n' }
  ])
  assert.equal(hasHallucinationRisk('时速600公里高速十幅列车', '时速600公里高速磁浮列车', summary36, 1), false)
  assert.equal(isTextCorroboratedByEvidence(summary36, 1, '时速600公里高速磁浮列车', 1), true)
})

test('hard failure triggers only on uncorroborated invented numbers or tokens', () => {
  const summary = fuseSubtitleEvidence([
    { source: 'asr', text: '1\n00:00:10,000 --> 00:00:12,000\n单节车厢载客约300人\n' },
    { source: 'ocr', text: '1\n00:00:10,000 --> 00:00:12,000\n单节车厢载客约300人\n' }
  ])
  // Hallucinated number 500 not present in ASR or OCR -> Hard failure
  assert.equal(hasHallucinationRisk('单节车厢载客约300人', '单节车厢载客约500人', summary, 1), true)

  // Supported number 300 -> No hallucination
  assert.equal(hasHallucinationRisk('单节车厢载客约300人', '单节车厢载客约300人', summary, 1), false)
})

test('repeated OCR can safely approve a clear ASR homophone and provenance states the direction', () => {
  const summary = fuseSubtitleEvidence([
    { source: 'asr', text: '1\n00:00:03,540 --> 00:00:05,360\n采用有人之手\n' },
    { source: 'ocr', text: [
      '1\n00:00:03,000 --> 00:00:04,000\n采用（GOA3）有人值守 无人驾驶模式\n',
      '2\n00:00:04,000 --> 00:00:05,000\n采用（GOA3）有人值守 无人驾驶模式\n',
      '3\n00:00:05,000 --> 00:00:06,000\n采用（GOA3）有人值守 无人驾驶模式\n'
    ].join('\n') }
  ])

  assert.equal(hasStrongOcrSupport(summary, 1, '采用有人值守'), true)
  const support = buildSourceSupport('采用有人之手', '采用有人值守', summary, 1, ['asr', 'ocr'])
  assert.equal(support.asr?.supportsFinal, false)
  assert.equal(support.ocr?.supportsFinal, true)
  const evidenceVi = buildEvidenceVi('采用有人之手', '采用有人值守', summary, 1, ['asr', 'ocr'], 'model prose')
  assert.match(evidenceVi, /ASR:.*有人之手/u)
  assert.match(evidenceVi, /OCR:.*有人值守/u)
  assert.doesNotMatch(evidenceVi, /ASR nhận nhầm/u)

  const directionSummary = fuseSubtitleEvidence([
    { source: 'asr', text: srt('适合于重庆这样的地形城市') },
    { source: 'ocr', text: srt('适配于重庆这样的地形城市') }
  ])
  const directionSupport = buildSourceSupport('适合于重庆这样的地形城市', '适配于重庆这样的地形城市', directionSummary, 1, ['asr', 'ocr'])
  assert.equal(directionSupport.asr?.supportsFinal, false)
  assert.equal(directionSupport.ocr?.supportsFinal, true)
})

test('number glyph changes are representation normalization, not semantic review', () => {
  assert.equal(isNumericRepresentationOnlyChange('由二到六节车厢组成', '由2～6节车厢组成'), true)
  assert.equal(isNumericRepresentationOnlyChange('三节载客量约307人', '单节载客量约307人'), false)
})

test('short unsupported ASR rows at the final tail are hard failures', () => {
  const summary = fuseSubtitleEvidence([
    { source: 'asr', text: [
      '1\n00:00:00,000 --> 00:00:01,000\n正文\n',
      '2\n00:00:01,000 --> 00:00:02,000\n结束\n',
      '3\n00:00:02,000 --> 00:00:02,320\n居家\n',
      '4\n00:00:02,320 --> 00:00:02,380\n感谢观看\n'
    ].join('\n') },
    { source: 'ocr', text: '1\n00:00:00,000 --> 00:00:01,000\n正文\n' }
  ])
  assert.equal(isLikelyTailHallucination({ startSeconds: 2, endSeconds: 2.32 }, 3, summary), true)
  assert.equal(isLikelyTailHallucination({ startSeconds: 2.32, endSeconds: 2.38 }, 4, summary), true)
})

test('canonical final SRT drops hard failures and renumbers remaining cues', () => {
  const canonical: CanonicalSource = {
    jobId: 'job-final',
    topicVi: '',
    entities: [],
    moneyMentions: [],
    measurementMentions: [],
    unresolvedCueNumbers: [2],
    cues: [
      { n: 1, time: '00:00:00,000 --> 00:00:01,000', originalZh: '一', correctedZh: '一', meaningVi: '', changed: false, confidence: 'high', issue: 'none', evidenceVi: '', candidates: [], needsReview: false, disposition: 'pass', finalAction: 'keep' },
      { n: 2, time: '00:00:01,000 --> 00:00:01,300', originalZh: '居家', correctedZh: '居家', meaningVi: '', changed: false, confidence: 'low', issue: 'asr-segmentation', evidenceVi: '', candidates: [], needsReview: true, disposition: 'hard_failure', finalAction: 'drop' },
      { n: 3, time: '00:00:01,300 --> 00:00:02,000', originalZh: '二', correctedZh: '二', meaningVi: '', changed: false, confidence: 'high', issue: 'none', evidenceVi: '', candidates: [], needsReview: false, disposition: 'pass', finalAction: 'keep' }
    ]
  }
  const output = buildCanonicalSrt(canonical)
  assert.match(output, /^1\n/u)
  assert.match(output, /\n二\n/u)
  assert.doesNotMatch(output, /居家/u)
  assert.equal(output.includes('\n3\n'), false)
})
