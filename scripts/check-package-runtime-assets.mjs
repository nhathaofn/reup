import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { listPackage } from '@electron/asar'

const packageRoot = resolve(process.argv[2] ?? 'dist/win-unpacked')
const resourcesDir = join(packageRoot, 'resources')
const asarPath = join(resourcesDir, 'app.asar')
const ffmpegDir = join(resourcesDir, 'ffmpeg')

if (!existsSync(packageRoot) || !existsSync(asarPath)) {
  console.error(`Khong tim thay goi Electron tai: ${packageRoot}`)
  process.exit(1)
}

for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
  const path = join(ffmpegDir, name)
  if (!existsSync(path) || statSync(path).size === 0) {
    console.error(`Gói Windows thiếu runtime bắt buộc: resources/ffmpeg/${name}`)
    process.exit(1)
  }
}

const forbiddenNames = new Set([
  'dy-engine',
  'dy-engine.exe',
  'ffplay',
  'ffplay.exe',
  'ocr-engine',
  'ocr-engine.exe',
  'video2x',
  'video2x.exe',
  'whisper-engine',
  'whisper-engine.exe',
  'yt-dlp',
  'yt-dlp.exe'
])
const forbiddenPathTokens = ['capcut-cli', '.capcut-cli-history']

function isForbidden(path) {
  const name = basename(path).toLowerCase()
  const normalized = path.toLowerCase()
  return name.endsWith('.zip') || forbiddenNames.has(name) || forbiddenPathTokens.some((token) => normalized.includes(token))
}

function walk(directory, results = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, results)
    else results.push(path)
  }
  return results
}

const packagedFiles = walk(resourcesDir).filter((path) => path !== asarPath)
const asarFiles = listPackage(asarPath)
const violations = [
  ...packagedFiles.filter(isForbidden),
  ...asarFiles.filter(isForbidden).map((path) => `app.asar:${path}`)
]

const misplacedFfmpeg = [
  ...packagedFiles.filter((path) => {
    const name = basename(path).toLowerCase()
    return (name === 'ffmpeg.exe' || name === 'ffprobe.exe') && !path.toLowerCase().startsWith(ffmpegDir.toLowerCase() + '\\')
  }),
  ...asarFiles
    .filter((path) => ['ffmpeg.exe', 'ffprobe.exe'].includes(basename(path).toLowerCase()))
    .map((path) => `app.asar:${path}`)
]
violations.push(...misplacedFfmpeg)

if (violations.length > 0) {
  console.error('Goi cai dat dang chua runtime bi cam:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(
  `OK: ${asarFiles.length} tep trong app.asar; FFmpeg/FFprobe nằm tại resources/ffmpeg, không có engine, yt-dlp hoặc ZIP.`
)
console.log('OK: native CapCut generator duoc dong goi trong app.asar.')
console.log(
  'Luu y: ffmpeg.dll o thu muc goc la thanh phan media cua Electron/Chromium, khong phai FFmpeg runtime cua TediaPros.'
)
