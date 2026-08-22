import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { VoiceSyncEntry, VoiceSyncScanResult } from '../../shared/types'
import { resolveFfmpeg } from '../deps'
import { parseSrt, readSrtFile, srtTimeToSeconds } from './srt'
import { ffprobePathForFfmpeg, probeAudioDurationUs } from './mediaProbe'

const VOICE_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'])
const naturalNameSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

let voiceChild: ChildProcess | null = null
let voiceCancelled = false

function audioFilesIn(entries: { name: string; isFile(): boolean }[]): string[] {
  return entries
    .filter((entry) => entry.isFile() && VOICE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((left, right) => naturalNameSort.compare(left, right))
}

function emptyScan(srtPath: string, voiceDir: string, error: string): VoiceSyncScanResult {
  return {
    ok: false,
    srtPath,
    voiceDir,
    cueCount: 0,
    audioCount: 0,
    matchedCount: 0,
    missingIndices: [],
    invalidIndices: [],
    extraFiles: [],
    entries: [],
    error
  }
}

/**
 * Quet thu muc voice theo thu tu tu nhien va doi chieu 1:1 voi cue SRT.
 * Chi quet file truc tiep trong thu muc, khong quet xuong thu muc con.
 */
export async function scanVoiceSync(srtPath: string, voiceDir: string): Promise<VoiceSyncScanResult> {
  if (!srtPath.trim()) return emptyScan(srtPath, voiceDir, 'Chưa chọn file SRT để lấy mốc thời gian.')
  if (!voiceDir.trim()) return emptyScan(srtPath, voiceDir, 'Chưa chọn thư mục voice.')

  try {
    const cues = parseSrt(readSrtFile(srtPath))
    if (cues.length === 0) return emptyScan(srtPath, voiceDir, 'File SRT không có câu hợp lệ.')

    const directoryEntries = await readdir(voiceDir, { withFileTypes: true })
    const audioNames = audioFilesIn(directoryEntries)
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) return emptyScan(srtPath, voiceDir, 'Thiếu ffmpeg/ffprobe để kiểm tra file voice.')
    const ffprobe = ffprobePathForFfmpeg(ffmpeg)

    const entries: VoiceSyncEntry[] = await Promise.all(
      cues.map(async (cue, index) => {
        const fileName = audioNames[index]
        const startSeconds = srtTimeToSeconds(cue.a)
        const endSeconds = srtTimeToSeconds(cue.b)
        const cueDuration = Math.max(0, endSeconds - startSeconds)
        if (!fileName) {
          return {
            index: index + 1,
            startSeconds,
            endSeconds,
            text: cue.chu.replace(/\\N/g, '\n'),
            status: 'missing'
          }
        }

        const filePath = join(voiceDir, fileName)
        let durationSeconds = 0
        try {
          durationSeconds = (await probeAudioDurationUs(filePath, ffprobe)) / 1_000_000
        } catch {
          durationSeconds = 0
        }
        if (durationSeconds <= 0 || cueDuration <= 0) {
          return {
            index: index + 1,
            startSeconds,
            endSeconds,
            text: cue.chu.replace(/\\N/g, '\n'),
            fileName,
            filePath,
            durationSeconds: durationSeconds || undefined,
            status: 'invalid',
            error: durationSeconds <= 0 ? 'Không đọc được thời lượng voice.' : 'Cue có thời lượng không hợp lệ.'
          }
        }

        return {
          index: index + 1,
          startSeconds,
          endSeconds,
          text: cue.chu.replace(/\\N/g, '\n'),
          fileName,
          filePath,
          durationSeconds,
          fitRatio: durationSeconds / cueDuration,
          status: 'ok'
        }
      })
    )

    const missingIndices = entries.filter((entry) => entry.status === 'missing').map((entry) => entry.index)
    const invalidIndices = entries.filter((entry) => entry.status === 'invalid').map((entry) => entry.index)
    const extraFiles = audioNames.slice(cues.length)
    const matchedCount = entries.filter((entry) => entry.status === 'ok').length

    return {
      ok: missingIndices.length === 0 && invalidIndices.length === 0 && extraFiles.length === 0,
      srtPath,
      voiceDir,
      cueCount: cues.length,
      audioCount: audioNames.length,
      matchedCount,
      missingIndices,
      invalidIndices,
      extraFiles,
      entries,
      error:
        missingIndices.length || invalidIndices.length || extraFiles.length
          ? 'Số file voice chưa khớp chính xác với số câu trong SRT.'
          : undefined
    }
  } catch (error) {
    return emptyScan(
      srtPath,
      voiceDir,
      error instanceof Error ? `Không quét được voice: ${error.message}` : 'Không quét được thư mục voice.'
    )
  }
}

function atempoChain(ratio: number): string[] {
  const filters: string[] = []
  let remaining = ratio
  while (remaining > 2) {
    filters.push('atempo=2')
    remaining /= 2
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  filters.push(`atempo=${Math.max(0.5, Math.min(2, remaining)).toFixed(6)}`)
  return filters
}

function runFfmpeg(ffmpeg: string, args: string[], cwd: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = ''
    let settled = false
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      voiceChild = null
      resolve({ code, stderr })
    }

    const child = spawn(ffmpeg, args, { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    voiceChild = child
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000)
    })
    child.on('error', () => finish(-1))
    child.on('close', (code) => finish(code ?? -1))
  })
}

function scanFailure(scan: VoiceSyncScanResult): string {
  const details: string[] = []
  if (scan.missingIndices.length) details.push(`thiếu câu ${scan.missingIndices.slice(0, 8).join(', ')}`)
  if (scan.invalidIndices.length) details.push(`file lỗi ở câu ${scan.invalidIndices.slice(0, 8).join(', ')}`)
  if (scan.extraFiles.length) details.push(`dư ${scan.extraFiles.length} file`)
  return details.length ? `Voice chưa sẵn sàng: ${details.join('; ')}.` : scan.error ?? 'Voice chưa sẵn sàng.'
}

export interface VoiceTimelineRequest {
  srtPath: string
  voiceDir: string
  workDir: string
  maxDuration?: number
}

export interface VoiceTimelineResult {
  ok: boolean
  outputPath?: string
  error?: string
  scan?: VoiceSyncScanResult
}

/** Tạo một track voice liên tục, mỗi file được đặt vào đúng mốc SRT. */
export async function buildVoiceTimeline(request: VoiceTimelineRequest): Promise<VoiceTimelineResult> {
  voiceCancelled = false
  const scan = await scanVoiceSync(request.srtPath, request.voiceDir)
  if (!scan.ok) return { ok: false, error: scanFailure(scan), scan }
  if (voiceCancelled) return { ok: false, error: 'Đã huỷ.', scan }

  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) return { ok: false, error: 'Thiếu ffmpeg để tạo timeline voice.', scan }

  const maxDuration = request.maxDuration && request.maxDuration > 0 ? request.maxDuration : Number.POSITIVE_INFINITY
  const totalDuration = Math.min(
    maxDuration,
    Math.max(...scan.entries.map((entry) => Math.min(entry.endSeconds, maxDuration)), 0)
  )
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    return { ok: false, error: 'Không xác định được thời lượng timeline voice.', scan }
  }

  const activeEntries = scan.entries.filter(
    (entry) =>
      entry.status === 'ok' &&
      entry.filePath &&
      entry.durationSeconds &&
      entry.startSeconds < totalDuration &&
      entry.endSeconds > entry.startSeconds
  )
  if (activeEntries.length === 0) return { ok: false, error: 'Không có voice nào nằm trong thời lượng video.', scan }

  await mkdir(request.workDir, { recursive: true })
  const outputPath = join(request.workDir, 'voice-timeline.m4a')
  await rm(outputPath, { force: true })

  const inputArgs: string[] = ['-hide_banner', '-loglevel', 'error', '-y']
  const filters: string[] = []
  const concatLabels: string[] = []
  let cursor = 0
  let segmentIndex = 0

  const appendSilence = (duration: number): void => {
    if (duration <= 0.000001) return
    const label = `silence${segmentIndex++}`
    filters.push(
      `anullsrc=r=48000:cl=stereo,atrim=duration=${duration.toFixed(6)},` +
        `asetpts=PTS-STARTPTS[${label}]`
    )
    concatLabels.push(`[${label}]`)
  }

  for (const [inputIndex, entry] of activeEntries.entries()) {
    inputArgs.push('-i', entry.filePath!)
    const cueEnd = Math.min(entry.endSeconds, totalDuration)
    const targetDuration = cueEnd - entry.startSeconds
    if (entry.startSeconds + 0.001 < cursor) {
      return {
        ok: false,
        error: 'SRT cÃ³ cÃ¢u chá»“ng thá»i gian, khÃ´ng thá»ƒ ghÃ©p voice 1:1.',
        scan
      }
    }

    appendSilence(entry.startSeconds - cursor)

    // Keep short TTS clips at their natural speaking rate and pad the rest of
    // the cue with silence. The previous implementation always stretched or
    // compressed every clip to the subtitle duration, which made short
    // sentences unnaturally slow and produced large per-cue speed jumps.
    // A long clip is accelerated only when it cannot fit before the next cue;
    // changing subtitle timings is outside this function's contract.
    const cueDuration = Math.max(0.05, targetDuration)
    const naturalDuration = entry.durationSeconds ?? cueDuration
    // A tiny lead-in keeps the first phoneme away from a hard cue/concat
    // boundary. It is silence, not a trim, so the first word cannot be lost.
    const leadIn = Math.min(0.06, cueDuration * 0.12)
    // If there is a real gap before the next cue, let a natural clip use that
    // gap instead of accelerating it merely because the subtitle box ended.
    // This preserves complete words for translations that are a little longer
    // than the source cue without changing subtitle timestamps.
    const nextStart = activeEntries[inputIndex + 1]
      ? Math.min(activeEntries[inputIndex + 1].startSeconds, totalDuration)
      : totalDuration
    const slotDuration = Math.max(cueDuration, nextStart - entry.startSeconds)
    const availableSpeech = Math.max(0.02, slotDuration - leadIn)
    const speechDuration = Math.min(naturalDuration, availableSpeech)
    const ratio = speechDuration > 0 ? naturalDuration / speechDuration : 1
    const label = `voice${inputIndex}`
    const tempo = ratio > 1.0005 ? `${atempoChain(ratio).join(',')},` : ''
    const fadeDuration = Math.min(0.04, speechDuration / 2)
    const fade =
      fadeDuration >= 0.004
        ? `afade=t=in:st=0:d=${fadeDuration.toFixed(6)},` +
          `afade=t=out:st=${Math.max(0, speechDuration - fadeDuration).toFixed(6)}:d=${fadeDuration.toFixed(6)},`
        : ''
    filters.push(
      `[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
        `${tempo}${fade}adelay=${Math.round(leadIn * 1000)}|${Math.round(leadIn * 1000)},` +
        `atrim=duration=${(leadIn + speechDuration).toFixed(6)},` +
        `asetpts=PTS-STARTPTS[${label}]`
    )
    concatLabels.push(`[${label}]`)

    const trailingSilence = Math.max(0, cueDuration - leadIn - speechDuration)
    if (trailingSilence > 0.004) {
      const silenceLabel = `silenceAfter${segmentIndex++}`
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${trailingSilence.toFixed(6)},` +
          `asetpts=PTS-STARTPTS[${silenceLabel}]`
      )
      concatLabels.push(`[${silenceLabel}]`)
    }
    cursor = Math.max(cueEnd, entry.startSeconds + leadIn + speechDuration)
  }

  appendSilence(totalDuration - cursor)
  filters.push(
    `${concatLabels.join('')}concat=n=${concatLabels.length}:v=0:a=1,` +
      `apad,atrim=duration=${totalDuration.toFixed(6)}[voiceOut]`
  )

  inputArgs.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[voiceOut]',
    '-vn',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    outputPath
  )

  const result = await runFfmpeg(ffmpeg, inputArgs, request.workDir)
  if (voiceCancelled) return { ok: false, error: 'Đã huỷ.', scan }
  if (result.code !== 0) {
    const reason = result.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
    return { ok: false, error: `Tạo timeline voice thất bại${reason ? `: ${reason}` : '.'}`, scan }
  }

  try {
    const outputStat = await stat(outputPath)
    if (outputStat.size < 1024) return { ok: false, error: 'Timeline voice tạo ra bị rỗng.', scan }
  } catch {
    return { ok: false, error: 'Không tìm thấy timeline voice sau khi tạo.', scan }
  }

  return { ok: true, outputPath, scan }
}

export function cancelVoiceTimeline(): void {
  voiceCancelled = true
  if (!voiceChild) return
  try {
    voiceChild.kill()
  } catch {
    /* bo qua */
  }
  voiceChild = null
}
