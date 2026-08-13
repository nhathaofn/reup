import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, delimiter, dirname, extname, isAbsolute, join } from 'node:path'
import { binDir, downloadFile, extractZip, resolveFfmpeg } from '../deps'
import {
  PYSCENEDETECT_VERSION,
  PYSCENEDETECT_WINDOWS_ASSET_SIZE,
  SCENE_SPLITTER_DEFAULTS,
  type SceneSplitterCancelResult,
  type SceneSplitterDetectorMode,
  type SceneSplitterEngineStatus,
  type SceneSplitterInstallProgress,
  type SceneSplitterInstallResult,
  type SceneSplitterProgress,
  type SceneSplitterRequest,
  type SceneSplitterResult,
  type SceneSplitterScene
} from '../../shared/features/scene-splitter'

const WINDOWS_ASSET_URL =
  'https://github.com/Breakthrough/PySceneDetect/releases/download/v0.7.1/PySceneDetect-0.7.1-win64.zip'
const WINDOWS_ASSET_SHA256 = 'ccf73e4f490101482e2d4b5ffd43aa8323b6e6f3b72c316423b85e42fe54baea'
const WINDOWS_EXECUTABLE_SHA256 = '65b6a62651b985accf5e1f4bc2fa5c36db25d0796ed3f4d12396a2f516d349c5'
const WINDOWS_ASSET_NAME = `PySceneDetect-${PYSCENEDETECT_VERSION}-win64.zip`
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.ts', '.m4v'])
const CAPTURE_TAIL_LIMIT = 64 * 1024

interface ParsedScene {
  sceneNumber: number
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

interface CapturedProcessResult {
  code: number
  stdout: string
  stderr: string
}

interface ActiveJob {
  cancelled: boolean
  child: ChildProcess | null
}

let activeJob: ActiveJob | null = null
let installInProgress: Promise<SceneSplitterInstallResult> | null = null

function managedEngineDir(): string {
  return join(binDir(), 'pyscenedetect')
}

function managedEnginePath(): string {
  return join(managedEngineDir(), process.platform === 'win32' ? 'scenedetect.exe' : 'scenedetect')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function findFile(root: string, fileName: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      const found = await findFile(fullPath, fileName)
      if (found) return found
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return fullPath
    }
  }
  return null
}

function runCapture(
  command: string,
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    job?: ActiveJob
    onOutput?: (text: string) => void
    timeoutMs?: number
  }
): Promise<CapturedProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: options?.env,
      detached: Boolean(options?.job && process.platform !== 'win32'),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (options?.job) options.job.child = child

    let stdout = ''
    let stderr = ''
    const appendTail = (current: string, text: string): string =>
      `${current}${text}`.slice(-CAPTURE_TAIL_LIMIT)
    const forwardOutput = (text: string): void => {
      try {
        options?.onOutput?.(text)
      } catch {
        // Progress is best-effort and must not crash the child-process pipeline.
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout = appendTail(stdout, text)
      forwardOutput(text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr = appendTail(stderr, text)
      forwardOutput(text)
    })
    const timeout = options?.timeoutMs
      ? setTimeout(() => {
          stderr = appendTail(stderr, `\nProcess timed out after ${options.timeoutMs}ms.`)
          killProcessTree(child)
        }, options.timeoutMs)
      : null
    child.once('error', (error) => {
      if (timeout) clearTimeout(timeout)
      if (options?.job?.child === child) options.job.child = null
      reject(error)
    })
    child.once('close', (code) => {
      if (timeout) clearTimeout(timeout)
      if (options?.job?.child === child) options.job.child = null
      resolveResult({ code: code ?? -1, stdout, stderr })
    })
  })
}

function parseVersion(text: string): string | null {
  return text.match(/(?:PySceneDetect|scenedetect)\s+v?(\d+\.\d+\.\d+)/i)?.[1] ?? null
}

async function executableVersion(command: string): Promise<string | null> {
  try {
    const result = await runCapture(command, ['version'], { timeoutMs: 10_000 })
    if (result.code !== 0) return null
    return parseVersion(`${result.stdout}\n${result.stderr}`)
  } catch {
    return null
  }
}

async function resolveEngine(): Promise<{ path: string; version: string; managed: boolean } | null> {
  const localPath = managedEnginePath()
  if (await exists(localPath)) {
    const trusted =
      process.platform !== 'win32' ||
      (await sha256File(localPath).catch(() => '')).toLowerCase() === WINDOWS_EXECUTABLE_SHA256
    if (trusted) {
      const version = await executableVersion(localPath)
      if (version) return { path: localPath, version, managed: true }
    }
  }

  const version = await executableVersion('scenedetect')
  return version ? { path: 'scenedetect', version, managed: false } : null
}

export async function sceneSplitterEngineStatus(): Promise<SceneSplitterEngineStatus> {
  const engine = await resolveEngine()
  return {
    has: engine !== null,
    version: engine?.version ?? null,
    expectedVersion: PYSCENEDETECT_VERSION,
    managed: engine?.managed ?? false,
    needsUpdate: engine !== null && engine.version !== PYSCENEDETECT_VERSION,
    installSupported: process.platform === 'win32',
    platform: process.platform
  }
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolveHash(hash.digest('hex')))
  })
}

async function installEngine(onProgress: (progress: SceneSplitterInstallProgress) => void): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error(
      'Trên macOS/Linux, hãy cài bằng: python -m pip install "scenedetect[opencv]" rồi mở lại ứng dụng.'
    )
  }
  if (activeJob) throw new Error('Không thể cài engine trong khi đang tách cảnh.')

  await mkdir(binDir(), { recursive: true })
  const installRoot = join(binDir(), `.pyscenedetect-install-${process.pid}-${Date.now()}`)
  const zipPath = join(installRoot, WINDOWS_ASSET_NAME)
  const extractDir = join(installRoot, 'extracted')
  const stagedDir = join(binDir(), `.pyscenedetect-staged-${process.pid}-${Date.now()}`)
  const finalDir = managedEngineDir()
  const backupDir = join(binDir(), `.pyscenedetect-backup-${process.pid}-${Date.now()}`)
  let backupCreated = false

  await mkdir(installRoot, { recursive: true })
  try {
    onProgress({ phase: 'downloading', message: 'Đang tải PySceneDetect 0.7.1…', percent: 0 })
    await downloadFile(WINDOWS_ASSET_URL, zipPath, (percent) => {
      onProgress({
        phase: 'downloading',
        message: `Đang tải PySceneDetect 0.7.1… ${percent}%`,
        percent
      })
    })

    onProgress({ phase: 'verifying', message: 'Đang kiểm tra SHA-256 chính thức…', percent: -1 })
    const downloadedSize = (await stat(zipPath)).size
    if (downloadedSize !== PYSCENEDETECT_WINDOWS_ASSET_SIZE) {
      throw new Error(
        `Kích thước gói PySceneDetect không khớp. Nhận ${downloadedSize}; cần ${PYSCENEDETECT_WINDOWS_ASSET_SIZE} byte.`
      )
    }
    const digest = await sha256File(zipPath)
    if (digest.toLowerCase() !== WINDOWS_ASSET_SHA256) {
      throw new Error(`Checksum PySceneDetect không khớp. Nhận ${digest}; cần ${WINDOWS_ASSET_SHA256}.`)
    }

    onProgress({ phase: 'extracting', message: 'Đang giải nén PySceneDetect…', percent: -1 })
    await mkdir(extractDir, { recursive: true })
    await extractZip(zipPath, extractDir)
    const executable = await findFile(extractDir, 'scenedetect.exe')
    if (!executable) throw new Error('Gói PySceneDetect không chứa scenedetect.exe.')

    await rm(stagedDir, { recursive: true, force: true })
    await rename(dirname(executable), stagedDir)
    const stagedVersion = await executableVersion(join(stagedDir, 'scenedetect.exe'))
    if (stagedVersion !== PYSCENEDETECT_VERSION) {
      throw new Error(`Engine vừa tải báo phiên bản ${stagedVersion ?? 'không xác định'}, cần ${PYSCENEDETECT_VERSION}.`)
    }

    onProgress({ phase: 'installing', message: 'Đang kích hoạt engine đã xác minh…', percent: -1 })
    if (await exists(finalDir)) {
      await rm(backupDir, { recursive: true, force: true })
      await rename(finalDir, backupDir)
      backupCreated = true
    }
    try {
      await rename(stagedDir, finalDir)
    } catch (error) {
      if (backupCreated && !(await exists(finalDir))) await rename(backupDir, finalDir)
      throw error
    }
    if (backupCreated) await rm(backupDir, { recursive: true, force: true }).catch(() => undefined)

    onProgress({ phase: 'done', message: `Đã cài PySceneDetect ${PYSCENEDETECT_VERSION}.`, percent: 100 })
  } finally {
    await rm(stagedDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(installRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function installSceneSplitterEngine(
  onProgress: (progress: SceneSplitterInstallProgress) => void
): Promise<SceneSplitterInstallResult> {
  if (installInProgress) return installInProgress
  installInProgress = (async () => {
    try {
      await installEngine(onProgress)
      return { ok: true }
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason)
      onProgress({ phase: 'error', message: error, percent: -1 })
      return { ok: false, error }
    } finally {
      installInProgress = null
    }
  })()
  return installInProgress
}

export function parseSceneCsv(csvText: string): ParsedScene[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const headerIndex = lines.findIndex((line) => line.toLowerCase().includes('scene number'))
  if (headerIndex < 0) return []

  const scenes: ParsedScene[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.startsWith('#')) continue
    const columns = line.split(',').map((column) => column.trim())
    if (columns.length < 7) continue
    const sceneNumber = Number.parseInt(columns[0], 10)
    const startSeconds = Number.parseFloat(columns[3])
    const endSeconds = Number.parseFloat(columns[6])
    if (![sceneNumber, startSeconds, endSeconds].every(Number.isFinite) || endSeconds < startSeconds) continue
    scenes.push({
      sceneNumber,
      startSeconds,
      endSeconds,
      durationSeconds: Number((endSeconds - startSeconds).toFixed(3))
    })
  }
  return scenes
}

function validateRequest(request: SceneSplitterRequest): Required<SceneSplitterRequest> {
  if (!request || !Array.isArray(request.sourceVideos) || request.sourceVideos.length === 0) {
    throw new Error('Vui lòng chọn ít nhất một video nguồn.')
  }
  if (request.sourceVideos.length > 1_000) throw new Error('Mỗi lượt chỉ hỗ trợ tối đa 1.000 video.')
  if (!request.sourceVideos.every((path) => typeof path === 'string')) {
    throw new Error('Danh sách video nguồn không hợp lệ.')
  }
  const sourceVideos = [...new Set(request.sourceVideos.map((path) => path.trim()).filter(Boolean))]
  if (!sourceVideos.length) throw new Error('Danh sách video nguồn không hợp lệ.')
  if (typeof request.outputDir !== 'string') throw new Error('Thư mục lưu phân cảnh không hợp lệ.')
  const outputDir = request.outputDir.trim()
  if (!outputDir) throw new Error('Vui lòng chọn thư mục lưu phân cảnh.')
  if (!isAbsolute(outputDir) || sourceVideos.some((path) => !isAbsolute(path))) {
    throw new Error('Video nguồn và thư mục lưu phải dùng đường dẫn tuyệt đối.')
  }

  const detectorMode = request.detectorMode ?? SCENE_SPLITTER_DEFAULTS.detectorMode
  if (detectorMode !== 'content' && detectorMode !== 'hybrid') {
    throw new Error('Thuật toán chỉ hỗ trợ Content hoặc Hybrid.')
  }
  const thresholdValue = request.thresholdValue ?? SCENE_SPLITTER_DEFAULTS.contentThreshold
  if (!Number.isFinite(thresholdValue) || thresholdValue < 1 || thresholdValue > 60) {
    throw new Error('Ngưỡng Content phải nằm trong khoảng 1 đến 60.')
  }
  const minSceneDuration = request.minSceneDuration ?? SCENE_SPLITTER_DEFAULTS.minSceneDuration
  if (!Number.isFinite(minSceneDuration) || minSceneDuration < 0.1 || minSceneDuration > 10) {
    throw new Error('Thời lượng cảnh tối thiểu phải nằm trong khoảng 0,1 đến 10 giây.')
  }
  return { sourceVideos, outputDir, detectorMode, thresholdValue, minSceneDuration }
}

async function validateInputFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    if (!VIDEO_EXTENSIONS.has(extname(path).toLowerCase())) {
      throw new Error(`Định dạng video không được hỗ trợ: ${basename(path)}`)
    }
    try {
      if (!(await stat(path)).isFile()) throw new Error('not-file')
    } catch {
      throw new Error(`Không tìm thấy video nguồn: ${path}`)
    }
  }
}

function sceneFileName(index: number): string {
  return `scene_${String(index).padStart(3, '0')}.mp4`
}

async function nextSceneIndex(outputDir: string): Promise<number> {
  const entries = await readdir(outputDir)
  let maximum = 0
  for (const entry of entries) {
    const match = /^scene_(\d+)\.mp4$/i.exec(entry)
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10))
  }
  return maximum + 1
}

function errorCode(reason: unknown): string | undefined {
  return reason && typeof reason === 'object' && 'code' in reason
    ? String((reason as NodeJS.ErrnoException).code)
    : undefined
}

async function commitSceneFile(
  sourcePath: string,
  outputDir: string,
  startingIndex: number
): Promise<{ index: number; fileName: string; filePath: string }> {
  let index = startingIndex
  while (index < Number.MAX_SAFE_INTEGER) {
    const fileName = sceneFileName(index)
    const filePath = join(outputDir, fileName)
    try {
      // Job temp lives inside outputDir, so a hard link is fast and CREATE_NEW is no-clobber.
      await link(sourcePath, filePath)
      await rm(sourcePath, { force: true }).catch(() => undefined)
      return { index, fileName, filePath }
    } catch (reason) {
      if (errorCode(reason) === 'EEXIST') {
        index += 1
        continue
      }
      try {
        await copyFile(sourcePath, filePath, constants.COPYFILE_EXCL)
        await rm(sourcePath, { force: true }).catch(() => undefined)
        return { index, fileName, filePath }
      } catch (copyReason) {
        if (errorCode(copyReason) === 'EEXIST') {
          index += 1
          continue
        }
        throw copyReason
      }
    }
  }
  throw new Error('Không thể cấp tên file phân cảnh an toàn.')
}

function detectorArgs(
  detectorMode: SceneSplitterDetectorMode,
  thresholdValue: number,
  minSceneDuration: number
): string[] {
  const minimum = `${minSceneDuration.toFixed(1)}s`
  if (detectorMode === 'hybrid') {
    return [
      'detect-content',
      '-t',
      SCENE_SPLITTER_DEFAULTS.hybridContentThreshold.toFixed(1),
      '-m',
      minimum,
      'detect-adaptive',
      '-t',
      SCENE_SPLITTER_DEFAULTS.hybridAdaptiveThreshold.toFixed(1),
      '-m',
      minimum
    ]
  }
  return ['detect-content', '-t', thresholdValue.toFixed(1), '-m', minimum]
}

function processEnvironment(ffmpegPath: string): NodeJS.ProcessEnv {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const currentPath = process.env[pathKey] ?? ''
  const ffmpegDirectory = isAbsolute(ffmpegPath) ? dirname(ffmpegPath) : ''
  return {
    ...process.env,
    [pathKey]: ffmpegDirectory ? `${ffmpegDirectory}${delimiter}${currentPath}` : currentPath
  }
}

async function probeDuration(ffmpegPath: string, videoPath: string, job: ActiveJob): Promise<number> {
  const ffprobePath = isAbsolute(ffmpegPath)
    ? join(dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    : 'ffprobe'
  try {
    const result = await runCapture(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath],
      { env: processEnvironment(ffmpegPath), job }
    )
    const duration = Number.parseFloat(result.stdout.trim())
    return result.code === 0 && Number.isFinite(duration) ? Number(duration.toFixed(3)) : 0
  } catch {
    return 0
  }
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.unref()
    } else {
      process.kill(-child.pid, 'SIGTERM')
    }
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // Process may already be gone.
    }
  }
}

export function cancelSceneSplitter(): SceneSplitterCancelResult {
  const job = activeJob
  if (!job) return { ok: true, wasRunning: false }
  job.cancelled = true
  if (job.child) killProcessTree(job.child)
  return { ok: true, wasRunning: true }
}

async function writeManifest(outputDir: string, scenes: SceneSplitterScene[]): Promise<string> {
  const manifestFile = join(outputDir, 'scene-splitter.json')
  const temporaryFile = `${manifestFile}.${process.pid}.${Date.now()}.tmp`
  let existing: { scenes?: SceneSplitterScene[] } = { scenes: [] }
  try {
    const text = await readFile(manifestFile, 'utf8')
    try {
      existing = JSON.parse(text) as { scenes?: SceneSplitterScene[] }
    } catch {
      throw new Error(`Danh sách cũ bị lỗi JSON, ứng dụng không ghi đè: ${manifestFile}`)
    }
  } catch (reason) {
    if (errorCode(reason) !== 'ENOENT') throw reason
  }
  const previousScenes = Array.isArray(existing.scenes) ? existing.scenes : []
  await writeFile(
    temporaryFile,
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        outputDir,
        scenes: [...previousScenes, ...scenes]
      },
      null,
      2
    ),
    'utf8'
  )
  await rename(temporaryFile, manifestFile)
  return manifestFile
}

function emitProgress(
  onProgress: (progress: SceneSplitterProgress) => void,
  progress: SceneSplitterProgress
): void {
  try {
    onProgress({ ...progress, percent: Math.max(0, Math.min(100, Math.round(progress.percent))) })
  } catch {
    // Renderer may have closed while the local process is winding down.
  }
}

export async function runSceneSplitter(
  rawRequest: SceneSplitterRequest,
  onProgress: (progress: SceneSplitterProgress) => void
): Promise<SceneSplitterResult> {
  if (activeJob) return { ok: false, error: 'Một tiến trình tách cảnh khác đang chạy.' }
  if (installInProgress) return { ok: false, error: 'PySceneDetect đang được cài đặt. Vui lòng đợi hoàn tất.' }

  const job: ActiveJob = { cancelled: false, child: null }
  activeJob = job
  const temporaryRoots: string[] = []
  const createdScenes: SceneSplitterScene[] = []
  let request: Required<SceneSplitterRequest> | null = null
  let manifestWritten = false
  try {
    request = validateRequest(rawRequest)
    await validateInputFiles(request.sourceVideos)
    const engine = await resolveEngine()
    if (!engine) throw new Error('Chưa cài PySceneDetect. Hãy tải engine ở đầu tab Tách cảnh.')
    if (engine.version !== PYSCENEDETECT_VERSION) {
      throw new Error(
        `PySceneDetect ${engine.version} không tương thích. Chức năng này cần đúng phiên bản ${PYSCENEDETECT_VERSION}.`
      )
    }
    const ffmpegPath = await resolveFfmpeg()
    if (!ffmpegPath) throw new Error('Không tìm thấy FFmpeg. Hãy hoàn tất bước thiết lập ứng dụng trước.')

    await mkdir(request.outputDir, { recursive: true })
    let sceneIndex = await nextSceneIndex(request.outputDir)

    for (let videoIndex = 0; videoIndex < request.sourceVideos.length; videoIndex++) {
      if (job.cancelled) break
      const sourceVideo = request.sourceVideos[videoIndex]
      const sourceName = basename(sourceVideo)
      const jobRoot = join(
        request.outputDir,
        `.scene-splitter-${process.pid}-${Date.now()}-${videoIndex}`
      )
      temporaryRoots.push(jobRoot)
      await mkdir(jobRoot, { recursive: true })
      const csvFile = join(jobRoot, '_scenes.csv')
      const basePercent = (videoIndex / request.sourceVideos.length) * 90
      const videoShare = 90 / request.sourceVideos.length
      const totalVideos = request.sourceVideos.length
      emitProgress(onProgress, {
        phase: 'detecting',
        percent: basePercent,
        message: `[${videoIndex + 1}/${request.sourceVideos.length}] Đang phân tích ${sourceName}…`,
        currentVideo: sourceName,
        currentVideoIndex: videoIndex + 1,
        totalVideos: request.sourceVideos.length,
        scenesCreated: createdScenes.length
      })

      const args = [
        '-i',
        sourceVideo,
        ...detectorArgs(request.detectorMode, request.thresholdValue, request.minSceneDuration),
        'list-scenes',
        '-s',
        '-o',
        jobRoot,
        '-f',
        '_scenes.csv',
        'split-video',
        '-o',
        jobRoot,
        '-hq'
      ]
      let engineOutputTail = ''
      let splittingStarted = false
      let lastEnginePercent = -1
      const forwardEngineProgress = (text: string): void => {
        engineOutputTail = `${engineOutputTail}${text}`.slice(-4_096)
        const splitMarker = engineOutputTail.search(/Splitting video with ffmpeg|Video splitting/i)
        if (!splittingStarted && splitMarker >= 0) {
          splittingStarted = true
          engineOutputTail = engineOutputTail.slice(splitMarker)
          emitProgress(onProgress, {
            phase: 'cutting',
            percent: basePercent + videoShare * 0.45,
            message: `[${videoIndex + 1}/${totalVideos}] Đang cắt ${sourceName}…`,
            currentVideo: sourceName,
            currentVideoIndex: videoIndex + 1,
            totalVideos,
            scenesCreated: createdScenes.length
          })
        }
        const matches = [...engineOutputTail.matchAll(/(?:Progress:\s*|\b)(\d{1,3})%/gi)]
        const parsedPercent = matches.length ? Number(matches[matches.length - 1][1]) : -1
        if (parsedPercent < 0 || parsedPercent > 100 || parsedPercent === lastEnginePercent) return
        lastEnginePercent = parsedPercent
        const stageFraction = splittingStarted
          ? 0.45 + (parsedPercent / 100) * 0.4
          : (parsedPercent / 100) * 0.45
        emitProgress(onProgress, {
          phase: splittingStarted ? 'cutting' : 'detecting',
          percent: basePercent + videoShare * stageFraction,
          message: splittingStarted
            ? `[${videoIndex + 1}/${totalVideos}] Đang cắt ${sourceName}… ${parsedPercent}%`
            : `[${videoIndex + 1}/${totalVideos}] Đang phân tích ${sourceName}… ${parsedPercent}%`,
          currentVideo: sourceName,
          currentVideoIndex: videoIndex + 1,
          totalVideos,
          scenesCreated: createdScenes.length
        })
      }
      const result = await runCapture(engine.path, args, {
        env: processEnvironment(ffmpegPath),
        job,
        onOutput: forwardEngineProgress
      })
      if (job.cancelled) break
      if (result.code !== 0) {
        const detail = result.stderr.trim().slice(-3000) || result.stdout.trim().slice(-3000)
        throw new Error(`PySceneDetect lỗi khi xử lý "${sourceName}" (mã ${result.code}).\n${detail}`)
      }

      const entries = await readdir(jobRoot)
      const splitFiles = entries
        .filter((name) => name.toLowerCase().endsWith('.mp4'))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
        .map((name) => join(jobRoot, name))
      if (!splitFiles.length) {
        throw new Error(`PySceneDetect hoàn tất nhưng không tạo clip nào cho "${sourceName}".`)
      }
      const parsedScenes = parseSceneCsv(await readFile(csvFile, 'utf8').catch(() => ''))

      for (let splitIndex = 0; splitIndex < splitFiles.length; splitIndex++) {
        if (job.cancelled) break
        emitProgress(onProgress, {
          phase: 'finalizing',
          percent: basePercent + videoShare * (0.85 + (splitIndex / splitFiles.length) * 0.15),
          message: `Đang lưu phân cảnh ${splitIndex + 1}/${splitFiles.length} từ ${sourceName}…`,
          currentVideo: sourceName,
          currentVideoIndex: videoIndex + 1,
          totalVideos: request.sourceVideos.length,
          scenesCreated: createdScenes.length
        })
        const committed = await commitSceneFile(splitFiles[splitIndex], request.outputDir, sceneIndex)

        const parsed = parsedScenes[splitIndex]
        const probedDuration =
          parsed && parsed.durationSeconds > 0
            ? parsed.durationSeconds
            : await probeDuration(ffmpegPath, committed.filePath, job)
        const startSeconds = parsed?.startSeconds ?? 0
        const durationSeconds = probedDuration || parsed?.durationSeconds || 0
        createdScenes.push({
          index: committed.index,
          fileName: committed.fileName,
          filePath: committed.filePath,
          sourceVideo,
          startSeconds,
          endSeconds: parsed?.endSeconds ?? Number((startSeconds + durationSeconds).toFixed(3)),
          durationSeconds: Number(durationSeconds.toFixed(3))
        })
        sceneIndex = committed.index + 1
      }
      await rm(jobRoot, { recursive: true, force: true })
      temporaryRoots.splice(temporaryRoots.indexOf(jobRoot), 1)
    }

    if (job.cancelled) {
      const manifestFile = createdScenes.length
        ? await writeManifest(request.outputDir, createdScenes).catch(() => undefined)
        : undefined
      manifestWritten = Boolean(manifestFile)
      emitProgress(onProgress, {
        phase: 'cancelled',
        percent: 0,
        message: 'Đã dừng theo yêu cầu.',
        scenesCreated: createdScenes.length
      })
      return {
        ok: false,
        cancelled: true,
        outputDir: request.outputDir,
        manifestFile,
        totalScenes: createdScenes.length,
        scenes: createdScenes,
        error: 'Đã dừng tiến trình theo yêu cầu.'
      }
    }
    if (!createdScenes.length) throw new Error('Không có phân cảnh nào được tạo.')

    emitProgress(onProgress, {
      phase: 'finalizing',
      percent: 96,
      message: 'Đang ghi danh sách phân cảnh…',
      scenesCreated: createdScenes.length
    })
    const manifestFile = await writeManifest(request.outputDir, createdScenes)
    manifestWritten = true
    emitProgress(onProgress, {
      phase: 'done',
      percent: 100,
      message: `Hoàn tất ${createdScenes.length} phân cảnh.`,
      scenesCreated: createdScenes.length
    })
    return {
      ok: true,
      outputDir: request.outputDir,
      manifestFile,
      totalScenes: createdScenes.length,
      scenes: createdScenes
    }
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : String(reason)
    emitProgress(onProgress, { phase: 'error', percent: 0, message: error })
    let manifestFile: string | undefined
    if (request && createdScenes.length && !manifestWritten) {
      manifestFile = await writeManifest(request.outputDir, createdScenes).catch(() => undefined)
      manifestWritten = Boolean(manifestFile)
    }
    return {
      ok: false,
      error,
      outputDir: request?.outputDir,
      manifestFile,
      totalScenes: createdScenes.length || undefined,
      scenes: createdScenes.length ? createdScenes : undefined
    }
  } finally {
    if (job.child) killProcessTree(job.child)
    for (const temporaryRoot of temporaryRoots) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
    }
    if (activeJob === job) activeJob = null
  }
}
