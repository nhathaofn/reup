import type { SrtLocalizationPhase } from '../../shared/features/srt-translator.ts'
import type { GeminiGenerateRequest } from './gemini-files.ts'

/**
 * Trace emitted by the SRT translator.
 *
 * The optional payload fields intentionally contain the serialized Gemini
 * request/response so a failed model call can be diagnosed from the log file.
 * Serializers below redact API-key-like fields and remote file URIs. The
 * payload can still contain the SRT and prompt text, so treat the log as
 * private support data.
 */
export type SrtTranslatorLogKind =
  | 'phase-start'
  | 'heartbeat'
  | 'operation-start'
  | 'operation-progress'
  | 'operation-complete'
  | 'operation-error'
  | 'summary'

export type SrtTranslatorLogLevel = 'info' | 'warn' | 'error'

export type SrtGeminiPayloadKind = 'request' | 'response'

export interface SrtGeminiLogPayload {
  kind: SrtGeminiPayloadKind
  content: string
}

export interface SrtTranslatorLogEvent {
  jobId?: string
  phase: SrtLocalizationPhase
  kind: SrtTranslatorLogKind
  level?: SrtTranslatorLogLevel
  operation?: string
  message?: string
  cueCount?: number
  targetCount?: number
  done?: number
  total?: number
  percent?: number
  targetId?: string
  targetIndex?: number
  durationMs?: number
  elapsedMs?: number
  attempt?: number
  systemChars?: number
  inputChars?: number
  outputCount?: number
  hasMedia?: boolean
  geminiPayload?: SrtGeminiLogPayload
}

export type SrtTranslatorLog = (event: SrtTranslatorLogEvent) => void

export function formatSubtitlePipelineLogLine(
  jobId: string,
  event: SrtTranslatorLogEvent,
  modelName: string
): string {
  return [
    `Subtitle pipeline job=${jobId}`,
    `${event.phase}/${event.kind}`,
    event.operation ? `op=${event.operation}` : '',
    event.message ?? '',
    event.targetId ? `targetId=${event.targetId}` : '',
    event.targetIndex !== undefined && event.targetCount !== undefined
      ? `target=${event.targetIndex}/${event.targetCount}`
      : '',
    event.done !== undefined && event.total !== undefined ? `step=${event.done}/${event.total}` : '',
    event.attempt !== undefined ? `attempt=${event.attempt}` : '',
    event.operation?.includes('gemini-') ? `model=${modelName}` : ''
  ].filter(Boolean).join(' | ').replace(/[\r\n]+/gu, ' ').slice(0, 1_500)
}

const TRACE_MAX_CHARS = 2_000_000
const SENSITIVE_TRACE_KEY = /^(?:api[-_]?key|authorization|x-goog-api-key|fileUri|remoteUri|uri)$/iu

function redactTraceValue(key: string, value: unknown): unknown {
  if (SENSITIVE_TRACE_KEY.test(key)) return '[REDACTED]'
  if (key === 'signal') return undefined
  return value
}

/** Serialize JSON-like Gemini data without allowing diagnostic logging to throw. */
export function serializeGeminiTrace(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    const serialized = JSON.stringify(value, (key, nested) => {
      const redacted = redactTraceValue(key, nested)
      if (redacted && typeof redacted === 'object') {
        if (seen.has(redacted)) return '[Circular]'
        seen.add(redacted)
      }
      return redacted
    })
    const text = serialized ?? String(value)
    return text.length <= TRACE_MAX_CHARS
      ? text
      : `${text.slice(0, TRACE_MAX_CHARS)}…[truncated ${text.length - TRACE_MAX_CHARS} chars]`
  } catch {
    return '[unserializable Gemini payload]'
  }
}

/** Serialize the request data passed to the Gemini transport, excluding AbortSignal. */
export function serializeGeminiRequest(request: GeminiGenerateRequest): string {
  return serializeGeminiTrace({
    systemInstruction: request.systemInstruction,
    userText: request.userText,
    responseSchema: request.responseSchema,
    ...(request.file ? {
      file: {
        name: request.file.name,
        uri: '[REDACTED]',
        mimeType: request.file.mimeType,
        state: request.file.state
      }
    } : {})
  })
}
