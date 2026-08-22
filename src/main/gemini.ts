import { readFile, writeFile } from 'node:fs/promises'
import { debugRaw, errLabel, logInfo } from './logger'
import { LOCKED_GEMINI_MODEL } from './gemini-model'
import type { GeminiStatus, SrtBlock } from '../shared/types'
import { buildCueText, buildSrt, chia, chiaText, huongDan, huongDanDiaPhuong, loiHeChuDich, mergeTranslatedBlocks, parseCueText, parseSrt } from './translate-shared'
import { backoffMs, loadApiKeyPool, nextCursor, parseApiKeys, rotateIndices, saveApiKeyPool, sleep } from './services/apiKeyPool'

export { parseSrt, buildSrt } from './translate-shared'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

// ---- Khoa cua user: ma hoa bang DPAPI (Win) / Keychain (mac) ----
const GEMINI_POOL_FILE = 'gemini-keys.bin'
const GEMINI_LEGACY_FILE = 'gk.bin'
let geminiKeyCursor = 0
const GEMINI_MODEL_CACHE_MS = 10 * 60_000
const GEMINI_MIN_GAP_MS = 350
const geminiModelCache = new Map<string, { expiresAt: number; models: string[] }>()
let geminiNextRequestAt = 0

async function paceGeminiRequest(): Promise<void> {
  const wait = geminiNextRequestAt - Date.now()
  if (wait > 0) await sleep(wait)
  geminiNextRequestAt = Date.now() + GEMINI_MIN_GAP_MS
}

export async function loadKeys(): Promise<string[]> {
  return loadApiKeyPool(GEMINI_POOL_FILE, GEMINI_LEGACY_FILE)
}

export async function saveKeys(keys: string[]): Promise<void> {
  await saveApiKeyPool(GEMINI_POOL_FILE, GEMINI_LEGACY_FILE, keys)
  geminiKeyCursor = 0
  geminiModelCache.clear()
}

/** Compatibility API used by the existing single-key translation settings. */
export async function saveKey(key: string): Promise<void> {
  await saveKeys(parseApiKeys(key))
}

export async function loadKey(): Promise<string> {
  return (await loadKeys())[0] ?? ''
}

export async function hasKey(): Promise<boolean> {
  return (await loadKeys()).length > 0
}

// ---- Model Gemini cố định ----
async function danhSach(_key: string): Promise<string[]> {
  return [LOCKED_GEMINI_MODEL]
}

interface GenKQ {
  ok: boolean
  text?: string
  lui?: boolean
  status?: number
  err?: string
}

// fetch cua Node KHONG tu het gio. Google mo ket noi roi im -> cho VINH VIEN,
// nut quay mai, khong co duong thoat. Bat buoc phai tu dat han.
const HAN_KIEM = 20_000 // kiem key: 1 cau "xin chào", 20s la qua du
const HAN_DICH = 180_000 // dich 1 chunk 20k ky tu: do that 14-60s

async function goi(
  key: string,
  model: string,
  sys: string,
  user: string,
  schema?: object,
  han = HAN_DICH,
  signal?: AbortSignal
): Promise<GenKQ> {
  const cfg: Record<string, unknown> = { temperature: 0.2 }
  if (schema) {
    cfg.responseMimeType = 'application/json'
    cfg.responseSchema = schema
  }
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: cfg
  }
  if (sys) body.systemInstruction = { parts: [{ text: sys }] }
  let res: Response
  try {
    await paceGeminiRequest()
    res = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(han), signal])
        : AbortSignal.timeout(han)
    })
  } catch (e) {
    return { ok: false, lui: true, status: 0, err: String(e) }
  }
  if (!res.ok) {
    const t = await res.text()
    return { ok: false, lui: res.status === 429 || res.status >= 500, status: res.status, err: t }
  }
  const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text.trim()) return { ok: false, lui: false, status: 200, err: 'rỗng' }
  return { ok: true, text }
}

async function goiCoLui(
  key: string,
  models: string[],
  sys: string,
  user: string,
  schema?: object,
  han?: number,
  signal?: AbortSignal
): Promise<GenKQ> {
  // Khong co model nao de thu -> phai bao ro, dung de rot ve "lỗi không xác định"
  if (!models.length) return { ok: false, err: 'network: không lấy được danh sách' }
  let cuoi: GenKQ = { ok: false, err: 'hết model' }
  for (const m of models) {
    if (signal?.aborted) return { ok: false, lui: false, status: 0, err: 'Đã huỷ.' }
    const r = await goi(key, m, sys, user, schema, han, signal)
    if (r.ok) return r
    debugRaw(`gemini ${m}`, r.err)
    cuoi = r
    if (!r.lui) break
  }
  return cuoi
}

function shouldRotateGeminiKey(result: GenKQ): boolean {
  if (result.status === 0 || result.status === 401 || result.status === 403 || result.status === 429) return true
  if ((result.status ?? 0) >= 500) return true
  return result.status === 400 && /api.?key|quota|resource.?exhausted|rate.?limit/i.test(result.err ?? '')
}

/** Try keys round-robin; a successful request advances the next starting key. */
async function goiCoLuiPool(
  keys: string[],
  sys: string,
  user: string,
  schema?: object,
  han?: number
): Promise<GenKQ> {
  let last: GenKQ = { ok: false, err: 'hết API key' }
  for (const index of rotateIndices(keys.length, geminiKeyCursor)) {
    const key = keys[index]
    const models = await danhSach(key)
    let result: GenKQ = { ok: false, err: 'hết model' }
    let rotateKeyAfterModels = false
    let lastTransientFailure: GenKQ | null = null
    for (const model of models) {
      let attempt = 0
      do {
        result = await goi(key, model, sys, user, schema, han)
        if (result.ok || (result.status ?? 0) < 500 || attempt >= 1) break
        await sleep(backoffMs(attempt))
        attempt++
      } while (true)
      if (result.ok) break
      debugRaw(`gemini pool ${model}`, result.err)
      const status = result.status ?? 0
      if (status >= 500) {
        // 5xx la loi tam thoi cua model/dich vu: tiep tuc thu model fallback
        // tren cung key truoc khi ket luan key bi loi.
        rotateKeyAfterModels = true
        lastTransientFailure = result
        continue
      }
      if (status === 400 || status === 404) {
        // Model co the het han/quyen truy cap trong danh sach tra ve tu API.
        // Bo qua model nay de thu fallback tiep theo, khong xoay key vo ich.
        continue
      }
      // 429/401/403/timeout lien quan den key: doi key ngay. Loi 4xx khac
      // thi dung model hien tai va tra loi ro rang.
      if (shouldRotateGeminiKey(result) || !result.lui) {
        if (shouldRotateGeminiKey(result)) rotateKeyAfterModels = true
        break
      }
    }
    if (result.ok) {
      geminiKeyCursor = nextCursor(index, keys.length)
      if (keys.length > 1) logInfo(`Gemini key pool: dùng key ${index + 1}/${keys.length}, lượt kế tiếp sẽ xoay vòng.`)
      return result
    }
    last = rotateKeyAfterModels && lastTransientFailure ? lastTransientFailure : result
    if (!rotateKeyAfterModels && !shouldRotateGeminiKey(result)) return result
      if (keys.length > 1) logInfo(`Gemini key pool: key ${index + 1}/${keys.length} bị giới hạn/lỗi, chuyển key kế tiếp.`)
      geminiKeyCursor = nextCursor(index, keys.length)
  }
  return last
}

/**
 * Kiem tra khoa = gui MOT cau chao that don gian, co tra loi la khoa con song.
 * Khong system instruction, khong schema — cang it thu cang it cho hong.
 * UI chi duoc bao dung/khong: khong ten model, khong so lieu.
 */
export async function checkKey(key: string): Promise<GeminiStatus> {
  const k = key.trim() || (await loadKey())
  if (!k) return { ok: false, message: 'Chưa nhập API key.' }

  const models = await danhSach(k)
  if (!models.length) return { ok: false, message: 'Kiểm tra thất bại: lỗi kết nối mạng.' }

  // Co mang thi Google LUON tra loi — chi la tra bang loi. Nen ket luan "khoa
  // chet" chi duoc rut ra khi da di HET danh sach ma khong cai nao tra loi.
  // (Truoc day chi thu 5 -> 5 cai dau ket hạn la bao chet, trong khi nhung cai
  //  sau van song -> bao oan.)
  let ketHan = 0
  let loiKhac = ''
  for (const m of models) {
    const r = await goi(k, m, '', 'xin chào', undefined, HAN_KIEM)
    if (r.ok) return { ok: true, message: 'API KEY của bạn dùng được.' }
    debugRaw(`checkKey ${m}`, r.err)

    // Mat mang / het gio -> dung ngay, thu tiep cung vo ich
    if (r.status === 0) return { ok: false, message: `Kiểm tra thất bại: ${errLabel(r.err)}` }
    // Khoa sai/bi thu hoi -> chac chan chet, khong can thu tiep
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      return { ok: false, message: 'API KEY không dùng được. Vui lòng tạo khoá mới và dán lại.' }
    }
    if (r.status === 429) ketHan++
    else loiKhac = r.err ?? ''
  }

  // Di het danh sach, khong cai nao tra loi
  if (ketHan && !loiKhac) {
    return { ok: false, message: 'API KEY đã dùng hết lượt hôm nay. Vui lòng thử lại sau.' }
  }
  return { ok: false, message: `API KEY không dùng được: ${errLabel(loiKhac)}` }
}

export async function checkKeyPool(keyText?: string): Promise<GeminiStatus & { keyCount: number; healthyKeyCount: number }> {
  const provided = parseApiKeys(keyText?.trim() || '')
  const pool = provided.length ? provided : await loadKeys()
  if (!pool.length) return { ok: false, keyCount: 0, healthyKeyCount: 0, message: 'Chưa nhập API key Gemini.' }

  let healthyKeyCount = 0
  for (const key of pool) {
    const status = await checkKey(key)
    if (status.ok) healthyKeyCount++
  }
  return {
    ok: healthyKeyCount > 0,
    keyCount: pool.length,
    healthyKeyCount,
    message: healthyKeyCount > 0
      ? `Đã kiểm tra ${pool.length} Gemini key: ${healthyKeyCount} key dùng được; hệ thống sẽ tự xoay khi bị giới hạn.`
      : `Đã kiểm tra ${pool.length} Gemini key nhưng chưa có key dùng được.`
  }
}

// ---- Dich .srt ----
const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { n: { type: 'INTEGER' }, t: { type: 'STRING' } },
    required: ['n', 't']
  }
}

/**
 * Dich 1 file .srt. Timestamp KHONG bao gio gui di — giu o may, ghep lai sau.
 * Khoi nao khong co ban dich -> giu nguyen chu goc (tha 1 dong chua dich con
 * hon ca file sai gio).
 */
export async function translateSrtText(
  raw: string,
  dich: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ ok: boolean; srt?: string; error?: string; count?: number }> {
  if (signal?.aborted) return { ok: false, error: 'Đã huỷ.' }
  const keys = await loadKeys()
  if (!keys.length) return { ok: false, error: 'Chưa có API key.' }

  const blocks = parseSrt(raw)
  if (!blocks.length) return { ok: false, error: 'File phụ đề trống.' }

  // Giữ batching theo giới hạn ký tự kể cả khi có nhiều key. Gửi từng cue
  // khiến một file vài chục câu thành vài chục lượt mạng tuần tự; pool vẫn
  // xoay key theo từng chunk và retry khi một key bị giới hạn.
  const chunks = chia(blocks)
  if (keys.length > 1) logInfo(`Gemini key pool: phân phối round-robin ${keys.length} key theo chunk.`)
  logInfo(`Dịch phụ đề: ${blocks.length} câu…`)

  const ra: SrtBlock[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) return { ok: false, error: 'Đã huỷ.' }
    const c = chunks[i]
    const payload = c.map((b, j) => `${j + 1}. ${b.text}`).join('\n')
    const r = await goiCoLuiPool(keys, huongDan(dich), payload, SCHEMA)
    if (!r.ok) return { ok: false, error: errLabel(r.err) }

    let arr: { n: number; t: string }[] = []
    try {
      arr = JSON.parse(r.text as string)
    } catch {
      return { ok: false, error: 'Kết quả dịch không đọc được.' }
    }
    ra.push(...mergeTranslatedBlocks(c, arr))
    onProgress?.(i + 1, chunks.length)
  }

  logInfo(`Dịch phụ đề: xong ${ra.length} câu.`)
  return { ok: true, srt: buildSrt(ra), count: ra.length }
}

export async function translateSrt(
  srtPath: string,
  outPath: string,
  dich: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const result = await translateSrtText(await readFile(srtPath, 'utf-8'), dich, onProgress, signal)
  if (!result.ok || result.srt === undefined) {
    return { ok: false, error: result.error }
  }
  await writeFile(outPath, result.srt, 'utf-8')
  return { ok: true, count: result.count }
}

/** Dịch kèm biên tập văn phong cho pipeline video đa ngôn ngữ. */
export async function localizeSrt(
  srtPath: string,
  outPath: string,
  dich: string,
  phongCach: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const keys = await loadKeys()
  if (!keys.length) return { ok: false, error: 'Chưa có API key.' }

  const blocks = parseSrt(await readFile(srtPath, 'utf-8'))
  if (!blocks.length) return { ok: false, error: 'File phụ đề trống.' }

  const chunks = chia(blocks)
  if (keys.length > 1) logInfo(`Gemini key pool: phân phối round-robin ${keys.length} key theo chunk.`)
  const ra: SrtBlock[] = []
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const payload = c.map((b, j) => `${j + 1}. ${b.text}`).join('\n')
    const r = await goiCoLuiPool(keys, huongDanDiaPhuong(dich, phongCach), payload, SCHEMA)
    if (!r.ok) return { ok: false, error: errLabel(r.err) }

    let arr: { n: number; t: string }[] = []
    try {
      arr = JSON.parse(r.text as string)
    } catch {
      return { ok: false, error: 'Kết quả bản địa hóa không đọc được.' }
    }
    const map = new Map(arr.map((x) => [x.n, x.t]))
    c.forEach((b, j) => ra.push({ time: b.time, text: map.get(j + 1) || b.text }))
    onProgress?.(i + 1, chunks.length)
  }

  await writeFile(outPath, buildSrt(ra), 'utf-8')
  logInfo(`Bản địa hóa phụ đề: xong ${ra.length} câu.`)
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
  const keys = await loadKeys()
  if (!keys.length) return { ok: false, error: 'Chưa có API key.' }

  const lines = parseCueText(await readFile(textPath, 'utf-8'))
  if (!lines.length) return { ok: false, error: 'File phụ đề TXT trống.' }

  const chunks = chiaText(lines)
  logInfo(`Bản địa hóa TXT: ${lines.length} cue trong ${chunks.length} request…`)
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
      const result = await goiCoLuiPool(keys, `${huongDanDiaPhuong(dich, phongCach)}${retryInstruction}`, payload, SCHEMA)
      if (!result.ok) return { ok: false, error: errLabel(result.err) }

      let items: { n: number; t: string }[] = []
      try {
        items = JSON.parse(result.text as string) as { n: number; t: string }[]
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
      logInfo(`Bản địa hóa TXT: ${languageError} Đang tự dịch lại phần ${i + 1}.`)
    }
    if (!accepted) return { ok: false, error: `${languageError} AI vẫn trả về sai ngôn ngữ sau khi thử lại.` }
    translated.push(...accepted)
    onProgress?.(i + 1, chunks.length)
  }

  await writeFile(outPath, buildCueText(translated), 'utf-8')
  logInfo(`Bản địa hóa TXT: xong ${translated.length} cue.`)
  return { ok: true, count: translated.length }
}
