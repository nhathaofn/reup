import { app, safeStorage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * API keys are kept in the main process. The pool file is encrypted with the
 * same OS-backed mechanism used by the existing single-key files. A legacy
 * file is read as a one-key pool so existing installations keep working.
 */
export function parseApiKeys(value: string): string[] {
  return [...new Set(
    value
      .split(/[\r\n,;]+/)
      .map((key) => key.trim())
      .filter(Boolean)
  )]
}

function pathFor(fileName: string): string {
  return join(app.getPath('userData'), fileName)
}

function decrypt(data: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(data)
    } catch {
      // Older/plaintext fallback installations may still have a readable file.
    }
  }
  return data.toString('utf8')
}

function encrypt(value: string): Buffer {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value)
    : Buffer.from(value, 'utf8')
}

function decodePool(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parseApiKeys(parsed.filter((item): item is string => typeof item === 'string').join('\n'))
    if (parsed && typeof parsed === 'object' && 'keys' in parsed) {
      const keys = (parsed as { keys?: unknown }).keys
      if (Array.isArray(keys)) return parseApiKeys(keys.filter((item): item is string => typeof item === 'string').join('\n'))
    }
  } catch {
    // Legacy files contain one encrypted string rather than JSON.
  }
  return parseApiKeys(raw)
}

export async function loadApiKeyPool(poolFileName: string, legacyFileName: string): Promise<string[]> {
  for (const fileName of [poolFileName, legacyFileName]) {
    try {
      const raw = decrypt(await readFile(pathFor(fileName)))
      const keys = decodePool(raw)
      if (keys.length) return keys
    } catch {
      // Try the next compatible storage format.
    }
  }
  return []
}

export async function saveApiKeyPool(
  poolFileName: string,
  legacyFileName: string,
  keys: string[]
): Promise<string[]> {
  const normalized = parseApiKeys(keys.join('\n'))
  const poolPath = pathFor(poolFileName)
  const legacyPath = pathFor(legacyFileName)
  if (!normalized.length) {
    await rm(poolPath, { force: true })
    await rm(legacyPath, { force: true })
    return []
  }

  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(
    poolPath,
    encrypt(JSON.stringify({ version: 1, keys: normalized })),
    { flag: 'w' }
  )
  // Keep the first key in the old location for compatibility with an older
  // TediaPros build. Current code always prefers the pool file above.
  await writeFile(legacyPath, encrypt(normalized[0]), { flag: 'w' })
  return normalized
}

export function rotateIndices(length: number, cursor: number): number[] {
  if (length <= 0) return []
  const start = ((cursor % length) + length) % length
  return Array.from({ length }, (_, offset) => (start + offset) % length)
}

export function nextCursor(index: number, length: number): number {
  return length > 0 ? (index + 1) % length : 0
}

/** Delay with a small jitter so a retry wave does not hit the provider at once. */
export function backoffMs(attempt: number, base = 900, cap = 15_000): number {
  const exponential = Math.min(cap, base * (2 ** Math.max(0, attempt)))
  return exponential + Math.floor(Math.random() * Math.min(350, Math.max(50, Math.floor(exponential / 4))))
}

/** Parse Retry-After (seconds or HTTP date) without trusting invalid values. */
export function retryAfterMs(value: string | null, fallback: number): number {
  if (!value) return fallback
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, Math.round(seconds * 1000))
  const timestamp = Date.parse(value)
  if (Number.isFinite(timestamp)) return Math.min(120_000, Math.max(0, timestamp - Date.now()))
  return fallback
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}
