import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { resolveFfmpeg } from '../deps'
import type {
  AutoShortClip,
  AutoShortProgress,
  AutoShortRequest,
  AutoShortResult
} from '../../shared/features/auto-short'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.ts', '.m4v'])

interface ActiveJob {
  cancelled: boolean
  child: ChildProcess | null
}

interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

let activeJob: ActiveJob | null = null

function isPathInsideVideoInput(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(path).toLowerCase())
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function ffprobePath(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

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

function report(onProgress: (progress: AutoShortProgress) => void, progress: AutoShortProgress): void {
  try {
    onProgress({
      ...progress,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent)))
    })
  } catch {
    // Renderer may have closed while FFmpeg is winding down.
  }
}

function runProcess(
  command: string,
  args: string[],
  job: ActiveJob,
  onProgress?: (line: string) => void
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    job.child = child
    let stderr = ''
    let stdout = ''
    let stdoutBuffer = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      stdoutBuffer += text
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) onProgress?.(line.trim())
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-16_000)
    })
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

async function probeDuration(ffprobe: string, video: string, job: ActiveJob): Promise<number> {
  const result = await runProcess(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video],
    job
  )
  if (result.code !== 0) return 0
  const value = Number.parseFloat(result.stdout.trim())
  return Number.isFinite(value) && value > 0 ? value : 0
}

function cleanBaseName(video: string): string {
  const name = basename(video, extname(video)).replace(/[^a-zA-Z0-9._-]+/g, '-')
  return name.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'video'
}

async function uniqueOutputPath(outputDir: string, base: string, clipNumber: number): Promise<string> {
  const stem = `${base}-short-${String(clipNumber).padStart(3, '0')}`
  let candidate = join(outputDir, `${stem}.mp4`)
  let suffix = 2
  while (await pathExists(candidate)) {
    candidate = join(outputDir, `${stem}-${suffix}.mp4`)
    suffix += 1
  }
  return candidate
}

function validateRequest(rawRequest: AutoShortRequest): AutoShortRequest {
  const videos = [...new Set((rawRequest?.videos ?? []).map((path) => path.trim()).filter(Boolean))]
  if (!videos.length) throw new Error('Vui lòng chọn ít nhất một video.')
  if (videos.some((path) => !isAbsolute(path) || !isPathInsideVideoInput(path))) {
    throw new Error('Danh sách đầu vào có file không phải video hoặc đường dẫn không hợp lệ.')
  }

  const outputDir = rawRequest?.outputDir?.trim()
  if (!outputDir || !isAbsolute(outputDir)) throw new Error('Vui lòng chọn thư mục đầu ra hợp lệ.')

  const clipSeconds = Number(rawRequest?.clipSeconds)
  if (![15, 30, 60].includes(clipSeconds)) throw new Error('Độ dài short không hợp lệ.')

  return {
    videos,
    outputDir,
    clipSeconds: clipSeconds as AutoShortRequest['clipSeconds'],
    layout: rawRequest?.layout === 'source' ? 'source' : 'vertical'
  }
}

export function cancelAutoShort(): { ok: boolean; wasRunning: boolean } {
  if (!activeJob) return { ok: true, wasRunning: false }
  activeJob.cancelled = true
  if (activeJob.child) killProcessTree(activeJob.child)
  return { ok: true, wasRunning: true }
}

export async function runAutoShort(
  rawRequest: AutoShortRequest,
  onProgress: (progress: AutoShortProgress) => void
): Promise<AutoShortResult> {
  if (activeJob) {
    return { ok: false, outputDir: rawRequest?.outputDir ?? '', files: [], clips: [], error: 'Một tác vụ Auto Short khác đang chạy.' }
  }

  const job: ActiveJob = { cancelled: false, child: null }
  activeJob = job
  const createdClips: AutoShortClip[] = []
  let outputDir = rawRequest?.outputDir?.trim() ?? ''

  try {
    const request = validateRequest(rawRequest)
    outputDir = request.outputDir
    await mkdir(outputDir, { recursive: true })
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) throw new Error('Không tìm thấy FFmpeg. Hãy chạy bước cài đặt trước.')

    const ffprobe = ffprobePath(ffmpeg)
    const durations: number[] = []
    let totalClips = 0
    for (let index = 0; index < request.videos.length; index += 1) {
      if (job.cancelled) {
        return { ok: false, cancelled: true, outputDir, files: [], clips: [], error: 'Đã dừng tác vụ.' }
      }
      const video = request.videos[index]
      const file = await stat(video).catch(() => null)
      if (!file?.isFile()) throw new Error(`Không tìm thấy video: ${basename(video)}`)
      const duration = await probeDuration(ffprobe, video, job)
      if (duration <= 0) throw new Error(`Không đọc được thời lượng video: ${basename(video)}`)
      durations.push(duration)
      totalClips += Math.ceil(duration / request.clipSeconds)
      report(onProgress, {
        phase: 'preparing',
        percent: 5 + ((index + 1) / request.videos.length) * 10,
        message: `Đang phân tích ${basename(video)}…`,
        currentVideo: video,
        totalClips,
        completedClips: 0
      })
    }

    let completedClips = 0
    for (let videoIndex = 0; videoIndex < request.videos.length; videoIndex += 1) {
      const video = request.videos[videoIndex]
      const duration = durations[videoIndex]
      const clipCount = Math.ceil(duration / request.clipSeconds)
      const base = cleanBaseName(video)

      for (let clipIndex = 0; clipIndex < clipCount; clipIndex += 1) {
        if (job.cancelled) {
          return {
            ok: false,
            cancelled: true,
            outputDir,
            files: createdClips.map((clip) => clip.output),
            clips: createdClips,
            error: 'Đã dừng tác vụ.'
          }
        }

        const startSeconds = clipIndex * request.clipSeconds
        const durationSeconds = Math.min(request.clipSeconds, duration - startSeconds)
        const output = await uniqueOutputPath(outputDir, base, clipIndex + 1)
        const temporaryOutput = `${output}.${process.pid}.part.mp4`
        await rm(temporaryOutput, { force: true })
        const filter = request.layout === 'vertical'
          ? ['-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920']
          : []
        report(onProgress, {
          phase: 'processing',
          percent: 15 + (completedClips / Math.max(1, totalClips)) * 85,
          message: `Đang tạo short ${clipIndex + 1}/${clipCount} từ ${basename(video)}…`,
          currentVideo: video,
          currentClip: clipIndex + 1,
          totalClips,
          completedClips
        })

        const result = await runProcess(
          ffmpeg,
          [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            startSeconds.toFixed(3),
            '-i',
            video,
            '-t',
            durationSeconds.toFixed(3),
            ...filter,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            '-progress',
            'pipe:1',
            '-nostats',
            temporaryOutput
          ],
          job,
          (line) => {
            const match = /^out_time_ms=(\d+)$/.exec(line)
            if (!match || job.cancelled) return
            const segmentProgress = Math.min(1, Number(match[1]) / 1_000_000 / durationSeconds)
            report(onProgress, {
              phase: 'processing',
              percent: 15 + ((completedClips + segmentProgress) / Math.max(1, totalClips)) * 85,
              message: `Đang mã hóa short ${clipIndex + 1}/${clipCount}…`,
              currentVideo: video,
              currentClip: clipIndex + 1,
              totalClips,
              completedClips
            })
          }
        )

        if (job.cancelled) {
          await rm(temporaryOutput, { force: true })
          return {
            ok: false,
            cancelled: true,
            outputDir,
            files: createdClips.map((clip) => clip.output),
            clips: createdClips,
            error: 'Đã dừng tác vụ.'
          }
        }
        if (result.code !== 0) {
          await rm(temporaryOutput, { force: true })
          const detail = result.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
          throw new Error(detail || `FFmpeg không tạo được short ${clipIndex + 1}.`)
        }

        const outputStat = await stat(temporaryOutput).catch(() => null)
        if (!outputStat?.isFile() || outputStat.size === 0) {
          await rm(temporaryOutput, { force: true })
          throw new Error(`FFmpeg tạo file rỗng cho short ${clipIndex + 1}.`)
        }
        await rename(temporaryOutput, output)
        createdClips.push({ source: video, output, startSeconds, durationSeconds })
        completedClips += 1
      }
    }

    report(onProgress, {
      phase: 'done',
      percent: 100,
      message: `Hoàn tất ${createdClips.length} short.`,
      totalClips,
      completedClips
    })
    return {
      ok: true,
      outputDir,
      files: createdClips.map((clip) => clip.output),
      clips: createdClips
    }
  } catch (reason) {
    if (job.cancelled) {
      return {
        ok: false,
        cancelled: true,
        outputDir,
        files: createdClips.map((clip) => clip.output),
        clips: createdClips,
        error: 'Đã dừng tác vụ.'
      }
    }
    const error = reason instanceof Error ? reason.message : String(reason)
    report(onProgress, {
      phase: 'error',
      percent: 100,
      message: error,
      totalClips: createdClips.length,
      completedClips: createdClips.length
    })
    return { ok: false, outputDir, files: createdClips.map((clip) => clip.output), clips: createdClips, error }
  } finally {
    if (job.child) killProcessTree(job.child)
    if (activeJob === job) activeJob = null
  }
}
