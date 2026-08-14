import {
  access,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve, win32 } from 'node:path'

export const CAPCUT_PORTABLE_MANIFEST = 'tblao-portable.json'

interface PortableManifest {
  schemaVersion: 1
  kind: 'tblao.capcut.portable'
  projectName: string
  sourceProjectPath: string
  sourceDraftsDir: string
  assetFiles: string[]
  createdAt: string
  repairedAt?: string
}

export interface CapCutPortabilityResult {
  ok: boolean
  projectPath: string
  manifestPath?: string
  updatedFiles: number
  rewrittenPaths: number
  missingAssets: string[]
  warnings: string[]
  error?: string
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function normalizeWindowsPath(value: string): string {
  return win32.normalize(value.replaceAll('/', '\\')).replace(/[\\]+$/, '')
}

function pathKey(value: string): string {
  return normalizeWindowsPath(value).toLocaleLowerCase()
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = pathKey(root)
  const normalizedCandidate = pathKey(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}\\`)
}

function relativeAssetPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '')
}

function isSafeAssetFile(value: string): boolean {
  const normalized = relativeAssetPath(value)
  const parts = normalized.split('/')
  return parts[0]?.toLocaleLowerCase() === 'assets' && !parts.includes('..') && !normalized.includes('\u0000')
}

function assetSuffixMatch(value: string, assetFiles: readonly string[]): string | null {
  const normalized = pathKey(value)
  for (const rawAsset of assetFiles) {
    const asset = relativeAssetPath(rawAsset)
    const suffix = `\\${asset.replaceAll('/', '\\')}`.toLocaleLowerCase()
    if (normalized.endsWith(suffix)) return asset
    if (normalized === asset.toLocaleLowerCase()) return asset
  }
  return null
}

function inferSourceRoot(values: readonly string[], assetFiles: readonly string[]): string | null {
  for (const value of values) {
    if (!/^[a-z]:[\\/]/i.test(value) && !value.startsWith('\\\\')) continue
    const asset = assetSuffixMatch(value, assetFiles)
    if (!asset) continue
    const normalizedValue = normalizeWindowsPath(value)
    const suffix = `\\${asset.replaceAll('/', '\\')}`
    if (normalizedValue.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) {
      return normalizedValue.slice(0, -suffix.length)
    }
  }
  return null
}

async function listRelativeFiles(root: string, prefix = ''): Promise<string[]> {
  if (!(await isFile(root)) && !(await isDirectory(root))) return []
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) result.push(...(await listRelativeFiles(child, relativePath)))
    else if (entry.isFile()) result.push(relativePath)
  }
  return result
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

function collectStringValues(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output)
    return
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectStringValues(item, output)
  }
}

function rewriteJson(
  value: unknown,
  key: string | null,
  currentProjectPath: string,
  sourceProjectPath: string | null,
  assetFiles: readonly string[],
  counters: { rewrittenPaths: number }
): unknown {
  if (typeof value === 'string') {
    let replacement: string | null = null
    if (key === 'draft_fold_path' || key === 'draft_project_path' || key === 'draft_root_folder') {
      replacement = currentProjectPath
    } else if (key === 'draft_json_file') {
      replacement = join(currentProjectPath, 'draft_content.json')
    } else if (key === 'draft_root_path') {
      replacement = dirname(currentProjectPath)
    } else if (sourceProjectPath && isWithin(sourceProjectPath, value)) {
      const relativePath = win32.relative(
        normalizeWindowsPath(sourceProjectPath),
        normalizeWindowsPath(value)
      )
      replacement = join(currentProjectPath, relativePath)
    } else {
      const asset = assetSuffixMatch(value, assetFiles)
      if (asset) replacement = join(currentProjectPath, asset.replaceAll('/', '\\'))
    }

    if (replacement && pathKey(replacement) !== pathKey(value)) {
      counters.rewrittenPaths += 1
      return replacement
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJson(item, key, currentProjectPath, sourceProjectPath, assetFiles, counters))
  }
  if (!isRecord(value)) return value

  const next: JsonRecord = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    next[childKey] = rewriteJson(
      childValue,
      childKey,
      currentProjectPath,
      sourceProjectPath,
      assetFiles,
      counters
    )
  }
  return next
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tblao-${process.pid}-${Date.now()}.tmp`
  const backup = `${path}.tblao-backup`
  await writeFile(temporary, JSON.stringify(value), 'utf8')
  await rm(backup, { force: true }).catch(() => undefined)
  const hadOriginal = await isFile(path)
  try {
    if (hadOriginal) await rename(path, backup)
    await rename(temporary, path)
    await rm(backup, { force: true }).catch(() => undefined)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (hadOriginal && !(await isFile(path)) && (await isFile(backup))) {
      await rename(backup, path).catch(() => undefined)
    }
    throw error
  }
}

async function projectJsonFiles(projectPath: string): Promise<string[]> {
  const entries = await readdir(projectPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.json'))
    .map((entry) => join(projectPath, entry.name))
    .filter((path) => basename(path).toLocaleLowerCase() !== CAPCUT_PORTABLE_MANIFEST)
}

async function readPortableManifest(path: string): Promise<PortableManifest | null> {
  const parsed = await readJson(path)
  if (!isRecord(parsed)) return null
  if (parsed.kind !== 'tblao.capcut.portable' || parsed.schemaVersion !== 1) return null
  if (typeof parsed.sourceProjectPath !== 'string') return null
  const assetFiles = Array.isArray(parsed.assetFiles)
    ? parsed.assetFiles.filter((item): item is string => typeof item === 'string' && isSafeAssetFile(item))
    : []
  return {
    schemaVersion: 1,
    kind: 'tblao.capcut.portable',
    projectName: typeof parsed.projectName === 'string' ? parsed.projectName : basename(dirname(path)),
    sourceProjectPath: parsed.sourceProjectPath,
    sourceDraftsDir: typeof parsed.sourceDraftsDir === 'string' ? parsed.sourceDraftsDir : dirname(parsed.sourceProjectPath),
    assetFiles,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    repairedAt: typeof parsed.repairedAt === 'string' ? parsed.repairedAt : undefined
  }
}

async function writePortableManifest(
  projectPath: string,
  projectName: string,
  assetFiles: string[],
  createdAt = new Date().toISOString()
): Promise<string> {
  const manifestPath = join(projectPath, CAPCUT_PORTABLE_MANIFEST)
  const manifest: PortableManifest = {
    schemaVersion: 1,
    kind: 'tblao.capcut.portable',
    projectName,
    sourceProjectPath: resolve(projectPath),
    sourceDraftsDir: dirname(resolve(projectPath)),
    assetFiles: [...new Set(assetFiles.map(relativeAssetPath).filter(isSafeAssetFile))].sort(),
    createdAt
  }
  await writeJsonAtomically(manifestPath, manifest)
  return manifestPath
}

export async function writePortableCapCutManifest(
  projectPath: string,
  projectName: string
): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('Portable CapCut project mode is currently supported on Windows only.')
  }
  const resolvedProjectPath = resolve(projectPath)
  const assetFiles = (await listRelativeFiles(join(resolvedProjectPath, 'assets')))
    .map((path) => `assets/${path}`)
  return writePortableManifest(resolvedProjectPath, projectName, assetFiles)
}

export async function repairPortableCapCutProject(projectPath: string): Promise<CapCutPortabilityResult> {
  const resolvedProjectPath = resolve(projectPath)
  const manifestPath = join(resolvedProjectPath, CAPCUT_PORTABLE_MANIFEST)
  const result: CapCutPortabilityResult = {
    ok: false,
    projectPath: resolvedProjectPath,
    manifestPath,
    updatedFiles: 0,
    rewrittenPaths: 0,
    missingAssets: [],
    warnings: []
  }

  try {
    if (process.platform !== 'win32') throw new Error('Portable CapCut repair is currently supported on Windows only.')
    if (!(await isDirectory(resolvedProjectPath))) throw new Error('CapCut project folder does not exist.')

    const existingManifest = await readPortableManifest(manifestPath)
    const projectFiles = await projectJsonFiles(resolvedProjectPath)
    const rootMetaPath = join(dirname(resolvedProjectPath), 'root_meta_info.json')
    const jsonPaths = (await isFile(rootMetaPath) ? [...projectFiles, rootMetaPath] : projectFiles)
    const parsedFiles: Array<{ path: string; value: unknown }> = []
    const allStrings: string[] = []
    for (const path of jsonPaths) {
      const value = await readJson(path)
      if (value === null) {
        result.warnings.push(`Skipped invalid JSON: ${basename(path)}`)
        continue
      }
      parsedFiles.push({ path, value })
      collectStringValues(value, allStrings)
    }

    const localAssetFiles = (await listRelativeFiles(join(resolvedProjectPath, 'assets')))
      .map((path) => `assets/${path}`)
    const assetFiles = [...new Set(
      [...(existingManifest?.assetFiles ?? []), ...localAssetFiles]
        .map(relativeAssetPath)
        .filter(isSafeAssetFile)
    )]
    const sourceProjectPath = existingManifest?.sourceProjectPath || inferSourceRoot(allStrings, assetFiles)
    if (!sourceProjectPath) {
      result.warnings.push('Could not infer the old project root; only known CapCut root metadata fields were repaired.')
    }

    const counters = { rewrittenPaths: 0 }
    for (const file of parsedFiles) {
      const rewritten = rewriteJson(
        file.value,
        null,
        resolvedProjectPath,
        sourceProjectPath,
        assetFiles,
        counters
      )
      if (JSON.stringify(rewritten) !== JSON.stringify(file.value)) {
        await writeJsonAtomically(file.path, rewritten)
        result.updatedFiles += 1
      }
    }
    result.rewrittenPaths = counters.rewrittenPaths

    for (const asset of assetFiles) {
      if (!(await isFile(join(resolvedProjectPath, asset.replaceAll('/', '\\'))))) {
        result.missingAssets.push(asset)
      }
    }
    if (result.missingAssets.length) {
      result.warnings.push(`Missing project assets: ${result.missingAssets.slice(0, 10).join(', ')}`)
    }

    const manifestName = existingManifest?.projectName || basename(resolvedProjectPath)
    await writePortableManifest(
      resolvedProjectPath,
      manifestName,
      assetFiles,
      existingManifest?.createdAt
    ).then(async (path) => {
      const current = await readJson(path)
      if (isRecord(current)) {
        current.repairedAt = new Date().toISOString()
        await writeJsonAtomically(path, current)
      }
    })
    result.ok = result.missingAssets.length === 0
    return result
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    return result
  }
}
