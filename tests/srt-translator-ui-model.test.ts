import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canAnalyze,
  canResolve,
  canTranslate,
  createInitialSrtTranslatorState,
  jobIdToReleaseBeforeReplacement,
  progressPercent,
  srtTranslatorReducer,
  visibleStep,
  type SrtTranslatorViewState
} from '../src/renderer/src/features/srt-translator/model.ts'
import {
  jaTargetInputFixture,
  successfulTranslationFixture,
  unresolvedCanonicalFixture,
  viTargetInputFixture
} from './helpers/srt-localization-fixtures.ts'

const reviewCueFixture = {
  ...unresolvedCanonicalFixture.cues[1]!,
  startSeconds: 3,
  endSeconds: 4
}

function analyzedStateFixture(overrides: Partial<SrtTranslatorViewState> = {}): SrtTranslatorViewState {
  return {
    ...createInitialSrtTranslatorState(),
    sourcePath: 'clip.srt',
    sourceText: 'source',
    sourceCount: 2,
    lastCueEndSeconds: 4,
    videoDurationSeconds: 5,
    videoPath: 'clip.mp4',
    jobId: 'job-1',
    geminiReady: true,
    topicVi: 'Thử nghiệm',
    targets: [viTargetInputFixture],
    ...overrides
  }
}

test('analyze requires only SRT, key and idle state', () => {
  const ready = { ...createInitialSrtTranslatorState(), sourcePath: 'clip.srt', videoPath: 'clip.mp4', geminiReady: true }
  assert.equal(canAnalyze(ready), true)
  assert.equal(canAnalyze({ ...ready, videoPath: '' }), true)
  assert.equal(canAnalyze({ ...ready, running: true }), false)
})

test('unresolved cues gate translation until every selection resolves', () => {
  const state = analyzedStateFixture({ unresolvedCueNumbers: [2], reviewCues: [reviewCueFixture] })
  assert.equal(visibleStep(state), 'review')
  assert.equal(canResolve(state), false)
  assert.equal(canTranslate(state), false)
  const selected = srtTranslatorReducer(state, { type: 'review-selected', cueNumber: 2, candidateId: '2:0' })
  assert.equal(canResolve(selected), true)
  const resolving = srtTranslatorReducer(selected, { type: 'resolve-started' })
  assert.equal(canTranslate(resolving), false)
  const resolved = srtTranslatorReducer(resolving, { type: 'resolve-succeeded' })
  assert.equal(canTranslate(resolved), true)
})

test('stale progress from an old job is ignored and same-phase progress never decreases', () => {
  const state = analyzedStateFixture({ jobId: 'job-new', running: true })
  const stale = srtTranslatorReducer(state, { type: 'progress', event: { jobId: 'job-old', phase: 'translating', message: 'old', percent: 90 } })
  assert.equal(stale, state)
  const first = srtTranslatorReducer(state, { type: 'progress', event: { jobId: 'job-new', phase: 'translating', message: 'new', percent: 80 } })
  const lower = srtTranslatorReducer(first, { type: 'progress', event: { jobId: 'job-new', phase: 'translating', message: 'new', percent: 70 } })
  assert.equal(lower.progress?.percent, 80)
})

test('first analyze progress adopts the Main-created job id so cancel works immediately', () => {
  const running = srtTranslatorReducer(createInitialSrtTranslatorState(), { type: 'analyze-started' })
  const withJob = srtTranslatorReducer(running, { type: 'progress', event: { jobId: 'job-main', phase: 'validating', message: 'Đang kiểm tra', percent: 2 } })
  assert.equal(withJob.jobId, 'job-main')
  assert.equal(withJob.progress?.phase, 'validating')
  assert.equal(visibleStep(withJob), 'restoration')
})

test('a retired job cannot be adopted after a replacement analyze starts', () => {
  const old = analyzedStateFixture({ jobId: 'job-old', running: true })
  const next = srtTranslatorReducer(old, { type: 'analyze-started' })
  const stale = srtTranslatorReducer(next, { type: 'progress', event: { jobId: 'job-old', phase: 'translating', message: 'cũ', percent: 90 } })
  assert.equal(stale, next)
  const fresh = srtTranslatorReducer(next, { type: 'progress', event: { jobId: 'job-new', phase: 'validating', message: 'mới', percent: 2 } })
  assert.equal(fresh.jobId, 'job-new')
})

test('source replacement exposes the old job for release and resets derived state', () => {
  const before = analyzedStateFixture({ jobId: 'job-old', videoPath: 'old.mp4', targets: [viTargetInputFixture], targetViews: [{ ...viTargetInputFixture, status: 'done', unverified: false }] })
  assert.equal(jobIdToReleaseBeforeReplacement(before), 'job-old')
  const after = srtTranslatorReducer(before, { type: 'source-loaded', result: { ok: true, sourcePath: 'new.srt', sourceText: 'new', count: 1, lastCueEndSeconds: 2, fingerprint: { path: 'new.srt', size: 10, modifiedMs: 20 } } })
  assert.equal(after.sourcePath, 'new.srt')
  assert.equal(after.jobId, '')
  assert.equal(after.videoPath, '')
  assert.deepEqual(after.targetViews, [])
  assert.equal(after.geminiReady, true)
})

test('analyze failure stops running and keeps a cleaned message', () => {
  const running = srtTranslatorReducer(analyzedStateFixture({ jobId: '' }), { type: 'analyze-started' })
  const failed = srtTranslatorReducer(running, { type: 'analyze-failed', error: 'Không thể kiểm chứng video.', errorCode: 'video-invalid' })
  assert.equal(failed.running, false)
  assert.equal(failed.error, 'Không thể kiểm chứng video.')
  assert.equal(failed.analyzeErrorCode, 'video-invalid')
  assert.equal(visibleStep(failed), 'source')
})

test('analyze with no review cue advances directly to target selection', () => {
  const next = srtTranslatorReducer(createInitialSrtTranslatorState(), { type: 'analyze-succeeded', result: { ok: true, jobId: 'job-1', sourcePath: 'clip.srt', videoPath: 'clip.mp4', sourceText: 'source', cueCount: 2, videoDurationSeconds: 5, topicVi: 'Chủ đề', changedCount: 0, reviewCues: [], unresolvedCueNumbers: [], unverified: false } })
  assert.equal(visibleStep(next), 'translation')
})

test('cancelled translation keeps successful and failed target rows', () => {
  const running = srtTranslatorReducer(analyzedStateFixture({ running: true, targets: [viTargetInputFixture, jaTargetInputFixture] }), { type: 'translation-started' })
  const result = { ...successfulTranslationFixture, cleanupWarning: 'Không thể xác nhận xóa video tạm trên Gemini; file sẽ tự hết hạn.', ok: false, cancelled: true, translations: [successfulTranslationFixture.translations[0]!, { target: jaTargetInputFixture, ok: false, unverified: false, rateStatus: 'source-preserved' as const, error: 'Target bị hủy.' }] }
  const state = srtTranslatorReducer(running, { type: 'translation-finished', result })
  assert.equal(state.running, false)
  assert.equal(state.jobId, '')
  assert.deepEqual(state.targetViews.map((view) => view.status), ['done', 'error'])
  assert.equal(state.targetViews[0]?.srt, successfulTranslationFixture.translations[0]?.srt)
  assert.equal(state.cleanupWarning, result.cleanupWarning)
})

test('text-only and rate-unavailable flags remain visible per target', () => {
  const result = { ...successfulTranslationFixture, translations: [{ ...successfulTranslationFixture.translations[0]!, unverified: true, rateStatus: 'unavailable' as const }] }
  const state = srtTranslatorReducer(analyzedStateFixture({ unverified: true }), { type: 'translation-finished', result })
  assert.equal(state.unverified, true)
  assert.equal(state.targetViews[0]?.unverified, true)
  assert.equal(state.targetViews[0]?.rateStatus, 'unavailable')
  assert.equal(state.cleanupWarning, '')
  assert.equal(state.rateSourceUpdatedAt, successfulTranslationFixture.rateSnapshot?.sourceUpdatedAt)
  assert.equal(state.rateAttributionUrl, 'https://www.exchangerate-api.com')
})

test('progress is clamped and terminal translation clears the job while retaining exports', () => {
  assert.equal(progressPercent({ jobId: 'job', phase: 'translating', message: '', percent: 150 }), 100)
  assert.equal(progressPercent({ jobId: 'job', phase: 'translating', message: '', percent: -1 }), 0)
  const started = srtTranslatorReducer(analyzedStateFixture(), { type: 'translation-started' })
  const finished = srtTranslatorReducer(started, { type: 'translation-finished', result: successfulTranslationFixture })
  assert.equal(finished.jobId, '')
  assert.equal(visibleStep(finished), 'export')
})
