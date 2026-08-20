import { randomUUID } from 'node:crypto'
import { resolveFfmpeg } from '../deps'
import { loadKey } from '../gemini'
import { LOCKED_GEMINI_MODEL } from '../gemini-model'
import { logError, logInfo, logWarn } from '../logger'
import { createExchangeRateProvider } from './exchange-rates'
import { createGeminiFilesTransport } from './gemini-files'
import { resolveLocalizedTarget } from './srt-locale-profiles'
import { runLocalizedTargetBatch } from './srt-localization'
import { applyReviewSelections, auditRestoration } from './srt-source-audit'
import { restoreSource } from './srt-source-restoration'
import { assertSourceFingerprint, loadSrtSource, nodeStatFile, probeVideoDuration, spawnProbeProcess, validateVideoSource } from './srt-source-validation'
import { createSrtTranslatorJobController, type SrtTranslatorJobController } from './srt-translator-job'
import type { SrtTranslatorLogEvent } from './srt-translator-logging'

function safeLogText(value: unknown): string {
  return String(value ?? '').replace(/[|\r\n]+/gu, ' ').trim().slice(0, 240)
}

function durationText(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return ''
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`
}

function logSrtProcess(event: SrtTranslatorLogEvent): void {
  const parts = [
    `SRT job=${safeLogText(event.jobId || 'unknown')}`,
    `${event.phase}/${event.kind}`,
    event.operation ? `op=${safeLogText(event.operation)}` : '',
    event.message ? safeLogText(event.message) : '',
    event.done !== undefined && event.total !== undefined ? `step=${event.done}/${event.total}` : '',
    event.targetIndex !== undefined && event.targetCount !== undefined ? `target=${event.targetIndex}/${event.targetCount}` : '',
    event.targetId ? `targetId=${safeLogText(event.targetId)}` : '',
    event.cueCount !== undefined ? `cues=${event.cueCount}` : '',
    event.percent !== undefined && Number.isFinite(event.percent) ? `progress=${event.percent.toFixed(1)}%` : '',
    event.inputChars !== undefined ? `inputChars=${event.inputChars}` : '',
    event.systemChars !== undefined ? `systemChars=${event.systemChars}` : '',
    event.outputCount !== undefined ? `output=${event.outputCount}` : '',
    event.attempt !== undefined ? `attempt=${event.attempt}` : '',
    durationText(event.durationMs) ? `duration=${durationText(event.durationMs)}` : '',
    durationText(event.elapsedMs) ? `elapsed=${durationText(event.elapsedMs)}` : '',
    event.hasMedia === undefined ? '' : `media=${event.hasMedia ? 'yes' : 'no'}`,
    event.operation?.includes('gemini-') ? `model=${LOCKED_GEMINI_MODEL}` : ''
  ].filter(Boolean).join(' | ')
  const writer = event.level === 'error' ? logError : event.level === 'warn' ? logWarn : logInfo
  writer(logSafeLine(parts))
  if (event.geminiPayload) logGeminiPayload(event, writer)
}

function logSafeLine(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 1_500)
}

const GEMINI_PAYLOAD_CHUNK_SIZE = 3_000

function logGeminiPayload(
  event: SrtTranslatorLogEvent,
  writer: (message: string) => void
): void {
  const payload = event.geminiPayload
  if (!payload) return
  const content = payload.content || '(empty)'
  const parts: string[] = []
  for (let offset = 0; offset < content.length; offset += GEMINI_PAYLOAD_CHUNK_SIZE) {
    parts.push(content.slice(offset, offset + GEMINI_PAYLOAD_CHUNK_SIZE))
  }
  if (parts.length === 0) parts.push('(empty)')
  const prefix = [
    `SRT job=${safeLogText(event.jobId || 'unknown')}`,
    `${event.phase}/gemini-${payload.kind}`,
    event.operation ? `op=${safeLogText(event.operation)}` : '',
    event.attempt !== undefined ? `attempt=${event.attempt}` : ''
  ].filter(Boolean).join(' | ')
  parts.forEach((part, index) => {
    writer(`${prefix} | part=${index + 1}/${parts.length} | chars=${content.length} | ${part.replace(/[\r\n]+/gu, '\\n')}`)
  })
}

export function createProductionSrtTranslatorJobController(): SrtTranslatorJobController {
  const rateProvider = createExchangeRateProvider()
  return createSrtTranslatorJobController({
    loadKey,
    loadSrtSource,
    validateVideoSource: (videoPath, source, signal) => validateVideoSource(videoPath, source, {
      statFile: nodeStatFile,
      probeDuration: (path, probeSignal) => probeVideoDuration(path, { resolveFfmpeg, spawnProbe: spawnProbeProcess }, probeSignal)
    }, signal),
    assertSourceFingerprint: (fingerprint) => assertSourceFingerprint(fingerprint, nodeStatFile),
    createTransport: (apiKey) => createGeminiFilesTransport({ apiKey }),
    restoreSource,
    auditRestoration,
    applyReviewSelections,
    resolveLocalizedTarget,
    getRateSnapshot: (signal) => rateProvider.getSnapshot(signal),
    runLocalizedTargetBatch,
    makeJobId: () => randomUUID(),
    log: logSrtProcess
  })
}
