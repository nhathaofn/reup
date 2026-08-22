import test from 'node:test'
import assert from 'node:assert/strict'

import {
  loadSrtSource,
  parseStrictSrtText,
  validateVideoSource,
  type LoadedSrtSource,
  type ValidatedLocalizationSource
} from '../src/main/services/srt-source-validation.ts'
import { auditRestoration, applyReviewSelections } from '../src/main/services/srt-source-audit.ts'
import { restoreSource } from '../src/main/services/srt-source-restoration.ts'
import { resolveLocalizedTarget } from '../src/main/services/srt-locale-profiles.ts'
import { runLocalizedTargetBatch } from '../src/main/services/srt-localization.ts'
import {
  createSrtTranslatorJobController,
  type SrtTranslatorJobDeps
} from '../src/main/services/srt-translator-job.ts'
import type {
  GeminiGenerateRequest,
  GeminiMultimodalTransport
} from '../src/main/services/gemini-files.ts'
import {
  makeLocalizedOutputFileName,
  type SrtLocalizationProgress,
  type SrtLocaleTargetInput
} from '../src/shared/features/srt-translator.ts'
import {
  createFakeGeminiTransport,
  jaTargetInputFixture,
  loadedSourceFixture,
  rateFixture,
  remoteFileFixture,
  viTargetInputFixture
} from './helpers/srt-localization-fixtures.ts'

const INTEGRATION_SOURCE_TEXT = [
  '1',
  '00:00:01,000 --> 00:00:02,000',
  '[SPEAKER_00] 这种鹅咬人吗',
  '',
  '2',
  '00:00:03,000 --> 00:00:04,000',
  '它值一百元',
  ''
].join('\n')

const RESTORATION_RESPONSE = {
  topicVi: 'Tập tính và giá trị của chim',
  cues: [
    {
      n: 1,
      correctedZh: '[SPEAKER_00] 这种鹅咬人吗',
      meaningVi: 'Con này có cắn người không?',
      changed: true,
      confidence: 'high',
      issue: 'taxonomy',
      evidenceVi: 'Hình ảnh và âm thanh khớp với câu hỏi về loài chim.',
      visualContextVi: 'Một loài chim nước xuất hiện trong video.',
      candidates: [{
        id: 'model-cue-1',
        correctedZh: '[SPEAKER_00] 这种鹅咬人吗',
        meaningVi: 'Con này có cắn người không?',
        evidenceVi: 'Hình ảnh và âm thanh khớp.'
      }],
      needsReview: false
    },
    {
      n: 2,
      correctedZh: '它值一百元',
      meaningVi: 'Nó có giá một trăm nhân dân tệ.',
      changed: true,
      confidence: 'low',
      issue: 'number-or-currency',
      evidenceVi: 'Âm thanh cho thấy một khoản giá bằng nhân dân tệ.',
      candidates: [
        {
          id: 'model-cue-2-a',
          correctedZh: '它值一百元',
          meaningVi: 'Nó có giá một trăm nhân dân tệ.',
          evidenceVi: 'Khớp với cách đọc trong audio.'
        },
        {
          id: 'model-cue-2-b',
          correctedZh: '它值一百块',
          meaningVi: 'Nó có giá một trăm tệ.',
          evidenceVi: 'Có thể là cách nói khẩu ngữ.'
        }
      ],
      needsReview: true
    }
  ],
  entities: [],
  moneyMentions: [{
    id: 'model-money',
    cueNumber: 2,
    sourceAmount: 100,
    sourceCurrencyCode: 'CNY',
    sourceSurface: '一百元',
    confidence: 'high',
    shouldConvert: true
  }],
  measurementMentions: [],
  rawGeminiResponse: 'RAW_GEMINI_RESPONSE_SECRET'
}

const AUDIT_ACCEPT_RESPONSE = {
  cues: [
    {
      n: 1,
      decision: 'accept',
      correctedZh: '[SPEAKER_00] 这种鹅咬人吗',
      meaningVi: 'Con này có cắn người không?',
      confidence: 'high',
      issue: 'taxonomy',
      evidenceVi: 'Audio và hình ảnh khớp.',
      candidates: []
    },
    {
      n: 2,
      decision: 'accept',
      correctedZh: '它值一百元',
      meaningVi: 'Nó có giá một trăm nhân dân tệ.',
      confidence: 'high',
      issue: 'number-or-currency',
      evidenceVi: 'Audio rõ và mặt chữ phù hợp.',
      candidates: []
    }
  ],
  rawGeminiResponse: 'RAW_GEMINI_RESPONSE_SECRET'
}

const AUDIT_REVIEW_RESPONSE = {
  cues: [
    AUDIT_ACCEPT_RESPONSE.cues[0],
    {
      n: 2,
      decision: 'review',
      correctedZh: '它值一百元',
      meaningVi: 'Nó có giá một trăm nhân dân tệ.',
      confidence: 'low',
      issue: 'number-or-currency',
      evidenceVi: 'Cần người dùng xác nhận cách khôi phục số tiền.',
      candidates: [{
        correctedZh: '它值一百元',
        meaningVi: 'Nó có giá một trăm nhân dân tệ.',
        evidenceVi: 'Giữ cách đọc có chữ 元.'
      }]
    }
  ]
}

const VIETNAMESE_ROWS = [
  { n: 1, t: '[SPEAKER_00] Con này có cắn người không?', rawGeminiResponse: 'RAW_GEMINI_RESPONSE_SECRET' },
  { n: 2, t: 'Nó có giá [[MONEY_money:2:0]].' }
]

const JAPANESE_ROWS = [
  { n: 1, t: '[SPEAKER_00] この子、人を噛むの？' },
  { n: 2, t: '値段は[[MONEY_money:2:0]]。', rawGeminiResponse: 'RAW_GEMINI_RESPONSE_SECRET' }
]

const INVALID_ROWS = [{ n: 1, t: '[SPEAKER_00] Chưa đủ cue' }]

type GenerateHook = (
  request: GeminiGenerateRequest,
  callIndex: number
) => unknown | Promise<unknown> | undefined

interface IntegrationHarnessConfig {
  responses: readonly unknown[]
  sourceText?: string
  videoDurationSeconds?: number
  apiKey?: string
  uploadError?: Error
  processingError?: Error
  deleteError?: Error
  fingerprintError?: Error
  rateAvailable?: boolean
  onGenerate?: GenerateHook
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) {
      reject(new Error('missing abort signal'))
      return
    }
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('cancelled', 'AbortError'))
      return
    }
    signal.addEventListener('abort', () => {
      reject(signal.reason ?? new DOMException('cancelled', 'AbortError'))
    }, { once: true })
  })
}

function assertSameSrtStructure(srt: string, source: LoadedSrtSource): void {
  const generated = parseStrictSrtText(srt, 'generated-target.srt')
  assert.equal(generated.length, source.cues.length)
  for (let index = 0; index < source.cues.length; index += 1) {
    assert.equal(generated[index]?.n, source.cues[index]?.n)
    assert.equal(generated[index]?.time, source.cues[index]?.time)
    assert.equal(generated[index]?.speakerLabel, source.cues[index]?.speakerLabel)
  }
}

function createIntegrationHarness(config: IntegrationHarnessConfig) {
  const sourceText = config.sourceText ?? INTEGRATION_SOURCE_TEXT
  const generatedRequests: GeminiGenerateRequest[] = []
  const logs: Array<{ phase: SrtLocalizationProgress['phase']; cueCount?: number; targetCount?: number }> = []
  const progress: SrtLocalizationProgress[] = []
  let uploadCount = 0
  let deleteCount = 0
  let generatedCount = 0
  let rateFetchCount = 0
  let validationCount = 0
  let fingerprintCount = 0
  let transportApiKey = ''

  const baseTransport = createFakeGeminiTransport(config.responses)
  const transport: GeminiMultimodalTransport = {
    uploadVideo: async (input) => {
      uploadCount += 1
      if (config.uploadError) throw config.uploadError
      return { ...remoteFileFixture, mimeType: input.mimeType }
    },
    waitUntilActive: async (file) => {
      if (config.processingError) throw config.processingError
      return { ...file, state: 'ACTIVE' }
    },
    generateJson: async <T>(request) => {
      const callIndex = generatedCount
      generatedCount += 1
      generatedRequests.push(request)
      const custom = await config.onGenerate?.(request, callIndex)
      if (custom !== undefined) return custom as T
      return baseTransport.generateJson<T>(request)
    },
    deleteFile: async () => {
      deleteCount += 1
      if (config.deleteError) throw config.deleteError
    }
  }

  const controller = createSrtTranslatorJobController({
    loadKey: async () => config.apiKey ?? 'test-key',
    loadSrtSource: (path) => loadSrtSource(path, {
      readText: async () => sourceText,
      statFile: async () => ({ size: Buffer.byteLength(sourceText), modifiedMs: 10, path })
    }),
    validateVideoSource: async (path, source, signal) => {
      validationCount += 1
      return validateVideoSource(path, source, {
        statFile: async (videoPath) => ({ size: 1_000, modifiedMs: 20, path: videoPath }),
        probeDuration: async () => {
          if (signal?.aborted) throw signal.reason
          return config.videoDurationSeconds ?? 5
        }
      }, signal)
    },
    assertSourceFingerprint: async () => {
      fingerprintCount += 1
      if (config.fingerprintError) throw config.fingerprintError
    },
    createTransport: (apiKey) => {
      transportApiKey = apiKey
      return transport
    },
    restoreSource,
    auditRestoration,
    applyReviewSelections,
    resolveLocalizedTarget,
    getRateSnapshot: async () => {
      rateFetchCount += 1
      return config.rateAvailable === false ? null : rateFixture
    },
    runLocalizedTargetBatch,
    makeJobId: () => 'job-integration',
    log: (event) => logs.push(event)
  } satisfies SrtTranslatorJobDeps)

  return {
    controller,
    transport,
    generatedRequests,
    logs,
    progress,
    get uploadCount() { return uploadCount },
    get deleteCount() { return deleteCount },
    get generatedCount() { return generatedCount },
    get rateFetchCount() { return rateFetchCount },
    get validationCount() { return validationCount },
    get fingerprintCount() { return fingerprintCount },
    get transportApiKey() { return transportApiKey }
  }
}

async function analyzeVideo(
  harness: ReturnType<typeof createIntegrationHarness>,
  progress: SrtLocalizationProgress[] = harness.progress
) {
  return harness.controller.analyze({
    sourcePath: 'clip.srt',
    videoPath: 'clip.mp4',
    verificationMode: 'video'
  }, (event) => progress.push(event))
}

async function analyzeTextOnly(
  harness: ReturnType<typeof createIntegrationHarness>,
  progress: SrtLocalizationProgress[] = harness.progress
) {
  return harness.controller.analyze({
    sourcePath: 'clip.srt',
    videoPath: '',
    verificationMode: 'text-only-confirmed'
  }, (event) => progress.push(event))
}

test('full fake video flow uploads once, audits review, resolves, localizes and cleans up', async () => {
  const events: SrtLocalizationProgress[] = []
  const harness = createIntegrationHarness({
    responses: [RESTORATION_RESPONSE, AUDIT_REVIEW_RESPONSE, VIETNAMESE_ROWS, JAPANESE_ROWS]
  })

  const analyzed = await analyzeVideo(harness, events)
  assert.equal(analyzed.ok, true)
  assert.deepEqual(analyzed.unresolvedCueNumbers, [2])
  assert.equal(analyzed.unverified, false)
  assert.ok(events.some((event) => event.phase === 'restoring-source'))
  assert.ok(events.some((event) => event.phase === 'auditing-source'))
  assert.ok(events.some((event) => event.phase === 'review-required'))

  const resolved = await harness.controller.resolve({
    jobId: analyzed.jobId as string,
    selections: [{ cueNumber: 2, candidateId: '2:0' }]
  })
  assert.deepEqual(resolved, { ok: true, unresolvedCueNumbers: [] })

  const translated = await harness.controller.translate({
    jobId: analyzed.jobId as string,
    targets: [viTargetInputFixture, jaTargetInputFixture]
  }, (event) => events.push(event))

  assert.equal(translated.ok, true)
  assert.equal(translated.translations.length, 2)
  assert.equal(translated.translations.every((item) => item.ok && item.unverified === false), true)
  assert.equal(translated.translations.every((item) => item.rateStatus === 'converted'), true)
  assert.ok(translated.rateSnapshot)
  for (const item of translated.translations) {
    assertSameSrtStructure(item.srt ?? '', loadedSourceFixture)
    assert.match(item.srt ?? '', /00:00:01,000 --> 00:00:02,000/u)
    assert.match(item.srt ?? '', /\[SPEAKER_00\]/u)
    assert.match(item.srt ?? '', /(?:VND|JPY)/u)
  }
  assert.equal(harness.uploadCount, 1)
  assert.equal(harness.deleteCount, 1)
  assert.equal(harness.rateFetchCount, 1)
  assert.equal(harness.validationCount, 1)
  assert.equal(harness.generatedRequests.filter((request) => request.file?.uri === remoteFileFixture.uri).length, 4)
  assert.equal(events.at(-1)?.phase, 'completed')
})

test('text-only confirmation skips video upload, omits file data and marks output unverified', async () => {
  const harness = createIntegrationHarness({
    responses: [RESTORATION_RESPONSE, AUDIT_ACCEPT_RESPONSE, VIETNAMESE_ROWS]
  })
  const analyzed = await analyzeTextOnly(harness)
  assert.equal(analyzed.ok, true)
  assert.equal(analyzed.unverified, true)
  assert.equal(harness.validationCount, 0)

  const translated = await harness.controller.translate({
    jobId: analyzed.jobId as string,
    targets: [viTargetInputFixture]
  }, () => {})
  assert.equal(translated.ok, true)
  assert.equal(translated.translations[0]?.unverified, true)
  assert.equal(harness.uploadCount, 0)
  assert.equal(harness.deleteCount, 0)
  assert.equal(harness.generatedRequests.every((request) => request.file === undefined), true)
  assert.equal(makeLocalizedOutputFileName('clip.srt', viTargetInputFixture, true), 'clip.vi-vn_unverified.srt')
})

test('partial target failure preserves a successful target and performs one cleanup', async () => {
  const harness = createIntegrationHarness({
    responses: [RESTORATION_RESPONSE, AUDIT_ACCEPT_RESPONSE, VIETNAMESE_ROWS, INVALID_ROWS, INVALID_ROWS]
  })
  const analyzed = await analyzeVideo(harness)
  const translated = await harness.controller.translate({
    jobId: analyzed.jobId as string,
    targets: [viTargetInputFixture, jaTargetInputFixture]
  }, () => {})

  assert.equal(translated.ok, true)
  assert.deepEqual(translated.translations.map((item) => item.ok), [true, false])
  assert.equal(translated.translations[1]?.error, 'Đầu ra bản dịch không hợp lệ.')
  assert.equal(harness.uploadCount, 1)
  assert.equal(harness.deleteCount, 1)
})

test('cancelling a target keeps completed partial output and cleans the remote file once', async () => {
  const secondTargetStarted = deferred<void>()
  const harness = createIntegrationHarness({
    responses: [RESTORATION_RESPONSE, AUDIT_ACCEPT_RESPONSE, VIETNAMESE_ROWS],
    onGenerate: async (request, callIndex) => {
      if (callIndex === 3) {
        secondTargetStarted.resolve()
        return waitForAbort(request.signal)
      }
      return undefined
    }
  })
  const analyzed = await analyzeVideo(harness)
  const translationPromise = harness.controller.translate({
    jobId: analyzed.jobId as string,
    targets: [viTargetInputFixture, jaTargetInputFixture]
  }, () => {})
  await secondTargetStarted.promise

  const [cancelled, translated] = await Promise.all([
    harness.controller.cancel({ jobId: analyzed.jobId as string }),
    translationPromise
  ])
  assert.equal(cancelled.ok, true)
  assert.equal(cancelled.wasRunning, true)
  assert.equal(translated.cancelled, true)
  assert.equal(translated.ok, true)
  assert.deepEqual(translated.translations.map((item) => item.ok), [true])
  assert.equal(harness.deleteCount, 1)
})

test('fingerprint change blocks translation before rates/model and still cleans the uploaded file', async () => {
  const harness = createIntegrationHarness({
    responses: [RESTORATION_RESPONSE, AUDIT_ACCEPT_RESPONSE],
    fingerprintError: new Error('File nguồn đã thay đổi. Hãy kiểm tra và phục hồi lại.')
  })
  const analyzed = await analyzeVideo(harness)
  const translated = await harness.controller.translate({
    jobId: analyzed.jobId as string,
    targets: [viTargetInputFixture]
  }, () => {})

  assert.equal(translated.ok, false)
  assert.match(translated.error ?? '', /File nguồn đã thay đổi/u)
  assert.equal(harness.rateFetchCount, 0)
  assert.equal(harness.generatedCount, 2)
  assert.equal(harness.deleteCount, 1)
})

test('cleanup warning is safe and does not erase successful translations', async () => {
  const rawDeleteFailure = `${remoteFileFixture.uri} RAW_GEMINI_RESPONSE_SECRET SECRET_API_KEY`
  const harness = createIntegrationHarness({
    responses: [RESTORATION_RESPONSE, AUDIT_ACCEPT_RESPONSE, VIETNAMESE_ROWS],
    deleteError: new Error(rawDeleteFailure),
    apiKey: 'SECRET_API_KEY'
  })
  const analyzed = await analyzeVideo(harness)
  const translated = await harness.controller.translate({
    jobId: analyzed.jobId as string,
    targets: [viTargetInputFixture]
  }, () => {})

  assert.equal(translated.translations[0]?.ok, true)
  assert.equal(translated.cleanupWarning, 'Không thể xác nhận xóa video tạm trên Gemini; file sẽ tự hết hạn.')
  assert.equal(JSON.stringify(translated).includes(remoteFileFixture.uri), false)
  assert.equal(JSON.stringify(translated).includes('RAW_GEMINI_RESPONSE_SECRET'), false)
  assert.equal(harness.deleteCount, 1)
})

test('public results stay safe while the diagnostic trace keeps Gemini payloads', async () => {
  const apiKey = 'SECRET_API_KEY'
  const rawResponse = 'RAW_GEMINI_RESPONSE_SECRET'
  const progress: SrtLocalizationProgress[] = []
  const harness = createIntegrationHarness({
    responses: [RESTORATION_RESPONSE, AUDIT_ACCEPT_RESPONSE, VIETNAMESE_ROWS],
    apiKey
  })
  const analyzed = await analyzeVideo(harness, progress)
  const translated = await harness.controller.translate({
    jobId: analyzed.jobId as string,
    targets: [viTargetInputFixture]
  }, (event) => progress.push(event))

  const publicSurface = JSON.stringify({ analyzed, translated, progress })
  for (const secret of [apiKey, remoteFileFixture.uri, rawResponse]) {
    assert.equal(publicSurface.includes(secret), false, `leaked public value: ${secret}`)
  }
  const traceSurface = JSON.stringify(harness.logs)
  assert.equal(traceSurface.includes(rawResponse), true)
  assert.equal(traceSurface.includes(apiKey), false)
  assert.equal(traceSurface.includes(remoteFileFixture.uri), false)
  assert.equal(harness.transportApiKey, apiKey)

  const failedHarness = createIntegrationHarness({
    responses: [],
    apiKey,
    uploadError: new Error(`${apiKey} ${remoteFileFixture.uri} ${rawResponse}`)
  })
  const failed = await analyzeVideo(failedHarness)
  const safeFailure = JSON.stringify(failed)
  assert.equal(failed.ok, false)
  assert.equal(safeFailure.includes(apiKey), false)
  assert.equal(safeFailure.includes(remoteFileFixture.uri), false)
  assert.equal(safeFailure.includes(rawResponse), false)
})

test('the full fake graph uses real source validation and preserves exact SRT structure', async () => {
  const loaded = await loadSrtSource('clip.srt', {
    readText: async () => INTEGRATION_SOURCE_TEXT,
    statFile: async (path) => ({ size: Buffer.byteLength(INTEGRATION_SOURCE_TEXT), modifiedMs: 10, path })
  })
  const validated: ValidatedLocalizationSource = await validateVideoSource('clip.mp4', loaded, {
    statFile: async (path) => ({ size: 1_000, modifiedMs: 20, path }),
    probeDuration: async () => 5
  })
  assert.deepEqual(validated.cues.map((cue) => cue.time), [
    '00:00:01,000 --> 00:00:02,000',
    '00:00:03,000 --> 00:00:04,000'
  ])
  assert.equal(validated.videoDurationSeconds, 5)
  assert.equal(loaded.sourceText, INTEGRATION_SOURCE_TEXT)
})

// Keep the target type referenced in this file so malformed target fixtures cannot
// silently drift away from the public IPC contract during future edits.
const _targetContractCheck: SrtLocaleTargetInput = viTargetInputFixture
void _targetContractCheck
