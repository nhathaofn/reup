import type {
  CanonicalSource,
  ExchangeRateSnapshot,
  LocaleProfile,
  LocalizedTarget,
  SrtAnalyzeErrorCode,
  SrtAnalyzeRequest,
  SrtAnalyzeResult,
  SrtCancelRequest,
  SrtCancelResult,
  SrtLocalizationPhase,
  SrtLocalizationProgress,
  SrtLocalizationTranslateRequest,
  SrtLocalizationTranslateResult,
  SrtReleaseRequest,
  SrtReleaseResult,
  ReviewSelection,
  SrtResolveRequest,
  SrtResolveResult,
  SrtReviewCue,
  SrtLocaleTargetInput,
  SourceFingerprint,
  SrtSourceCue
} from '../../shared/features/srt-translator.ts'
import type { GeminiMultimodalTransport, GeminiRemoteFile } from './gemini-files.ts'
import type { LoadedSrtSource, ValidatedLocalizationSource } from './srt-source-validation.ts'
import { applyReviewSelections, auditRestoration } from './srt-source-audit.ts'
import { restoreSource } from './srt-source-restoration.ts'
import { resolveLocalizedTarget } from './srt-locale-profiles.ts'
import { runLocalizedTargetBatch } from './srt-localization.ts'
import type { SrtTranslatorLog, SrtTranslatorLogEvent } from './srt-translator-logging.ts'

export const CLEANUP_WARNING = 'Không thể xác nhận xóa video tạm trên Gemini; file sẽ tự hết hạn.'
export const SRT_LOG_HEARTBEAT_INTERVAL_MS = 30_000
export const SRT_LOG_SLOW_PHASE_THRESHOLD_MS = 3 * 60 * 1_000

export interface SrtTranslatorJobTraceOptions {
  /** Mainly useful for deterministic tests; production keeps the 30s default. */
  heartbeatIntervalMs?: number
  slowPhaseThresholdMs?: number
  now?: () => number
}

export interface SrtTranslatorJobDeps {
  loadKey(): Promise<string>
  loadSrtSource(path: string): Promise<LoadedSrtSource>
  /** Optional legacy verified-media path. The default workflow never calls it. */
  validateVideoSource?(path: string, source: LoadedSrtSource, signal?: AbortSignal): Promise<ValidatedLocalizationSource>
  assertSourceFingerprint(fingerprint: SourceFingerprint): Promise<void>
  createTransport(apiKey: string): GeminiMultimodalTransport
  restoreSource: typeof restoreSource
  auditRestoration: typeof auditRestoration
  applyReviewSelections: typeof applyReviewSelections
  resolveLocalizedTarget: typeof resolveLocalizedTarget
  getRateSnapshot(signal?: AbortSignal): Promise<ExchangeRateSnapshot | null>
  runLocalizedTargetBatch: typeof runLocalizedTargetBatch
  makeJobId(): string
  log: SrtTranslatorLog
}

export interface SrtTranslatorJobController {
  analyze(request: SrtAnalyzeRequest, emit: (event: SrtLocalizationProgress) => void): Promise<SrtAnalyzeResult>
  resolve(request: SrtResolveRequest): Promise<SrtResolveResult>
  translate(request: SrtLocalizationTranslateRequest, emit: (event: SrtLocalizationProgress) => void): Promise<SrtLocalizationTranslateResult>
  cancel(request: SrtCancelRequest): Promise<SrtCancelResult>
  release(request: SrtReleaseRequest): Promise<SrtReleaseResult>
  dispose(): Promise<void>
}

interface ActiveLocalizationJob {
  id: string
  source?: LoadedSrtSource
  validatedSource?: ValidatedLocalizationSource
  transport?: GeminiMultimodalTransport
  remoteFile?: GeminiRemoteFile
  canonical?: CanonicalSource
  abortController: AbortController
  unverified: boolean
  cancelled: boolean
  translations: SrtLocalizationTranslateResult['translations']
  log: SrtTranslatorLog
  phase?: SrtLocalizationPhase
  phaseStartedAt?: number
  phasePercent?: number
  activeOperation?: string
  heartbeatTimer?: ReturnType<typeof setTimeout>
  heartbeatIntervalMs: number
  slowPhaseThresholdMs: number
  now: () => number
  cleanupWarning?: string
  cleanupPromise?: Promise<string | undefined>
}

const TERMINAL_PHASES = new Set<SrtLocalizationPhase>(['review-required', 'completed', 'cancelled', 'error'])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} không hợp lệ.`)
  return value.trim()
}

function isAbort(reason: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (reason instanceof Error && reason.name === 'AbortError')
}

function safeMessage(reason: unknown, stage: 'source' | 'video' | 'key' | 'upload' | 'processing' | 'restoration' | 'translation' | 'unknown'): string {
  const text = reason instanceof Error ? reason.message : ''
  const reasonName = isObject(reason) && typeof reason.name === 'string' ? reason.name : ''
  if (reasonName === 'TimeoutError' || text.startsWith('Gemini phản hồi quá thời gian chờ.')) return 'Gemini phản hồi quá thời gian chờ. Hãy thử lại.'
  if (text.includes('File nguồn đã thay đổi')) return 'File nguồn đã thay đổi. Hãy kiểm tra và phục hồi lại.'
  if (text.startsWith('SRT không hợp lệ')) return text.split('(')[0].trim()
  if (stage === 'source') return 'Không thể đọc hoặc kiểm tra file SRT nguồn.'
  if (stage === 'video') return 'Không thể kiểm tra file video.'
  if (stage === 'key') return 'Chưa có API key Gemini.'
  if (stage === 'upload') return 'Không thể tải video lên Gemini.'
  if (stage === 'processing') return 'Gemini xử lý video thất bại.'
  if (stage === 'restoration') return 'Không thể phục hồi phụ đề tiếng Trung.'
  if (stage === 'translation') return 'Không thể dịch phụ đề cho target này.'
  return 'Tác vụ dịch SRT thất bại.'
}

function errorCodeForStage(stage: Parameters<typeof safeMessage>[1]): SrtAnalyzeErrorCode {
  if (stage === 'source') return 'source-invalid'
  if (stage === 'video') return 'video-invalid'
  if (stage === 'key') return 'key-missing'
  if (stage === 'upload') return 'upload-failed'
  if (stage === 'processing') return 'processing-failed'
  if (stage === 'restoration') return 'restoration-failed'
  return 'unknown'
}

function stopHeartbeat(job: ActiveLocalizationJob): void {
  if (!job.heartbeatTimer) return
  clearTimeout(job.heartbeatTimer)
  job.heartbeatTimer = undefined
}

function logJob(job: ActiveLocalizationJob, event: SrtTranslatorLogEvent): void {
  if (event.kind === 'operation-start' || event.kind === 'operation-progress') {
    job.activeOperation = event.operation
  } else if (event.kind === 'operation-complete' || event.kind === 'operation-error') {
    if (!event.operation || job.activeOperation === event.operation) job.activeOperation = undefined
  }
  try {
    job.log({ ...event, jobId: job.id })
  } catch {
    // Diagnostic logging must never break or change the actual translation job.
  }
}

function scheduleHeartbeat(job: ActiveLocalizationJob): void {
  stopHeartbeat(job)
  if (!job.phase || TERMINAL_PHASES.has(job.phase)) return
  const phase = job.phase
  const phaseStartedAt = job.phaseStartedAt ?? job.now()
  const tick = (): void => {
    if (job.phase !== phase || job.phaseStartedAt !== phaseStartedAt || TERMINAL_PHASES.has(phase)) return
    const elapsedMs = Math.max(0, job.now() - phaseStartedAt)
    const slow = elapsedMs >= job.slowPhaseThresholdMs
    logJob(job, {
      phase,
      kind: 'heartbeat',
      level: slow ? 'warn' : 'info',
      operation: job.activeOperation ?? 'phase-wait',
      message: slow
        ? `Phase đang chạy hơn ${Math.floor(elapsedMs / 60_000)} phút${job.activeOperation ? `; đang chờ ${job.activeOperation}` : ''}.`
        : `Phase vẫn đang chạy${job.activeOperation ? `; đang chờ ${job.activeOperation}` : ''}.`,
      elapsedMs,
      ...(job.phasePercent === undefined ? {} : { percent: job.phasePercent })
    })
    job.heartbeatTimer = setTimeout(tick, job.heartbeatIntervalMs)
  }
  job.heartbeatTimer = setTimeout(tick, job.heartbeatIntervalMs)
}

function emitPhase(
  job: ActiveLocalizationJob,
  emit: (event: SrtLocalizationProgress) => void,
  phase: SrtLocalizationPhase,
  message: string,
  percent: number
): void {
  const normalizedPercent = Math.min(100, Math.max(0, percent))
  const phaseChanged = job.phase !== phase
  if (phaseChanged) {
    stopHeartbeat(job)
    job.phase = phase
    job.phaseStartedAt = job.now()
    job.phasePercent = normalizedPercent
    job.activeOperation = undefined
    logJob(job, {
      phase,
      kind: 'phase-start',
      message,
      ...(phase === 'uploading-video' || phase === 'processing-video' ? { hasMedia: true } : {})
    })
    scheduleHeartbeat(job)
  } else {
    job.phasePercent = normalizedPercent
  }
  emit({ jobId: job.id, phase, message, percent: normalizedPercent })
}

function reviewCues(canonical: CanonicalSource, source: LoadedSrtSource): SrtReviewCue[] {
  const sourceByNumber = new Map(source.cues.map((cue) => [cue.n, cue]))
  return canonical.cues.map((cue) => {
    const sourceCue = sourceByNumber.get(cue.n)
    return { ...cue, startSeconds: sourceCue?.startSeconds ?? 0, endSeconds: sourceCue?.endSeconds ?? 0 }
  })
}

function hasConvertibleMoney(canonical: CanonicalSource): boolean {
  return canonical.moneyMentions.some((mention) => mention.confidence === 'high' && mention.shouldConvert)
}

function rateSnapshotMetadata(snapshot: ExchangeRateSnapshot | null): SrtLocalizationTranslateResult['rateSnapshot'] {
  return snapshot
    ? { sourceUpdatedAt: snapshot.sourceUpdatedAt, attributionUrl: snapshot.attributionUrl }
    : undefined
}

function requestString(request: unknown, key: string): string {
  if (!isObject(request) || typeof request[key] !== 'string') return ''
  return request[key] as string
}

function verifyRequestShape(request: unknown): SrtAnalyzeRequest {
  if (!isObject(request)) throw new Error('Yêu cầu phân tích không hợp lệ.')
  const sourcePath = requireNonEmpty(request.sourcePath, 'Đường dẫn SRT')
  // SRT-only is the product default. Keep an explicit `video` mode as a
  // backwards-compatible escape hatch for older callers, but never infer it
  // from the presence of a video path.
  const verificationMode = request.verificationMode === undefined
    ? 'text-only-confirmed'
    : request.verificationMode
  if (verificationMode !== 'video' && verificationMode !== 'text-only-confirmed') throw new Error('Chế độ kiểm tra không hợp lệ.')
  const videoPath = verificationMode === 'video' ? requireNonEmpty(request.videoPath, 'Đường dẫn video') : requestString(request, 'videoPath').trim()
  return { sourcePath, ...(videoPath ? { videoPath } : {}), verificationMode }
}

function verifyJobRequest(request: unknown): string {
  if (!isObject(request)) throw new Error('Yêu cầu job không hợp lệ.')
  return requireNonEmpty(request.jobId, 'Job ID')
}

function verifyReviewSelections(value: unknown): ReviewSelection[] {
  if (!Array.isArray(value)) throw new Error('Danh sách lựa chọn không hợp lệ.')
  return value.map((item) => {
    if (!isObject(item) || !Number.isSafeInteger(item.cueNumber) || (item.cueNumber as number) <= 0 || typeof item.candidateId !== 'string' || !item.candidateId.trim()) {
      throw new Error('Danh sách lựa chọn không hợp lệ.')
    }
    return { cueNumber: item.cueNumber as number, candidateId: (item.candidateId as string).trim() }
  })
}

function verifyTargetInputs(value: unknown): SrtLocaleTargetInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error('Target locale không hợp lệ.')
  if (value.some((item) => !isObject(item))) throw new Error('Target locale không hợp lệ.')
  return value as SrtLocaleTargetInput[]
}

function targetKey(target: LocalizedTarget): string {
  return `${target.profile.locale.toLowerCase()}|${target.profile.regionLabel.trim().toLowerCase()}|${target.profile.currencyCode.toUpperCase()}`
}

export function createSrtTranslatorJobController(deps: SrtTranslatorJobDeps, traceOptions: SrtTranslatorJobTraceOptions = {}): SrtTranslatorJobController {
  let activeJob: ActiveLocalizationJob | null = null
  const heartbeatIntervalMs = Number.isFinite(traceOptions.heartbeatIntervalMs) && (traceOptions.heartbeatIntervalMs ?? 0) > 0
    ? traceOptions.heartbeatIntervalMs as number
    : SRT_LOG_HEARTBEAT_INTERVAL_MS
  const slowPhaseThresholdMs = Number.isFinite(traceOptions.slowPhaseThresholdMs) && (traceOptions.slowPhaseThresholdMs ?? 0) > 0
    ? traceOptions.slowPhaseThresholdMs as number
    : SRT_LOG_SLOW_PHASE_THRESHOLD_MS
  const now = traceOptions.now ?? Date.now

  const cleanup = async (job: ActiveLocalizationJob): Promise<string | undefined> => {
    if (job.cleanupPromise) return job.cleanupPromise
    job.cleanupPromise = (async () => {
      stopHeartbeat(job)
      job.abortController.abort()
      const cleanupStartedAt = job.now()
      logJob(job, {
        phase: job.phase ?? 'cleaning-up',
        kind: 'operation-start',
        operation: 'cleanup',
        message: 'Bắt đầu dọn tài nguyên của job.'
      })
      if (job.remoteFile) {
        try {
          if (!job.transport?.deleteFile) throw new Error('cleanup_transport_missing')
          await job.transport.deleteFile(job.remoteFile.name)
        } catch {
          job.cleanupWarning = CLEANUP_WARNING
          logJob(job, {
            phase: 'cleaning-up',
            kind: 'operation-error',
            level: 'warn',
            operation: 'cleanup-remote-file',
            message: 'Không xác nhận được việc xóa file tạm trên Gemini.',
            durationMs: Math.max(0, job.now() - cleanupStartedAt)
          })
        }
        job.remoteFile = undefined
      }
      if (activeJob?.id === job.id) activeJob = null
      logJob(job, {
        phase: 'cleaning-up',
        kind: 'operation-complete',
        operation: 'cleanup',
        message: 'Đã dọn xong tài nguyên của job.',
        durationMs: Math.max(0, job.now() - cleanupStartedAt)
      })
      return job.cleanupWarning
    })()
    return job.cleanupPromise
  }

  const getOwnedJob = (request: unknown): ActiveLocalizationJob => {
    const id = verifyJobRequest(request)
    if (!activeJob || activeJob.id !== id) throw new Error('Job không còn hoạt động.')
    return activeJob
  }

  const analyze = async (request: SrtAnalyzeRequest, emit: (event: SrtLocalizationProgress) => void): Promise<SrtAnalyzeResult> => {
    let job: ActiveLocalizationJob | null = null
    let normalizedRequest: SrtAnalyzeRequest | null = null
    try {
      normalizedRequest = verifyRequestShape(request)
      if (activeJob) await cleanup(activeJob)
      job = {
        id: deps.makeJobId(), abortController: new AbortController(), unverified: normalizedRequest.verificationMode === 'text-only-confirmed',
        cancelled: false, translations: [], log: deps.log, heartbeatIntervalMs, slowPhaseThresholdMs, now
      }
      activeJob = job
      emitPhase(job, emit, 'validating', 'Đang kiểm tra file nguồn…', 0)

      let loaded: LoadedSrtSource
      const loadStartedAt = job.now()
      logJob(job, { phase: 'validating', kind: 'operation-start', operation: 'load-srt', message: 'Bắt đầu đọc và kiểm tra SRT.' })
      try {
        loaded = await deps.loadSrtSource(normalizedRequest.sourcePath)
        job.source = loaded
        logJob(job, {
          phase: 'validating',
          kind: 'operation-complete',
          operation: 'load-srt',
          message: 'Đã đọc và kiểm tra SRT.',
          cueCount: loaded.cues.length,
          durationMs: Math.max(0, job.now() - loadStartedAt)
        })
      } catch (reason) {
        logJob(job, {
          phase: 'validating',
          kind: 'operation-error',
          level: 'error',
          operation: 'load-srt',
          message: 'Đọc hoặc kiểm tra SRT thất bại.',
          durationMs: Math.max(0, job.now() - loadStartedAt)
        })
        throw Object.assign(new Error(safeMessage(reason, 'source')), { stage: 'source' })
      }
      let source: LoadedSrtSource | ValidatedLocalizationSource = loaded
      if (!job.unverified) {
        const validationStartedAt = job.now()
        logJob(job, { phase: 'validating', kind: 'operation-start', operation: 'validate-video-legacy', message: 'Bắt đầu kiểm tra media legacy.', hasMedia: true })
        try {
          emitPhase(job, emit, 'validating', 'Đang kiểm tra thời lượng video…', 5)
          if (!deps.validateVideoSource) throw new Error('legacy_video_validator_missing')
          const validated = await deps.validateVideoSource(normalizedRequest.videoPath ?? '', loaded, job.abortController.signal)
          source = validated
          job.validatedSource = validated
          logJob(job, {
            phase: 'validating',
            kind: 'operation-complete',
            operation: 'validate-video-legacy',
            message: 'Đã kiểm tra media legacy.',
            cueCount: validated.cues.length,
            durationMs: Math.max(0, job.now() - validationStartedAt),
            hasMedia: true
          })
        } catch (reason) {
          if (isAbort(reason, job.abortController.signal)) throw reason
          logJob(job, {
            phase: 'validating',
            kind: 'operation-error',
            level: 'error',
            operation: 'validate-video-legacy',
            message: 'Kiểm tra media legacy thất bại.',
            durationMs: Math.max(0, job.now() - validationStartedAt),
            hasMedia: true
          })
          throw Object.assign(new Error(safeMessage(reason, 'video')), { stage: 'video' })
        }
      }

      let key: string
      const keyStartedAt = job.now()
      logJob(job, { phase: 'validating', kind: 'operation-start', operation: 'load-gemini-key', message: 'Bắt đầu nạp cấu hình Gemini.' })
      try {
        key = (await deps.loadKey()).trim()
        if (!key) throw new Error('empty-key')
        logJob(job, { phase: 'validating', kind: 'operation-complete', operation: 'load-gemini-key', message: 'Đã nạp cấu hình Gemini.', durationMs: Math.max(0, job.now() - keyStartedAt) })
      } catch (reason) {
        logJob(job, { phase: 'validating', kind: 'operation-error', level: 'error', operation: 'load-gemini-key', message: 'Không nạp được cấu hình Gemini.', durationMs: Math.max(0, job.now() - keyStartedAt) })
        throw Object.assign(new Error(safeMessage(reason, 'key')), { stage: 'key' })
      }
      job.transport = deps.createTransport(key)

      if (!job.unverified) {
        const validated = source as ValidatedLocalizationSource
        emitPhase(job, emit, 'uploading-video', 'Đang tải video lên Gemini…', 5)
        const uploadStartedAt = job.now()
        logJob(job, { phase: 'uploading-video', kind: 'operation-start', operation: 'upload-video-legacy', message: 'Bắt đầu tải media legacy lên Gemini.', cueCount: source.cues.length, hasMedia: true })
        try {
          if (!job.transport.uploadVideo) throw new Error('legacy_media_transport_missing')
          job.remoteFile = await job.transport.uploadVideo({ path: validated.videoPath, mimeType: validated.videoMimeType, displayName: validated.videoPath.split(/[\\/]/).pop() ?? 'video', signal: job.abortController.signal })
          logJob(job, { phase: 'uploading-video', kind: 'operation-complete', operation: 'upload-video-legacy', message: 'Đã tải media legacy lên Gemini.', cueCount: source.cues.length, durationMs: Math.max(0, job.now() - uploadStartedAt), hasMedia: true })
        } catch (reason) {
          if (isAbort(reason, job.abortController.signal)) throw reason
          logJob(job, { phase: 'uploading-video', kind: 'operation-error', level: 'error', operation: 'upload-video-legacy', message: 'Tải media legacy lên Gemini thất bại.', durationMs: Math.max(0, job.now() - uploadStartedAt), hasMedia: true })
          throw Object.assign(new Error(safeMessage(reason, 'upload')), { stage: 'upload' })
        }
        emitPhase(job, emit, 'processing-video', 'Gemini đang xử lý video…', 20)
        const processingStartedAt = job.now()
        logJob(job, { phase: 'processing-video', kind: 'operation-start', operation: 'process-video-legacy', message: 'Đang chờ Gemini xử lý media legacy.', hasMedia: true })
        try {
          if (!job.transport.waitUntilActive) throw new Error('legacy_media_transport_missing')
          job.remoteFile = await job.transport.waitUntilActive(job.remoteFile, job.abortController.signal)
          logJob(job, { phase: 'processing-video', kind: 'operation-complete', operation: 'process-video-legacy', message: 'Gemini đã xử lý xong media legacy.', durationMs: Math.max(0, job.now() - processingStartedAt), hasMedia: true })
        } catch (reason) {
          if (isAbort(reason, job.abortController.signal)) throw reason
          logJob(job, { phase: 'processing-video', kind: 'operation-error', level: 'error', operation: 'process-video-legacy', message: 'Gemini xử lý media legacy thất bại.', durationMs: Math.max(0, job.now() - processingStartedAt), hasMedia: true })
          throw Object.assign(new Error(safeMessage(reason, 'processing')), { stage: 'processing' })
        }
      }

      emitPhase(job, emit, 'restoring-source', job.unverified ? 'Đang đọc toàn bộ SRT và phục hồi tiếng Trung…' : 'Đang phục hồi tiếng Trung…', job.unverified ? 10 : 25)
      let draft
      try {
        draft = await deps.restoreSource({
          source,
          transport: job.transport,
          jobId: job.id,
          ...(job.unverified ? {} : { file: job.remoteFile }),
          signal: job.abortController.signal,
          onLog: (event) => logJob(job!, event),
          onProgress: (done, total) => {
            logJob(job!, {
              phase: 'restoring-source',
              kind: 'operation-progress',
              operation: 'restore-progress',
              message: `Đã xử lý ${done}/${total} cửa sổ phục hồi.`,
              done,
              total,
              cueCount: source.cues.length,
              percent: total ? (done / total) * 100 : 100,
              hasMedia: Boolean(job!.remoteFile)
            })
            emitPhase(job!, emit, 'restoring-source', `Đang phục hồi cửa sổ ${done}/${total}…`, (job!.unverified ? 10 : 25) + (total ? (done / total) * 40 : 40))
          }
        })
      } catch (reason) {
        if (isAbort(reason, job.abortController.signal)) throw reason
        throw Object.assign(new Error(safeMessage(reason, 'restoration')), { stage: 'restoration' })
      }
      emitPhase(job, emit, 'auditing-source', 'Đang audit bản phục hồi theo ngữ cảnh SRT…', job.unverified ? 55 : 65)
      let canonical: CanonicalSource
      try {
        canonical = await deps.auditRestoration({
          jobId: job.id,
          source,
          draft,
          transport: job.transport,
          ...(job.unverified ? {} : { file: job.remoteFile }),
          signal: job.abortController.signal,
          onLog: (event) => logJob(job!, event),
          onProgress: (done, total) => {
            logJob(job!, {
              phase: 'auditing-source',
              kind: 'operation-progress',
              operation: 'audit-progress',
              message: `Đã xử lý ${done}/${total} batch audit.`,
              done,
              total,
              cueCount: source.cues.length,
              percent: total ? (done / total) * 100 : 100,
              hasMedia: Boolean(job!.remoteFile)
            })
            emitPhase(job!, emit, 'auditing-source', `Đang audit batch ${done}/${total}…`, (job!.unverified ? 55 : 65) + (total ? (done / total) * 15 : 15))
          }
        })
      } catch (reason) {
        if (isAbort(reason, job.abortController.signal)) throw reason
        throw Object.assign(new Error(safeMessage(reason, 'restoration')), { stage: 'restoration' })
      }
      job.canonical = canonical
      const unresolved = canonical.unresolvedCueNumbers
      emitPhase(job, emit, unresolved.length ? 'review-required' : 'auditing-source', unresolved.length ? 'Cần bạn duyệt các cue chưa chắc…' : 'Đã kiểm tra xong nguồn.', 70)
      if (!unresolved.length) emitPhase(job, emit, 'completed', 'Đã kiểm tra và phục hồi xong nguồn.', 100)
      return {
        ok: true, jobId: job.id, sourcePath: normalizedRequest.sourcePath, ...(normalizedRequest.videoPath ? { videoPath: normalizedRequest.videoPath } : {}), sourceText: source.sourceText,
        cueCount: source.cues.length, ...('videoDurationSeconds' in source ? { videoDurationSeconds: source.videoDurationSeconds } : {}),
        topicVi: canonical.topicVi, changedCount: canonical.cues.filter((cue) => cue.changed).length,
        reviewCues: reviewCues(canonical, source), unresolvedCueNumbers: unresolved, unverified: job.unverified
      }
    } catch (reason) {
      const sourcePath = normalizedRequest?.sourcePath ?? requestString(request, 'sourcePath').trim()
      const videoPath = normalizedRequest?.videoPath ?? requestString(request, 'videoPath').trim()
      if (!job) {
        return { ok: false, sourcePath, ...(videoPath ? { videoPath } : {}), errorCode: 'unknown', error: safeMessage(reason, 'unknown') }
      }
      if (isAbort(reason, job.abortController.signal)) {
        job.cancelled = true
        logJob(job, { phase: job.phase ?? 'cleaning-up', kind: 'summary', level: 'warn', operation: 'analyze-job', message: 'Job phân tích bị hủy.' })
        emitPhase(job, emit, 'cleaning-up', job.unverified ? 'Đang dọn phiên SRT…' : 'Đang dọn video tạm…', 96)
        const warning = await cleanup(job)
        emitPhase(job, emit, 'cancelled', 'Tác vụ đã được hủy.', 100)
        return { ok: false, sourcePath, ...(videoPath ? { videoPath } : {}), ...(warning ? { cleanupWarning: warning } : {}), errorCode: 'cancelled', error: 'Tác vụ đã được hủy.' }
      }
      const stage = isObject(reason) && typeof reason.stage === 'string' ? reason.stage as Parameters<typeof safeMessage>[1] : 'unknown'
      logJob(job, { phase: job.phase ?? 'error', kind: 'operation-error', level: 'error', operation: 'analyze-job', message: safeMessage(reason, stage) })
      emitPhase(job, emit, 'cleaning-up', job.unverified ? 'Đang dọn phiên SRT…' : 'Đang dọn video tạm…', 96)
      const warning = await cleanup(job)
      emitPhase(job, emit, 'error', safeMessage(reason, stage), 100)
      return { ok: false, sourcePath, ...(videoPath ? { videoPath } : {}), ...(warning ? { cleanupWarning: warning } : {}), errorCode: errorCodeForStage(stage), error: safeMessage(reason, stage) }
    }
  }

  const resolve = async (request: SrtResolveRequest): Promise<SrtResolveResult> => {
    let job: ActiveLocalizationJob | null = null
    let fingerprintFailed = false
    const resolveStartedAt = Date.now()
    try {
      job = getOwnedJob(request)
      logJob(job, { phase: job.phase ?? 'review-required', kind: 'operation-start', operation: 'resolve-review', message: 'Bắt đầu áp dụng lựa chọn review.' })
      if (!job.canonical || !job.source) throw new Error('Nguồn chưa được phân tích.')
      const selections = verifyReviewSelections((request as unknown as Record<string, unknown>).selections)
      try {
        await deps.assertSourceFingerprint(job.source.fingerprint)
        if (job.validatedSource) await deps.assertSourceFingerprint(job.validatedSource.videoFingerprint)
      } catch (reason) {
        fingerprintFailed = true
        throw reason
      }
      job.canonical = deps.applyReviewSelections(job.canonical, selections)
      logJob(job, {
        phase: job.canonical.unresolvedCueNumbers.length ? 'review-required' : 'auditing-source',
        kind: 'operation-complete',
        operation: 'resolve-review',
        message: job.canonical.unresolvedCueNumbers.length ? 'Review vẫn còn cue chưa được giải quyết.' : 'Đã áp dụng xong lựa chọn review.',
        cueCount: job.source.cues.length,
        outputCount: job.canonical.unresolvedCueNumbers.length,
        durationMs: Math.max(0, job.now() - resolveStartedAt)
      })
      return { ok: true, unresolvedCueNumbers: job.canonical.unresolvedCueNumbers }
    } catch (reason) {
      const unresolvedCueNumbers = job?.canonical?.unresolvedCueNumbers ?? activeJob?.canonical?.unresolvedCueNumbers ?? []
      if (fingerprintFailed && job) await cleanup(job)
      if (job) {
        logJob(job, {
          phase: job.phase ?? 'review-required',
          kind: 'operation-error',
          level: 'error',
          operation: 'resolve-review',
          message: 'Không áp dụng được lựa chọn review.',
          durationMs: Math.max(0, (job?.now() ?? Date.now()) - resolveStartedAt)
        })
      }
      return { ok: false, unresolvedCueNumbers, error: reason instanceof Error ? reason.message : 'Không thể duyệt nguồn.' }
    }
  }

  const translate = async (request: SrtLocalizationTranslateRequest, emit: (event: SrtLocalizationProgress) => void): Promise<SrtLocalizationTranslateResult> => {
    let job: ActiveLocalizationJob | null = null
    let finalResult: SrtLocalizationTranslateResult | null = null
    let cleanupRequired = false
    try {
      job = getOwnedJob(request)
      if (!job.canonical || !job.source || !job.transport) throw new Error('Nguồn chưa sẵn sàng để dịch.')
      const targetInputs = verifyTargetInputs((request as unknown as Record<string, unknown>).targets)
      const resolved: LocalizedTarget[] = []
      const keys = new Set<string>()
      for (const raw of targetInputs) {
        const target = deps.resolveLocalizedTarget(raw)
        const key = targetKey(target)
        if (keys.has(key)) continue
        keys.add(key)
        resolved.push(target)
      }
      try {
        await deps.assertSourceFingerprint(job.source.fingerprint)
        if (job.validatedSource) await deps.assertSourceFingerprint(job.validatedSource.videoFingerprint)
      } catch (reason) {
        cleanupRequired = true
        throw reason
      }
      if (job.canonical.unresolvedCueNumbers.length) throw new Error('còn cue chưa được duyệt.')
      cleanupRequired = true
      emitPhase(job, emit, 'fetching-rates', 'Đang lấy tỷ giá và chuẩn bị đơn vị…', 72)
      const rateStartedAt = job.now()
      const needsRates = hasConvertibleMoney(job.canonical)
      logJob(job, {
        phase: 'fetching-rates',
        kind: 'operation-start',
        operation: 'fetch-rates',
        message: needsRates ? 'Bắt đầu lấy tỷ giá cho các khoản tiền cần đổi.' : 'Không có khoản tiền cần lấy tỷ giá; giữ nguyên dữ liệu nguồn.'
      })
      let rateSnapshot: ExchangeRateSnapshot | null = null
      try {
        rateSnapshot = needsRates ? await deps.getRateSnapshot(job.abortController.signal) : null
      } catch (reason) {
        logJob(job, {
          phase: 'fetching-rates',
          kind: 'operation-error',
          level: 'error',
          operation: 'fetch-rates',
          message: 'Lấy tỷ giá thất bại.',
          durationMs: Math.max(0, job.now() - rateStartedAt)
        })
        throw reason
      }
      logJob(job, {
        phase: 'fetching-rates',
        kind: 'operation-complete',
        operation: 'fetch-rates',
        message: needsRates ? (rateSnapshot ? 'Đã lấy xong tỷ giá.' : 'Không lấy được tỷ giá; target sẽ giữ nguyên tiền nguồn.') : 'Đã chuẩn bị đơn vị và bỏ qua tỷ giá.',
        durationMs: Math.max(0, job.now() - rateStartedAt)
      })
      emitPhase(job, emit, 'translating', 'Đang dịch theo từng target…', 75)
      const result = await deps.runLocalizedTargetBatch({
        jobId: job.id,
        canonical: job.canonical, targets: resolved, transport: job.transport, ...(job.unverified ? {} : { file: job.remoteFile }),
        rateSnapshot, unverified: job.unverified, signal: job.abortController.signal,
        onLog: (event) => logJob(job!, event),
        onProgress: (event) => {
          logJob(job!, {
            phase: 'translating',
            kind: 'operation-progress',
            operation: 'translate-progress',
            message: `Đã xử lý target ${event.targetIndex + 1}/${event.totalTargets}.`,
            targetId: event.targetId,
            targetIndex: event.targetIndex + 1,
            targetCount: event.totalTargets,
            percent: event.percent,
            cueCount: job!.source?.cues.length,
            hasMedia: Boolean(job!.remoteFile)
          })
          emitPhase(job!, emit, 'translating', `Đang dịch ${event.targetId}…`, 75 + event.percent * 0.2)
        }
      })
      job.translations = result.translations
      if (result.cancelled) job.cancelled = true
      logJob(job, {
        phase: 'translating',
        kind: 'summary',
        level: result.ok ? 'info' : 'warn',
        operation: 'translation-summary',
        message: result.ok ? 'Đã hoàn tất ít nhất một target.' : 'Không có target nào hoàn tất.',
        cueCount: job.source.cues.length,
        targetCount: resolved.length,
        outputCount: result.translations.filter((item) => item.ok).length
      })
      finalResult = { ...result, translations: job.translations, rateSnapshot: result.rateSnapshot ?? rateSnapshotMetadata(rateSnapshot) }
      return finalResult
    } catch (reason) {
      if (job && isAbort(reason, job.abortController.signal)) {
        job.cancelled = true
        cleanupRequired = true
        finalResult = { ok: job.translations.some((item) => item.ok), translations: job.translations, cancelled: true, error: 'Tác vụ đã được hủy.' }
        return finalResult
      }
      finalResult = { ok: false, translations: job?.translations ?? [], error: reason instanceof Error ? reason.message : 'Không thể dịch.' }
      if (job) {
        logJob(job, {
          phase: job.phase ?? 'translating',
          kind: 'operation-error',
          level: 'error',
          operation: 'translation-job',
          message: 'Job dịch thất bại.',
          targetCount: job.translations.length
        })
      }
      return finalResult
    } finally {
      if (job && cleanupRequired) {
        emitPhase(job, emit, 'cleaning-up', job.unverified ? 'Đang dọn phiên SRT…' : 'Đang dọn video tạm…', 96)
        const warning = await cleanup(job)
        if (warning) job.cleanupWarning = warning
        if (warning && finalResult) finalResult.cleanupWarning = warning
        if (finalResult?.cancelled) {
          emitPhase(job, emit, 'cancelled', 'Tác vụ đã được hủy.', 100)
        } else if (finalResult?.ok) {
          emitPhase(job, emit, 'completed', 'Đã dịch xong các target.', 100)
        } else {
          emitPhase(job, emit, 'error', finalResult?.error ?? 'Tác vụ dịch SRT thất bại.', 100)
        }
      }
    }
  }

  const cancel = async (request: SrtCancelRequest): Promise<SrtCancelResult> => {
    try {
      const job = getOwnedJob(request)
      job.cancelled = true
      const warning = await cleanup(job)
      return { ok: true, wasRunning: true, cleanupWarning: warning }
    } catch (reason) {
      return { ok: false, wasRunning: false, error: reason instanceof Error ? reason.message : 'Không thể hủy job.' }
    }
  }

  const release = async (request: SrtReleaseRequest): Promise<SrtReleaseResult> => {
    try {
      const job = getOwnedJob(request)
      const warning = await cleanup(job)
      return { ok: true, released: true, cleanupWarning: warning }
    } catch (reason) {
      return { ok: false, released: false, error: reason instanceof Error ? reason.message : 'Không thể giải phóng job.' }
    }
  }

  return { analyze, resolve, translate, cancel, release, dispose: async () => { if (activeJob) await cleanup(activeJob) } }
}
