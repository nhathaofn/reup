export const DEFAULT_SERVER_URL = 'http://127.0.0.1:48191' as const
export const TEDIAPROS_PRODUCT = 'tediapros' as const
export const TEDIAPROS_SERVER_PRODUCT = 'tediapros-server' as const
export const TEDIAPROS_API_VERSION = 'v1' as const
export const REQUIRED_SERVER_CAPABILITY = 'session' as const

export const SERVER_CHANNELS = {
  status: 'server:status',
  connect: 'server:connect'
} as const

export type ServerConnectionErrorCode =
  | 'invalid-url'
  | 'unreachable'
  | 'incompatible'
  | 'invalid-response'
  | 'storage-error'

export interface ServerHandshake {
  ok: true
  product: typeof TEDIAPROS_SERVER_PRODUCT
  apiVersion: typeof TEDIAPROS_API_VERSION
  serverVersion: string
  capabilities: string[]
}

export type ServerConnectionStatus =
  | {
      state: 'connected'
      endpoint: string
      serverVersion: string
      capabilities: string[]
      managed: boolean
    }
  | {
      state: 'unavailable'
      endpoint: string
      capabilities: []
      errorCode: ServerConnectionErrorCode
      managed: boolean
    }

export class ServerContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerContractError'
  }
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false

  const octets = parts.map(Number)
  if (octets.some((part) => part < 0 || part > 255)) return false

  const [first, second] = octets
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

function isPrivateIPv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === '::1') return true

  const firstGroup = normalized.split(':', 1)[0]
  return /^f[cd][0-9a-f]{2}$/.test(firstGroup) || /^fe[89ab][0-9a-f]$/.test(firstGroup)
}

function isLanHttpHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || isPrivateIPv4(normalized) || isPrivateIPv6(normalized)
}

export function normalizeServerUrl(value: string): string {
  const input = value.trim()
  if (!input) throw new ServerContractError('Server URL is required.')

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ServerContractError('Server URL is invalid.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServerContractError('Server URL must use HTTP or HTTPS.')
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new ServerContractError('Server URL must not contain credentials, a path, a query, or a fragment.')
  }
  if (url.protocol === 'http:' && !isLanHttpHost(url.hostname)) {
    throw new ServerContractError('Plain HTTP is allowed only for loopback and private LAN addresses.')
  }

  return url.origin
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseServerHandshake(value: unknown): ServerHandshake {
  if (!isRecord(value)) throw new ServerContractError('Handshake response must be an object.')

  const capabilities = value.capabilities
  const validCapabilities =
    Array.isArray(capabilities) &&
    capabilities.every((capability) => typeof capability === 'string' && capability.trim() !== '')

  if (
    value.ok !== true ||
    value.product !== TEDIAPROS_SERVER_PRODUCT ||
    value.apiVersion !== TEDIAPROS_API_VERSION ||
    typeof value.serverVersion !== 'string' ||
    value.serverVersion.trim() === '' ||
    !validCapabilities ||
    !capabilities.includes(REQUIRED_SERVER_CAPABILITY)
  ) {
    throw new ServerContractError('Handshake response is incompatible with this client.')
  }

  return {
    ok: true,
    product: TEDIAPROS_SERVER_PRODUCT,
    apiVersion: TEDIAPROS_API_VERSION,
    serverVersion: value.serverVersion,
    capabilities: [...capabilities]
  }
}
