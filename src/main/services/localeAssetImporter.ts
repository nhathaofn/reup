import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import {
  type LocaleAssetImportRequest,
  type LocaleAssetImportResult,
  type LocaleAssetManifest,
  type SourceBlockManifest
} from '../../shared/features/content-blocks.ts'
import { parseSrt } from './srt.ts'
import {
  fingerprintSourceManifest,
  readSourceBlockManifest,
  validateLocaleAssetManifest,
  validateSourceBlockManifest,
  writeArtifactAtomic
} from './contentBlockManifest.ts'
import { probeAudioDurationUs, requireFfprobePath } from './mediaProbe.ts'

const VOICE_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'])

export interface ImportLocaleAssetManifestInput {
  source: SourceBlockManifest
  locale: string
  localizedSrtRaw: string
  voiceDir: string
  audioFileNames: string[]
  voiceMap: Record<string, string> | null
  probeDurationUs: (path: string) => Promise<number>
  isFile: (path: string) => Promise<boolean>
}

function canonicalizeLocale(locale: string): string {
  let canonical: string
  try {
    canonical = Intl.getCanonicalLocales(locale.trim())[0]
  } catch {
    throw new Error('Locale phải là BCP-47 hợp lệ.')
  }
  if (!canonical || !new Intl.Locale(canonical).region || /-[0-9a-wy-z]-/iu.test(canonical)) {
    throw new Error('Locale phải có region và không được chứa extension/private-use.')
  }
  return canonical
}

function localizedCueTexts(source: SourceBlockManifest, raw: string): Map<string, string> {
  const cues = parseSrt(raw)
  const sourceCues = source.blocks.flatMap((block) => block.dialogue).sort((left, right) => left.sourceIndex - right.sourceIndex)
  if (cues.length !== sourceCues.length) {
    throw new Error(`Localized SRT phải có đúng ${sourceCues.length} cue.`)
  }
  const textByCue = new Map<string, string>()
  for (const [index, cue] of cues.entries()) {
    const text = cue.chu.replace(/\\N/gu, '\n').trim()
    if (!text) throw new Error(`Localized SRT cue ${index + 1} không có text.`)
    textByCue.set(sourceCues[index].cueId, text)
  }
  return textByCue
}

function isSafeVoiceName(fileName: string): boolean {
  return Boolean(fileName) && fileName === parse(fileName).base && !fileName.includes('/') && !fileName.includes('\\') && !fileName.includes('..')
}

function audioNamesOnly(names: readonly string[]): string[] {
  return names.filter((name) => VOICE_EXTENSIONS.has(extname(name).toLowerCase()))
}

function emptyResult(error?: string): LocaleAssetImportResult {
  return { ok: false, missingCueIds: [], invalidCueIds: [], extraFiles: [], error }
}

export async function importLocaleAssetManifest(
  input: ImportLocaleAssetManifestInput
): Promise<LocaleAssetImportResult> {
  validateSourceBlockManifest(input.source)
  const locale = canonicalizeLocale(input.locale)
  const textByCue = localizedCueTexts(input.source, input.localizedSrtRaw)
  const audioNames = audioNamesOnly(input.audioFileNames)
  const missingCueIds: string[] = []
  const invalidCueIds: string[] = []
  const selectedFiles = new Map<string, string>()
  const usedFiles = new Set<string>()

  if (input.voiceMap) {
    for (const [cueId, fileName] of Object.entries(input.voiceMap)) {
      if (!input.source.blocks.some((block) => block.cueIds.includes(cueId))) {
        throw new Error(`voice-map chứa cue ID không tồn tại: ${cueId}.`)
      }
      if (!isSafeVoiceName(fileName)) throw new Error(`voice-map có filename không an toàn cho ${cueId}.`)
      if (usedFiles.has(fileName)) throw new Error(`voice-map trỏ trùng file: ${fileName}.`)
      usedFiles.add(fileName)
      selectedFiles.set(cueId, fileName)
    }
  } else {
    const byStem = new Map<string, string[]>()
    for (const fileName of audioNames) {
      const stem = parse(fileName).name
      const values = byStem.get(stem) ?? []
      values.push(fileName)
      byStem.set(stem, values)
    }
    for (const block of input.source.blocks) {
      for (const cueId of block.cueIds) {
        const candidates = byStem.get(cueId) ?? []
        if (candidates.length === 1) selectedFiles.set(cueId, candidates[0])
        else if (candidates.length > 1) invalidCueIds.push(cueId)
        else missingCueIds.push(cueId)
      }
    }
  }

  const sourceCueIds = input.source.blocks.flatMap((block) => block.cueIds)
  for (const cueId of sourceCueIds) {
    if (!selectedFiles.has(cueId)) {
      if (!missingCueIds.includes(cueId) && !invalidCueIds.includes(cueId)) missingCueIds.push(cueId)
      continue
    }
    const fileName = selectedFiles.get(cueId)!
    if (!audioNames.includes(fileName)) {
      missingCueIds.push(cueId)
      continue
    }
    const voicePath = resolve(input.voiceDir, fileName)
    const voiceRelative = relative(resolve(input.voiceDir), voicePath)
    if (voiceRelative.startsWith('..') || isAbsolute(voiceRelative) || !isSafeVoiceName(fileName)) {
      invalidCueIds.push(cueId)
      continue
    }
    if (!(await input.isFile(voicePath))) {
      missingCueIds.push(cueId)
      continue
    }
    const durationUs = await input.probeDurationUs(voicePath)
    if (!Number.isSafeInteger(durationUs) || durationUs < 1_000) invalidCueIds.push(cueId)
  }

  const extraFiles = audioNames.filter((fileName) => !selectedFiles.has(sourceCueIds.find((cueId) => selectedFiles.get(cueId) === fileName) ?? ''))
  if (input.voiceMap) {
    for (const fileName of audioNames) {
      if (!usedFiles.has(fileName)) extraFiles.push(fileName)
    }
  }
  const uniqueExtraFiles = [...new Set(extraFiles)]
  if (missingCueIds.length || invalidCueIds.length || uniqueExtraFiles.length) {
    return {
      ok: false,
      missingCueIds: [...new Set(missingCueIds)],
      invalidCueIds: [...new Set(invalidCueIds)],
      extraFiles: uniqueExtraFiles,
      error: 'Voice chưa khớp chính xác theo cue ID.'
    }
  }

  const voiceAssets = new Map<string, { voicePath: string; voiceDurationUs: number }>()
  for (const cueId of sourceCueIds) {
    const fileName = selectedFiles.get(cueId)!
    const voicePath = resolve(input.voiceDir, fileName)
    voiceAssets.set(cueId, { voicePath, voiceDurationUs: await input.probeDurationUs(voicePath) })
  }
  const blocks: LocaleAssetManifest['blocks'] = {}
  for (const block of input.source.blocks) {
    blocks[block.id] = {
      cues: block.cueIds.map((cueId) => ({
        cueId,
        text: textByCue.get(cueId)!,
        voicePath: voiceAssets.get(cueId)!.voicePath,
        voiceDurationUs: voiceAssets.get(cueId)!.voiceDurationUs
      }))
    }
  }
  const manifest: LocaleAssetManifest = {
    schemaVersion: 1,
    sourceManifestFingerprint: fingerprintSourceManifest(input.source),
    locale,
    blocks
  }
  return { ok: true, manifest: validateLocaleAssetManifest(manifest), missingCueIds: [], invalidCueIds: [], extraFiles: [] }
}

export async function importLocaleAssetsFromFiles(
  request: LocaleAssetImportRequest
): Promise<LocaleAssetImportResult> {
  try {
    if (!isAbsolute(request.projectDir) || !isAbsolute(request.sourceManifestPath) || !isAbsolute(request.localizedSrtPath) || !isAbsolute(request.voiceDir)) {
      return emptyResult('Các path của locale phải là đường dẫn tuyệt đối.')
    }
    const source = await readSourceBlockManifest(request.sourceManifestPath)
    const localizedSrtRaw = await readFile(request.localizedSrtPath, 'utf8')
    const entries = await readdir(request.voiceDir, { withFileTypes: true })
    const audioFileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
    let voiceMap: Record<string, string> | null = null
    if (request.voiceMapPath) voiceMap = JSON.parse(await readFile(request.voiceMapPath, 'utf8')) as Record<string, string>
    const ffprobe = await requireFfprobePath()
    const result = await importLocaleAssetManifest({
      source,
      locale: request.locale,
      localizedSrtRaw,
      voiceDir: request.voiceDir,
      audioFileNames,
      voiceMap,
      probeDurationUs: (path) => probeAudioDurationUs(path, ffprobe),
      isFile: async (path) => {
        try { return (await stat(path)).isFile() } catch { return false }
      }
    })
    if (!result.ok || !result.manifest) return result
    const localeDir = resolve(request.projectDir, 'locales', result.manifest.locale)
    const manifestPath = join(localeDir, 'assets.json')
    await writeArtifactAtomic(manifestPath, result.manifest, validateLocaleAssetManifest)
    return { ...result, manifestPath }
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : String(error))
  }
}
