import { safeStorage, app } from 'electron'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { debugRaw, errLabel, logInfo } from './logger'
import type { DichKeyStatus, SrtBlock } from '../shared/types'
import { buildCueText, buildSrt, chia, chiaText, huongDan, huongDanDiaPhuong, loiHeChuDich, parseCueText, parseSrt } from './translate-shared'

const BASE = 'https://api.openai.com/v1'

// ---- Khoa cua user: ma hoa bang DPAPI (Win) / Keychain (mac) ----
function keyFile(): string {
  return join(app.getPath('userData'), 'ok.bin')
}

export async function saveKey(key: string): Promise<void> {
  const t = key.trim()
  if (!t) {
    await rm(keyFile(), { force: true })
    return
  }
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(t)
    : Buffer.from(t, 'utf-8')
  await writeFile(keyFile(), buf)
}

export async function loadKey(): Promise<string> {
  try {
    const buf = await readFile(keyFile())
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
  } catch {
    return ''
  }
}

export async function hasKey(): Promise<boolean> {
  return (await loadKey()).length > 0
}

// ---- Chon model ----
const DU_PHONG = ['gpt-4o-mini', 'gpt-4o']

function diem(n: string): number {
  let s = 0
  if (n === 'gpt-4o-mini') s += 200
  if (n === 'gpt-4o') s += 150
  if (n.startsWith('gpt-4o-mini')) s += 100
  if (n.startsWith('gpt-4o')) s += 80
  if (n.includes('mini')) s += 20
  if (n.includes('realtime') || n.includes('audio') || n.includes('search')) s -= 100
  return s
}

async function danhSach(key: string): Promise<string[]> {
  let ds: string[] = []
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (res.ok) {
      const d = (await res.json()) as { data?: { id?: string }[] }
      ds = (d.data ?? [])
        .map((m) => m.id ?? '')
        .filter((id) => id.startsWith('gpt-4o') && !id.includes('realtime') && !id.includes('audio'))
    }
  } catch {
    /* rot ve du phong */
  }
  const pool = ds.length ? ds : DU_PHONG
  const uniq = [...new Set(pool)]
  return uniq.sort((a, b) => diem(b) - diem(a))
}

interface GenKQ {
  ok: boolean
  text?: string
  lui?: boolean
  status?: number
  err?: string
}

const HAN_KIEM = 20_000
const HAN_DICH = 180_000

/** OpenAI json_schema bat root object — boc mang {n,t} trong `items`. */
const SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'srt_translation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              n: { type: 'integer' },
              t: { type: 'string' }
            },
            required: ['n', 't'],
            additionalProperties: false
          }
        }
      },
      required: ['items'],
      additionalProperties: false
    }
  }
}

async function goi(
  key: string,
  model: string,
  sys: string,
  user: string,
  dungSchema: boolean,
  han = HAN_DICH
): Promise<GenKQ> {
  const messages: { role: string; content: string }[] = []
  if (sys) messages.push({ role: 'system', content: sys })
  messages.push({ role: 'user', content: user })

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2
  }
  if (dungSchema) body.response_format = SCHEMA

  let res: Response
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(han)
    })
  } catch (e) {
    return { ok: false, lui: true, status: 0, err: String(e) }
  }
  if (!res.ok) {
    const t = await res.text()
    return { ok: false, lui: res.status === 429 || res.status >= 500, status: res.status, err: t }
  }
  const d = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[]
  }
  const text = d.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) return { ok: false, lui: false, status: 200, err: 'rỗng' }
  return { ok: true, text }
}

async function goiCoLui(
  key: string,
  models: string[],
  sys: string,
  user: string,
  dungSchema: boolean,
  han?: number
): Promise<GenKQ> {
  if (!models.length) return { ok: false, err: 'network: không lấy được danh sách' }
  let cuoi: GenKQ = { ok: false, err: 'hết model' }
  for (const m of models) {
    const r = await goi(key, m, sys, user, dungSchema, han)
    if (r.ok) return r
    debugRaw(`openai ${m}`, r.err)
    cuoi = r
    if (!r.lui) break
  }
  return cuoi
}

export async function checkKey(key: string): Promise<DichKeyStatus> {
  const k = key.trim() || (await loadKey())
  if (!k) return { ok: false, message: 'Chưa nhập API key.' }

  const models = await danhSach(k)
  if (!models.length) return { ok: false, message: 'Kiểm tra thất bại: lỗi kết nối mạng.' }

  let ketHan = 0
  let loiKhac = ''
  for (const m of models) {
    const r = await goi(k, m, '', 'xin chào', false, HAN_KIEM)
    if (r.ok) return { ok: true, message: 'API KEY của bạn dùng được.' }
    debugRaw(`openai checkKey ${m}`, r.err)

    if (r.status === 0) return { ok: false, message: `Kiểm tra thất bại: ${errLabel(r.err)}` }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, message: 'API KEY không dùng được. Vui lòng tạo khoá mới và dán lại.' }
    }
    if (r.status === 429) ketHan++
    else loiKhac = r.err ?? ''
  }

  if (ketHan && !loiKhac) {
    return { ok: false, message: 'API KEY đã dùng hết lượt hôm nay. Vui lòng thử lại sau.' }
  }
  return { ok: false, message: `API KEY không dùng được: ${errLabel(loiKhac)}` }
}

/**
 * Dich 1 file .srt qua OpenAI. Timestamp khong gui di — ghep lai sau.
 */
export async function translateSrt(
  srtPath: string,
  outPath: string,
  dich: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const key = await loadKey()
  if (!key) return { ok: false, error: 'Chưa có API key.' }

  const blocks = parseSrt(await readFile(srtPath, 'utf-8'))
  if (!blocks.length) return { ok: false, error: 'File phụ đề trống.' }

  const models = await danhSach(key)
  const chunks = chia(blocks)
  logInfo(`Dịch phụ đề (ChatGPT): ${blocks.length} câu…`)

  const ra: SrtBlock[] = []
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const payload = c.map((b, j) => `${j + 1}. ${b.text}`).join('\n')
    const r = await goiCoLui(key, models, huongDan(dich), payload, true)
    if (!r.ok) return { ok: false, error: errLabel(r.err) }

    let arr: { n: number; t: string }[] = []
    try {
      const parsed = JSON.parse(r.text as string) as
        | { items?: { n: number; t: string }[] }
        | { n: number; t: string }[]
      arr = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
    } catch {
      return { ok: false, error: 'Kết quả dịch không đọc được.' }
    }
    const map = new Map(arr.map((x) => [x.n, x.t]))
    c.forEach((b, j) => ra.push({ time: b.time, text: map.get(j + 1) || b.text }))
    onProgress?.(i + 1, chunks.length)
  }

  await writeFile(outPath, buildSrt(ra), 'utf-8')
  logInfo(`Dịch phụ đề (ChatGPT): xong ${ra.length} câu.`)
  return { ok: true, count: ra.length }
}

/** Dịch kèm biên tập văn phong cho pipeline video đa ngôn ngữ. */
export async function localizeSrt(
  srtPath: string,
  outPath: string,
  dich: string,
  phongCach: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const key = await loadKey()
  if (!key) return { ok: false, error: 'Chưa có API key.' }

  const blocks = parseSrt(await readFile(srtPath, 'utf-8'))
  if (!blocks.length) return { ok: false, error: 'File phụ đề trống.' }

  const models = await danhSach(key)
  const chunks = chia(blocks)
  const ra: SrtBlock[] = []
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const payload = c.map((b, j) => `${j + 1}. ${b.text}`).join('\n')
    const r = await goiCoLui(key, models, huongDanDiaPhuong(dich, phongCach), payload, true)
    if (!r.ok) return { ok: false, error: errLabel(r.err) }

    let arr: { n: number; t: string }[] = []
    try {
      const parsed = JSON.parse(r.text as string) as
        | { items?: { n: number; t: string }[] }
        | { n: number; t: string }[]
      arr = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
    } catch {
      return { ok: false, error: 'Kết quả bản địa hóa không đọc được.' }
    }
    const map = new Map(arr.map((x) => [x.n, x.t]))
    c.forEach((b, j) => ra.push({ time: b.time, text: map.get(j + 1) || b.text }))
    onProgress?.(i + 1, chunks.length)
  }

  await writeFile(outPath, buildSrt(ra), 'utf-8')
  logInfo(`Bản địa hóa phụ đề (ChatGPT): xong ${ra.length} câu.`)
  return { ok: true, count: ra.length }
}

/** Bản địa hóa TXT: một request xử lý cả chunk nhiều dòng, mỗi dòng là một cue. */
export async function localizeTextFile(
  textPath: string,
  outPath: string,
  dich: string,
  phongCach: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const key = await loadKey()
  if (!key) return { ok: false, error: 'Chưa có API key.' }

  const lines = parseCueText(await readFile(textPath, 'utf-8'))
  if (!lines.length) return { ok: false, error: 'File phụ đề TXT trống.' }

  const models = await danhSach(key)
  const chunks = chiaText(lines)
  logInfo(`Bản địa hóa TXT (ChatGPT): ${lines.length} cue trong ${chunks.length} request…`)
  const translated: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const payload = chunk.map((line, index) => `${index + 1}. ${line}`).join('\n')
    let accepted: string[] | null = null
    let languageError = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const retryInstruction = attempt === 0
        ? ''
        : `\n\nRETRY: The previous response used the wrong language (${languageError}). Translate every line again and output only the target language. Do not retain source text.`
      const result = await goiCoLui(key, models, `${huongDanDiaPhuong(dich, phongCach)}${retryInstruction}`, payload, true)
      if (!result.ok) return { ok: false, error: errLabel(result.err) }

      let items: { n: number; t: string }[] = []
      try {
        const parsed = JSON.parse(result.text as string) as
          | { items?: { n: number; t: string }[] }
          | { n: number; t: string }[]
        items = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
      } catch {
        return { ok: false, error: 'Kết quả bản địa hóa TXT không đọc được.' }
      }
      const map = new Map(items.map((item) => [item.n, item.t]))
      const candidate: string[] = []
      for (let index = 0; index < chunk.length; index++) {
        const value = map.get(index + 1)
        if (!value?.trim()) return { ok: false, error: `Kết quả bản địa hóa TXT thiếu dòng ${index + 1}.` }
        candidate.push(value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim())
      }
      languageError = loiHeChuDich(dich, candidate) ?? ''
      if (!languageError) {
        accepted = candidate
        break
      }
      logInfo(`Bản địa hóa TXT (ChatGPT): ${languageError} Đang tự dịch lại phần ${i + 1}.`)
    }
    if (!accepted) return { ok: false, error: `${languageError} AI vẫn trả về sai ngôn ngữ sau khi thử lại.` }
    translated.push(...accepted)
    onProgress?.(i + 1, chunks.length)
  }

  await writeFile(outPath, buildCueText(translated), 'utf-8')
  logInfo(`Bản địa hóa TXT (ChatGPT): xong ${translated.length} cue.`)
  return { ok: true, count: translated.length }
}
