import { spawn, type ChildProcess } from 'node:child_process'
import { access, constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logError, logInfo } from '../logger'

export interface TextRemovalRegion {
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface TextRemovalProgress {
  percent: number
  message: string
}

export type TextRemovalMaskPolicy = 'adaptive' | 'locked'

export interface TextRemovalOptions {
  input: string
  output: string
  ffmpeg: string
  ffprobe: string
  region: TextRemovalRegion
  maskPolicy?: TextRemovalMaskPolicy
  preferGpu: boolean
  onProgress: (progress: TextRemovalProgress) => void
}

interface PythonRunner {
  command: string
  prefixArgs: string[]
}

let activeChild: ChildProcess | null = null

function fileExists(path: string): Promise<boolean> {
  return new Promise((resolveExists) => access(path, constants.F_OK, (error) => resolveExists(!error)))
}

function scriptCandidates(): string[] {
  // electron-vite runs the main process as CommonJS, while standalone E2E
  // bundles may be ESM. Keep both paths valid instead of evaluating an empty
  // import.meta.url in a CJS bundle before the cwd candidate is checked.
  const thisDir = typeof __dirname === 'string'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))
  return [
    join(process.cwd(), 'scripts', 'text-remove-engine.py'),
    resolve(thisDir, '../../../scripts/text-remove-engine.py'),
    join(process.resourcesPath, 'text-remove', 'text-remove-engine.py')
  ]
}

function pythonCandidates(): Array<{ command: string; prefixArgs: string[] }> {
  const localAppData = process.env.LOCALAPPDATA || ''
  return [
    ...(process.env.TEDIAPROS_PYTHON ? [{ command: process.env.TEDIAPROS_PYTHON, prefixArgs: [] }] : []),
    { command: 'python', prefixArgs: [] },
    { command: 'py', prefixArgs: ['-3.11'] },
    { command: join(localAppData, 'Programs/Python/Python311/python.exe'), prefixArgs: [] },
    { command: join(localAppData, 'Programs/Python/Python310/python.exe'), prefixArgs: [] }
  ]
}

function probePython(candidate: { command: string; prefixArgs: string[] }): Promise<boolean> {
  return new Promise((done) => {
    let child: ChildProcess
    try {
      child = spawn(candidate.command, [...candidate.prefixArgs, '-c', 'import cv2'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      done(false)
      return
    }
    child.once('error', () => done(false))
    child.once('close', (code) => done(code === 0))
  })
}

async function resolveScript(): Promise<string | null> {
  for (const candidate of scriptCandidates()) {
    if (await fileExists(candidate)) return candidate
  }
  return null
}

async function resolvePython(): Promise<PythonRunner | null> {
  for (const candidate of pythonCandidates()) {
    if (await probePython(candidate)) return candidate
  }
  return null
}

function safeProgress(onProgress: (progress: TextRemovalProgress) => void, progress: TextRemovalProgress): void {
  try {
    onProgress({ percent: Math.max(0, Math.min(100, Math.round(progress.percent))), message: progress.message })
  } catch {
    // Renderer may close while the worker is finishing.
  }
}

export async function removeTextFromVideo(options: TextRemovalOptions): Promise<{ ok: boolean; error?: string }> {
  if (activeChild) return { ok: false, error: 'Đang xóa chữ ở video khác.' }
  const [script, python] = await Promise.all([resolveScript(), resolvePython()])
  if (!script) return { ok: false, error: 'Không tìm thấy engine xóa chữ cục bộ.' }
  if (!python) {
    return {
      ok: false,
      error: 'Chưa có Python có OpenCV (cv2). Cài Python 3.11 rồi chạy: python -m pip install opencv-python.'
    }
  }

  const args = [
    ...python.prefixArgs,
    script,
    '--input', options.input,
    '--output', options.output,
    '--ffmpeg', options.ffmpeg,
    '--ffprobe', options.ffprobe,
    '--x0', String(Math.round(options.region.x0)),
    '--x1', String(Math.round(options.region.x1)),
    '--y0', String(Math.round(options.region.y0)),
    '--y1', String(Math.round(options.region.y1)),
    '--margin', '8',
    '--radius', '8',
    '--mask-policy', options.maskPolicy === 'locked' ? 'locked' : 'adaptive'
  ]
  if (options.preferGpu) args.push('--prefer-gpu')

  return new Promise((resolveResult) => {
    let child: ChildProcess
    try {
      child = spawn(python.command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      })
    } catch (error) {
      resolveResult({ ok: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    activeChild = child
    let stdoutBuffer = ''
    let stderrTail = ''
    let doneOutput = false

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const value = JSON.parse(line) as { type?: string; percent?: number; text?: string; message?: string }
          if (value.type === 'progress') {
            safeProgress(options.onProgress, { percent: value.percent ?? 0, message: value.text ?? 'Đang xóa chữ…' })
          } else if (value.type === 'status') {
            safeProgress(options.onProgress, { percent: 0, message: value.message ?? 'Đang chuẩn bị xóa chữ…' })
          } else if (value.type === 'done') {
            doneOutput = true
          } else if (value.type === 'error') {
            stderrTail = `${stderrTail}\n${value.message ?? ''}`.slice(-4000)
          }
        } catch {
          // Ignore non-JSON diagnostic lines.
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}\n${chunk.toString('utf8')}`.slice(-4000)
    })
    child.once('error', (error) => {
      if (activeChild === child) activeChild = null
      resolveResult({ ok: false, error: error.message })
    })
    child.once('close', (code) => {
      if (activeChild === child) activeChild = null
      if (code === 0 && doneOutput) {
        logInfo('Dịch màn hình: đã làm mờ chữ cũ theo mask.')
        resolveResult({ ok: true })
        return
      }
      if (code === null) {
        resolveResult({ ok: false, error: 'Đã hủy bước xóa chữ.' })
        return
      }
      const error = stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || `engine code ${code}`
      logError(`Dịch màn hình: xóa chữ thất bại: ${error}`)
      resolveResult({ ok: false, error })
    })
  })
}

export function cancelTextRemoval(): void {
  if (!activeChild) return
  activeChild.kill()
  activeChild = null
}
