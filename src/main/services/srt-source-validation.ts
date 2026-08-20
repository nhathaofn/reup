import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import type {
  SourceFingerprint,
  SrtSourceCue
} from '../../shared/features/srt-translator'

export interface FileStat {
  size: number
  modifiedMs: number
  path?: string
}

export interface SourceValidationDeps {
  readText(path: string): Promise<string>
  statFile(path: string): Promise<FileStat>
}

export interface LoadedSrtSource {
  sourcePath: string
  sourceText: string
  fingerprint: SourceFingerprint
  cues: SrtSourceCue[]
  lastCueEndSeconds: number
}

export interface VideoValidationDeps {
  statFile(path: string): Promise<FileStat>
  probeDuration(path: string, signal?: AbortSignal): Promise<number>
}

export interface ValidatedLocalizationSource extends LoadedSrtSource {
  videoPath: string
  videoFingerprint: SourceFingerprint
  videoMimeType: string
  videoDurationSeconds: number
}

export interface ProbeProcessResult {
  code: number
  stdout: string
}

export type SpawnProbe = (
  command: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs: number; windowsHide: true }
) => Promise<ProbeProcessResult>

export interface ProbeVideoDeps {
  resolveFfmpeg(): Promise<string | null>
  spawnProbe: SpawnProbe
}

export const SUPPORTED_GEMINI_VIDEO_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.webm': 'video/webm',
  '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp',
  '.3gpp': 'video/3gpp'
}

export async function nodeStatFile(path: string): Promise<FileStat> {
  const value = await stat(path)
  return { path, size: value.size, modifiedMs: value.mtimeMs }
}

export const productionSourceValidationDeps: SourceValidationDeps = {
  readText: (path) => readFile(path, 'utf8'),
  statFile: nodeStatFile
}

const TIMESTAMP = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/
const SPEAKER_LABEL = /^(\[SPEAKER_\d+\])/u

function invalidSrt(_sourceLabel: string, detail: string): Error {
  return new Error(`SRT không hợp lệ: ${detail}.`)
}

function timestampToSeconds(
  hours: string,
  minutes: string,
  seconds: string,
  milliseconds: string,
  sourceLabel: string
): number {
  const h = Number(hours)
  const m = Number(minutes)
  const s = Number(seconds)
  const ms = Number(milliseconds)
  if (m > 59 || s > 59) {
    throw invalidSrt(sourceLabel, 'timestamp không hợp lệ')
  }
  return h * 3600 + m * 60 + s + ms / 1000
}

export function parseStrictSrtText(sourceText: string, sourceLabel: string): SrtSourceCue[] {
  if (typeof sourceText !== 'string') {
    throw invalidSrt(sourceLabel, 'nội dung không phải văn bản')
  }

  const normalized = sourceText.replace(/^\uFEFF/u, '').replace(/\r\n?/g, '\n')
  const trimmed = normalized.trim()
  if (!trimmed) throw invalidSrt(sourceLabel, 'không có cue')

  const blocks = trimmed.split(/\n[ \t]*\n/u)
  const cues: SrtSourceCue[] = []
  const seenNumbers = new Set<number>()

  for (let index = 0; index < blocks.length; index += 1) {
    const lines = blocks[index].split('\n')
    if (lines.length < 3) throw invalidSrt(sourceLabel, 'cue thiếu dòng bắt buộc')

    const numberText = lines[0].trim()
    if (!/^\d+$/u.test(numberText)) {
      throw invalidSrt(sourceLabel, 'số cue không hợp lệ')
    }
    const n = Number(numberText)
    if (!Number.isSafeInteger(n) || n !== index + 1 || seenNumbers.has(n)) {
      throw invalidSrt(sourceLabel, 'số cue phải liên tục từ 1 đến N')
    }
    seenNumbers.add(n)

    const time = lines[1].trim()
    const match = TIMESTAMP.exec(time)
    if (!match) throw invalidSrt(sourceLabel, 'timestamp không hợp lệ')
    const startSeconds = timestampToSeconds(match[1], match[2], match[3], match[4], sourceLabel)
    const endSeconds = timestampToSeconds(match[5], match[6], match[7], match[8], sourceLabel)
    if (startSeconds >= endSeconds) {
      throw invalidSrt(sourceLabel, 'thời gian bắt đầu phải trước thời gian kết thúc')
    }

    const text = lines.slice(2).join('\n')
    if (!text.trim()) throw invalidSrt(sourceLabel, 'cue không có nội dung')
    const previous = cues[cues.length - 1]
    if (previous && startSeconds < previous.startSeconds) {
      throw invalidSrt(sourceLabel, 'thứ tự thời gian của cue không hợp lệ')
    }

    cues.push({
      n,
      time,
      startSeconds,
      endSeconds,
      text,
      speakerLabel: SPEAKER_LABEL.exec(text)?.[1]
    })
  }

  return cues
}

export async function loadSrtSource(
  sourcePath: string,
  deps: SourceValidationDeps = productionSourceValidationDeps
): Promise<LoadedSrtSource> {
  if (!sourcePath.trim() || extname(sourcePath).toLowerCase() !== '.srt') {
    throw new Error('File nguồn phải có định dạng .srt.')
  }

  let sourceText: string
  let beforeStat: FileStat
  let afterStat: FileStat
  try {
    beforeStat = await deps.statFile(sourcePath)
    sourceText = await deps.readText(sourcePath)
    afterStat = await deps.statFile(sourcePath)
  } catch {
    throw new Error('Không đọc được file SRT nguồn.')
  }

  if (
    beforeStat.size !== afterStat.size ||
    beforeStat.modifiedMs !== afterStat.modifiedMs
  ) {
    throw new Error('File nguồn đã thay đổi. Hãy kiểm tra và phục hồi lại.')
  }

  const cues = parseStrictSrtText(sourceText, sourcePath)
  const { size, modifiedMs } = afterStat
  return {
    sourcePath,
    sourceText,
    fingerprint: { path: sourcePath, size, modifiedMs },
    cues,
    lastCueEndSeconds: cues[cues.length - 1].endSeconds
  }
}

export const spawnProbeProcess: SpawnProbe = (command, args, options) =>
  new Promise((resolvePromise, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, [...args], { windowsHide: options.windowsHide })
    } catch {
      reject(new Error('Không thể chạy FFprobe.'))
      return
    }

    let stdout = ''
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      action()
    }
    const abort = (): void => {
      child.kill()
      finish(() => reject(new Error('Đã hủy kiểm tra video.')))
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error('FFprobe quá thời gian chờ.')))
    }, options.timeoutMs)

    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer | string) => { stdout += String(chunk) })
    child.stderr?.resume()
    child.on('error', () => finish(() => reject(new Error('Không thể chạy FFprobe.'))))
    child.on('close', (code) => finish(() => resolvePromise({ code: code ?? -1, stdout })))
    if (options.signal?.aborted) abort()
  })

export async function probeVideoDuration(
  videoPath: string,
  deps: ProbeVideoDeps,
  signal?: AbortSignal
): Promise<number> {
  const ffmpeg = await deps.resolveFfmpeg()
  if (!ffmpeg) throw new Error('Không tìm thấy FFmpeg/FFprobe.')
  const bareCommand = !ffmpeg.includes('/') && !ffmpeg.includes('\\')
  const ffprobe = bareCommand
    ? 'ffprobe'
    : join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  const result = await deps.spawnProbe(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath
  ], { signal, timeoutMs: 60_000, windowsHide: true })
  const duration = Number(result.stdout.trim())
  if (result.code !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Không đọc được thời lượng video.')
  }
  return duration
}

export async function validateVideoSource(
  videoPath: string,
  source: LoadedSrtSource,
  deps: VideoValidationDeps,
  signal?: AbortSignal
): Promise<ValidatedLocalizationSource> {
  const extension = extname(videoPath).toLowerCase()
  const videoMimeType = SUPPORTED_GEMINI_VIDEO_TYPES[extension]
  if (!videoMimeType) throw new Error('định dạng video không được hỗ trợ.')

  let videoStat: FileStat
  try {
    videoStat = await deps.statFile(videoPath)
  } catch {
    throw new Error('Không đọc được file video.')
  }
  if (!Number.isFinite(videoStat.size) || videoStat.size <= 0) {
    throw new Error('File video rỗng hoặc không hợp lệ.')
  }

  const videoDurationSeconds = await deps.probeDuration(videoPath, signal)
  if (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds <= 0) {
    throw new Error('Thời lượng video không hợp lệ.')
  }
  if (source.lastCueEndSeconds > videoDurationSeconds + 2) {
    throw new Error('phụ đề vượt thời lượng video quá 2 giây.')
  }

  return {
    ...source,
    videoPath,
    videoFingerprint: {
      path: videoPath,
      size: videoStat.size,
      modifiedMs: videoStat.modifiedMs
    },
    videoMimeType,
    videoDurationSeconds
  }
}

export async function assertSourceFingerprint(
  expected: SourceFingerprint,
  statFile: SourceValidationDeps['statFile'] = nodeStatFile
): Promise<void> {
  if (!expected.path.trim()) {
    throw new Error('File nguồn đã thay đổi. Hãy kiểm tra và phục hồi lại.')
  }
  let current: FileStat
  try {
    current = await statFile(expected.path)
  } catch {
    throw new Error('File nguồn đã thay đổi. Hãy kiểm tra và phục hồi lại.')
  }
  const expectedPath = normalize(resolve(expected.path))
  const currentPath = current.path
    ? normalize(resolve(current.path))
    : expectedPath
  if (
    currentPath !== expectedPath ||
    current.size !== expected.size ||
    current.modifiedMs !== expected.modifiedMs
  ) {
    throw new Error('File nguồn đã thay đổi. Hãy kiểm tra và phục hồi lại.')
  }
}
