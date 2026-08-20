import { spawn, type ChildProcess } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import type {
  MultiLangCancelResult,
  MultiLangBlurMaskPolicy,
  MultiLangKeyStatus,
  MultiLangOutput,
  MultiLangProgress,
  MultiLangRegion,
  MultiLangRequest,
  MultiLangResult,
  MultiLangStyle,
  MultiLangSubtitleStyle,
  MultiLangTarget
} from '../../shared/features/multilang-short'
import { DICH_LANGS, type BlurRegion } from '../../shared/types'
import { resolveFfmpeg } from '../deps'
import { detectGpu } from '../gpu'
import { burnSubtitle, cancelBurn } from '../burn'
import { transcribeAudio, whisperCudaStatus } from '../whisper'
import { localizeTextFile as localizeGeminiText } from '../gemini'
import { localizeTextFile as localizeOpenAiText } from '../openai'
import { localizeTextFile as localizeOllamaText } from '../ollama'
import {
  cancelSceneSplitter,
  runSceneSplitter,
  sceneSplitterEngineStatus
} from './sceneSplitter'
import { parseSrt, readSrtFile } from './srt'
import { parseCueText } from '../translate-shared'
import { logInfo } from '../logger'
import { cancelTextRemoval, removeTextFromVideo } from './textRemove'
import {
  backoffMs,
  loadApiKeyPool,
  nextCursor,
  parseApiKeys,
  retryAfterMs,
  rotateIndices,
  saveApiKeyPool,
  sleep
} from './apiKeyPool'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.ts', '.m4v'])
const DEFAULT_VOICE_MODEL = 'eleven_multilingual_v2'
const DEFAULT_SUBTITLE_STYLE: MultiLangSubtitleStyle = {
  textColor: '#ffffff',
  outlineColor: '#111827',
  outlinePx: 2,
  bgEnabled: false,
  bgColor: '#111827',
  bgOpacity: 82,
  fontScale: 100,
  bold: true,
  italic: false,
  shadowPx: 1,
  bgPaddingPx: 10
}
const DEFAULT_SUBTITLE_REGION: MultiLangRegion = {
  x0: 0.08,
  x1: 0.92,
  y0: 0.8,
  y1: 0.95
}
const ELEVEN_VOICES_ENDPOINT = 'https://api.elevenlabs.io/v1/voices'
const ELEVEN_MODELS_ENDPOINT = 'https://api.elevenlabs.io/v1/models'
const ELEVEN_TTS_ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech'
const ELEVEN_POOL_FILE = 'elevenlabs-keys.bin'
const ELEVEN_LEGACY_FILE = 'elevenlabs.key'

interface ActiveJob {
  cancelled: boolean
  child: ChildProcess | null
  abortController: AbortController
}

interface VideoMeta {
  width: number
  height: number
  duration: number
}

interface SceneManifest {
  requested: boolean
  used: boolean
  engine?: string | null
  manifestFile?: string
  scenes: Array<{
    index: number
    sourceVideo: string
    filePath: string
    startSeconds: number
    endSeconds: number
    durationSeconds: number
  }>
  variantOrders?: Array<{
    sourceVideo: string
    language: string
    locale: string
    sceneIndices: number[]
    mode: 'timeline' | 'rotated'
  }>
  note?: string
}

let activeJob: ActiveJob | null = null
let elevenKeyCursor = 0
const ELEVEN_MIN_GAP_MS = 350
let elevenNextRequestAt = 0

function killProcessTree(processToKill: ChildProcess): void {
  if (!processToKill.pid) return
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(processToKill.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.unref()
    } else {
      process.kill(-processToKill.pid, 'SIGTERM')
    }
  } catch {
    try {
      processToKill.kill('SIGTERM')
    } catch {
      // Process may already have exited.
    }
  }
}

async function paceElevenRequest(): Promise<void> {
  const wait = elevenNextRequestAt - Date.now()
  if (wait > 0) await sleep(wait)
  elevenNextRequestAt = Date.now() + ELEVEN_MIN_GAP_MS
}

export async function loadElevenLabsKeys(): Promise<string[]> {
  return loadApiKeyPool(ELEVEN_POOL_FILE, ELEVEN_LEGACY_FILE)
}

export async function saveElevenLabsKeys(keys: string[]): Promise<void> {
  await saveApiKeyPool(ELEVEN_POOL_FILE, ELEVEN_LEGACY_FILE, keys)
  elevenKeyCursor = 0
}

/** Compatibility API used by the original one-key tab. */
export async function saveElevenLabsKey(value: string): Promise<void> {
  await saveElevenLabsKeys(parseApiKeys(value))
}

export async function hasElevenLabsKey(): Promise<boolean> {
  return (await loadElevenLabsKeys()).length > 0
}

async function loadElevenLabsKey(): Promise<string> {
  return (await loadElevenLabsKeys())[0] ?? ''
}

export async function checkElevenLabsKey(
  providedKey?: string,
  voiceId?: string
): Promise<MultiLangKeyStatus> {
  const key = providedKey?.trim() || (await loadElevenLabsKey())
  if (!key) return { ok: false, hasKey: false, message: 'Chưa nhập ElevenLabs API key.' }
  if (voiceId?.trim() && !/^[a-zA-Z0-9_-]{3,160}$/.test(voiceId.trim())) {
    return { ok: false, hasKey: true, message: 'Voice ID không hợp lệ.' }
  }

  try {
    const response = await fetch(ELEVEN_VOICES_ENDPOINT, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) {
      return {
        ok: false,
        hasKey: true,
        message: response.status === 401 || response.status === 403
          ? 'ElevenLabs API key không dùng được.'
          : `ElevenLabs trả về lỗi HTTP ${response.status}.`
      }
    }
    const payload = (await response.json()) as { voices?: Array<{ voice_id?: string }> }
    if (voiceId?.trim() && !(payload.voices ?? []).some((voice) => voice.voice_id === voiceId.trim())) {
      return { ok: false, hasKey: true, message: 'API key dùng được nhưng không tìm thấy Voice ID này.' }
    }
    return { ok: true, hasKey: true, message: 'ElevenLabs API key và Voice ID dùng được.' }
  } catch {
    return { ok: false, hasKey: true, message: 'Không kết nối được ElevenLabs. Kiểm tra mạng rồi thử lại.' }
  }
}

export async function checkElevenLabsKeyPool(
  keyText?: string,
  voiceId?: string
): Promise<MultiLangKeyStatus> {
  const provided = parseApiKeys(keyText?.trim() || '')
  const pool = provided.length ? provided : await loadElevenLabsKeys()
  if (!pool.length) return { ok: false, hasKey: false, keyCount: 0, healthyKeyCount: 0, message: 'Chưa nhập ElevenLabs API key.' }

  let healthyKeyCount = 0
  for (const key of pool) {
    const status = await checkElevenLabsKey(key, voiceId)
    if (status.ok) healthyKeyCount++
  }
  return {
    ok: healthyKeyCount > 0,
    hasKey: true,
    keyCount: pool.length,
    healthyKeyCount,
    message: healthyKeyCount > 0
      ? `Đã kiểm tra ${pool.length} ElevenLabs key: ${healthyKeyCount} key dùng được; hệ thống sẽ tự xoay khi bị giới hạn.`
      : `Đã kiểm tra ${pool.length} ElevenLabs key nhưng chưa có key dùng được.`
  }
}

function report(onProgress: (progress: MultiLangProgress) => void, progress: MultiLangProgress): void {
  try {
    onProgress({
      ...progress,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent)))
    })
  } catch {
    // Renderer có thể đã đóng trong lúc process đang kết thúc.
  }
}

function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(path).toLowerCase())
}

function safeName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || fallback
}

function targetKey(target: MultiLangTarget): string {
  return safeName(`${target.language}-${target.locale}`, target.language)
}

function styleDescription(style: MultiLangStyle): string {
  switch (style) {
    case 'social':
      return 'thân thiện, nói như người bản địa trên TikTok/Reels, câu ngắn và dễ đọc'
    case 'news':
      return 'rõ ràng, súc tích, có nhịp như bản tin ngắn; không giật tít quá mức'
    case 'dramatic':
      return 'có nhịp kể chuyện và điểm nhấn cảm xúc vừa phải, vẫn trung thành nội dung'
    default:
      return 'tự nhiên, gần khẩu ngữ, dễ hiểu và dễ nghe bằng TTS'
  }
}

interface ElevenVoice {
  voice_id?: string
  name?: string
  category?: string
  labels?: Record<string, string>
  description?: string | null
  sharing?: {
    status?: string
    original_voice_id?: string | null
    public_owner_id?: string | null
  } | null
  verified_languages?: Array<{ language_id?: string; language?: string; locale?: string }>
}

interface ElevenModel {
  model_id?: string
  name?: string
  description?: string
  can_do_text_to_speech?: boolean
  can_use_style?: boolean
  languages?: Array<{ language_id?: string; name?: string }>
}

interface ElevenCatalog {
  voices: ElevenVoice[]
  models: ElevenModel[]
}

interface ResolvedVoice {
  voiceId: string
  voiceModel: string
  automaticVoice: boolean
  automaticModel: boolean
}

const AUTO_VOICE_FALLBACK = '21m00Tcm4TlvDq8ikWAM'
const LANGUAGE_ALIASES: Record<string, string[]> = {
  vi: ['vietnamese', 'tiếng việt'],
  en: ['english', 'american', 'british'],
  zh: ['chinese', 'mandarin', '中文', 'tiếng trung'],
  ja: ['japanese', '日本語', 'tiếng nhật'],
  ko: ['korean', '한국어', 'tiếng hàn'],
  es: ['spanish', 'español', 'tiếng tây ban nha'],
  fr: ['french', 'français', 'tiếng pháp'],
  de: ['german', 'deutsch', 'tiếng đức'],
  id: ['indonesian', 'bahasa indonesia', 'tiếng indonesia'],
  th: ['thai', 'ภาษาไทย', 'tiếng thái'],
  pt: ['portuguese', 'português', 'tiếng bồ đào nha'],
  ru: ['russian', 'русский', 'tiếng nga'],
  ar: ['arabic', 'العربية', 'tiếng ả rập']
}

let cachedCatalog: { expiresAt: number; catalog: ElevenCatalog } | null = null

function catalogText(voice: ElevenVoice): string {
  return [
    voice.name,
    voice.description,
    voice.category,
    ...Object.entries(voice.labels ?? {}).flat()
  ].filter(Boolean).join(' ').toLowerCase()
}

function voiceLanguageScore(voice: ElevenVoice, language: string): number {
  const exact = (voice.verified_languages ?? []).some((item) =>
    [item.language_id, item.language, item.locale].some((value) => value?.toLowerCase().startsWith(language.toLowerCase()))
  )
  if (exact) return 120
  const labelLanguage = voice.labels?.language?.toLowerCase() ?? ''
  if (labelLanguage === language.toLowerCase()) return 105
  const text = catalogText(voice)
  if ((LANGUAGE_ALIASES[language] ?? []).some((alias) => text.includes(alias))) return 85
  return 0
}

function voiceStyleScore(voice: ElevenVoice, style: MultiLangStyle): number {
  const text = catalogText(voice)
  const terms: Record<MultiLangStyle, string[]> = {
    social: ['social', 'creator', 'conversational', 'energetic', 'young'],
    news: ['news', 'narrat', 'documentary', 'professional', 'broadcast'],
    dramatic: ['expressive', 'dramatic', 'story', 'warm', 'character'],
    natural: ['natural', 'conversational', 'professional', 'narrat', 'warm']
  }
  return (terms[style] ?? []).reduce((score, term) => score + (text.includes(term) ? 9 : 0), 0)
}

function isCopiedLibraryVoice(voice: ElevenVoice): boolean {
  const sharing = voice.sharing
  return sharing?.status?.toLowerCase() === 'copied'
    || Boolean(sharing?.original_voice_id)
    || Boolean(sharing?.public_owner_id)
}

function chooseVoice(voices: ElevenVoice[], target: MultiLangTarget): { voiceId: string; automatic: boolean } {
  // /v1/voices also returns Voice Library entries copied into the account.
  // Free keys may list those voices but TTS rejects them with HTTP 402
  // paid_plan_required, so auto mode must only rank account/premade voices.
  const candidates = voices.filter((voice) =>
    /^[a-zA-Z0-9_-]{3,160}$/.test(voice.voice_id ?? '') && !isCopiedLibraryVoice(voice)
  )
  if (!candidates.length) return { voiceId: AUTO_VOICE_FALLBACK, automatic: true }
  const ranked = candidates
    .map((voice) => ({
      voice,
      score: voiceLanguageScore(voice, target.language) + voiceStyleScore(voice, target.style) + (voice.category === 'professional' ? 3 : 0)
    }))
    .sort((left, right) => right.score - left.score)
  // Prefer a language match. If the account exposes no language metadata,
  // the best available voice is still a safer fallback than failing a batch.
  const languageMatched = ranked.find(({ voice }) => voiceLanguageScore(voice, target.language) > 0)
  return { voiceId: (languageMatched ?? ranked[0]).voice.voice_id as string, automatic: true }
}

function modelStyleScore(modelId: string, target: MultiLangTarget): number {
  const id = modelId.toLowerCase()
  if (target.style === 'dramatic') {
    if (id.includes('v3')) return 130
    if (id.includes('multilingual')) return 110
    if (id.includes('flash')) return 85
  }
  if (target.style === 'social') {
    if (id.includes('flash')) return 130
    if (id.includes('multilingual')) return 105
    if (id.includes('v3')) return 95
  }
  if (id.includes('multilingual')) return 125
  if (id.includes('flash')) return 115
  if (id.includes('v3')) return 100
  return 10
}

function chooseModel(models: ElevenModel[], target: MultiLangTarget): { modelId: string; automatic: boolean } {
  const candidates = models.filter((model) => model.can_do_text_to_speech !== false && /^[a-zA-Z0-9._-]{3,100}$/.test(model.model_id ?? ''))
  const languageMatched = candidates.filter((model) =>
    (model.languages ?? []).some((language) => language.language_id?.toLowerCase() === target.language.toLowerCase())
  )
  const ranked = (languageMatched.length ? languageMatched : candidates)
    .sort((left, right) => modelStyleScore(right.model_id as string, target) - modelStyleScore(left.model_id as string, target))
  if (ranked[0]?.model_id) return { modelId: ranked[0].model_id, automatic: true }

  // Stable fallback for an account that cannot list models. Flash 2.5 covers
  // Vietnamese; multilingual v2 is the most compatible long-form default.
  if (target.language === 'vi') return { modelId: 'eleven_flash_v2_5', automatic: true }
  if (target.style === 'dramatic') return { modelId: 'eleven_v3', automatic: true }
  return { modelId: DEFAULT_VOICE_MODEL, automatic: true }
}

async function fetchElevenJson<T>(keys: string[], endpoint: string): Promise<T | null> {
  for (const index of rotateIndices(keys.length, elevenKeyCursor)) {
    try {
      const response = await fetch(endpoint, {
        headers: { 'xi-api-key': keys[index] },
        signal: AbortSignal.timeout(20_000)
      })
      if (response.ok) {
        elevenKeyCursor = nextCursor(index, keys.length)
        return await response.json() as T
      }
      if (![401, 403, 429].includes(response.status) && response.status < 500) return null
    } catch {
      // Try the next key; a transient network failure must not pin the batch.
    }
  }
  return null
}

async function loadElevenCatalog(keys: string[]): Promise<ElevenCatalog> {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) return cachedCatalog.catalog
  const [voicesPayload, modelsPayload] = await Promise.all([
    fetchElevenJson<{ voices?: ElevenVoice[] }>(keys, ELEVEN_VOICES_ENDPOINT),
    fetchElevenJson<ElevenModel[]>(keys, ELEVEN_MODELS_ENDPOINT)
  ])
  const catalog = {
    voices: voicesPayload?.voices ?? [],
    models: Array.isArray(modelsPayload) ? modelsPayload : []
  }
  cachedCatalog = { expiresAt: Date.now() + 10 * 60_000, catalog }
  return catalog
}

function resolveVoice(
  catalog: ElevenCatalog,
  target: MultiLangTarget,
  voiceMode: MultiLangRequest['voiceMode'],
  globalVoiceId: string,
  globalVoiceModel: string
): ResolvedVoice {
  const explicitVoiceId = target.voiceId || (voiceMode === 'manual' || globalVoiceId ? globalVoiceId : '')
  const explicitModel = target.voiceModel || (voiceMode === 'manual' || globalVoiceModel !== DEFAULT_VOICE_MODEL ? globalVoiceModel : '')
  const chosenVoice = explicitVoiceId || chooseVoice(catalog.voices, target).voiceId
  const chosenModel = explicitModel || chooseModel(catalog.models, target).modelId
  return {
    voiceId: chosenVoice,
    voiceModel: chosenModel,
    automaticVoice: !explicitVoiceId,
    automaticModel: !explicitModel
  }
}

function validateRequest(raw: MultiLangRequest): MultiLangRequest {
  const videos = [...new Set((raw?.videos ?? []).map((value) => value.trim()).filter(Boolean))]
  if (!videos.length) throw new Error('Vui lòng chọn ít nhất một video nguồn.')
  if (videos.length > 100) throw new Error('Mỗi lượt chỉ hỗ trợ tối đa 100 video nguồn.')
  if (videos.some((video) => !isAbsolute(video) || !isVideoPath(video))) {
    throw new Error('Video nguồn phải là file video có đường dẫn tuyệt đối.')
  }

  const outputDir = raw?.outputDir?.trim()
  if (!outputDir || !isAbsolute(outputDir)) throw new Error('Vui lòng chọn thư mục đầu ra hợp lệ.')

  const targets = (raw?.targets ?? [])
    .filter((target) => target && typeof target.language === 'string' && typeof target.locale === 'string')
    .map((target) => ({
      language: target.language.trim(),
      locale: target.locale.trim(),
      style: target.style ?? 'natural',
      voiceId: target.voiceId?.trim() || undefined,
      voiceModel: target.voiceModel?.trim() || undefined
    }))
    .filter((target) => target.language && target.locale)
  if (!targets.length) throw new Error('Vui lòng chọn ít nhất một ngôn ngữ đầu ra.')
  if (targets.length > 20) throw new Error('Mỗi lượt chỉ hỗ trợ tối đa 20 ngôn ngữ đầu ra.')
  const duplicateTargets = new Set<string>()
  for (const target of targets) {
    if (!DICH_LANGS.some((language) => language.code === target.language)) {
      throw new Error(`Ngôn ngữ không được hỗ trợ: ${target.language}`)
    }
    const key = targetKey(target)
    if (duplicateTargets.has(key)) throw new Error(`Ngôn ngữ đầu ra bị trùng: ${target.locale}`)
    duplicateTargets.add(key)
  }

  const voiceMode = raw?.voiceMode === 'manual' ? 'manual' : 'auto'
  const voiceId = raw?.voiceId?.trim() || ''
  if (voiceMode === 'manual' && (!voiceId || !/^[a-zA-Z0-9_-]{3,160}$/.test(voiceId))) {
    throw new Error('Vui lòng nhập ElevenLabs Voice ID hợp lệ.')
  }
  for (const target of targets) {
    if (target.voiceId && !/^[a-zA-Z0-9_-]{3,160}$/.test(target.voiceId)) {
      throw new Error(`Voice ID cho ${target.locale} không hợp lệ.`)
    }
    if (target.voiceModel && !/^[a-zA-Z0-9._-]{3,100}$/.test(target.voiceModel)) {
      throw new Error(`Model ElevenLabs cho ${target.locale} không hợp lệ.`)
    }
  }
  const blur = raw?.blurRegion
  const blurValues = blur ? [Number(blur.x0), Number(blur.x1), Number(blur.y0), Number(blur.y1)] : []
  if (blur && !blurValues.every((value) => Number.isFinite(value))) {
    throw new Error('Tọa độ vùng làm mờ không hợp lệ.')
  }
  const blurRegion: MultiLangRegion | null = blur
    ? {
        x0: Math.max(0, Math.min(1, Math.min(blurValues[0], blurValues[1]))),
        x1: Math.max(0, Math.min(1, Math.max(blurValues[0], blurValues[1]))),
        y0: Math.max(0, Math.min(1, Math.min(blurValues[2], blurValues[3]))),
        y1: Math.max(0, Math.min(1, Math.max(blurValues[2], blurValues[3])))
      }
    : null
  if (blurRegion && (blurRegion.x1 - blurRegion.x0 < 0.01 || blurRegion.y1 - blurRegion.y0 < 0.01)) {
    throw new Error('Vùng làm mờ quá nhỏ. Hãy kéo chọn lại vùng cần che.')
  }

  const blurMaskPolicy: MultiLangBlurMaskPolicy = raw?.blurMaskPolicy === 'locked' ? 'locked' : 'adaptive'

  const subtitle = raw?.subtitleRegion
  const subtitleValues = subtitle ? [Number(subtitle.x0), Number(subtitle.x1), Number(subtitle.y0), Number(subtitle.y1)] : []
  if (subtitle && !subtitleValues.every((value) => Number.isFinite(value))) {
    throw new Error('Tọa độ vùng hiển thị phụ đề không hợp lệ.')
  }
  const subtitleRegion: MultiLangRegion = subtitle
    ? {
        x0: Math.max(0, Math.min(1, Math.min(subtitleValues[0], subtitleValues[1]))),
        x1: Math.max(0, Math.min(1, Math.max(subtitleValues[0], subtitleValues[1]))),
        y0: Math.max(0, Math.min(1, Math.min(subtitleValues[2], subtitleValues[3]))),
        y1: Math.max(0, Math.min(1, Math.max(subtitleValues[2], subtitleValues[3])))
      }
    : DEFAULT_SUBTITLE_REGION
  if (subtitleRegion.x1 - subtitleRegion.x0 < 0.05 || subtitleRegion.y1 - subtitleRegion.y0 < 0.04) {
    throw new Error('Vùng hiển thị phụ đề quá nhỏ. Hãy kéo chọn lại khung phụ đề.')
  }

  const rawSubtitleStyle: Partial<MultiLangSubtitleStyle> = raw?.subtitleStyle ?? {}
  const color = (value: unknown, fallback: string): string =>
    typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback
  const number = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
  }
  const subtitleStyle: MultiLangSubtitleStyle = {
    textColor: color(rawSubtitleStyle.textColor, DEFAULT_SUBTITLE_STYLE.textColor),
    outlineColor: color(rawSubtitleStyle.outlineColor, DEFAULT_SUBTITLE_STYLE.outlineColor),
    outlinePx: number(rawSubtitleStyle.outlinePx, DEFAULT_SUBTITLE_STYLE.outlinePx, 0, 8),
    bgEnabled: rawSubtitleStyle.bgEnabled === true,
    bgColor: color(rawSubtitleStyle.bgColor, DEFAULT_SUBTITLE_STYLE.bgColor),
    bgOpacity: number(rawSubtitleStyle.bgOpacity, DEFAULT_SUBTITLE_STYLE.bgOpacity, 0, 100),
    fontScale: number(rawSubtitleStyle.fontScale, DEFAULT_SUBTITLE_STYLE.fontScale, 60, 160),
    bold: rawSubtitleStyle.bold !== false,
    italic: rawSubtitleStyle.italic === true,
    shadowPx: number(rawSubtitleStyle.shadowPx, DEFAULT_SUBTITLE_STYLE.shadowPx, 0, 8),
    bgPaddingPx: number(rawSubtitleStyle.bgPaddingPx, DEFAULT_SUBTITLE_STYLE.bgPaddingPx, 4, 32)
  }

  const originalAudioVolume = Number(raw?.originalAudioVolume ?? 0)
  if (!Number.isFinite(originalAudioVolume) || originalAudioVolume < 0 || originalAudioVolume > 100) {
    throw new Error('Âm lượng video gốc phải nằm trong khoảng 0 đến 100%.')
  }

  const translationProvider = raw?.translationProvider === 'openai'
    ? 'openai'
    : raw?.translationProvider === 'ollama'
      ? 'ollama'
      : 'gemini'
  const translationModel = raw?.translationModel?.trim() || 'qwen2.5:7b'
  const translationBaseUrl = raw?.translationBaseUrl?.trim() || 'http://127.0.0.1:11434'

  return {
    videos,
    outputDir,
    targets,
    translationProvider,
    translationModel,
    translationBaseUrl,
    voiceMode,
    voiceId,
    voiceModel: raw?.voiceModel?.trim() || DEFAULT_VOICE_MODEL,
    blurRegion,
    blurMaskPolicy,
    subtitleRegion,
    subtitleStyle,
    originalAudioVolume,
    // Scene splitting invokes an extra decode/split/re-encode pass. Keep the
    // fast, source-timeline path as the default; callers can still opt in
    // explicitly when scene shuffling is required.
    sceneSplit: raw?.sceneSplit === true,
    variantShuffle: raw?.variantShuffle === true,
    whisper: {
      model: raw?.whisper?.model?.trim() || 'large-v3-turbo',
      sourceLanguage: raw?.whisper?.sourceLanguage?.trim() || 'auto',
      preferGpu: raw?.whisper?.preferGpu !== false
    }
  }
}

function ffprobePath(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

function runProcess(command: string, args: string[], job: ActiveJob): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (job.cancelled) {
      reject(new Error('Đã huỷ.'))
      return
    }
    let child: ChildProcess
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    job.child = child
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-16_000) })
    child.once('error', (error) => {
      if (job.child === child) job.child = null
      reject(error)
    })
    child.once('close', (code) => {
      if (job.child === child) job.child = null
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

async function probeVideo(ffprobe: string, video: string, job: ActiveJob): Promise<VideoMeta> {
  const result = await runProcess(
    ffprobe,
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1',
      video
    ],
    job
  )
  if (result.code !== 0) throw new Error(`Không đọc được thông tin video: ${basename(video)}`)
  return {
    width: Number(/codec_type=video[\s\S]*?width=(\d+)/.exec(result.stdout)?.[1]) || Number(/width=(\d+)/.exec(result.stdout)?.[1]) || 0,
    height: Number(/codec_type=video[\s\S]*?height=(\d+)/.exec(result.stdout)?.[1]) || Number(/height=(\d+)/.exec(result.stdout)?.[1]) || 0,
    duration: Number(/duration=([\d.]+)/.exec(result.stdout)?.[1]) || 0
  }
}

function regionPixels(region: MultiLangRegion | null, meta: VideoMeta): BlurRegion[] {
  if (!region || meta.width <= 0 || meta.height <= 0) return []
  const x0 = Math.floor(region.x0 * meta.width / 2) * 2
  const x1 = Math.max(x0 + 2, Math.floor(region.x1 * meta.width / 2) * 2)
  const y0 = Math.floor(region.y0 * meta.height / 2) * 2
  const y1 = Math.max(y0 + 2, Math.floor(region.y1 * meta.height / 2) * 2)
  return [{ x0, x1: Math.min(meta.width, x1), y0, y1: Math.min(meta.height, y1), id: 'multilang-blur', color: '#f4b860' }]
}

async function cleanSourceText(
  input: string,
  outputDir: string,
  ffmpeg: string,
  ffprobe: string,
  region: BlurRegion,
  maskPolicy: MultiLangBlurMaskPolicy,
  preferGpu: boolean,
  job: ActiveJob,
  onProgress: (progress: { percent: number; message: string }) => void
): Promise<string> {
  if (job.cancelled) throw new Error('Đã huỷ.')
  const output = join(outputDir, `${safeName(basename(input).replace(/\.[^.]+$/, ''), 'video')}-text-clean.mp4`)
  const result = await removeTextFromVideo({
    input,
    output,
    ffmpeg,
    ffprobe,
    region,
    maskPolicy,
    preferGpu,
    onProgress
  })
  if (job.cancelled) throw new Error('Đã huỷ.')
  if (!result.ok) {
    throw new Error(result.error || `Không che được phần chữ trong video nguồn: ${basename(input)}`)
  }
  await ensureFile(output)
  return output
}

function sourceSlug(video: string, index: number): string {
  return `${String(index + 1).padStart(3, '0')}-${safeName(basename(video), 'video')}`
}

async function ensureFile(path: string): Promise<void> {
  const file = await stat(path).catch(() => null)
  if (!file?.isFile() || file.size <= 0) throw new Error(`Không tạo được file đầu ra: ${basename(path)}`)
}

async function buildSrtFromCueText(sourceSrt: string, translatedTxt: string, outputSrt: string): Promise<number> {
  const cues = parseSrt(readSrtFile(sourceSrt))
  const lines = parseCueText(await readFile(translatedTxt, 'utf-8'))
  if (lines.length !== cues.length) {
    throw new Error(`TXT bản dịch lệch số cue: SRT có ${cues.length}, TXT có ${lines.length}.`)
  }
  const content = cues
    .map((cue, index) => `${index + 1}\n${cue.a} --> ${cue.b}\n${lines[index]}`)
    .join('\n\n')
  await writeFile(outputSrt, `${content}\n`, 'utf-8')
  return lines.length
}

async function elevenLabsTts(
  keys: string[],
  voiceId: string,
  modelId: string,
  text: string,
  language: string,
  signal: AbortSignal
): Promise<Buffer> {
  let lastError = 'ElevenLabs không trả về audio.'
  for (const index of rotateIndices(keys.length, elevenKeyCursor)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new Error('Đã huỷ.')
      try {
        const body: Record<string, unknown> = {
          text,
          model_id: modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        }
        // Multilingual v2 performs language detection itself; the other current
        // models accept language_code and benefit from the explicit locale.
        if (modelId !== DEFAULT_VOICE_MODEL) body.language_code = language
        await paceElevenRequest()
        const response = await fetch(`${ELEVEN_TTS_ENDPOINT}/${encodeURIComponent(voiceId)}`, {
          method: 'POST',
          headers: {
            accept: 'audio/mpeg',
            'content-type': 'application/json',
            'xi-api-key': keys[index]
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        })
        if (response.ok) {
          elevenKeyCursor = nextCursor(index, keys.length)
          if (keys.length > 1) logInfo(`ElevenLabs key pool: dùng key ${index + 1}/${keys.length}, lượt kế tiếp sẽ xoay vòng.`)
          return Buffer.from(await response.arrayBuffer())
        }
        const detail = (await response.text()).slice(0, 240)
        lastError = response.status === 401 || response.status === 403
          ? 'ElevenLabs API key hoặc Voice ID không hợp lệ.'
          : response.status === 402 && detail.includes('paid_plan_required')
            ? 'Giọng ElevenLabs đã chọn là giọng thư viện, không dùng được với tài khoản Free. Hãy dùng Auto voice/giọng premade hoặc nâng cấp gói ElevenLabs.'
          : response.status === 429
            ? 'ElevenLabs đang giới hạn lượt gọi.'
            : `ElevenLabs lỗi HTTP ${response.status}${detail ? `: ${detail}` : '.'}`
        const shouldRotate = response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500
        if (!shouldRotate) throw new Error(lastError)

        // 429 belongs to the current key: respect Retry-After, then move on.
        // 5xx is normally service-wide, so retry briefly with backoff before
        // spending another key on the same overloaded endpoint.
        if (response.status === 429) {
          await sleep(retryAfterMs(response.headers.get('retry-after'), backoffMs(0, 1_500, 30_000)))
          break
        }
        if (attempt < 2) {
          await sleep(retryAfterMs(response.headers.get('retry-after'), backoffMs(attempt)))
          continue
        }
        break
      } catch (error) {
        if (signal.aborted) throw new Error('Đã huỷ.')
        if (error instanceof Error && error.message === lastError) throw error
        lastError = 'Không kết nối được ElevenLabs hoặc request đã hết thời gian.'
        if (attempt < 2) {
          await sleep(backoffMs(attempt))
          continue
        }
      }
    }
    if (keys.length > 1) logInfo(`ElevenLabs key pool: key ${index + 1}/${keys.length} bị giới hạn/lỗi, chuyển key kế tiếp.`)
  }
  throw new Error(lastError)
}

async function generateVoiceFiles(
  keys: string[],
  voiceId: string,
  voiceModel: string,
  language: string,
  srtPath: string,
  voiceDir: string,
  job: ActiveJob,
  onCue: (done: number, total: number) => void
): Promise<void> {
  const cues = parseSrt(readSrtFile(srtPath))
  if (!cues.length) throw new Error(`SRT không có câu hợp lệ: ${basename(srtPath)}`)
  await mkdir(voiceDir, { recursive: true })
  for (const [index, cue] of cues.entries()) {
    if (job.cancelled) throw new Error('Đã huỷ.')
    const text = cue.chu.replace(/\\N/g, ' ').trim()
    if (!text) throw new Error(`Cue ${index + 1} trong SRT bị trống.`)
    const audio = await elevenLabsTts(keys, voiceId, voiceModel, text, language, job.abortController.signal)
    if (job.cancelled) throw new Error('Đã huỷ.')
    const output = join(voiceDir, `${String(index + 1).padStart(3, '0')}.mp3`)
    await writeFile(output, audio)
    await ensureFile(output)
    onCue(index + 1, cues.length)
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function srtTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const pad = (value: number, width: number): string => String(value).padStart(width, '0')
  return `${pad(Math.floor(milliseconds / 3_600_000), 2)}:${pad(Math.floor((milliseconds % 3_600_000) / 60_000), 2)}:${pad(Math.floor((milliseconds % 60_000) / 1000), 2)},${pad(milliseconds % 1000, 3)}`
}

function concatFileLine(path: string): string {
  return `file '${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
}

async function buildVariantVideo(
  ffmpeg: string,
  scenes: SceneManifest['scenes'],
  output: string,
  job: ActiveJob
): Promise<'gpu' | 'cpu'> {
  const listPath = join(dirname(output), 'variant-concat.txt')
  await writeFile(listPath, `${scenes.map((scene) => concatFileLine(scene.filePath)).join('\n')}\n`, 'utf8')
  const encoders: Array<{ mode: 'gpu' | 'cpu'; args: string[] }> = [
    { mode: 'gpu', args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23'] },
    { mode: 'gpu', args: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] },
    { mode: 'gpu', args: ['-c:v', 'h264_qsv', '-global_quality', '23'] },
    { mode: 'cpu', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'] }
  ]
  let lastError = ''
  for (const encoder of encoders) {
    if (job.cancelled) throw new Error('Đã huỷ.')
    await rm(output, { force: true })
    const result = await runProcess(
      ffmpeg,
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-map', '0:v:0', '-map', '0:a:0?',
        ...encoder.args,
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart', output
      ],
      job
    )
    if (result.code === 0) {
      await ensureFile(output)
      return encoder.mode
    }
    lastError = result.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ''
  }
  throw new Error(`Không tạo được variant scene${lastError ? `: ${lastError}` : '.'}`)
}

async function remapSrtForVariant(
  sourceSrt: string,
  originalScenes: SceneManifest['scenes'],
  orderedScenes: SceneManifest['scenes'],
  outputSrt: string
): Promise<number[]> {
  const cues = parseSrt(readSrtFile(sourceSrt))
  const offsets = new Map<number, number>()
  let cursor = 0
  for (const scene of orderedScenes) {
    offsets.set(scene.index, cursor)
    cursor += scene.durationSeconds
  }

  const mappedCues: Array<{
    originalIndex: number
    startSeconds: number
    endSeconds: number
    text: string
  }> = []
  for (const [index, cue] of cues.entries()) {
    const start = srtTimestampToSeconds(cue.a)
    const end = Math.max(start + 0.05, srtTimestampToSeconds(cue.b))
    const scene = [...originalScenes]
      .map((candidate) => ({
        candidate,
        overlap: Math.max(0, Math.min(end, candidate.endSeconds) - Math.max(start, candidate.startSeconds))
      }))
      .sort((left, right) => right.overlap - left.overlap)[0]?.candidate
    if (!scene || !offsets.has(scene.index)) {
      mappedCues.push({
        originalIndex: index,
        startSeconds: start,
        endSeconds: end,
        text: cue.chu.replace(/\\N/g, '\n')
      })
      continue
    }
    const sceneOffset = offsets.get(scene.index) ?? 0
    const relativeStart = Math.max(0, Math.min(scene.durationSeconds, start - scene.startSeconds))
    const relativeEnd = Math.max(relativeStart + 0.05, Math.min(scene.durationSeconds, end - scene.startSeconds))
    const mappedStart = sceneOffset + relativeStart
    const mappedEnd = Math.min(cursor, Math.max(mappedStart + 0.05, sceneOffset + relativeEnd))
    mappedCues.push({
      originalIndex: index,
      startSeconds: mappedStart,
      endSeconds: mappedEnd,
      text: cue.chu.replace(/\\N/g, '\n')
    })
  }
  mappedCues.sort((left, right) =>
    left.startSeconds - right.startSeconds ||
    left.endSeconds - right.endSeconds ||
    left.originalIndex - right.originalIndex
  )
  const lines = mappedCues.map((cue, index) =>
    `${index + 1}\n${srtTime(cue.startSeconds)} --> ${srtTime(cue.endSeconds)}\n${cue.text}`
  )
  await writeFile(outputSrt, `${lines.join('\n\n')}\n`, 'utf8')
  return mappedCues.map((cue) => cue.originalIndex)
}

async function remapVoiceFilesForVariant(
  sourceVoiceDir: string,
  orderedOriginalCueIndices: number[],
  outputVoiceDir: string
): Promise<void> {
  await mkdir(outputVoiceDir, { recursive: true })
  for (const [index, originalCueIndex] of orderedOriginalCueIndices.entries()) {
    const source = join(sourceVoiceDir, `${String(originalCueIndex + 1).padStart(3, '0')}.mp3`)
    const output = join(outputVoiceDir, `${String(index + 1).padStart(3, '0')}.mp3`)
    await copyFile(source, output)
    await ensureFile(output)
  }
}

function srtTimestampToSeconds(timestamp: string): number {
  const match = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(timestamp.trim())
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

function cancelledResult(outputDir: string, runDir: string, originalSubtitles: string[], outputs: MultiLangOutput[]): MultiLangResult {
  return {
    ok: false,
    cancelled: true,
    outputDir,
    runDir,
    originalSubtitles,
    outputs,
    error: 'Đã dừng tác vụ.'
  }
}

function stopResult(
  outputDir: string,
  runDir: string,
  originalSubtitles: string[],
  outputs: MultiLangOutput[],
  onProgress: (progress: MultiLangProgress) => void,
  totalOutputs: number
): MultiLangResult {
  report(onProgress, {
    phase: 'cancelled',
    percent: 100,
    message: 'Đã dừng pipeline và giải phóng tiến trình đang chạy.',
    completedOutputs: outputs.filter((output) => Boolean(output.videoPath)).length,
    totalOutputs
  })
  return cancelledResult(outputDir, runDir, originalSubtitles, outputs)
}

export function cancelMultiLangShort(): MultiLangCancelResult {
  if (!activeJob) return { ok: true, wasRunning: false }
  const job = activeJob
  job.cancelled = true
  job.abortController.abort()
  cancelSceneSplitter()
  cancelBurn()
  cancelTextRemoval()
  if (job.child) killProcessTree(job.child)
  return { ok: true, wasRunning: true }
}

export async function runMultiLangShort(
  rawRequest: MultiLangRequest,
  onProgress: (progress: MultiLangProgress) => void
): Promise<MultiLangResult> {
  if (activeJob) {
    return {
      ok: false,
      outputDir: rawRequest?.outputDir ?? '',
      originalSubtitles: [],
      outputs: [],
      error: 'Một pipeline đa ngôn ngữ khác đang chạy.'
    }
  }

  const job: ActiveJob = { cancelled: false, child: null, abortController: new AbortController() }
  activeJob = job
  const originalSubtitles: string[] = []
  const outputs: MultiLangOutput[] = []
  const renderSources = new Map<MultiLangOutput, string>()
  const cleanedSources = new Map<string, string>()
  let request: MultiLangRequest | null = null
  let runDir = ''

  try {
    request = validateRequest(rawRequest)
    await mkdir(request.outputDir, { recursive: true })
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) throw new Error('Thiếu FFmpeg. Hãy hoàn tất bước thiết lập ứng dụng trước.')
    const ffprobe = ffprobePath(ffmpeg)
    const keys = await loadElevenLabsKeys()
    if (!keys.length) throw new Error('Chưa có ElevenLabs API key. Hãy lưu API key trong tab này trước khi chạy.')
    const needsAutoVoice = request.voiceMode === 'auto' || request.targets.some((target) => !target.voiceId || !target.voiceModel)
    const elevenCatalog = needsAutoVoice ? await loadElevenCatalog(keys) : { voices: [], models: [] }

    runDir = join(request.outputDir, `multilang-${Date.now()}-${process.pid}`)
    await mkdir(runDir, { recursive: true })
    const totalOutputs = request.videos.length * request.targets.length
    const gpu = await detectGpu()
    const cuda = request.whisper.preferGpu ? await whisperCudaStatus() : { has: false }
    const useCuda = request.whisper.preferGpu && gpu.canAccelerate && cuda.has
    const gpuMode: MultiLangProgress['gpuMode'] = useCuda
      ? 'cuda'
      : gpu.hasNvidia || gpu.canAccelerate
        ? 'cpu-fallback'
        : 'cpu-fallback'

    report(onProgress, {
      phase: 'preparing',
      percent: 2,
      message: useCuda
        ? `Đã chọn Whisper CUDA trên ${gpu.name ?? 'GPU'}. FFmpeg sẽ thử encoder phần cứng trước.`
        : 'Không đủ gói CUDA cho Whisper; sẽ dùng CPU và vẫn thử encoder phần cứng cho FFmpeg.',
      completedOutputs: 0,
      totalOutputs,
      gpuMode
    })

    for (const [sourceIndex, video] of request.videos.entries()) {
      if (job.cancelled) return stopResult(request.outputDir, runDir, originalSubtitles, outputs, onProgress, totalOutputs)
      const slug = sourceSlug(video, sourceIndex)
      const sourceDir = join(runDir, 'sources', slug)
      await mkdir(sourceDir, { recursive: true })
      report(onProgress, {
        phase: 'transcribing',
        percent: 5 + (sourceIndex / request.videos.length) * 20,
        message: `[${sourceIndex + 1}/${request.videos.length}] Đang tạo phụ đề + SRT gốc từ ${basename(video)}…`,
        sourceIndex: sourceIndex + 1,
        sourceCount: request.videos.length,
        completedOutputs: outputs.length,
        totalOutputs,
        gpuMode
      })
      const transcription = await transcribeAudio(
        `multilang-${sourceIndex + 1}`,
        {
          input: video,
          outputDir: sourceDir,
          model: request.whisper.model,
          language: request.whisper.sourceLanguage,
          task: 'transcribe',
          formats: ['srt', 'txt'],
          device: useCuda ? 'cuda' : 'cpu',
          diarize: false,
          speakers: 0,
          quality: 'accurate'
        },
        (progress) => {
          const local = progress.percent >= 0 ? progress.percent / 100 : 0
          report(onProgress, {
            phase: 'transcribing',
            percent: 5 + ((sourceIndex + local) / request!.videos.length) * 20,
            message: `[${sourceIndex + 1}/${request!.videos.length}] ${progress.line ?? 'Đang nhận diện giọng nói…'}`,
            sourceIndex: sourceIndex + 1,
            sourceCount: request!.videos.length,
            completedOutputs: outputs.length,
            totalOutputs,
            gpuMode
          })
        }
      )
      if (!transcription.ok) throw new Error(transcription.error || `Không tạo được SRT: ${basename(video)}`)
      const sourceSrt = transcription.outputs.find((path) => path.toLowerCase().endsWith('.srt'))
      if (!sourceSrt) throw new Error(`Whisper không trả về SRT: ${basename(video)}`)
      const sourceTxt = transcription.outputs.find((path) => path.toLowerCase().endsWith('.txt'))
      if (!sourceTxt) throw new Error(`Whisper không trả về TXT theo cue: ${basename(video)}`)
      const sourceCueCount = parseSrt(readSrtFile(sourceSrt)).length
      const sourceTextCount = parseCueText(await readFile(sourceTxt, 'utf-8')).length
      if (sourceCueCount !== sourceTextCount) {
        throw new Error(`TXT nguồn lệch SRT: SRT có ${sourceCueCount} cue, TXT có ${sourceTextCount} dòng.`)
      }
      originalSubtitles.push(sourceSrt)

      for (const [targetIndex, target] of request.targets.entries()) {
        if (job.cancelled) return stopResult(request.outputDir, runDir, originalSubtitles, outputs, onProgress, totalOutputs)
        const targetSlug = targetKey(target)
        const targetDir = join(runDir, 'packages', slug, targetSlug)
        const srtPath = join(targetDir, `${safeName(basename(video), 'video')}.${targetSlug}.srt`)
        const translatedTxtPath = join(targetDir, `${safeName(basename(video), 'video')}.${targetSlug}.txt`)
        const localizationStyle = `${styleDescription(target.style)}; ưu tiên cách dùng từ phù hợp locale ${target.locale}`
        await mkdir(targetDir, { recursive: true })
        report(onProgress, {
          phase: 'translating',
          percent: 25 + ((sourceIndex * request.targets.length + targetIndex) / totalOutputs) * 20,
          message: `[${sourceIndex + 1}/${request.videos.length}] Bản địa hóa ${target.locale}…`,
          sourceIndex: sourceIndex + 1,
          sourceCount: request.videos.length,
          targetLanguage: target.language,
          targetIndex: targetIndex + 1,
          targetCount: request.targets.length,
          completedOutputs: outputs.length,
          totalOutputs,
          gpuMode
        })
        const localized = request.translationProvider === 'openai'
          ? await localizeOpenAiText(sourceTxt, translatedTxtPath, target.language, localizationStyle, (done, total) => {
              report(onProgress, {
                phase: 'translating',
                percent: 25 + ((sourceIndex * request!.targets.length + targetIndex + done / Math.max(1, total)) / totalOutputs) * 20,
                message: `Đang biên tập ${target.locale}: phần ${done}/${total}…`,
                sourceIndex: sourceIndex + 1,
                sourceCount: request!.videos.length,
                targetLanguage: target.language,
                targetIndex: targetIndex + 1,
                targetCount: request!.targets.length,
                completedOutputs: outputs.length,
                totalOutputs,
                gpuMode
              })
            })
          : request.translationProvider === 'ollama'
            ? await localizeOllamaText(sourceTxt, translatedTxtPath, target.language, localizationStyle, request.translationModel, request.translationBaseUrl, (done, total) => {
                report(onProgress, {
                  phase: 'translating',
                  percent: 25 + ((sourceIndex * request!.targets.length + targetIndex + done / Math.max(1, total)) / totalOutputs) * 20,
                  message: `Đang biên tập ${target.locale}: phần ${done}/${total}…`,
                  sourceIndex: sourceIndex + 1,
                  sourceCount: request!.videos.length,
                  targetLanguage: target.language,
                  targetIndex: targetIndex + 1,
                  targetCount: request!.targets.length,
                  completedOutputs: outputs.length,
                  totalOutputs,
                  gpuMode
                })
              })
            : await localizeGeminiText(sourceTxt, translatedTxtPath, target.language, localizationStyle, (done, total) => {
              report(onProgress, {
                phase: 'translating',
                percent: 25 + ((sourceIndex * request!.targets.length + targetIndex + done / Math.max(1, total)) / totalOutputs) * 20,
                message: `Đang biên tập ${target.locale}: phần ${done}/${total}…`,
                sourceIndex: sourceIndex + 1,
                sourceCount: request!.videos.length,
                targetLanguage: target.language,
                targetIndex: targetIndex + 1,
                targetCount: request!.targets.length,
                completedOutputs: outputs.length,
                totalOutputs,
                gpuMode
              })
            })
        if (!localized.ok) throw new Error(`${target.locale}: ${localized.error || 'Không bản địa hóa được SRT.'}`)
        await buildSrtFromCueText(sourceSrt, translatedTxtPath, srtPath)

        const resolvedVoice = resolveVoice(
          elevenCatalog,
          target,
          request.voiceMode,
          request.voiceId,
          request.voiceModel
        )
        const voiceDir = join(targetDir, 'voice')
        report(onProgress, {
          phase: 'voicing',
          percent: 45 + ((sourceIndex * request.targets.length + targetIndex) / totalOutputs) * 20,
          message: `[${sourceIndex + 1}/${request.videos.length}] Tạo voice ElevenLabs ${target.locale} · ${resolvedVoice.voiceModel}${resolvedVoice.automaticVoice ? ' · auto voice' : ''}…`,
          sourceIndex: sourceIndex + 1,
          sourceCount: request.videos.length,
          targetLanguage: target.language,
          targetIndex: targetIndex + 1,
          targetCount: request.targets.length,
          completedOutputs: outputs.length,
          totalOutputs,
          gpuMode
        })
        await generateVoiceFiles(keys, resolvedVoice.voiceId, resolvedVoice.voiceModel, target.language, srtPath, voiceDir, job, (done, total) => {
          report(onProgress, {
            phase: 'voicing',
            percent: 45 + ((sourceIndex * request!.targets.length + targetIndex + done / Math.max(1, total)) / totalOutputs) * 20,
            message: `Đang tạo voice ${target.locale}: câu ${done}/${total}…`,
            sourceIndex: sourceIndex + 1,
            sourceCount: request!.videos.length,
            targetLanguage: target.language,
            targetIndex: targetIndex + 1,
            targetCount: request!.targets.length,
            completedOutputs: outputs.length,
            totalOutputs,
            gpuMode
          })
        })
        outputs.push({
          sourceVideo: video,
          language: target.language,
          locale: target.locale,
          srtPath,
          voiceDir,
          voiceId: resolvedVoice.voiceId,
          voiceModel: resolvedVoice.voiceModel
        })
      }
    }

    // Phat hien hop sat dong chu va lam mo video nguon dung mot lan truoc khi
    // tach scene. Khung user keo chi la vung tim kiem; khong lam mo toan bo
    // khung do va khong chay phuc hoi/tai tao nen.
    for (const [sourceIndex, video] of request.videos.entries()) {
      if (job.cancelled) return stopResult(request.outputDir, runDir, originalSubtitles, outputs, onProgress, totalOutputs)
      const meta = await probeVideo(ffprobe, video, job)
      if (job.cancelled) return stopResult(request.outputDir, runDir, originalSubtitles, outputs, onProgress, totalOutputs)
      const textRegions = regionPixels(request.blurRegion, meta)
      if (textRegions.length === 0) continue

      const sourceDir = join(runDir, 'sources', sourceSlug(video, sourceIndex))
      await mkdir(sourceDir, { recursive: true })
      report(onProgress, {
        phase: 'blurring',
        percent: 65 + (sourceIndex / request.videos.length) * 1,
        message: `[${sourceIndex + 1}/${request.videos.length}] Đang nhận diện và làm mờ nét chữ trong ${basename(video)}…`,
        sourceIndex: sourceIndex + 1,
        sourceCount: request.videos.length,
        completedOutputs: outputs.length,
        totalOutputs,
        gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
      })
      const cleaned = await cleanSourceText(video, sourceDir, ffmpeg, ffprobe, textRegions[0], request.blurMaskPolicy ?? 'adaptive', gpu.canAccelerate, job, (progress) => {
        const local = progress.percent >= 0 ? progress.percent / 100 : 0
        report(onProgress, {
          phase: 'blurring',
          percent: 65 + ((sourceIndex + local) / request!.videos.length) * 1,
          message: `[${sourceIndex + 1}/${request!.videos.length}] ${progress.message}`,
          sourceIndex: sourceIndex + 1,
          sourceCount: request!.videos.length,
          completedOutputs: outputs.length,
          totalOutputs,
          gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
        })
      })
      cleanedSources.set(video, cleaned)
    }

    const sceneSourceVideos = request.videos.map((video) => cleanedSources.get(video) ?? video)
    let sceneManifest: SceneManifest = { requested: request.sceneSplit, used: false, scenes: [] }
    if (request.sceneSplit) {
      report(onProgress, {
        phase: 'splitting',
        percent: 66,
        message: 'Đang gọi hệ thống Content hiện tại để tách và lập manifest scene…',
        completedOutputs: outputs.length,
        totalOutputs,
        gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
      })
      const status = await sceneSplitterEngineStatus()
      if (status.has && !status.needsUpdate) {
        const sceneDir = join(runDir, 'scenes')
        const sceneResult = await runSceneSplitter(
          { sourceVideos: sceneSourceVideos, outputDir: sceneDir },
          (progress) => report(onProgress, {
            phase: 'splitting',
            percent: 66 + Math.max(0, progress.percent) * 0.06,
            message: progress.message,
            completedOutputs: outputs.length,
            totalOutputs,
            gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
          })
        )
        if (sceneResult.ok && sceneResult.scenes) {
          sceneManifest = {
            requested: true,
            used: true,
            engine: status.version,
            manifestFile: sceneResult.manifestFile,
            scenes: sceneResult.scenes.map((scene) => ({
              index: scene.index,
              sourceVideo: scene.sourceVideo,
              filePath: scene.filePath,
              startSeconds: scene.startSeconds,
              endSeconds: scene.endSeconds,
              durationSeconds: scene.durationSeconds
            })),
            note: 'Scene map được giữ theo timeline gốc để SRT và voice không lệch khi xuất video.'
          }
        } else {
          sceneManifest.note = sceneResult.error || 'Không tách được scene; pipeline tiếp tục bằng video nguồn.'
        }
      } else {
        sceneManifest.note = 'Chưa có PySceneDetect đúng phiên bản; pipeline tiếp tục bằng video nguồn.'
      }
    }

    if (sceneManifest.used && request.variantShuffle && sceneManifest.scenes.length > 1) {
      const variantOrders: NonNullable<SceneManifest['variantOrders']> = []
      for (const output of outputs) {
        if (job.cancelled) return stopResult(request.outputDir, runDir, originalSubtitles, outputs, onProgress, totalOutputs)
        const preparedSource = cleanedSources.get(output.sourceVideo) ?? output.sourceVideo
        const sourceScenes = sceneManifest.scenes
          .filter((scene) => scene.sourceVideo === preparedSource)
          .sort((left, right) => left.startSeconds - right.startSeconds)
        if (sourceScenes.length < 2) {
          variantOrders.push({
            sourceVideo: output.sourceVideo,
            language: output.language,
            locale: output.locale,
            sceneIndices: sourceScenes.map((scene) => scene.index),
            mode: 'timeline'
          })
          continue
        }
        const targetIndex = request.targets.findIndex((target) => target.language === output.language && target.locale === output.locale)
        const shift = Math.max(0, targetIndex) % sourceScenes.length
        const orderedScenes = [...sourceScenes.slice(shift), ...sourceScenes.slice(0, shift)]
        const variantDir = join(runDir, 'variants', sourceSlug(output.sourceVideo, request.videos.indexOf(output.sourceVideo)), targetKey({ language: output.language, locale: output.locale, style: 'natural' }))
        await mkdir(variantDir, { recursive: true })
        const variantSource = join(variantDir, 'variant.mp4')
        report(onProgress, {
          phase: 'mapping',
          percent: 73,
          message: `Đang tạo variant ${output.locale} từ ${orderedScenes.length} scene…`,
          targetLanguage: output.language,
          targetIndex: targetIndex + 1,
          targetCount: request.targets.length,
          completedOutputs: outputs.length,
          totalOutputs,
          gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
        })
        await buildVariantVideo(ffmpeg, orderedScenes, variantSource, job)
        const variantSrt = join(variantDir, `${safeName(basename(output.srtPath), 'subtitle')}.variant.srt`)
        const orderedCueIndices = await remapSrtForVariant(output.srtPath, sourceScenes, orderedScenes, variantSrt)
        const variantVoiceDir = join(variantDir, 'voice')
        await remapVoiceFilesForVariant(output.voiceDir, orderedCueIndices, variantVoiceDir)
        await ensureFile(variantSrt)
        output.srtPath = variantSrt
        output.voiceDir = variantVoiceDir
        renderSources.set(output, variantSource)
        variantOrders.push({
          sourceVideo: output.sourceVideo,
          language: output.language,
          locale: output.locale,
          sceneIndices: orderedScenes.map((scene) => scene.index),
          mode: 'rotated'
        })
      }
      sceneManifest.variantOrders = variantOrders
      sceneManifest.note = 'Scene được xoay theo locale; SRT được remap theo scene order và voice giữ nguyên theo cue.'
    }

    const sceneManifestPath = join(runDir, 'scene-map.json')
    await writeJson(sceneManifestPath, sceneManifest)
    report(onProgress, {
      phase: 'mapping',
      percent: 73,
      message: sceneManifest.used
        ? `Đã map ${sceneManifest.scenes.length} scene với các gói SRT/voice.`
        : 'Đã tạo map timeline; giữ thứ tự nguồn để không làm lệch SRT/voice.',
      completedOutputs: outputs.length,
      totalOutputs,
      gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
    })

    for (const [index, output] of outputs.entries()) {
      if (job.cancelled) return stopResult(request.outputDir, runDir, originalSubtitles, outputs, onProgress, totalOutputs)
      const sourceIndex = request.videos.indexOf(output.sourceVideo)
      const targetIndex = request.targets.findIndex((target) => target.language === output.language && target.locale === output.locale)
      const finalDir = join(runDir, 'exports', sourceSlug(output.sourceVideo, sourceIndex), targetKey({ language: output.language, locale: output.locale, style: 'natural' }))
      await mkdir(finalDir, { recursive: true })
      let renderSource = renderSources.get(output) ?? cleanedSources.get(output.sourceVideo) ?? output.sourceVideo
      const renderMeta = await probeVideo(ffprobe, renderSource, job)
      if (job.cancelled) return stopResult(request.outputDir, runDir, originalSubtitles, outputs, onProgress, totalOutputs)
      report(onProgress, {
        phase: 'rendering',
        percent: 75 + (index / outputs.length) * 24,
        message: `Đang xuất ${index + 1}/${outputs.length}: ${output.locale} · ${basename(output.sourceVideo)}…`,
        sourceIndex: sourceIndex + 1,
        sourceCount: request.videos.length,
        targetLanguage: output.language,
        targetIndex: targetIndex + 1,
        targetCount: request.targets.length,
        completedOutputs: index,
        totalOutputs,
        gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
      })
      const burned = await burnSubtitle(
        {
          video: renderSource,
          srt: output.srtPath,
          outputDir: finalDir,
          mode: 'burn',
          blurRegions: [],
          lamMo: false,
          subRegion: renderMeta.width > 0 && renderMeta.height > 0
            ? (() => {
                const region = request.subtitleRegion ?? DEFAULT_SUBTITLE_REGION
                return {
                  x0: Math.round(renderMeta.width * region.x0),
                  x1: Math.round(renderMeta.width * region.x1),
                  y0: Math.round(renderMeta.height * region.y0),
                  y1: Math.round(renderMeta.height * region.y1)
                }
              })()
            : undefined,
          batAmThanh: true,
          amThanhMode: 'voice-per-cue',
          voiceSyncSrt: output.srtPath,
          voiceDir: output.voiceDir,
          amLuongGoc: request.originalAudioVolume,
          amLuongVoice: 100,
          textColor: request.subtitleStyle?.textColor,
          outlineColor: request.subtitleStyle?.outlineColor,
          outlinePx: request.subtitleStyle?.outlinePx,
          bgEnabled: request.subtitleStyle?.bgEnabled,
          bgColor: request.subtitleStyle?.bgColor,
          bgOpacity: request.subtitleStyle?.bgOpacity,
          fontScale: request.subtitleStyle?.fontScale,
          bold: request.subtitleStyle?.bold,
          italic: request.subtitleStyle?.italic,
          shadowPx: request.subtitleStyle?.shadowPx,
          bgPaddingPx: request.subtitleStyle?.bgPaddingPx
        },
        (progress) => {
          report(onProgress, {
            phase: 'rendering',
            percent: 75 + ((index + Math.max(0, progress.percent) / 100) / outputs.length) * 24,
            message: `Đang mã hóa ${output.locale}: ${progress.percent}%…`,
            sourceIndex: sourceIndex + 1,
            sourceCount: request!.videos.length,
            targetLanguage: output.language,
            targetIndex: targetIndex + 1,
            targetCount: request!.targets.length,
            completedOutputs: index,
            totalOutputs,
            gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
          })
        }
      )
      if (!burned.ok || !burned.output) throw new Error(`${output.locale}: ${burned.error || 'Xuất video thất bại.'}`)
      await ensureFile(burned.output)
      output.videoPath = burned.output
      const preparedSource = cleanedSources.get(output.sourceVideo) ?? output.sourceVideo
      output.sceneCount = sceneManifest.scenes.filter((scene) => scene.sourceVideo === preparedSource).length || undefined
    }

    await writeJson(join(runDir, 'language-packages.json'), { outputs, originalSubtitles, sceneManifest })
    report(onProgress, {
      phase: 'done',
      percent: 100,
      message: `Hoàn tất ${outputs.filter((output) => output.videoPath).length}/${totalOutputs} video theo ngôn ngữ.`,
      completedOutputs: outputs.length,
      totalOutputs,
      gpuMode: gpu.canAccelerate ? 'encoder-gpu' : 'cpu-fallback'
    })
    logInfo(`Pipeline đa ngôn ngữ: xong ${outputs.length} gói đầu ra.`)
    return { ok: true, outputDir: request.outputDir, runDir, originalSubtitles, outputs, scenesManifest: sceneManifestPath }
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : String(reason)
    if (job.cancelled || error === 'Đã huỷ.') return stopResult(request?.outputDir ?? '', runDir, originalSubtitles, outputs, onProgress, request ? request.videos.length * request.targets.length : 0)
    report(onProgress, {
      phase: 'error',
      percent: 100,
      message: error,
      completedOutputs: outputs.filter((output) => Boolean(output.videoPath)).length,
      totalOutputs: request ? request.videos.length * request.targets.length : 0
    })
    return {
      ok: false,
      outputDir: request?.outputDir ?? rawRequest?.outputDir ?? '',
      runDir: runDir || undefined,
      originalSubtitles,
      outputs,
      error
    }
  } finally {
    if (job.child) killProcessTree(job.child)
    if (activeJob === job) activeJob = null
  }
}
