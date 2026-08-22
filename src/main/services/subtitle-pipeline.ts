import { randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import type {
  SubtitleFusionSummary,
  SubtitlePipelineAsrOptions,
  SubtitlePipelineOutputPaths,
  SubtitlePipelineProgress,
  SubtitlePipelineRequest,
  SubtitlePipelineResult,
  SubtitlePipelineSource
} from '../../shared/features/subtitle-pipeline'
import {
  adaptLegacyTarget,
  validateLocaleTargetInput,
  type CanonicalSource,
  type SrtLocaleTargetInput,
  type SrtTargetLanguage
} from '../../shared/features/srt-translator'
import type { WhisperRequest } from '../../shared/types'
import { loadKey } from '../gemini'
import { LOCKED_GEMINI_MODEL } from '../gemini-model'
import { logError, logInfo, logWarn } from '../logger'
import { cancelOcr, ocrVideo } from '../ocr'
import { transcribeAudio } from '../whisper'
import { auditRestoration } from './srt-source-audit'
import {
  buildEvidenceSource,
  restoreSource,
  type RestorationDraft
} from './srt-source-restoration'
import { createGeminiFilesTransport } from './gemini-files'
import { createExchangeRateProvider } from './exchange-rates'
import { resolveLocalizedTarget } from './srt-locale-profiles'
import { loadSrtSource } from './srt-source-validation'
import { generateLocalizedTitle, runLocalizedTargetBatch } from './srt-localization'
import { ttsNormalizeSrt } from './srt-tts-normalization'
import {
  formatSubtitlePipelineLogLine,
  type SrtTranslatorLogEvent
} from './srt-translator-logging'
import {
  buildFusedSrt,
  fuseSubtitleEvidence,
  type SubtitleEvidenceTrackInput
} from './subtitle-pipeline-fusion'
import { buildCanonicalSrt } from './subtitle-pipeline-output'
import { materializeLocalizedTitleOutput, materializeSrtBatchOutput } from './srt-batch-output'
import {
  alignCanonicalToOcrStructure,
  alignRestorationDraftToOcrStructure
} from './subtitle-pipeline-structure'

interface SubtitlePipelineServiceOptions {
  jobId?: string
  signal?: AbortSignal
  emit?: (progress: SubtitlePipelineProgress) => void
  now?: () => number
}

interface NormalizedPipelineRequest {
  videoPath: string
  outputDir: string
  sourceSrtPath?: string
  runAsr: boolean
  runOcr: boolean
  ocrMode: 'auto' | 'full'
  ocrRegion?: NonNullable<SubtitlePipelineRequest['ocrRegion']>
  asr: SubtitlePipelineAsrOptions
  aiEnabled: boolean
  targetLanguage: string
  targetLocales: SrtLocaleTargetInput[]
  keepIntermediates: boolean
  keepDiagnosticFiles: boolean
  aiMode: 'fusion-restore' | 'restore-only'
}

interface AiPipelineDetails {
  draft?: RestorationDraft
  canonical?: CanonicalSource
  unresolvedCueNumbers: number[]
  error?: string
}

const SUPPORTED_TARGETS = new Set(['vi', 'en', 'zh', 'ja', 'ko', 'id', 'th'])
const HEARTBEAT_MS = 30_000
const SLOW_PHASE_MS = 3 * 60_000

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} không hợp lệ.`)
  return value.trim()
}

function normalizeRegion(value: SubtitlePipelineRequest['ocrRegion']): NonNullable<SubtitlePipelineRequest['ocrRegion']> | undefined {
  if (!value) return undefined
  const numbers = [value.x0, value.x1, value.y0, value.y1]
  if (numbers.some((item) => !Number.isFinite(item) || item < 0)) throw new Error('Vùng OCR không hợp lệ.')
  const region = {
    x0: Math.round(value.x0), x1: Math.round(value.x1),
    y0: Math.round(value.y0), y1: Math.round(value.y1)
  }
  if (region.x0 >= region.x1 || region.y0 >= region.y1) throw new Error('Vùng OCR không hợp lệ.')
  return region
}

export function normalizeSubtitlePipelineRequest(request: SubtitlePipelineRequest): NormalizedPipelineRequest {
  if (!request || typeof request !== 'object') throw new Error('Yêu cầu pipeline không hợp lệ.')
  const videoPath = nonEmpty(request.videoPath, 'Video')
  const outputDir = nonEmpty(request.outputDir, 'Thư mục xuất')
  const sourceSrtPath = typeof request.sourceSrtPath === 'string' && request.sourceSrtPath.trim()
    ? request.sourceSrtPath.trim()
    : undefined
  if (sourceSrtPath && extname(sourceSrtPath).toLowerCase() !== '.srt') {
    throw new Error('Nguồn tham chiếu phải là file SRT.')
  }
  const runAsr = request.runAsr !== false
  const runOcr = request.runOcr !== false
  const ocrMode = request.ocrMode === 'full' ? 'full' : 'auto'
  if (!runAsr && !runOcr && !sourceSrtPath) throw new Error('Cần bật ASR, OCR hoặc chọn một SRT tham chiếu.')
  const asr = request.asr ?? {}
  const model = typeof asr.model === 'string' && asr.model.trim() ? asr.model.trim() : 'small'
  const language = typeof asr.language === 'string' && asr.language.trim() ? asr.language.trim() : 'auto'
  const device = asr.device === 'cuda' ? 'cuda' : 'cpu'
  const quality = asr.quality === 'balanced' ? 'balanced' : 'accurate'
  const speakers = Number.isSafeInteger(asr.speakers) && (asr.speakers ?? 0) >= 0
    ? Math.min(20, asr.speakers as number)
    : 0
  const rawTarget = typeof request.ai?.targetLanguage === 'string'
    ? request.ai.targetLanguage.trim().toLowerCase()
    : 'none'
  const targetLanguage = rawTarget === 'none' || !rawTarget ? 'none' : rawTarget
  if (targetLanguage !== 'none' && !SUPPORTED_TARGETS.has(targetLanguage)) {
    throw new Error('Ngôn ngữ dịch của pipeline không được hỗ trợ.')
  }
  let targetLocales: SrtLocaleTargetInput[] = []
  if (request.ai?.targetLocales !== undefined) {
    if (!Array.isArray(request.ai.targetLocales) || request.ai.targetLocales.length > 20) {
      throw new Error('Danh sách ngôn ngữ dịch không hợp lệ.')
    }
    const seen = new Set<string>()
    targetLocales = request.ai.targetLocales.map((input) => {
      const checked = validateLocaleTargetInput(input)
      if (!checked.ok) throw new Error(checked.error)
      if (seen.has(checked.value.id)) throw new Error('Danh sách ngôn ngữ dịch bị trùng.')
      seen.add(checked.value.id)
      return checked.value
    })
  } else if (request.ai?.targetLocale) {
    const checked = validateLocaleTargetInput(request.ai.targetLocale)
    if (!checked.ok) throw new Error(checked.error)
    targetLocales = [checked.value]
  } else if (targetLanguage !== 'none') {
    const legacy = adaptLegacyTarget({
      id: targetLanguage,
      label: targetLanguage,
      code: targetLanguage
    } satisfies SrtTargetLanguage)
    if (legacy) {
      targetLocales = [{
        id: legacy.profile.id,
        languageLabel: legacy.profile.languageLabel,
        locale: legacy.profile.locale,
        regionLabel: legacy.profile.regionLabel,
        currencyCode: legacy.profile.currencyCode
      }]
    } else if (targetLanguage === 'zh') {
      targetLocales = [{
        id: 'zh-cn',
        languageLabel: 'Tiếng Trung giản thể',
        locale: 'zh-CN',
        regionLabel: 'Trung Quốc đại lục',
        currencyCode: 'CNY'
      }]
    }
  }
  const ocrRegion = normalizeRegion(request.ocrRegion)
  const keepDiagnosticFiles = request.ai?.keepDiagnosticFiles !== false
  const aiMode = request.ai?.mode === 'restore-only' ? 'restore-only' : 'fusion-restore'
  return {
    videoPath,
    outputDir,
    ...(sourceSrtPath ? { sourceSrtPath } : {}),
    runAsr,
    runOcr,
    ocrMode,
    ...(ocrRegion ? { ocrRegion } : {}),
    asr: {
      model,
      language,
      device,
      quality,
      diarize: Boolean(asr.diarize),
      speakers
    },
    aiEnabled: request.ai?.enabled !== false,
    targetLanguage,
    targetLocales,
    keepIntermediates: request.keepIntermediates !== false,
    keepDiagnosticFiles,
    aiMode
  }
}

function abortError(): Error {
  return Object.assign(new Error('Đã huỷ.'), { name: 'AbortError' })
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function isAbort(reason: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (reason instanceof Error && reason.name === 'AbortError') ||
    (reason instanceof Error && reason.message === 'Đã huỷ.')
}

function safeStem(path: string): string {
  const stem = basename(path).replace(/\.[^.]+$/u, '')
  return stem.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '_').trim() || 'subtitle'
}

function safeLanguageFileLabel(value: string): string {
  const withoutLanguagePrefix = value.replace(/^tiếng\s+/iu, '').trim()
  return withoutLanguagePrefix
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '_')
    .replace(/[^a-zA-Z0-9]+/gu, '_')
    .trim()
    .replace(/^_+|_+$/gu, '')
    .toLowerCase() || 'ngon_ngu'
}

function batchSrtFileName(languageLabel: string): string {
  return `batch_${safeLanguageFileLabel(languageLabel)}.srt`
}

function sourceLanguageLabel(language: string): string {
  const labels: Readonly<Record<string, string>> = {
    zh: 'Tiếng Trung',
    vi: 'Tiếng Việt',
    en: 'Tiếng Anh',
    ja: 'Tiếng Nhật',
    ko: 'Tiếng Hàn',
    id: 'Tiếng Indonesia',
    th: 'Tiếng Thái'
  }
  return labels[language.trim().toLowerCase()] ?? 'Ngôn ngữ gốc'
}

async function nextAvailablePath(directory: string, fileName: string): Promise<string> {
  const extension = extname(fileName)
  const stem = fileName.slice(0, fileName.length - extension.length)
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = join(directory, index === 0 ? fileName : `${stem}-${index + 1}${extension}`)
    try {
      await access(candidate)
    } catch {
      return candidate
    }
  }
  throw new Error('Không tạo được tên file xuất an toàn.')
}

function srtTimestamp(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(safe / 3_600_000)
  const minutes = Math.floor((safe % 3_600_000) / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1_000)
  const millis = safe % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function buildFallbackCanonical(summary: SubtitleFusionSummary, jobId: string): CanonicalSource {
  return {
    jobId,
    topicVi: '',
    cues: summary.cues.map((cue) => ({
      n: cue.n,
      time: `${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}`,
      originalZh: cue.text,
      correctedZh: cue.text,
      meaningVi: '',
      changed: false,
      confidence: cue.confidence,
      issue: 'none',
      evidenceVi: '',
      candidates: [],
      needsReview: false,
      disposition: 'pass',
      finalAction: 'keep'
    })),
    entities: [],
    moneyMentions: [],
    measurementMentions: [],
    unresolvedCueNumbers: []
  }
}

/**
 * The audit model may retain original cue numbers even when hard failures are
 * dropped from final.srt. Translation must use the exact canonical text and
 * the exact numbering of that final document, so remap all cue-linked facts.
 */
function canonicalForTranslation(canonical: CanonicalSource): CanonicalSource {
  const kept = canonical.cues.filter((cue) => cue.finalAction !== 'drop')
  const numberMap = new Map(kept.map((cue, index) => [cue.n, index + 1]))
  return {
    ...canonical,
    cues: kept.map((cue, index) => ({
      ...cue,
      n: index + 1,
      correctedZh: cue.finalAction === 'fallback' ? cue.originalZh : cue.correctedZh
    })),
    moneyMentions: canonical.moneyMentions
      .filter((mention) => numberMap.has(mention.cueNumber))
      .map((mention) => ({ ...mention, cueNumber: numberMap.get(mention.cueNumber)! })),
    measurementMentions: canonical.measurementMentions
      .filter((mention) => numberMap.has(mention.cueNumber))
      .map((mention) => ({ ...mention, cueNumber: numberMap.get(mention.cueNumber)! })),
    unresolvedCueNumbers: []
  }
}

async function moveExistingSmartArtifacts(outputDir: string, draftDir: string, stem: string): Promise<void> {
  const entries = await readdir(outputDir, { withFileTypes: true })
  const prefix = `${stem}.smart.`
  for (const entry of entries) {
    const isPreviousSmartArtifact = entry.name.startsWith(prefix)
    const isPreviousBatchSrt = entry.name.startsWith('batch_') && extname(entry.name).toLowerCase() === '.srt'
    const isPreviousBatchText = entry.name.startsWith('batch_') && extname(entry.name).toLowerCase() === '.txt'
    const isPreviousBatchFolder = entry.name.startsWith('Batchbatch_') && entry.isDirectory()
    const isPreviousTitleFile = entry.name.startsWith('tieude_') && extname(entry.name).toLowerCase() === '.txt'
    const isPreviousBatchArtifact = isPreviousBatchSrt || isPreviousBatchText || isPreviousBatchFolder
    if ((!entry.isFile() && !entry.isDirectory()) || (!isPreviousSmartArtifact && !isPreviousBatchArtifact && !isPreviousTitleFile)) continue
    const extension = extname(entry.name).toLowerCase()
    if (isPreviousSmartArtifact && extension !== '.srt' && extension !== '.json') continue
    const sourcePath = join(outputDir, entry.name)
    const draftPath = await nextAvailablePath(draftDir, entry.name)
    try {
      await rename(sourcePath, draftPath)
    } catch (reason) {
      // A concurrent cleanup can remove a stale artifact between readdir and
      // rename. Any other error should be visible instead of leaving a mixed
      // output root behind.
      if ((reason as NodeJS.ErrnoException)?.code !== 'ENOENT') throw reason
    }
  }
}

function assertSafeWorkDirectory(outputDir: string, workDir: string): void {
  const base = resolve(outputDir)
  const target = resolve(workDir)
  const rel = relative(base, target)
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || resolve(base, rel) !== target) {
    throw new Error('Thư mục tạm của pipeline không an toàn.')
  }
}

function buildWhisperRequest(request: NormalizedPipelineRequest, outputDir: string): WhisperRequest {
  return {
    input: request.videoPath,
    outputDir,
    model: request.asr.model,
    language: request.asr.language,
    task: 'transcribe',
    formats: ['srt'],
    device: request.asr.device,
    diarize: Boolean(request.asr.diarize),
    speakers: request.asr.speakers ?? 0,
    quality: request.asr.quality
  }
}

export { buildCanonicalSrt } from './subtitle-pipeline-output'

function buildNeedsReviewSrt(canonical: CanonicalSource): string {
  const reviewCues = canonical.cues.filter((cue) => cue.needsReview)
  return reviewCues.map((cue) => `${cue.n}\n${cue.time}\n${cue.correctedZh}\n`).join('\n')
}

function buildDraftSrt(draft: RestorationDraft): string {
  return draft.cues.map((cue) => `${cue.n}\n${cue.time}\n${cue.correctedZh}\n`).join('\n')
}

function logGeminiEvent(jobId: string, event: SrtTranslatorLogEvent): void {
  const prefix = `Subtitle pipeline job=${jobId}`
  const line = formatSubtitlePipelineLogLine(jobId, event, LOCKED_GEMINI_MODEL)
  const writer = event.level === 'error' ? logError : event.level === 'warn' ? logWarn : logInfo
  writer(line)
  if (!event.geminiPayload) return
  const content = event.geminiPayload.content || '(empty)'
  const chunkSize = 3_000
  const total = Math.max(1, Math.ceil(content.length / chunkSize))
  for (let index = 0; index < total; index += 1) {
    const chunk = content.slice(index * chunkSize, (index + 1) * chunkSize).replace(/[\r\n]+/gu, '\\n')
    writer(`${prefix} | gemini-${event.geminiPayload.kind} | op=${event.operation ?? 'unknown'} | part=${index + 1}/${total} | chars=${content.length} | ${chunk}`)
  }
}

function evidenceArtifact(summary: SubtitleFusionSummary, ai: AiPipelineDetails): object {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    sourceCounts: summary.sourceCounts,
    conflictCueNumbers: summary.conflictCueNumbers,
    cues: summary.cues,
    ai: {
      applied: Boolean(ai.canonical),
      unresolvedCueNumbers: ai.unresolvedCueNumbers,
      ...(ai.error ? { error: ai.error } : {}),
      ...(ai.canonical ? {
        topicVi: ai.canonical.topicVi,
        cues: ai.canonical.cues.map((cue) => ({
          n: cue.n,
          originalZh: cue.originalZh,
          correctedZh: cue.correctedZh,
          meaningVi: cue.meaningVi,
          confidence: cue.confidence,
          issue: cue.issue,
          evidenceVi: cue.evidenceVi,
          needsReview: cue.needsReview,
          ...(cue.disposition ? { disposition: cue.disposition } : {}),
          ...(cue.finalAction ? { finalAction: cue.finalAction } : {}),
          ...(cue.sourceSupport ? { sourceSupport: cue.sourceSupport } : {}),
          ...(cue.basis ? { basis: cue.basis } : {}),
          ...(cue.changeType ? { changeType: cue.changeType } : {}),
          candidates: cue.candidates
        })),
        droppedCueNumbers: ai.canonical.cues
          .filter((cue) => cue.finalAction === 'drop')
          .map((cue) => cue.n),
        entities: ai.canonical.entities
      } : {})
    }
  }
}

export async function runSubtitlePipeline(
  request: SubtitlePipelineRequest,
  options: SubtitlePipelineServiceOptions = {}
): Promise<SubtitlePipelineResult> {
  const jobId = options.jobId ?? randomUUID()
  const now = options.now ?? Date.now
  const startedAt = now()
  const warnings: string[] = []
  const outputs: SubtitlePipelineOutputPaths = {}
  let summary: SubtitleFusionSummary | null = null
  let currentPhase: SubtitlePipelineProgress['phase'] = 'validating'
  let phaseStartedAt = now()
  let phaseMessage = 'Đang kiểm tra đầu vào…'
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let normalized: NormalizedPipelineRequest | null = null
  let workDir = ''
  let draftDir = ''
  let outputCueCount = 0

  const emit = (
    phase: SubtitlePipelineProgress['phase'],
    percent: number,
    message: string,
    extra: Partial<Omit<SubtitlePipelineProgress, 'jobId' | 'phase' | 'percent' | 'message'>> = {}
  ): void => {
    if (phase !== currentPhase) {
      currentPhase = phase
      phaseStartedAt = now()
    }
    phaseMessage = message
    const progress: SubtitlePipelineProgress = {
      jobId,
      phase,
      percent: Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)),
      message,
      elapsedMs: Math.max(0, now() - startedAt),
      ...extra
    }
    options.emit?.(progress)
  }

  const startHeartbeat = (): void => {
    heartbeat = setInterval(() => {
      const elapsed = Math.max(0, now() - phaseStartedAt)
      const line = `Subtitle pipeline job=${jobId} | ${currentPhase}/heartbeat | ${phaseMessage} | elapsed=${(elapsed / 1_000).toFixed(1)}s`
      if (elapsed >= SLOW_PHASE_MS) logWarn(line)
      else logInfo(line)
    }, HEARTBEAT_MS)
  }

  const materializeBatchArtifacts = async (srtPath: string, label: string): Promise<void> => {
    try {
      const artifact = await materializeSrtBatchOutput(srtPath)
      outputs.batchOutputs = [
        ...(outputs.batchOutputs ?? []),
        {
          srtPath: artifact.srtPath,
          textPath: artifact.textPath,
          splitDir: artifact.splitDir
        }
      ]
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'không rõ nguyên nhân'
      warnings.push(`Không tạo được file Batch cho ${label}: ${detail}`)
      logWarn(`Subtitle pipeline job=${jobId} | batch-output/warning | ${label} | ${detail}`)
    }
  }

  try {
    normalized = normalizeSubtitlePipelineRequest(request)
    assertNotAborted(options.signal)
    await mkdir(normalized.outputDir, { recursive: true })
    workDir = join(normalized.outputDir, `.tediapros-subtitle-pipeline-${jobId}`)
    assertSafeWorkDirectory(normalized.outputDir, workDir)
    await mkdir(workDir, { recursive: true })
    draftDir = join(normalized.outputDir, 'draft')
    await mkdir(draftDir, { recursive: true })
    outputs.draftDir = draftDir
    startHeartbeat()
    emit('validating', 2, 'Đã kiểm tra cấu hình pipeline.')
    logInfo(`Subtitle pipeline job=${jobId} | validating/start | video=${basename(normalized.videoPath)} | asr=${normalized.runAsr ? 'yes' : 'no'} | ocr=${normalized.runOcr ? 'yes' : 'no'} | srt=${normalized.sourceSrtPath ? 'yes' : 'no'} | ai=${normalized.aiEnabled ? 'yes' : 'no'}`)

    const tracks: SubtitleEvidenceTrackInput[] = []
    if (normalized.sourceSrtPath) {
      assertNotAborted(options.signal)
      tracks.push({
        source: 'srt',
        path: normalized.sourceSrtPath,
        text: await readFile(normalized.sourceSrtPath, 'utf8')
      })
    }
    // Keep previous lower-quality artifacts produced by this pipeline out of
    // the output root before this run writes the best source/locale files.
    await moveExistingSmartArtifacts(normalized.outputDir, draftDir, safeStem(normalized.videoPath))

    let ocrRawPath: string | undefined
    if (normalized.runOcr) {
      emit('ocr', 5, 'Đang đọc chữ xuất hiện trong video…', { source: 'ocr' })
      const ocrDir = join(workDir, 'ocr')
      await mkdir(ocrDir, { recursive: true })
      const region = normalized.ocrRegion
      const abortOcr = (): void => cancelOcr()
      options.signal?.addEventListener('abort', abortOcr, { once: true })
      try {
        const result = await ocrVideo(
          normalized.videoPath,
          ocrDir,
          normalized.ocrMode === 'full' ? 0 : region?.y0 ?? -1,
          normalized.ocrMode === 'full' ? -1 : region?.y1 ?? -1,
          normalized.ocrMode === 'full' ? 0 : region?.x0 ?? -1,
          normalized.ocrMode === 'full' ? -1 : region?.x1 ?? -1,
          ['.srt'],
          (progress) => emit(
            'ocr',
            progress.percent < 0 ? 5 : 5 + progress.percent * 0.3,
            progress.text || 'Đang đọc chữ xuất hiện trong video…',
            { source: 'ocr' }
          )
        )
        if (result.ok) {
          ocrRawPath = result.outputs?.find((path) => path.toLowerCase().endsWith('.srt')) ?? result.output
          if (ocrRawPath) {
            tracks.push({
              source: 'ocr',
              path: ocrRawPath,
              text: await readFile(ocrRawPath, 'utf8'),
              region
            })
          }
        } else if (result.error === 'Đã huỷ.' || options.signal?.aborted) {
          throw abortError()
        } else {
          warnings.push(`OCR không hoàn tất: ${result.error ?? 'không rõ nguyên nhân'}`)
          logWarn(`Subtitle pipeline job=${jobId} | ocr/warning | ${result.error ?? 'không có kết quả'}`)
        }
      } finally {
        options.signal?.removeEventListener('abort', abortOcr)
      }
    }

    let asrRawPath: string | undefined
    if (normalized.runAsr) {
      assertNotAborted(options.signal)
      emit('asr', 35, 'Đang nhận diện lời nói trong video…', { source: 'asr' })
      const asrDir = join(workDir, 'asr')
      await mkdir(asrDir, { recursive: true })
      const result = await transcribeAudio(
        `${jobId}:asr`,
        buildWhisperRequest(normalized, asrDir),
        (progress) => emit(
          'asr',
          progress.percent < 0 ? 35 : 35 + progress.percent * 0.3,
          progress.line || 'Đang nhận diện lời nói trong video…',
          { source: 'asr' }
        ),
        options.signal
      )
      if (result.ok) {
        asrRawPath = result.outputs.find((path) => path.toLowerCase().endsWith('.srt'))
        if (asrRawPath) {
          tracks.push({
            source: 'asr',
            path: asrRawPath,
            text: await readFile(asrRawPath, 'utf8'),
            language: normalized.asr.language
          })
        }
      } else if (result.error === 'Đã huỷ.' || options.signal?.aborted) {
        throw abortError()
      } else {
        warnings.push(`ASR không hoàn tất: ${result.error ?? 'không rõ nguyên nhân'}`)
        logWarn(`Subtitle pipeline job=${jobId} | asr/warning | ${result.error ?? 'không có kết quả'}`)
      }
    }

    assertNotAborted(options.signal)
    if (!tracks.length) throw new Error('Không có nguồn phụ đề nào được tạo thành công.')
    emit('fusing', 68, 'Đang đối chiếu ASR, OCR và SRT theo timeline…')
    summary = fuseSubtitleEvidence(tracks)
    if (!summary.cues.length) throw new Error('Các nguồn phụ đề không có cue hợp lệ.')
    const stem = safeStem(normalized.videoPath)
    const translationRequested = normalized.targetLocales.length > 0
    let outputCanonical = alignCanonicalToOcrStructure(buildFallbackCanonical(summary, jobId), summary)
    let bestCanonical = outputCanonical
    let canonicalSrtText = buildCanonicalSrt(outputCanonical)
    outputCueCount = outputCanonical.cues.filter((cue) => cue.finalAction !== 'drop').length
    const fusedPath = await nextAvailablePath(draftDir, `${stem}.smart.fused.srt`)
    await writeFile(fusedPath, buildFusedSrt(summary.cues), 'utf8')
    outputs.fusedSrt = fusedPath

    if (normalized.keepIntermediates && asrRawPath) {
      const path = await nextAvailablePath(draftDir, `${stem}.smart.asr.srt`)
      await copyFile(asrRawPath, path)
      outputs.asrSrt = path
    }
    if (normalized.keepIntermediates && ocrRawPath) {
      const path = await nextAvailablePath(draftDir, `${stem}.smart.ocr.srt`)
      await copyFile(ocrRawPath, path)
      outputs.ocrSrt = path
    }
    logInfo(`Subtitle pipeline job=${jobId} | fusing/complete | cues=${summary.cues.length} | conflicts=${summary.conflictCueNumbers.length} | asr=${summary.sourceCounts.asr} | ocr=${summary.sourceCounts.ocr} | srt=${summary.sourceCounts.srt}`)

    const ai: AiPipelineDetails = { unresolvedCueNumbers: [] }
    if (normalized.aiEnabled) {
      const key = (await loadKey()).trim()
      if (!key) {
        ai.error = 'Chưa có API key Gemini; đã giữ bản hợp nhất cục bộ.'
        warnings.push(ai.error)
      } else {
        const transport = createGeminiFilesTransport({ apiKey: key })
        // Build the source directly from evidence summary using raw ASR text as baseline
        const source = buildEvidenceSource(summary, normalized.videoPath)
        emit('restoring', 72, 'Gemini đang AI Fusion + Restore từ các track evidence…', { cues: summary.cues.length })
        try {
          ai.draft = await restoreSource({
            source,
            transport,
            jobId,
            evidence: summary,
            mode: normalized.aiMode,
            signal: options.signal,
            onLog: (event) => logGeminiEvent(jobId, event),
            onProgress: (done, total) => emit(
              'restoring',
              72 + (total ? (done / total) * 10 : 10),
              `Đã phục hồi ${done}/${total} cửa sổ evidence…`,
              { cues: summary?.cues.length }
            )
          })
          if (normalized.keepDiagnosticFiles) {
            const draftPath = await nextAvailablePath(draftDir, `${stem}.smart.ai-draft.srt`)
            await writeFile(draftPath, buildDraftSrt(alignRestorationDraftToOcrStructure(ai.draft, summary)), 'utf8')
            outputs.aiDraftSrt = draftPath
          }
          emit('auditing', 83, 'Gemini đang audit độc lập bản phục hồi…', { cues: summary.cues.length })
          ai.canonical = await auditRestoration({
            jobId,
            source,
            draft: ai.draft,
            transport,
            evidence: summary,
            signal: options.signal,
            onLog: (event) => logGeminiEvent(jobId, event),
            onProgress: (done, total) => emit(
              'auditing',
              83 + (total ? (done / total) * 8 : 8),
              `Đã audit ${done}/${total} batch evidence…`,
              { cues: summary?.cues.length }
            )
          })
          const reviewCues = ai.canonical.cues.filter((cue) => cue.needsReview)
          ai.unresolvedCueNumbers = reviewCues.map((cue) => cue.n)
          // final.srt is the canonical transcript. Hard-failure rows such as
          // tail hallucinations are omitted and the remaining indices are
          // renumbered only when this text is materialized below.
          outputCanonical = alignCanonicalToOcrStructure(ai.canonical, summary)
          canonicalSrtText = buildCanonicalSrt(outputCanonical)
          bestCanonical = canonicalForTranslation(outputCanonical)
          outputCueCount = outputCanonical.cues.filter((cue) => cue.finalAction !== 'drop').length
          if (reviewCues.length > 0) {
            warnings.push(`${reviewCues.length} cue được đánh dấu cần rà soát (đã xuất riêng vào thư mục draft).`)
          }
        } catch (reason) {
          if (isAbort(reason, options.signal)) throw abortError()
          ai.error = 'Gemini không hoàn tất phục hồi; đã giữ bản hợp nhất cục bộ.'
          warnings.push(ai.error)
          logWarn(`Subtitle pipeline job=${jobId} | ai/warning | ${reason instanceof Error ? reason.message : 'unknown'}`)
        }
      }
    }

    // Materialize the single best canonical source in the output root. Every
    // selected target language may add one best translation beside it; all
    // lower-level restoration/evidence variants remain in draft.
    const canonicalPath = await nextAvailablePath(
      normalized.outputDir,
      batchSrtFileName(sourceLanguageLabel(normalized.asr.language))
    )
    await writeFile(canonicalPath, canonicalSrtText, 'utf8')
    outputs.finalSrt = canonicalPath
    outputs.restoredSrt = canonicalPath
    outputs.primarySrt = canonicalPath
    await materializeBatchArtifacts(canonicalPath, 'SRT nguồn tốt nhất')

    const ttsReadyPath = await nextAvailablePath(draftDir, `${stem}.smart.tts-ready.srt`)
    await writeFile(ttsReadyPath, ttsNormalizeSrt(canonicalSrtText), 'utf8')
    outputs.ttsReadySrt = ttsReadyPath

    if (ai.canonical) {
      const reviewCues = outputCanonical.cues.filter((cue) => cue.needsReview)
      if (reviewCues.length > 0) {
        const needsReviewPath = await nextAvailablePath(draftDir, `${stem}.smart.needs-review.srt`)
        await writeFile(needsReviewPath, buildNeedsReviewSrt(outputCanonical), 'utf8')
        outputs.needsReviewSrt = needsReviewPath
      }
    }

    // Write the diagnostic artifact before the optional translation step. If a
    // target translation later times out/fails, the user still gets the full
    // ASR/OCR/SRT alignment and Gemini decision trail needed to optimize it.
    const evidencePath = await nextAvailablePath(draftDir, `${stem}.smart.evidence.json`)
    await writeFile(evidencePath, JSON.stringify(evidenceArtifact(summary, ai), null, 2), 'utf8')
    outputs.evidenceJson = evidencePath

    assertNotAborted(options.signal)
    if (translationRequested) {
      const targetLabels = normalized.targetLocales.map((target) => target.languageLabel).join(', ')
      try {
        emit('translating', 92, `Đang dịch bản phụ đề sang ${targetLabels}…`)
        const key = (await loadKey()).trim()
        if (!key) {
          warnings.push('Chưa có API key Gemini; chỉ xuất bản canonical nguồn.')
        } else {
          const targets = normalized.targetLocales.map((target) => resolveLocalizedTarget(target))
          const needsRates = bestCanonical.moneyMentions.some((mention) => mention.confidence === 'high' && mention.shouldConvert)
          let rateSnapshot = null
          if (needsRates) {
            try {
              rateSnapshot = await createExchangeRateProvider().getSnapshot(options.signal)
            } catch (reason) {
              warnings.push(`Không lấy được tỷ giá; bản dịch sẽ giữ tiền tệ nguồn (${reason instanceof Error ? reason.message : 'không rõ nguyên nhân'}).`)
            }
          }
          const transport = createGeminiFilesTransport({ apiKey: key })
          const localized = await runLocalizedTargetBatch({
            jobId,
            canonical: bestCanonical,
            targets,
            transport,
            rateSnapshot,
            unverified: true,
            signal: options.signal,
            onLog: (event) => logGeminiEvent(jobId, event),
            onProgress: (event) => emit(
              'translating',
              92 + event.percent * 0.05,
              `Đã dịch ${event.targetIndex + 1}/${event.totalTargets} target…`
            )
          })
          if (localized.cancelled || options.signal?.aborted) throw abortError()
          const translatedOutputs: NonNullable<SubtitlePipelineOutputPaths['translatedOutputs']> = []
          const titleOutputs: NonNullable<SubtitlePipelineOutputPaths['titleOutputs']> = []
          for (const translated of localized.translations) {
            if (!translated.ok || !translated.srt) {
              warnings.push(`Dịch ${translated.target.languageLabel} không hoàn tất: ${translated.error ?? 'không rõ nguyên nhân'}`)
              continue
            }
            const translatedPath = await nextAvailablePath(
              normalized.outputDir,
              batchSrtFileName(translated.target.languageLabel)
            )
            await writeFile(translatedPath, translated.srt, 'utf8')
            await materializeBatchArtifacts(translatedPath, `bản dịch ${translated.target.languageLabel}`)
            translatedOutputs.push({
              target: translated.target,
              path: translatedPath,
              primary: translatedOutputs.length === 0
            })
            if (!outputs.translatedSrt) outputs.translatedSrt = translatedPath

            const target = targets.find((candidate) => candidate.id === translated.target.id)
            if (!target) {
              warnings.push(`Không tìm thấy hồ sơ quốc gia để tạo tiêu đề cho ${translated.target.languageLabel}.`)
              continue
            }
            try {
              emit('translating', 97, `Đang tạo tiêu đề cho ${translated.target.regionLabel}…`)
              const title = await generateLocalizedTitle({
                jobId,
                canonical: bestCanonical,
                target,
                localizedSrt: translated.srt,
                transport,
                targetIndex: targets.findIndex((candidate) => candidate.id === target.id) + 1,
                targetCount: targets.length,
                signal: options.signal,
                onLog: (event) => logGeminiEvent(jobId, event)
              })
              if (!title.ok || !title.title) {
                warnings.push(`Không tạo được tiêu đề cho ${translated.target.regionLabel}: ${title.error ?? 'không rõ nguyên nhân'}`)
                continue
              }
              const titlePath = await materializeLocalizedTitleOutput(
                normalized.outputDir,
                translated.target.regionLabel,
                title.title
              )
              titleOutputs.push({ target: translated.target, path: titlePath })
            } catch (reason) {
              if (isAbort(reason, options.signal)) throw abortError()
              warnings.push(`Không xuất được tiêu đề cho ${translated.target.regionLabel}: ${reason instanceof Error ? reason.message : 'không rõ nguyên nhân'}`)
            }
          }
          if (translatedOutputs.length) outputs.translatedOutputs = translatedOutputs
          if (titleOutputs.length) outputs.titleOutputs = titleOutputs
          if (!translatedOutputs.length) warnings.push(`Không có ngôn ngữ nào dịch thành công: ${localized.error ?? 'không rõ nguyên nhân'}`)
        }
      } catch (reason) {
        if (isAbort(reason, options.signal)) throw abortError()
        warnings.push(`Dịch target không hoàn tất: ${reason instanceof Error ? reason.message : 'không rõ nguyên nhân'}`)
      }
    }

    emit('exporting', 98, 'Đang hoàn tất các file kết quả…')
    emit('completed', 100, 'Pipeline phụ đề đã hoàn tất.', {
      cues: outputCueCount,
      conflicts: summary.conflictCueNumbers.length
    })
    logInfo(`Subtitle pipeline job=${jobId} | completed/summary | cues=${outputCueCount} | conflicts=${summary.conflictCueNumbers.length} | warnings=${warnings.length} | elapsed=${((now() - startedAt) / 1_000).toFixed(1)}s`)
    return {
      ok: true,
      jobId,
      outputs,
      cueCount: outputCueCount,
      conflictCount: summary.conflictCueNumbers.length,
      warnings
    }
  } catch (reason) {
    const cancelled = isAbort(reason, options.signal)
    const error = cancelled
      ? 'Đã huỷ.'
      : reason instanceof Error
        ? reason.message
        : 'Pipeline phụ đề thất bại.'
    emit(cancelled ? 'cancelled' : 'error', 100, cancelled ? 'Pipeline đã được hủy.' : error)
    const writer = cancelled ? logWarn : logError
    writer(`Subtitle pipeline job=${jobId} | ${cancelled ? 'cancelled' : 'error'}/summary | ${error}`)
    return {
      ok: false,
      jobId,
      outputs,
      cueCount: outputCueCount,
      conflictCount: summary?.conflictCueNumbers.length ?? 0,
      warnings,
      error
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    if (workDir && normalized) {
      try {
        assertSafeWorkDirectory(normalized.outputDir, workDir)
        await rm(workDir, { recursive: true, force: true })
      } catch {
        logWarn(`Subtitle pipeline job=${jobId} | cleanup/warning | Không dọn được thư mục tạm.`)
      }
    }
  }
}

export function sourceLabel(source: SubtitlePipelineSource): string {
  if (source === 'asr') return 'Lời nói (ASR)'
  if (source === 'ocr') return 'Chữ trên hình (OCR)'
  return 'SRT tham chiếu'
}
