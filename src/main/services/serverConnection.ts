import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
  parseServerHandshake,
  ServerContractError,
  TEDIAPROS_API_VERSION,
  TEDIAPROS_PRODUCT,
  type ServerConnectionErrorCode,
  type ServerConnectionStatus
} from '../../shared/server-contract.ts'

const HANDSHAKE_PATH = '/api/v1/session/handshake'
const MAX_RESPONSE_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 5_000

export interface ServerEndpointStore {
  read(): Promise<string | null>
  write(endpoint: string): Promise<void>
}

interface ServerConnectionOptions {
  store: ServerEndpointStore
  clientVersion: string
  platform: string
  architecture: string
  environmentEndpoint?: string
  fetcher?: typeof fetch
  timeoutMs?: number
}

export interface ServerConnectionService {
  status(): Promise<ServerConnectionStatus>
  connect(endpoint: string): Promise<ServerConnectionStatus>
}

class ConnectionFailure extends Error {
  readonly code: ServerConnectionErrorCode

  constructor(code: ServerConnectionErrorCode) {
    super(code)
    this.name = 'ConnectionFailure'
    this.code = code
  }
}

function unavailable(
  endpoint: string,
  errorCode: ServerConnectionErrorCode,
  managed: boolean
): ServerConnectionStatus {
  return { state: 'unavailable', endpoint, capabilities: [], errorCode, managed }
}

function safeEndpointForDisplay(value: string): string {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : ''
  } catch {
    return ''
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new ConnectionFailure('invalid-response')
  }

  if (!response.body) throw new ConnectionFailure('invalid-response')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break

      totalBytes += chunk.value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new ConnectionFailure('invalid-response')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ConnectionFailure('invalid-response')
  }
}

export function createServerConnectionService(
  options: ServerConnectionOptions
): ServerConnectionService {
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const managedEndpoint = options.environmentEndpoint?.trim() || null
  let currentEndpoint: string | null = null

  async function handshake(endpointInput: string, managed: boolean): Promise<ServerConnectionStatus> {
    let endpoint: string
    try {
      endpoint = normalizeServerUrl(endpointInput)
    } catch (error) {
      if (error instanceof ServerContractError) {
        return unavailable(safeEndpointForDisplay(endpointInput), 'invalid-url', managed)
      }
      throw error
    }

    if (
      options.platform !== 'win32' ||
      (options.architecture !== 'x64' && options.architecture !== 'arm64')
    ) {
      return unavailable(endpoint, 'incompatible', managed)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(`${endpoint}${HANDSHAKE_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          product: TEDIAPROS_PRODUCT,
          apiVersion: TEDIAPROS_API_VERSION,
          clientVersion: options.clientVersion,
          platform: options.platform,
          architecture: options.architecture
        }),
        cache: 'no-store',
        signal: controller.signal
      })

      if (!response.ok) {
        await response.body?.cancel()
        return unavailable(endpoint, 'incompatible', managed)
      }

      const body = await readResponseBody(response)
      let handshake
      try {
        handshake = parseServerHandshake(body)
      } catch (error) {
        if (error instanceof ServerContractError) {
          return unavailable(endpoint, 'incompatible', managed)
        }
        throw error
      }

      return {
        state: 'connected',
        endpoint,
        serverVersion: handshake.serverVersion,
        capabilities: handshake.capabilities,
        managed
      }
    } catch (error) {
      if (error instanceof ConnectionFailure) return unavailable(endpoint, error.code, managed)
      return unavailable(endpoint, 'unreachable', managed)
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    async status() {
      if (managedEndpoint) return handshake(managedEndpoint, true)

      if (!currentEndpoint) {
        try {
          currentEndpoint = (await options.store.read()) ?? DEFAULT_SERVER_URL
        } catch {
          currentEndpoint = DEFAULT_SERVER_URL
        }
      }
      return handshake(currentEndpoint, false)
    },

    async connect(endpoint) {
      if (managedEndpoint) return handshake(managedEndpoint, true)

      const status = await handshake(endpoint, false)
      if (status.state !== 'connected') return status

      try {
        await options.store.write(status.endpoint)
      } catch {
        return unavailable(status.endpoint, 'storage-error', false)
      }
      currentEndpoint = status.endpoint
      return status
    }
  }
}

export function createFileServerEndpointStore(configPath: string): ServerEndpointStore {
  return {
    async read() {
      try {
        const value = JSON.parse(await readFile(configPath, 'utf8')) as unknown
        if (
          typeof value === 'object' &&
          value !== null &&
          'endpoint' in value &&
          typeof value.endpoint === 'string'
        ) {
          return value.endpoint
        }
      } catch {
        // Thiếu hoặc hỏng cấu hình thì quay về endpoint local mặc định.
      }
      return null
    },

    async write(endpoint) {
      await mkdir(dirname(configPath), { recursive: true })
      await writeFile(configPath, `${JSON.stringify({ endpoint }, null, 2)}\n`, 'utf8')
    }
  }
}
