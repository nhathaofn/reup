import { readFile, writeFile } from 'node:fs/promises'
import type { MultiLangKeyStatus } from '../shared/features/multilang-short'
import { buildCueText, chiaText, huongDanDiaPhuong, loiHeChuDich, parseCueText } from './translate-shared'
import { debugRaw, logInfo } from './logger'

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_MODEL = 'qwen2.5:7b'
const HAN_DICH = 180_000

interface OllamaTagResponse {
  models?: Array<{ name?: string }>
}

interface OllamaChatResponse {
  message?: { content?: string }
}

function baseUrl(value?: string): string {
  const candidate = value?.trim() || DEFAULT_BASE_URL
  const parsed = new URL(candidate)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Ollama URL phải dùng HTTP hoặc HTTPS.')
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)) {
    throw new Error('Ollama chỉ được phép chạy trên máy local (127.0.0.1/localhost).')
  }
  return candidate.replace(/\/+$/, '')
}

function modelName(value?: string): string {
  const model = value?.trim() || DEFAULT_MODEL
  if (!/^[\w.-]+(?::[\w.-]+)?$/.test(model)) throw new Error('Tên model Ollama không hợp lệ.')
  return model
}

function modelMatches(installed: string, requested: string): boolean {
  return installed === requested || (requested.endsWith(':latest') && installed === requested.slice(0, -7))
}

export async function checkOllama(model?: string, url?: string): Promise<MultiLangKeyStatus> {
  let endpoint: string
  let requested: string
  try {
    endpoint = baseUrl(url)
    requested = modelName(model)
  } catch (error) {
    return { ok: false, hasKey: false, message: error instanceof Error ? error.message : String(error) }
  }

  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return { ok: false, hasKey: false, message: `Ollama trả về HTTP ${response.status}.` }
    const data = (await response.json()) as OllamaTagResponse
    const models = (data.models ?? []).map((item) => item.name?.trim()).filter((name): name is string => Boolean(name))
    if (!models.some((installed) => modelMatches(installed, requested))) {
      const installed = models.length ? ` Đang có: ${models.join(', ')}.` : ''
      return { ok: false, hasKey: false, keyCount: models.length, message: `Ollama đang chạy nhưng chưa có model "${requested}".${installed}` }
    }
    return { ok: true, hasKey: true, keyCount: 1, message: `Ollama sẵn sàng với model ${requested}.` }
  } catch (error) {
    return {
      ok: false,
      hasKey: false,
      message: `Không kết nối được Ollama tại ${endpoint}: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function parseItems(raw: string): Array<{ n: number; t: string }> | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    const parsed = JSON.parse(cleaned) as { items?: Array<{ n: number; t: string }> } | Array<{ n: number; t: string }>
    return Array.isArray(parsed) ? parsed : (parsed.items ?? null)
  } catch {
    return null
  }
}

async function chat(
  endpoint: string,
  model: string,
  system: string,
  user: string
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${system}\n\nChỉ trả về JSON object có dạng {"items":[{"n":1,"t":"..."}]} và không thêm markdown.` },
          { role: 'user', content: user }
        ],
        stream: false,
        format: 'json',
        options: { temperature: 0 }
      }),
      signal: AbortSignal.timeout(HAN_DICH)
    })
    if (!response.ok) return { ok: false, error: `Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 300)}` }
    const data = (await response.json()) as OllamaChatResponse
    const text = data.message?.content?.trim() ?? ''
    return text ? { ok: true, text } : { ok: false, error: 'Ollama trả về nội dung rỗng.' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Bản địa hóa TXT bằng Ollama local; mỗi request giữ nguyên ranh giới từng cue. */
export async function localizeTextFile(
  textPath: string,
  outPath: string,
  dich: string,
  phongCach: string,
  model?: string,
  url?: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; error?: string; count?: number }> {
  let endpoint: string
  let selectedModel: string
  try {
    endpoint = baseUrl(url)
    selectedModel = modelName(model)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const status = await checkOllama(selectedModel, endpoint)
  if (!status.ok) return { ok: false, error: status.message }

  const lines = parseCueText(await readFile(textPath, 'utf-8'))
  if (!lines.length) return { ok: false, error: 'File phụ đề TXT trống.' }

  const chunks = chiaText(lines)
  logInfo(`Bản địa hóa TXT (Ollama ${selectedModel}): ${lines.length} cue trong ${chunks.length} request…`)
  const translated: string[] = []
  const translateChunk = async (
    chunk: string[],
    targetLanguage: string,
    targetStyle: string,
    chunkIndex: number
  ): Promise<{ lines?: string[]; error?: string }> => {
    const payload = chunk.map((line, index) => `${index + 1}. ${line}`).join('\n')
    let accepted: string[] | null = null
    let languageError = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const retryInstruction = attempt === 0
        ? ''
        : `\n\nRETRY: The previous response used the wrong language (${languageError}). Translate every line again and output only the target language. Do not retain source text.`
      const result = await chat(endpoint, selectedModel, `${huongDanDiaPhuong(targetLanguage, targetStyle)}${retryInstruction}`, payload)
      if (!result.ok) {
        debugRaw(`ollama ${selectedModel}`, result.error)
        return { error: result.error || 'Ollama không trả về kết quả.' }
      }
      const items = parseItems(result.text ?? '')
      if (!items) return { error: 'Kết quả Ollama không đọc được dạng JSON.' }

      const map = new Map<number, string>()
      for (const item of items) {
        if (Number.isInteger(item.n) && typeof item.t === 'string' && !map.has(item.n)) map.set(item.n, item.t)
      }
      const candidate: string[] = []
      for (let index = 0; index < chunk.length; index++) {
        const value = map.get(index + 1)
        if (!value?.trim()) return { error: `Kết quả Ollama thiếu dòng ${index + 1}.` }
        candidate.push(value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim())
      }
      languageError = loiHeChuDich(targetLanguage, candidate) ?? ''
      if (!languageError) {
        accepted = candidate
        break
      }
      logInfo(`Bản địa hóa TXT (Ollama): ${languageError} Đang tự dịch lại phần ${chunkIndex + 1}.`)
    }
    return accepted
      ? { lines: accepted }
      : { error: `${languageError} AI vẫn trả về sai ngôn ngữ sau khi thử lại.` }
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    let sourceForTarget = chunk
    if (dich === 'vi' && /\p{Script=Han}/u.test(chunk.join(' '))) {
      logInfo(`Bản địa hóa TXT (Ollama): dùng cầu nối English → Vietnamese cho phần ${i + 1} để tránh giữ nguyên chữ Trung.`)
      const pivot = await translateChunk(
        chunk,
        'en',
        'faithful, clear English that preserves the complete meaning and standard names',
        i
      )
      if (!pivot.lines) return { ok: false, error: pivot.error || 'Ollama không tạo được bản dịch cầu nối.' }
      sourceForTarget = pivot.lines
    }

    const localized = await translateChunk(sourceForTarget, dich, phongCach, i)
    if (!localized.lines) return { ok: false, error: localized.error || 'Ollama không trả về kết quả.' }
    translated.push(...localized.lines)
    onProgress?.(i + 1, chunks.length)
  }

  await writeFile(outPath, buildCueText(translated), 'utf-8')
  logInfo(`Bản địa hóa TXT (Ollama): xong ${translated.length} cue.`)
  return { ok: true, count: translated.length }
}
