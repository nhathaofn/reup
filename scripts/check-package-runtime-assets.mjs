import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { listPackage } from '@electron/asar'

const packageRoot = resolve(process.argv[2] ?? 'dist/win-unpacked')
const resourcesDir = join(packageRoot, 'resources')
const asarPath = join(resourcesDir, 'app.asar')

if (!existsSync(packageRoot) || !existsSync(asarPath)) {
  console.error(`Khong tim thay goi Electron tai: ${packageRoot}`)
  process.exit(1)
}

const forbiddenNames = new Set([
  'dy-engine',
  'dy-engine.exe',
  'ffmpeg',
  'ffmpeg.exe',
  'ffplay',
  'ffplay.exe',
  'ffprobe',
  'ffprobe.exe',
  'ocr-engine',
  'ocr-engine.exe',
  'video2x',
  'video2x.exe',
  'whisper-engine',
  'whisper-engine.exe',
  'yt-dlp',
  'yt-dlp.exe'
])

function isForbidden(path) {
  const name = basename(path).toLowerCase()
  return name.endsWith('.zip') || forbiddenNames.has(name)
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
const requiredCapCutAdapterFiles = [
  '\\node_modules\\capcut-cli\\package.json',
  '\\node_modules\\capcut-cli\\dist\\index.js',
  '\\node_modules\\capcut-cli\\templates\\_init\\draft_content.json'
]
function unpackedCapCutPath(requiredPath) {
  return join(resourcesDir, 'app.asar.unpacked', ...requiredPath.slice(1).split('\\'))
}

const missingCapCutAdapterFiles = requiredCapCutAdapterFiles.filter(
  (requiredPath) => !asarFiles.includes(requiredPath) && !existsSync(unpackedCapCutPath(requiredPath))
)
const violations = [
  ...packagedFiles.filter(isForbidden),
  ...asarFiles.filter(isForbidden).map((path) => `app.asar:${path}`)
]

if (missingCapCutAdapterFiles.length > 0) {
  console.error('Goi cai dat thieu runtime CapCut adapter trong asar hoac asar.unpacked:')
  for (const missing of missingCapCutAdapterFiles) console.error(`- ${missing}`)
  process.exit(1)
}

if (violations.length > 0) {
  console.error('Goi cai dat dang chua runtime bi cam:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(
  `OK: ${asarFiles.length} tep trong app.asar; khong co engine, ffmpeg executable, yt-dlp hoac ZIP.`
)
console.log('OK: capcut-cli runtime, command entry va template toi thieu da duoc dong goi (asar/unpacked).')
console.log(
  'Luu y: ffmpeg.dll o thu muc goc la thanh phan media cua Electron/Chromium, khong phai FFmpeg runtime cua T-blao.'
)
