import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetParent = join(projectRoot, 'build', 'runtime')
const targetDir = join(targetParent, 'ffmpeg')
const archiveUrl =
  process.env.TBLAO_FFMPEG_BUNDLE_URL?.trim() ||
  'https://github.com/nhathaofn/releases/releases/download/assets-v1/ffmpeg-win.zip'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function run(command, args, env = process.env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk.toString()))
    child.stderr.on('data', (chunk) => (output += chunk.toString()))
    child.once('error', reject)
    child.once('close', (code) => resolveResult({ code: code ?? -1, output }))
  })
}

async function findFile(root, expectedName) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const found = await findFile(path, expectedName)
      if (found) return found
    } else if (entry.name.toLowerCase() === expectedName.toLowerCase()) {
      return path
    }
  }
  return null
}

function versionFromOutput(output) {
  return /(?:ffmpeg|ffprobe)\s+version\s+([^\s]+)/i.exec(output)?.[1] ?? null
}

async function inspectBinary(path) {
  if (!(await exists(path))) return null
  const result = await run(path, ['-version'])
  if (result.code !== 0) return null
  const version = versionFromOutput(result.output)
  const file = await stat(path)
  return version && file.size > 0 ? { version, size: file.size } : null
}

async function inspectBundle(directory) {
  const ffmpegPath = join(directory, 'ffmpeg.exe')
  const ffprobePath = join(directory, 'ffprobe.exe')
  const [ffmpeg, ffprobe] = await Promise.all([inspectBinary(ffmpegPath), inspectBinary(ffprobePath)])
  if (!ffmpeg || !ffprobe || ffmpeg.version !== ffprobe.version) return null
  return { ffmpegPath, ffprobePath, version: ffmpeg.version }
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function download(path) {
  const response = await fetch(archiveUrl, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Không tải được FFmpeg bundle (${response.status}) từ ${archiveUrl}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path))
}

async function extract(zipPath, destination) {
  const env = {
    ...process.env,
    TBLAO_FFMPEG_ZIP_PATH: zipPath,
    TBLAO_FFMPEG_DEST_DIR: destination
  }
  const command =
    '$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $env:TBLAO_FFMPEG_ZIP_PATH -DestinationPath $env:TBLAO_FFMPEG_DEST_DIR -Force'
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], env)
  if (result.code !== 0) throw new Error(`Giải nén FFmpeg bundle thất bại: ${result.output.trim()}`)
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('prepare:ffmpeg:win chỉ chạy trên Windows.')
  }

  const existing = await inspectBundle(targetDir)
  if (existing) {
    console.log(`Đã có FFmpeg/FFprobe đồng bộ trong ${targetDir} (${existing.version}).`)
    return
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'tblao-ffmpeg-'))
  const archivePath = join(tempRoot, 'ffmpeg-win.zip')
  const expandedDir = join(tempRoot, 'expanded')
  const stagedDir = join(targetParent, `.ffmpeg-staged-${process.pid}`)

  try {
    console.log(`Đang tải FFmpeg/FFprobe bundle: ${archiveUrl}`)
    await download(archivePath)
    console.log(`SHA-256 bundle: ${await sha256(archivePath)}`)
    await mkdir(expandedDir, { recursive: true })
    await extract(archivePath, expandedDir)

    const sourceFfmpeg = await findFile(expandedDir, 'ffmpeg.exe')
    const sourceFfprobe = await findFile(expandedDir, 'ffprobe.exe')
    if (!sourceFfmpeg || !sourceFfprobe) throw new Error('Bundle không chứa đủ ffmpeg.exe và ffprobe.exe.')

    await rm(stagedDir, { recursive: true, force: true })
    await mkdir(stagedDir, { recursive: true })
    await copyFile(sourceFfmpeg, join(stagedDir, 'ffmpeg.exe'))
    await copyFile(sourceFfprobe, join(stagedDir, 'ffprobe.exe'))
    const bundle = await inspectBundle(stagedDir)
    if (!bundle) throw new Error('Cặp FFmpeg/FFprobe tải về không cùng phiên bản hoặc không khởi động được.')

    await writeFile(
      join(stagedDir, 'FFMPEG-NOTICE.txt'),
      `T-blao Windows FFmpeg bundle\n\nFFmpeg/FFprobe version: ${bundle.version}\nSource: ${archiveUrl}\nLicense information: https://ffmpeg.org/legal.html\n\nSee THIRD-PARTY-NOTICES.txt in the application for the project notice.\n`,
      'utf8'
    )
    await mkdir(targetParent, { recursive: true })
    await rm(targetDir, { recursive: true, force: true })
    await rename(stagedDir, targetDir)
    console.log(`Đã chuẩn bị cặp FFmpeg/FFprobe ${bundle.version} tại ${targetDir}.`)
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    await rm(stagedDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
