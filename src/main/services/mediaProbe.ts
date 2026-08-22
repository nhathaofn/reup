import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'

export interface ProbeProcessResult {
  code: number | null
  stdout: string
  stderr: string
}

export type ProbeRunner = (command: string, args: string[], timeoutMs: number) => Promise<ProbeProcessResult>

export interface VideoProbeInfo {
  path: string
  durationUs: number
  width: number
  height: number
  fps: number
}

export function ffprobePathForFfmpeg(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

export function parseAudioDurationUs(stdout: string): number {
  const seconds = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Không đọc được thời lượng voice.')
  return Math.round(seconds * 1_000_000)
}

export function parseVideoProbeJson(path: string, stdout: string): VideoProbeInfo {
  const parsed = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
  const stream = parsed.streams?.[0] ?? {}
  const durationUs = Math.round(Number(parsed.format?.duration) * 1_000_000)
  const width = Number(stream.width)
  const height = Number(stream.height)
  const rate = String(stream.r_frame_rate ?? '30/1').split('/').map(Number)
  const fps = rate[1] ? rate[0] / rate[1] : rate[0]
  if (![durationUs, width, height, fps].every(Number.isFinite) || durationUs <= 0 || width <= 0 || height <= 0 || fps <= 0) {
    throw new Error('Video không có duration/kích thước/fps hợp lệ.')
  }
  return { path, durationUs, width, height, fps }
}

export const runProbe: ProbeRunner = (command, args, timeoutMs) => new Promise((resolve) => {
  let stdout = ''
  let stderr = ''
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const append = (current: string, chunk: Buffer | string): string => `${current}${chunk.toString()}`.slice(-65_536)
  const finish = (code: number | null, fallback = ''): void => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    resolve({ code, stdout, stderr: stderr || fallback })
  }

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    finish(null, error instanceof Error ? error.message : String(error))
    return
  }
  child.stdout?.on('data', (chunk: Buffer | string) => { stdout = append(stdout, chunk) })
  child.stderr?.on('data', (chunk: Buffer | string) => { stderr = append(stderr, chunk) })
  child.on('error', (error) => finish(null, error.message))
  child.on('close', (code) => finish(code))
  timer = setTimeout(() => {
    try { child.kill() } catch { /* process already exited */ }
    finish(null, `FFprobe quá thời gian ${timeoutMs} ms.`)
  }, timeoutMs)
})

export async function requireFfprobePath(): Promise<string> {
  const { resolveFfmpeg } = await import('../deps.ts')
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg/FFprobe.')
  return ffprobePathForFfmpeg(ffmpeg)
}

export async function probeAudioDurationUs(
  filePath: string,
  ffprobe?: string,
  runner: ProbeRunner = runProbe
): Promise<number> {
  const command = ffprobe ?? await requireFfprobePath()
  const result = await runner(command, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], 60_000)
  if (result.code !== 0) throw new Error(`Không đọc được voice: ${result.stderr.trim() || 'FFprobe thất bại.'}`)
  return parseAudioDurationUs(result.stdout)
}

export async function probeVideoMetadata(
  filePath: string,
  ffprobe?: string,
  runner: ProbeRunner = runProbe
): Promise<VideoProbeInfo> {
  const command = ffprobe ?? await requireFfprobePath()
  const result = await runner(command, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', filePath], 60_000)
  if (result.code !== 0) throw new Error(`Không đọc được video: ${result.stderr.trim() || 'FFprobe thất bại.'}`)
  return parseVideoProbeJson(filePath, result.stdout)
}
