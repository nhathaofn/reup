import test from 'node:test'
import assert from 'node:assert/strict'
import { createSrtTranslatorJobController, type SrtTranslatorJobDeps } from '../src/main/services/srt-translator-job.ts'
import type { SrtTranslatorLogEvent } from '../src/main/services/srt-translator-logging.ts'
import { resolveLocalizedTarget } from '../src/main/services/srt-locale-profiles.ts'
import { applyReviewSelections } from '../src/main/services/srt-source-audit.ts'
import { createFakeGeminiTransport, jaTargetInputFixture, loadedSourceFixture, rateFixture, remoteFileFixture, resolvedCanonicalFixture, restorationDraftFixture, successfulTranslationFixture, unresolvedCanonicalFixture, validatedSourceFixture, viTargetInputFixture } from './helpers/srt-localization-fixtures.ts'

function makeDeps(overrides: Partial<SrtTranslatorJobDeps> = {}): SrtTranslatorJobDeps {
  return {
    loadKey: async () => 'test-key', loadSrtSource: async () => loadedSourceFixture,
    validateVideoSource: async () => validatedSourceFixture, assertSourceFingerprint: async () => {},
    createTransport: () => createFakeGeminiTransport([]), restoreSource: async () => restorationDraftFixture,
    auditRestoration: async () => resolvedCanonicalFixture, applyReviewSelections: (canonical) => canonical,
    resolveLocalizedTarget, getRateSnapshot: async () => rateFixture,
    runLocalizedTargetBatch: async () => successfulTranslationFixture, makeJobId: () => 'job-1', log: () => {}, ...overrides
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function waitForAbort<T>(signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.reject(new Error('missing abort signal'))
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('cancelled', 'AbortError')), { once: true })
  })
}

test('video is uploaded once, reused, then deleted after translation', async () => {
  const calls: string[] = []
  const transport = {
    ...createFakeGeminiTransport([]),
    uploadVideo: async () => { calls.push('upload'); return remoteFileFixture },
    waitUntilActive: async () => remoteFileFixture,
    deleteFile: async (name: string) => { calls.push(`delete:${name}`) }
  }
  const controller = createSrtTranslatorJobController(makeDeps({
    createTransport: () => transport,
    restoreSource: async ({ file }) => { calls.push(`restore:${file?.name}`); return restorationDraftFixture },
    auditRestoration: async ({ file }) => { calls.push(`audit:${file?.name}`); return resolvedCanonicalFixture },
    runLocalizedTargetBatch: async ({ file }) => { calls.push(`translate:${file?.name}`); return successfulTranslationFixture }
  }))
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  const translated = await controller.translate({ jobId: analyzed.jobId as string, targets: [viTargetInputFixture] }, () => {})
  assert.equal(analyzed.ok, true); assert.equal(translated.ok, true)
  assert.deepEqual(calls, ['upload', 'restore:files/abc', 'audit:files/abc', 'translate:files/abc', 'delete:files/abc'])
})

test('changed source fingerprint blocks translation before rates/model', async () => {
  let rateCalls = 0; let modelCalls = 0
  const controller = createSrtTranslatorJobController(makeDeps({ assertSourceFingerprint: async () => { throw new Error('File nguồn đã thay đổi. Hãy kiểm tra và phục hồi lại.') }, getRateSnapshot: async () => { rateCalls += 1; return rateFixture }, runLocalizedTargetBatch: async () => { modelCalls += 1; return successfulTranslationFixture } }))
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  const result = await controller.translate({ jobId: analyzed.jobId!, targets: [viTargetInputFixture] }, () => {})
  assert.equal(result.ok, false); assert.match(result.error ?? '', /File nguồn đã thay đổi/); assert.deepEqual([rateCalls, modelCalls], [0, 0])
})

test('unresolved source blocks translate and locale dedupe fetches one rate snapshot', async () => {
  const blocked = createSrtTranslatorJobController(makeDeps({ auditRestoration: async () => unresolvedCanonicalFixture }))
  const analyzedBlocked = await blocked.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  const noTranslate = await blocked.translate({ jobId: analyzedBlocked.jobId!, targets: [viTargetInputFixture] }, () => {})
  assert.equal(noTranslate.ok, false); assert.match(noTranslate.error ?? '', /chưa được duyệt/)

  let calls = 0; let targetCount = 0
  const controller = createSrtTranslatorJobController(makeDeps({ getRateSnapshot: async () => { calls += 1; return rateFixture }, runLocalizedTargetBatch: async ({ targets }) => { targetCount = targets.length; return successfulTranslationFixture } }))
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  await controller.translate({ jobId: analyzed.jobId!, targets: [viTargetInputFixture, { ...viTargetInputFixture, id: 'renderer-duplicate' }, jaTargetInputFixture] }, () => {})
  assert.equal(calls, 1); assert.equal(targetCount, 2)
})

test('text-only-confirmed never uploads and marks output unverified', async () => {
  let uploads = 0; const files: unknown[] = []
  const controller = createSrtTranslatorJobController(makeDeps({
    createTransport: () => ({ ...createFakeGeminiTransport([]), uploadVideo: async () => { uploads += 1; return remoteFileFixture } }),
    restoreSource: async ({ file }) => { files.push(file); return restorationDraftFixture },
    auditRestoration: async ({ file }) => { files.push(file); return resolvedCanonicalFixture },
    runLocalizedTargetBatch: async ({ file, unverified }) => { files.push(file); return { ...successfulTranslationFixture, translations: successfulTranslationFixture.translations.map((item) => ({ ...item, unverified: Boolean(unverified) })) } }
  }))
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: '', verificationMode: 'text-only-confirmed' }, () => {})
  const result = await controller.translate({ jobId: analyzed.jobId!, targets: [viTargetInputFixture] }, () => {})
  assert.equal(uploads, 0); assert.deepEqual(files, [undefined, undefined, undefined]); assert.equal(result.translations[0]?.unverified, true)
})

test('SRT-only analyze is the default and never validates or uploads media', async () => {
  let validations = 0
  let uploads = 0
  const files: unknown[] = []
  const controller = createSrtTranslatorJobController(makeDeps({
    validateVideoSource: async () => { validations += 1; return validatedSourceFixture },
    createTransport: () => ({
      ...createFakeGeminiTransport([]),
      uploadVideo: async () => { uploads += 1; return remoteFileFixture }
    }),
    restoreSource: async ({ file }) => { files.push(file); return restorationDraftFixture },
    auditRestoration: async ({ file }) => { files.push(file); return resolvedCanonicalFixture }
  }))
  const result = await controller.analyze({ sourcePath: 'clip.srt' }, () => {})
  assert.equal(result.ok, true)
  assert.equal(result.unverified, true)
  assert.equal(result.videoPath, undefined)
  assert.deepEqual([validations, uploads, files], [0, 0, [undefined, undefined]])
})

test('SRT trace records operations and warns when a phase exceeds the slow threshold', async () => {
  const logs: SrtTranslatorLogEvent[] = []
  const waiting = deferred<typeof loadedSourceFixture>()
  const controller = createSrtTranslatorJobController(makeDeps({
    log: (event) => logs.push(event),
    loadSrtSource: async () => waiting.promise
  }), { heartbeatIntervalMs: 2, slowPhaseThresholdMs: 5 })
  const analyzing = controller.analyze({ sourcePath: 'clip.srt' }, () => {})
  await new Promise((resolve) => setTimeout(resolve, 25))
  waiting.resolve(loadedSourceFixture)
  const result = await analyzing
  assert.equal(result.ok, true)
  assert.ok(logs.some((event) => event.kind === 'phase-start' && event.phase === 'validating'))
  assert.ok(logs.some((event) => event.operation === 'load-srt' && event.kind === 'operation-start'))
  assert.ok(logs.some((event) => event.kind === 'heartbeat' && event.level === 'warn' && (event.elapsedMs ?? 0) >= 5))
  assert.equal(JSON.stringify(logs).includes('test-key'), false)
})

test('delete failure returns one safe cleanup warning', async () => {
  const transport = { ...createFakeGeminiTransport([]), uploadVideo: async () => remoteFileFixture, waitUntilActive: async () => remoteFileFixture, deleteFile: async () => { throw new Error('files/abc SECRET_DELETE_DETAIL') } }
  const controller = createSrtTranslatorJobController(makeDeps({ createTransport: () => transport }))
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  const released = await controller.release({ jobId: analyzed.jobId! })
  assert.equal(released.cleanupWarning, 'Không thể xác nhận xóa video tạm trên Gemini; file sẽ tự hết hạn.')
  assert.equal(JSON.stringify(released).includes('files/abc'), false)
  assert.equal(JSON.stringify(released).includes('SECRET_DELETE_DETAIL'), false)
})

test('translation preconditions preserve the active job for review and retry', async () => {
  let deletes = 0
  const transport = {
    ...createFakeGeminiTransport([]),
    uploadVideo: async () => remoteFileFixture,
    waitUntilActive: async () => remoteFileFixture,
    deleteFile: async () => { deletes += 1 }
  }
  const controller = createSrtTranslatorJobController(makeDeps({
    createTransport: () => transport,
    auditRestoration: async () => unresolvedCanonicalFixture,
    applyReviewSelections
  }))
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  const blocked = await controller.translate({ jobId: analyzed.jobId!, targets: [viTargetInputFixture] }, () => {})
  assert.equal(blocked.ok, false)
  assert.match(blocked.error ?? '', /chưa được duyệt/)

  const resolved = await controller.resolve({ jobId: analyzed.jobId!, selections: [{ cueNumber: 2, candidateId: '2:0' }] })
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.unresolvedCueNumbers, [])
  const released = await controller.release({ jobId: analyzed.jobId! })
  assert.equal(released.released, true)
  assert.equal(deletes, 1)
})

test('malformed requests are rejected before fingerprint access and keep the job', async () => {
  let fingerprintCalls = 0
  const controller = createSrtTranslatorJobController(makeDeps({
    auditRestoration: async () => unresolvedCanonicalFixture,
    assertSourceFingerprint: async () => { fingerprintCalls += 1 }
  }))
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})

  const invalidResolve = await controller.resolve({
    jobId: analyzed.jobId!,
    selections: [{ cueNumber: '2', candidateId: '' } as unknown as { cueNumber: number; candidateId: string }]
  })
  assert.equal(invalidResolve.ok, false)
  assert.match(invalidResolve.error ?? '', /lựa chọn không hợp lệ/)

  const invalidTranslate = await controller.translate({
    jobId: analyzed.jobId!,
    targets: [null] as any
  }, () => {})
  assert.equal(invalidTranslate.ok, false)
  assert.match(invalidTranslate.error ?? '', /Target locale không hợp lệ/)
  assert.equal(fingerprintCalls, 0)

  const released = await controller.release({ jobId: analyzed.jobId! })
  assert.equal(released.released, true)
})

test('invalid analyze request does not release the existing job', async () => {
  const controller = createSrtTranslatorJobController(makeDeps())
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  const invalid = await controller.analyze({ sourcePath: '', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  assert.equal(invalid.ok, false)
  const released = await controller.release({ jobId: analyzed.jobId! })
  assert.equal(released.released, true)
})

test('cancelling validation returns cancelled and emits a terminal phase', async () => {
  const started = deferred<void>()
  const events: string[] = []
  const controller = createSrtTranslatorJobController(makeDeps({
    validateVideoSource: async (_path, _source, signal) => {
      started.resolve()
      return waitForAbort<typeof validatedSourceFixture>(signal)
    }
  }))
  const operation = controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, (event) => events.push(event.phase))
  await started.promise
  const cancelled = await controller.cancel({ jobId: 'job-1' })
  const result = await operation
  assert.equal(cancelled.wasRunning, true)
  assert.equal(result.errorCode, 'cancelled')
  assert.equal(events.at(-1), 'cancelled')
})

test('concurrent analyze operations keep cancellation owned by the old job', async () => {
  const firstStarted = deferred<void>()
  let validations = 0
  let sequence = 0
  const controller = createSrtTranslatorJobController(makeDeps({
    makeJobId: () => `job-${++sequence}`,
    validateVideoSource: async (_path, _source, signal) => {
      validations += 1
      if (validations === 1) {
        firstStarted.resolve()
        return waitForAbort<typeof validatedSourceFixture>(signal)
      }
      return validatedSourceFixture
    }
  }))
  const first = controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  await firstStarted.promise
  const second = controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.errorCode, 'cancelled')
  assert.equal(secondResult.ok, true)
  const released = await controller.release({ jobId: 'job-2' })
  assert.equal(released.released, true)
})

test('processing failures use processing-failed and clean the uploaded file', async () => {
  let deletes = 0
  const controller = createSrtTranslatorJobController(makeDeps({
    createTransport: () => ({
      ...createFakeGeminiTransport([]),
      uploadVideo: async () => remoteFileFixture,
      waitUntilActive: async () => { throw new Error('Gemini xử lý video thất bại.') },
      deleteFile: async () => { deletes += 1 }
    })
  }))
  const result = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  assert.equal(result.errorCode, 'processing-failed')
  assert.equal(deletes, 1)
})

test('restoration timeout is reported as an error instead of cancellation', async () => {
  const controller = createSrtTranslatorJobController(makeDeps({
    restoreSource: async () => { throw new DOMException('request timeout', 'TimeoutError') }
  }))
  const result = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, () => {})
  assert.equal(result.errorCode, 'restoration-failed')
  assert.equal(result.error, 'Gemini phản hồi quá thời gian chờ. Hãy thử lại.')
})

test('successful translation emits completed and returns rate snapshot metadata', async () => {
  const analyzeEvents: string[] = []
  const translateEvents: string[] = []
  const controller = createSrtTranslatorJobController(makeDeps({
    runLocalizedTargetBatch: async () => ({ ...successfulTranslationFixture, rateSnapshot: undefined })
  }))
  const analyzed = await controller.analyze({ sourcePath: 'clip.srt', videoPath: 'clip.mp4', verificationMode: 'video' }, (event) => analyzeEvents.push(event.phase))
  assert.equal(analyzeEvents.at(-1), 'completed')
  const translated = await controller.translate({ jobId: analyzed.jobId!, targets: [viTargetInputFixture] }, (event) => translateEvents.push(event.phase))
  assert.deepEqual(translated.rateSnapshot, { sourceUpdatedAt: rateFixture.sourceUpdatedAt, attributionUrl: rateFixture.attributionUrl })
  assert.equal(translateEvents.at(-1), 'completed')
})
