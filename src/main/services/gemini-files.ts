import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { LOCKED_GEMINI_MODEL } from '../gemini-model.ts'

export interface GeminiRemoteFile {
  name: string
  uri: string
  mimeType: string
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED'
}

export interface GeminiGenerateRequest {
  systemInstruction: string
  userText: string
  responseSchema: object
  file?: GeminiRemoteFile
  signal?: AbortSignal
}

export interface GeminiMultimodalTransport {
  /** Media methods are optional: the SRT-only workflow only needs generateJson. */
  uploadVideo?(input: {
    path: string
    mimeType: string
    displayName: string
    signal?: AbortSignal
  }): Promise<GeminiRemoteFile>
  waitUntilActive?(file: GeminiRemoteFile, signal?: AbortSignal): Promise<GeminiRemoteFile>
  generateJson<T>(request: GeminiGenerateRequest): Promise<T>
  deleteFile?(name: string): Promise<void>
}

export interface GeminiFilesDeps {
  apiKey: string
  /** Test override; production omits this and always uses LOCKED_GEMINI_MODEL. */
  models?: string[]
  generateTimeoutMs?: number
  fetchImpl?: typeof fetch
  openUploadBody?: (path: string) => Promise<{
    body: BodyInit
    size: number
    duplex?: 'half'
  }>
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  random?: () => number
}

const API_ROOT = 'https://generativelanguage.googleapis.com'
const EXCLUDED_MODEL = /image|imagen|tts|audio|speech|embedding|robotics|computer-use|omni/u
const GENERATE_TIMEOUT_MS = 180_000
const UPLOAD_REQUEST_TIMEOUT_MS = 20 * 60 * 1000
const POLL_REQUEST_TIMEOUT_MS = 30_000
const PROCESSING_DEADLINE_MS = 20 * 60 * 1000
const RETRY_AFTER_CAP_MS = 30_000

type RequestInitFactory = RequestInit | (() => RequestInit | Promise<RequestInit>)

function isAbort(reason: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) ||
    (reason instanceof Error && reason.name === 'AbortError')
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('cancelled', 'AbortError')
}

function sleepDefault(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolvePromise()
    }, ms)
    const abort = (): void => {
      clearTimeout(timer)
      reject(abortReason(signal))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function childTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const abort = (): void => controller.abort(abortReason(parent))
  parent?.addEventListener('abort', abort, { once: true })
  if (parent?.aborted) abort()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('request timeout', 'TimeoutError'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
    }
  }
}

function scoreModel(name: string): number {
  const match = name.match(/(\d+\.\d+|\d+)/u)
  let score = (match ? Number.parseFloat(match[1]) : 1) * 100
  if (name.includes('flash')) score += 50
  if (name.includes('lite')) score -= 20
  if (name.includes('preview') || name.includes('-exp')) score -= 30
  return score
}

function normalizeModelName(name: string): string {
  return name.replace(/^models\//u, '').trim()
}

/**
 * Encode a Gemini resource name without encoding its path separators.
 *
 * `files/<id>` is a resource path, not one opaque URL path segment. Encoding
 * the whole string turns it into `files%2F<id>`, which the Files API does not
 * resolve for `files.get`/`files.delete`.
 */
function resourcePath(name: string): string {
  return name
    .trim()
    .replace(/^\/+|\/+$/gu, '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function chooseModels(models: readonly string[]): string[] {
  return [...models]
    .map(normalizeModelName)
    .filter((name) => Boolean(name) && !EXCLUDED_MODEL.test(name))
    .sort((left, right) => scoreModel(right) - scoreModel(left))
}

function retryDelayMs(
  response: Response | null,
  callIndex: number,
  now: () => number,
  random: () => number
): number {
  const value = response?.headers.get('Retry-After')?.trim()
  if (value) {
    const seconds = Number(value)
    const parsed = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, Date.parse(value) - now())
    if (Number.isFinite(parsed)) return Math.min(RETRY_AFTER_CAP_MS, parsed)
  }
  return Math.min(
    RETRY_AFTER_CAP_MS,
    1000 * (2 ** callIndex) + Math.floor(Math.max(0, random()) * 251)
  )
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function internalError(code: string): Error {
  return new Error(code)
}

function publicError(reason: unknown, fallback: string): Error {
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason
  if (reason instanceof Error && (reason.name === 'AbortError' || reason.name === 'TimeoutError')) {
    return reason
  }
  const code = reason instanceof Error ? reason.message : ''
  if (code === 'gemini_upload_start_failed') return new Error('Không thể bắt đầu tải video lên Gemini.')
  if (code === 'gemini_upload_finalize_failed') return new Error('Không thể hoàn tất tải video lên Gemini.')
  if (code === 'gemini_processing_failed') return new Error('Gemini xử lý video thất bại.')
  if (code === 'gemini_processing_timeout') return new Error('Gemini xử lý video quá thời gian chờ.')
  if (code === 'gemini_delete_failed') return new Error('Không thể xác nhận xóa video khỏi Gemini.')
  return new Error(fallback)
}

async function defaultOpenUploadBody(path: string): Promise<{
  body: BodyInit
  size: number
  duplex: 'half'
}> {
  const info = await stat(path)
  return {
    body: Readable.toWeb(createReadStream(path)) as unknown as BodyInit,
    size: info.size,
    duplex: 'half'
  }
}

export function createGeminiFilesTransport(deps: GeminiFilesDeps): GeminiMultimodalTransport {
  const apiKey = deps.apiKey.trim()
  if (!apiKey) throw new Error('Gemini API key còn trống.')
  const fetchImpl = deps.fetchImpl ?? fetch
  const openUploadBody = deps.openUploadBody ?? defaultOpenUploadBody
  const usesDefaultUploadBody = !deps.openUploadBody
  const sleep = deps.sleep ?? sleepDefault
  const now = deps.now ?? Date.now
  const random = deps.random ?? Math.random
  const generateTimeoutMs = deps.generateTimeoutMs ?? GENERATE_TIMEOUT_MS
  const injectedModels = deps.models?.length ? chooseModels(deps.models) : null

  const requestWithRetry = async (
    url: string,
    makeInit: RequestInitFactory,
    signal: AbortSignal | undefined,
    maxCalls = 3,
    acceptedStatuses: readonly number[] = []
  ): Promise<Response> => {
    let lastResponse: Response | null = null
    for (let callIndex = 0; callIndex < maxCalls; callIndex += 1) {
      if (signal?.aborted) throw abortReason(signal)
      try {
        const init = typeof makeInit === 'function' ? await makeInit() : makeInit
        const response = await fetchImpl(url, { ...init, signal })
        lastResponse = response
        if (response.ok || acceptedStatuses.includes(response.status)) return response
        if (!isRetryableStatus(response.status) || callIndex === maxCalls - 1) {
          throw internalError(`gemini_http_${response.status}`)
        }
      } catch (reason) {
        if (isAbort(reason, signal)) throw abortReason(signal)
        if (reason instanceof Error && /^gemini_http_4(?!29)/u.test(reason.message)) {
          throw reason
        }
        if (callIndex === maxCalls - 1) throw internalError('gemini_network_failed')
      }
      await sleep(retryDelayMs(lastResponse, callIndex, now, random), signal)
    }
    throw internalError('gemini_network_failed')
  }

  const modelList = async (): Promise<string[]> => {
    // Production deliberately skips /models discovery. This keeps every SRT
    // request on the user-selected model and avoids silently changing models.
    return injectedModels?.length ? injectedModels : [LOCKED_GEMINI_MODEL]
  }

  const uploadVideo = async (input: {
    path: string
    mimeType: string
    displayName: string
    signal?: AbortSignal
  }): Promise<GeminiRemoteFile> => {
    const startChild = childTimeoutSignal(input.signal, UPLOAD_REQUEST_TIMEOUT_MS)
    try {
      const initialBody = usesDefaultUploadBody ? null : await openUploadBody(input.path)
      const uploadSize = initialBody?.size ?? (await stat(input.path)).size
      const startResponse = await requestWithRetry(
        `${API_ROOT}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(uploadSize),
            'X-Goog-Upload-Header-Content-Type': input.mimeType,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ file: { displayName: input.displayName } })
        },
        startChild.signal
      )
      const uploadUrl = startResponse.headers.get('x-goog-upload-url')
      if (!uploadUrl) throw internalError('gemini_upload_start_failed')

      let useInitialBody = true
      const finalResponse = await requestWithRetry(
        uploadUrl,
        async () => {
          const body = useInitialBody && initialBody
            ? initialBody
            : await openUploadBody(input.path)
          useInitialBody = false
          return {
            method: 'POST',
            headers: {
              'Content-Length': String(body.size),
              'X-Goog-Upload-Offset': '0',
              'X-Goog-Upload-Command': 'upload, finalize'
            },
            body: body.body,
            ...(body.duplex ? { duplex: body.duplex } : {})
          } as RequestInit
        },
        startChild.signal
      )
      const payload = await finalResponse.json() as { file?: unknown }
      const file = payload.file
      if (!file || typeof file !== 'object') throw internalError('gemini_upload_finalize_failed')
      const value = file as Record<string, unknown>
      if (
        typeof value.name !== 'string' || typeof value.uri !== 'string' ||
        typeof value.mimeType !== 'string' ||
        !['PROCESSING', 'ACTIVE', 'FAILED'].includes(String(value.state))
      ) throw internalError('gemini_upload_finalize_failed')
      return {
        name: value.name,
        uri: value.uri,
        mimeType: value.mimeType,
        state: value.state as GeminiRemoteFile['state']
      }
    } catch (reason) {
      if (isAbort(reason, input.signal)) throw abortReason(input.signal)
      if (reason instanceof Error && reason.message === 'gemini_upload_start_failed') {
        throw publicError(reason, 'Không thể bắt đầu tải video lên Gemini.')
      }
      throw publicError(reason, 'Không thể tải video lên Gemini.')
    } finally {
      startChild.dispose()
    }
  }

  const waitUntilActive = async (
    file: GeminiRemoteFile,
    signal?: AbortSignal
  ): Promise<GeminiRemoteFile> => {
    if (file.state === 'ACTIVE') return file
    if (file.state === 'FAILED') throw new Error('Gemini xử lý video thất bại.')
    const deadline = now() + PROCESSING_DEADLINE_MS
    let current = file
    while (now() <= deadline) {
      const child = childTimeoutSignal(signal, POLL_REQUEST_TIMEOUT_MS)
      try {
        const response = await requestWithRetry(
          `${API_ROOT}/v1beta/${resourcePath(current.name)}?key=${encodeURIComponent(apiKey)}`,
          { method: 'GET' },
          child.signal
        )
        const payload = await response.json() as Record<string, unknown>
        const candidate = payload.file && typeof payload.file === 'object' ? payload.file : payload
        if (!candidate || typeof candidate !== 'object') throw internalError('gemini_processing_failed')
        const value = candidate as Record<string, unknown>
        if (
          typeof value.name !== 'string' || typeof value.uri !== 'string' ||
          typeof value.mimeType !== 'string'
        ) throw internalError('gemini_processing_failed')
        const state = String(value.state) as GeminiRemoteFile['state']
        if (!['PROCESSING', 'ACTIVE', 'FAILED'].includes(state)) {
          throw internalError('gemini_processing_failed')
        }
        current = { name: value.name, uri: value.uri, mimeType: value.mimeType, state }
        if (current.state === 'ACTIVE') return current
        if (current.state === 'FAILED') throw internalError('gemini_processing_failed')
      } catch (reason) {
        if (isAbort(reason, signal)) throw abortReason(signal)
        if (reason instanceof Error && reason.message === 'gemini_processing_failed') {
          throw new Error('Gemini xử lý video thất bại.')
        }
        throw publicError(reason, 'Không thể kiểm tra trạng thái video trên Gemini.')
      } finally {
        child.dispose()
      }
      await sleep(2_000, signal)
    }
    throw new Error('Gemini xử lý video quá thời gian chờ.')
  }

  const generateJson = async <T>(request: GeminiGenerateRequest): Promise<T> => {
    const models = await modelList()
    let lastReason: unknown = null
    const parts = [
      ...(request.file ? [{ fileData: { mimeType: request.file.mimeType, fileUri: request.file.uri } }] : []),
      { text: request.userText }
    ]
    const body = {
      systemInstruction: { parts: [{ text: request.systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: request.responseSchema
      }
    }

    for (const model of models) {
      const child = childTimeoutSignal(request.signal, generateTimeoutMs)
      try {
        const response = await requestWithRetry(
          `${API_ROOT}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          },
          child.signal
        )
        const payload = await response.json() as Record<string, unknown>
        const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
        const first = candidates[0]
        const partsValue = first && typeof first === 'object'
          ? (first as Record<string, unknown>).content
          : null
        const responseParts = partsValue && typeof partsValue === 'object'
          ? (partsValue as Record<string, unknown>).parts
          : null
        const text = Array.isArray(responseParts)
          ? responseParts
              .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object')
              .map((part) => typeof part.text === 'string' ? part.text : '')
              .join('')
          : ''
        if (!text) throw internalError('gemini_invalid_json')
        try {
          return JSON.parse(text) as T
        } catch {
          throw internalError('gemini_invalid_json')
        }
      } catch (reason) {
        if (isAbort(reason, request.signal)) throw abortReason(request.signal)
        lastReason = reason
      } finally {
        child.dispose()
      }
    }
    throw publicError(lastReason, 'Gemini không trả về JSON hợp lệ.')
  }

  const deleteFile = async (name: string): Promise<void> => {
    const child = childTimeoutSignal(undefined, 10_000)
    try {
      await requestWithRetry(
        `${API_ROOT}/v1beta/${resourcePath(name)}?key=${encodeURIComponent(apiKey)}`,
        { method: 'DELETE' },
        child.signal,
        2,
        [404]
      )
    } catch (reason) {
      throw publicError(reason, 'Không thể xác nhận xóa video khỏi Gemini.')
    } finally {
      child.dispose()
    }
  }

  return { uploadVideo, waitUntilActive, generateJson, deleteFile }
}
