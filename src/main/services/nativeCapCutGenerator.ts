import { randomUUID } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

type JsonRecord = Record<string, unknown>

export interface NativeCapCutVideoItem {
  sourcePath: string
  assetName: string
  startSeconds: number
  durationSeconds: number
  sourceStartSeconds?: number
  sourceDurationSeconds?: number
  width: number
  height: number
  volume: number
}

export interface NativeCapCutAudioItem {
  sourcePath: string
  assetName: string
  startSeconds: number
  durationSeconds: number
  sourceDurationSeconds: number
  speed: number
  volume: number
}

export interface NativeCapCutTextItem {
  startSeconds: number
  durationSeconds: number
  text: string
}

export interface NativeCapCutProjectInput {
  projectPath: string
  projectName: string
  templateDir: string
  width: number
  height: number
  fps: number
  videoItems: NativeCapCutVideoItem[]
  audioItems: NativeCapCutAudioItem[]
  textItems: NativeCapCutTextItem[]
  onProgress?: (message: string) => void
  isCancelled?: () => boolean
}

export interface NativeCapCutProjectResult {
  videoSegmentIds: string[]
  audioSegmentIds: string[]
  textSegmentIds: string[]
  durationSeconds: number
  assetFiles: string[]
}

interface MaterialLocation {
  group: string
  item: JsonRecord
}

interface TrackPrototype {
  track: JsonRecord
  segment: JsonRecord
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function id(): string {
  return randomUUID()
}

function microseconds(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1_000_000))
}

function nowMicroseconds(): number {
  return Date.now() * 1_000
}

function normalizedPath(value: string): string {
  return resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase()
}

function isWithin(root: string, candidate: string): boolean {
  const rootPath = normalizedPath(root)
  const candidatePath = normalizedPath(candidate)
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}\\`)
}

function rewriteTemplatePaths(value: unknown, templateDir: string, projectDir: string): unknown {
  if (typeof value === 'string' && isWithin(templateDir, value)) {
    const relativePath = relative(resolve(templateDir), resolve(value))
    return join(projectDir, relativePath)
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteTemplatePaths(item, templateDir, projectDir))
  }
  if (isRecord(value)) {
    const result: JsonRecord = {}
    for (const [key, child] of Object.entries(value)) {
      result[key] = rewriteTemplatePaths(child, templateDir, projectDir)
    }
    return result
  }
  return value
}

function findTrackPrototype(draft: JsonRecord, type: string, name: string): TrackPrototype | null {
  const tracks = asRecordArray(draft.tracks)
  const candidates = tracks.filter((track) => String(track.type ?? '') === type)
  const named = candidates.find((track) => String(track.name ?? '') === name && asRecordArray(track.segments).length > 0)
  const track = named ?? candidates.find((candidate) => asRecordArray(candidate.segments).length > 0)
  if (!track) return null
  const segment = asRecordArray(track.segments)[0]
  return segment ? { track, segment } : null
}

function findMaterial(draft: JsonRecord, materialId: string, preferredGroup: string): MaterialLocation | null {
  const materials = asRecord(draft.materials)
  const groups = [preferredGroup, ...Object.keys(materials).filter((group) => group !== preferredGroup)]
  for (const group of groups) {
    const list = asRecordArray(materials[group])
    const item = list.find((candidate) => String(candidate.id ?? '') === materialId)
    if (item) return { group, item }
  }
  return null
}

function setFirstPath(material: JsonRecord, value: string): void {
  for (const key of ['path', 'local_material_file_path', 'file_Path', 'file_path']) {
    if (typeof material[key] === 'string') {
      material[key] = value
      return
    }
  }
  material.path = value
}

function setMaterialName(material: JsonRecord, value: string): void {
  for (const key of ['material_name', 'name', 'extra_info']) {
    if (typeof material[key] === 'string') material[key] = value
  }
}

function setTextMaterial(material: JsonRecord, text: string): void {
  if (typeof material.content === 'string') {
    try {
      const content = JSON.parse(material.content) as unknown
      if (isRecord(content)) {
        content.text = text
        if (Array.isArray(content.styles)) {
          for (const style of content.styles.filter(isRecord)) style.range = [0, text.length]
        }
        material.content = JSON.stringify(content)
      }
    } catch {
      material.content = JSON.stringify({ text })
    }
  } else if ('text' in material) {
    material.text = text
  } else {
    material.content = JSON.stringify({ text })
  }
}

function setRange(segment: JsonRecord, key: 'target_timerange' | 'source_timerange', startUs: number, durationUs: number): void {
  const range = asRecord(segment[key])
  range.start = startUs
  range.duration = durationUs
  segment[key] = range
}

function appendMaterial(draft: JsonRecord, group: string, material: JsonRecord): void {
  const materials = asRecord(draft.materials)
  if (!Array.isArray(materials[group])) materials[group] = []
  ;(materials[group] as unknown[]).push(material)
  draft.materials = materials
}

function cloneCompanionMaterials(
  draft: JsonRecord,
  prototypeSegment: JsonRecord,
  speed: number
): string[] {
  const refs = Array.isArray(prototypeSegment.extra_material_refs)
    ? prototypeSegment.extra_material_refs.filter((value): value is string => typeof value === 'string')
    : []
  const nextRefs: string[] = []
  for (const ref of refs) {
    const location = findMaterial(draft, ref, '')
    if (!location) continue
    const material = clone(location.item)
    const nextId = id()
    material.id = nextId
    if (location.group === 'speeds') material.speed = speed
    appendMaterial(draft, location.group, material)
    nextRefs.push(nextId)
  }
  return nextRefs
}

function createSegment(
  draft: JsonRecord,
  prototype: TrackPrototype,
  materialGroup: string,
  configureMaterial: (material: JsonRecord) => void,
  startSeconds: number,
  durationSeconds: number,
  sourceDurationSeconds: number,
  speed: number,
  volume: number
): JsonRecord {
  const sourceMaterialId = String(prototype.segment.material_id ?? '')
  const materialLocation = findMaterial(draft, sourceMaterialId, materialGroup)
  if (!materialLocation) throw new Error(`Template thiếu material ${materialGroup} cho track ${String(prototype.track.name ?? '')}.`)

  const material = clone(materialLocation.item)
  const materialId = id()
  material.id = materialId
  configureMaterial(material)
  appendMaterial(draft, materialGroup, material)

  const segment = clone(prototype.segment)
  segment.id = id()
  segment.raw_segment_id = String(prototype.track.id ?? '')
  segment.material_id = materialId
  setRange(segment, 'target_timerange', microseconds(startSeconds), microseconds(durationSeconds))
  setRange(segment, 'source_timerange', 0, microseconds(sourceDurationSeconds))
  segment.speed = speed
  segment.volume = volume
  segment.extra_material_refs = cloneCompanionMaterials(draft, prototype.segment, speed)
  return segment
}

function replaceTrackSegments(track: JsonRecord, segments: JsonRecord[]): void {
  track.segments = segments
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tblao-${process.pid}-${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(value), 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

function mergeTimelineEnvelope(target: JsonRecord, draft: JsonRecord): JsonRecord {
  const result = clone(target)
  for (const key of ['id', 'name', 'duration', 'fps', 'canvas_config', 'tracks', 'materials', 'platform', 'last_modified_platform', 'config']) {
    if (key in draft) result[key] = clone(draft[key])
  }
  return result
}

function rewriteTimelineEnvelope(value: unknown, draft: JsonRecord): { value: unknown; changed: boolean } {
  if (isRecord(value)) {
    if (Array.isArray(value.tracks)) return { value: mergeTimelineEnvelope(value, draft), changed: true }
    const result = clone(value)
    let changed = false
    for (const [key, child] of Object.entries(result)) {
      if (typeof child === 'string') {
        try {
          const parsed = JSON.parse(child) as unknown
          const rewritten = rewriteTimelineEnvelope(parsed, draft)
          if (rewritten.changed) {
            result[key] = JSON.stringify(rewritten.value)
            changed = true
          }
        } catch {
          // Ordinary metadata strings are not timeline envelopes.
        }
      } else {
        const rewritten = rewriteTimelineEnvelope(child, draft)
        if (rewritten.changed) {
          result[key] = rewritten.value
          changed = true
        }
      }
    }
    return { value: result, changed }
  }
  if (Array.isArray(value)) {
    const result = [...value]
    let changed = false
    for (const [index, child] of result.entries()) {
      const rewritten = rewriteTimelineEnvelope(child, draft)
      if (rewritten.changed) {
        result[index] = rewritten.value
        changed = true
      }
    }
    return { value: result, changed }
  }
  return { value, changed: false }
}

async function rewriteTimelineMirrors(projectPath: string, draft: JsonRecord): Promise<void> {
  for (const fileName of ['draft_info.json', 'template-2.tmp']) {
    const path = join(projectPath, fileName)
    const parsed = await readJson(path)
    if (parsed === null) continue
    const rewritten = rewriteTimelineEnvelope(parsed, draft)
    if (rewritten.changed) await writeJsonAtomic(path, rewritten.value)
  }
}

async function copyAssets(
  projectPath: string,
  videoItems: NativeCapCutVideoItem[],
  audioItems: NativeCapCutAudioItem[]
): Promise<string[]> {
  const copied: string[] = []
  for (const [index, item] of videoItems.entries()) {
    const extension = extname(item.sourcePath) || '.mp4'
    const name = item.assetName || `tblao-video-${String(index + 1).padStart(3, '0')}${extension}`
    const target = join(projectPath, 'assets', 'video', name)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(item.sourcePath, target)
    copied.push(target)
  }
  for (const [index, item] of audioItems.entries()) {
    const extension = extname(item.sourcePath) || '.mp3'
    const name = item.assetName || `tblao-audio-${String(index + 1).padStart(3, '0')}${extension}`
    const target = join(projectPath, 'assets', 'audio', name)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(item.sourcePath, target)
    copied.push(target)
  }
  return copied
}

function draftMaterialSize(draft: JsonRecord): number {
  const materials = asRecord(draft.materials)
  return Object.values(materials).reduce<number>(
    (total, group) => total + asRecordArray(group).length,
    0
  )
}

async function updateDraftMeta(
  projectPath: string,
  projectName: string,
  draft: JsonRecord,
  durationUs: number
): Promise<JsonRecord> {
  const metaPath = join(projectPath, 'draft_meta_info.json')
  const parsed = await readJson(metaPath)
  const meta = isRecord(parsed) ? parsed : {}
  const rootPath = dirname(projectPath)
  const draftId = String(draft.id ?? id())
  meta.draft_id = draftId
  meta.draft_name = projectName
  meta.draft_fold_path = projectPath
  meta.draft_json_file = join(projectPath, 'draft_content.json')
  meta.draft_root_path = rootPath
  meta.tm_duration = durationUs
  meta.draft_timeline_materials_size = draftMaterialSize(draft)
  meta.tm_draft_modified = nowMicroseconds()
  if (typeof meta.tm_draft_create !== 'number') meta.tm_draft_create = nowMicroseconds()
  if (await isFile(join(projectPath, 'draft_cover.jpg'))) meta.draft_cover = 'draft_cover.jpg'
  await writeJsonAtomic(metaPath, meta)

  const rootMetaPath = join(rootPath, 'root_meta_info.json')
  const rootParsed = await readJson(rootMetaPath)
  const rootMeta = isRecord(rootParsed) ? rootParsed : {}
  const entries = asRecordArray(rootMeta.all_draft_store)
  const entry = clone(meta)
  entry.draft_fold_path = projectPath
  entry.draft_json_file = join(projectPath, 'draft_content.json')
  entry.draft_root_path = rootPath
  entry.draft_name = projectName
  entry.draft_cover = await isFile(join(projectPath, 'draft_cover.jpg'))
    ? join(projectPath, 'draft_cover.jpg')
    : ''
  entry.streaming_edit_draft_ready = true
  const existingIndex = entries.findIndex((candidate) =>
    String(candidate.draft_id ?? '') === draftId ||
    normalizedPath(String(candidate.draft_fold_path ?? '')) === normalizedPath(projectPath)
  )
  if (existingIndex >= 0) entries[existingIndex] = entry
  else entries.push(entry)
  rootMeta.all_draft_store = entries
  await writeJsonAtomic(rootMetaPath, rootMeta)
  return meta
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export async function validateNativeCapCutTemplate(templateDir: string): Promise<string | null> {
  if (!(await isFile(join(templateDir, 'draft_content.json')))) return 'Template CapCut phải có draft_content.json.'
  const parsed = await readJson(join(templateDir, 'draft_content.json'))
  if (!isRecord(parsed) || !Array.isArray(parsed.tracks) || !isRecord(parsed.materials)) {
    return 'Template CapCut không có cấu trúc draft native hợp lệ.'
  }
  for (const [type, name, label] of [
    ['video', 'Video nền', 'video'],
    ['audio', 'Voice', 'voice'],
    ['text', 'Phụ đề', 'subtitle']
  ] as const) {
    if (!findTrackPrototype(parsed, type, name)) {
      return `Template CapCut phải có ít nhất một segment ${label} để làm mẫu.`
    }
  }
  return null
}

export async function generateNativeCapCutProject(
  input: NativeCapCutProjectInput
): Promise<NativeCapCutProjectResult> {
  const projectPath = resolve(input.projectPath)
  const templateDir = resolve(input.templateDir)
  if (await isFile(join(projectPath, 'draft_content.json'))) {
    throw new Error(`Project đích đã tồn tại: ${projectPath}`)
  }
  const templateError = await validateNativeCapCutTemplate(templateDir)
  if (templateError) throw new Error(templateError)
  if (input.isCancelled?.()) throw new Error('Đã hủy.')

  input.onProgress?.('Đang sao chép template CapCut native…')
  await cp(templateDir, projectPath, { recursive: true, force: false })
  const draftPath = join(projectPath, 'draft_content.json')
  const templateDraft = await readJson(draftPath)
  if (!isRecord(templateDraft)) throw new Error('Không đọc được draft_content.json sau khi sao chép template.')
  const draft = rewriteTemplatePaths(templateDraft, templateDir, projectPath) as JsonRecord
  const videoPrototype = findTrackPrototype(draft, 'video', 'Video nền')
  const audioPrototype = findTrackPrototype(draft, 'audio', 'Voice')
  const textPrototype = findTrackPrototype(draft, 'text', 'Phụ đề')
  if (!videoPrototype || !audioPrototype || !textPrototype) throw new Error('Template thiếu track mẫu video, voice hoặc phụ đề.')

  const copiedAssets = await copyAssets(projectPath, input.videoItems, input.audioItems)
  const videoTrack = videoPrototype.track
  const audioTrack = audioPrototype.track
  const textTrack = textPrototype.track
  const videoSegments: JsonRecord[] = []
  const audioSegments: JsonRecord[] = []
  const textSegments: JsonRecord[] = []
  const videoSegmentIds: string[] = []
  const audioSegmentIds: string[] = []
  const textSegmentIds: string[] = []

  for (const [index, item] of input.videoItems.entries()) {
    if (input.isCancelled?.()) throw new Error('Đã hủy.')
    const targetPath = copiedAssets[index]
    const segment = createSegment(
      draft,
      videoPrototype,
      'videos',
      (material) => {
        setFirstPath(material, targetPath)
        setMaterialName(material, basename(targetPath))
        material.type = 'video'
        material.duration = microseconds(item.sourceDurationSeconds ?? item.durationSeconds)
        material.width = item.width
        material.height = item.height
        material.has_audio = false
      },
      item.startSeconds,
      item.durationSeconds,
      item.sourceDurationSeconds ?? item.durationSeconds,
      1,
      item.volume
    )
    if (item.sourceStartSeconds) setRange(segment, 'source_timerange', microseconds(item.sourceStartSeconds), microseconds(item.durationSeconds))
    videoSegmentIds.push(String(segment.id))
    videoSegments.push(segment)
  }

  for (const [index, item] of input.audioItems.entries()) {
    if (input.isCancelled?.()) throw new Error('Đã hủy.')
    const targetPath = copiedAssets[input.videoItems.length + index]
    const segment = createSegment(
      draft,
      audioPrototype,
      'audios',
      (material) => {
        setFirstPath(material, targetPath)
        setMaterialName(material, basename(targetPath))
        material.type = 'extract_music'
        material.duration = microseconds(item.sourceDurationSeconds)
        material.category_name = 'local'
        material.category_id = ''
        material.source_platform = 0
      },
      item.startSeconds,
      item.durationSeconds,
      item.sourceDurationSeconds,
      item.speed,
      item.volume
    )
    audioSegmentIds.push(String(segment.id))
    audioSegments.push(segment)
  }

  for (const item of input.textItems) {
    if (input.isCancelled?.()) throw new Error('Đã hủy.')
    const segment = createSegment(
      draft,
      textPrototype,
      'texts',
      (material) => {
        setTextMaterial(material, item.text)
        material.sub_type = 1
        material.caption_template_info = material.caption_template_info ?? {
          category_id: '',
          category_name: '',
          effect_id: '',
          is_new: false,
          resource_id: ''
        }
      },
      item.startSeconds,
      item.durationSeconds,
      item.durationSeconds,
      1,
      1
    )
    textSegmentIds.push(String(segment.id))
    textSegments.push(segment)
  }

  replaceTrackSegments(videoTrack, videoSegments)
  replaceTrackSegments(audioTrack, audioSegments)
  replaceTrackSegments(textTrack, textSegments)
  draft.id = String(draft.id ?? id())
  draft.name = input.projectName
  draft.duration = microseconds(
    Math.max(
      0,
      ...input.videoItems.map((item) => item.startSeconds + item.durationSeconds),
      ...input.audioItems.map((item) => item.startSeconds + item.durationSeconds),
      ...input.textItems.map((item) => item.startSeconds + item.durationSeconds)
    )
  )
  draft.fps = input.fps
  const canvas = asRecord(draft.canvas_config)
  canvas.width = input.width
  canvas.height = input.height
  draft.canvas_config = canvas
  draft.update_time = nowMicroseconds()
  await writeJsonAtomic(draftPath, draft)
  await rewriteTimelineMirrors(projectPath, draft)
  await updateDraftMeta(projectPath, input.projectName, draft, Number(draft.duration ?? 0))

  return {
    videoSegmentIds,
    audioSegmentIds,
    textSegmentIds,
    durationSeconds: Number(draft.duration ?? 0) / 1_000_000,
    assetFiles: copiedAssets
  }
}
