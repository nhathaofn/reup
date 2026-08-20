import { access, lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

const TIMESTAMP_PATTERN = /^\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}(?:\s+.*)?\s*$/u
const CUE_NUMBER_PATTERN = /^\s*\d+\s*$/u
const NUMBERED_TEXT_FILE_PATTERN = /^\d+\.txt$/u

export interface SrtBatchOutput {
  srtPath: string
  textPath: string
  splitDir: string
  splitFiles: string[]
}

function isMissing(reason: unknown): boolean {
  return (reason as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function assertContained(root: string, target: string, label: string): void {
  const rootPath = resolve(root)
  const targetPath = resolve(target)
  const rel = relative(rootPath, targetPath)
  const normalizeForComparison = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || normalizeForComparison(resolve(rootPath, rel)) !== normalizeForComparison(targetPath)) {
    throw new Error(`${label} nằm ngoài thư mục xuất an toàn.`)
  }
}

async function assertNotLink(path: string, label: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error(`${label} không được là symbolic link/junction.`)
}

function stripSrtFormatting(srtText: string): string[] {
  const lines = srtText.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n')
  const outputLines: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!line.trim()) continue
    if (TIMESTAMP_PATTERN.test(line)) continue

    if (CUE_NUMBER_PATTERN.test(line)) {
      let nextIndex = index + 1
      while (nextIndex < lines.length && !lines[nextIndex]?.trim()) nextIndex += 1
      if (nextIndex < lines.length && TIMESTAMP_PATTERN.test(lines[nextIndex] ?? '')) continue
    }

    outputLines.push(line)
  }

  return outputLines
}

async function ensureSafeTextTarget(path: string, label: string): Promise<void> {
  try {
    await assertNotLink(path, label)
  } catch (reason) {
    if (!isMissing(reason)) throw reason
  }
}

async function ensureSafeSplitDir(splitDir: string, outputDir: string): Promise<void> {
  assertContained(outputDir, splitDir, 'Thư mục Batch')
  try {
    const info = await lstat(splitDir)
    if (info.isSymbolicLink()) throw new Error('Thư mục Batch không được là symbolic link/junction.')
    if (!info.isDirectory()) throw new Error('Đường dẫn thư mục Batch đã tồn tại nhưng không phải thư mục.')
  } catch (reason) {
    if (!isMissing(reason)) throw reason
    await mkdir(splitDir)
  }

  const resolvedOutputDir = await realpath(outputDir)
  const resolvedSplitDir = await realpath(splitDir)
  assertContained(resolvedOutputDir, resolvedSplitDir, 'Thư mục Batch')
}

async function removeStaleNumberedFiles(splitDir: string): Promise<void> {
  const entries = await readdir(splitDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!NUMBERED_TEXT_FILE_PATTERN.test(entry.name)) continue
    const path = join(splitDir, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error(`File Batch cũ không được là symbolic link/junction: ${path}`)
    if (!info.isFile()) throw new Error(`File Batch cũ không phải file: ${path}`)
    await unlink(path)
  }
}

/**
 * Convert one exported SRT into the text artifacts consumed by the batch
 * workflow. This mirrors the user's PowerShell converter while keeping all
 * writes scoped to the SRT's output directory.
 */
export async function materializeSrtBatchOutput(srtPath: string): Promise<SrtBatchOutput> {
  if (extname(srtPath).toLowerCase() !== '.srt') {
    throw new Error(`File đầu vào phải có phần mở rộng .srt: ${srtPath}`)
  }

  const absoluteSrtPath = resolve(srtPath)
  const outputDir = dirname(absoluteSrtPath)
  const fileName = basename(absoluteSrtPath)
  const baseName = fileName.slice(0, fileName.length - extname(fileName).length)
  const textPath = join(outputDir, `${baseName}.txt`)
  const splitDir = join(outputDir, `Batch${baseName}`)

  assertContained(outputDir, textPath, 'File TXT')
  assertContained(outputDir, splitDir, 'Thư mục Batch')
  await access(absoluteSrtPath)

  const srtText = await readFile(absoluteSrtPath, 'utf8')
  const outputLines = stripSrtFormatting(srtText)

  await ensureSafeTextTarget(textPath, 'File TXT')
  await writeFile(textPath, outputLines.length ? `${outputLines.join('\n')}\n` : '', { encoding: 'utf8' })

  await ensureSafeSplitDir(splitDir, outputDir)
  await removeStaleNumberedFiles(splitDir)

  const splitFiles: string[] = []
  for (let index = 0; index < outputLines.length; index += 1) {
    const linePath = join(splitDir, `${index + 1}.txt`)
    await ensureSafeTextTarget(linePath, 'File Batch')
    await writeFile(linePath, outputLines[index] ?? '', { encoding: 'utf8' })
    splitFiles.push(linePath)
  }

  return {
    srtPath: absoluteSrtPath,
    textPath,
    splitDir,
    splitFiles
  }
}
