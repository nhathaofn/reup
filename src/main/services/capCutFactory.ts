import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  basename,
  delimiter,
  dirname,
  extname,
  join,
  parse,
  resolve
} from 'node:path'
import { constants, existsSync } from 'node:fs'
import {
  type CapCutFactoryCancelResult,
  type CapCutFactoryEnvironment,
  type CapCutFactoryPreflightResult,
  type CapCutFactoryPreflightSet,
  type CapCutFactoryProgress,
  type CapCutFactoryProjectResult,
  type CapCutFactoryRequest,
  type CapCutFactoryResult,
  type CapCutFactoryVideoInfo
} from '../../shared/features/capcut-factory'
import type { SceneSplitterScene } from '../../shared/features/scene-splitter'
import type { VoiceSyncEntry } from '../../shared/types'
import { resolveFfmpeg } from '../deps'
import { writePortableCapCutManifest } from './capcutPortability'
import { scanVoiceSync } from './voiceSync'

interface ActiveJob {
  cancelled: boolean
  child: ChildProcess | null
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

interface CompileSpec {
  name: string
  width: number
  height: number
  fps: number
  ratio: 'original'
  tracks: Array<{
    type: 'video' | 'audio'
    name: string
    items: Array<Record<string, string | number>>
  }>
  operations: Array<{
    op: 'captions'
    path: string
    trackName: string
  }>
}

interface CapCutSceneClip {
  sceneId: string
  index: number
  filePath: string
  fileName: string
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

/**
 * Timeline entry after scene anchoring. The original SRT range is kept in the
 * manifest for auditability, while start/end are the ranges used by both the
 * CapCut subtitle track and the voice track.
 */
interface SceneAlignedVoiceEntry extends VoiceSyncEntry {
  originalStartSeconds: number
  originalEndSeconds: number
  assignedSceneId?: string
  alignmentDeltaSeconds: number
}

interface SceneCueLink {
  cueId: string
  index: number
  startSeconds: number
  endSeconds: number
  originalStartSeconds?: number
  originalEndSeconds?: number
  alignmentDeltaSeconds?: number
  assignedSceneId?: string
  durationSeconds: number
  text: string
  voiceFileName?: string
  voiceDurationSeconds?: number
  speed?: number
  sceneIds: string[]
  groupId?: string
  crossesVisualSceneBoundary: boolean
  videoSegmentId?: string
  subtitleSegmentId?: string
  voiceSegmentId?: string
}

interface SceneGroupLink {
  groupId: string
  index: number
  startSeconds: number
  endSeconds: number
  sceneIds: string[]
  cueIds: string[]
  videoSegmentIds: string[]
  subtitleSegmentIds: string[]
  voiceSegmentIds: string[]
}

interface SceneLinkPlan {
  mode: 'non-destructive'
  alignment: {
    mode: 'scene-start-overlap'
    shiftedCueCount: number
    maxShiftSeconds: number
  }
  scenes: Array<{
    sceneId: string
    index: number
    fileName: string
    startSeconds: number
    endSeconds: number
    durationSeconds: number
    groupId: string
    cueIds: string[]
    sharedCueIds: string[]
    videoSegmentId?: string
  }>
  groups: SceneGroupLink[]
  cues: SceneCueLink[]
  crossSceneCueCount: number
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.webm',
  '.m4v',
  '.mts',
  '.m2ts'
])
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024
const require = createRequire(import.meta.url)
let activeJob: ActiveJob | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => resolve(value)))]
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function normalizedComparablePath(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

function samePath(left: string, right: string): boolean {
  return normalizedComparablePath(left) === normalizedComparablePath(right)
}

async function loadSceneClips(
  sceneDir: string,
  videoPath: string,
  videoDurationSeconds: number
): Promise<CapCutSceneClip[]> {
  const directory = sceneDir.trim()
  if (!(await isDirectory(directory))) throw new Error('Thư mục phân cảnh không tồn tại.')
  const manifestPath = join(directory, 'scene-splitter.json')
  if (!(await isFile(manifestPath))) {
    throw new Error('Thư mục phân cảnh phải chứa scene-splitter.json được tạo bởi tab Tách cảnh.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Không đọc được manifest phân cảnh: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.scenes)) {
    throw new Error('Manifest phân cảnh không đúng cấu trúc.')
  }

  const scenes = (parsed.scenes as unknown[])
    .filter((scene): scene is SceneSplitterScene => isRecord(scene))
    .filter((scene) => typeof scene.sourceVideo === 'string' && samePath(scene.sourceVideo, videoPath))
    .map((scene) => {
      const index = Number(scene.index)
      const start = Number(scene.startSeconds)
      const end = Number(scene.endSeconds)
      const duration = Number(scene.durationSeconds ?? end - start)
      const declaredPath = typeof scene.filePath === 'string' ? scene.filePath : ''
      const fileName = typeof scene.fileName === 'string' ? scene.fileName : ''
      return {
        index,
        filePath: declaredPath && isAbsolutePath(declaredPath) ? declaredPath : join(directory, fileName),
        fileName: fileName || basename(declaredPath),
        startSeconds: start,
        endSeconds: end,
        durationSeconds: duration
      }
    })
    .filter((scene) =>
      [scene.index, scene.startSeconds, scene.endSeconds, scene.durationSeconds].every(Number.isFinite) &&
      scene.startSeconds >= 0 &&
      scene.endSeconds > scene.startSeconds &&
      scene.durationSeconds > 0
    )
    .sort((left, right) => left.startSeconds - right.startSeconds)

  if (!scenes.length) {
    throw new Error('Không tìm thấy scene nào trong manifest cho đúng video nền đã chọn.')
  }

  const clips: CapCutSceneClip[] = []
  let previousEnd = 0
  for (const scene of scenes) {
    const filePath = (await isFile(scene.filePath)) ? scene.filePath : join(directory, scene.fileName)
    if (!(await isFile(filePath))) throw new Error(`Không tìm thấy file scene: ${scene.fileName || scene.filePath}`)
    if (scene.startSeconds > previousEnd + 0.05) {
      throw new Error(`Các scene bị hở timeline tại ${previousEnd.toFixed(3)}s.`)
    }
    if (scene.startSeconds < previousEnd - 0.05) {
      throw new Error(`Các scene bị chồng timeline tại ${scene.startSeconds.toFixed(3)}s.`)
    }
    if (scene.startSeconds >= videoDurationSeconds + 0.05) {
      throw new Error(`Scene ${scene.fileName} bắt đầu sau thời lượng video.`)
    }
    const endSeconds = Math.min(scene.endSeconds, videoDurationSeconds)
    const durationSeconds = endSeconds - scene.startSeconds
    if (!(durationSeconds > 0)) continue
    clips.push({
      sceneId: parse(scene.fileName || filePath).name || `scene-${scene.index}`,
      index: scene.index,
      filePath,
      fileName: scene.fileName || basename(filePath),
      startSeconds: scene.startSeconds,
      endSeconds,
      durationSeconds
    })
    previousEnd = endSeconds
  }

  if (!clips.length || clips[0].startSeconds > 0.05) {
    throw new Error('Scene đầu tiên không bắt đầu từ mốc 0 của video.')
  }
  if (previousEnd < videoDurationSeconds - 0.25) {
    throw new Error(`Các scene chỉ phủ đến ${previousEnd.toFixed(3)}s, video dài ${videoDurationSeconds.toFixed(3)}s.`)
  }
  return clips
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) > 0.001
}

/**
 * Anchor a cue to the scene that contains most of its original SRT range.
 *
 * A cue is never split or trimmed. If its original start is before the chosen
 * scene start, only the start moves forward; the original end and voice file
 * are preserved, and the caller fits the voice to the resulting window by
 * changing speed. This prevents the next scene's subtitle/voice from showing
 * over the tail of the previous scene.
 */
function alignEntriesToScenes(
  sceneClips: CapCutSceneClip[],
  entries: VoiceSyncEntry[],
  videoDurationSeconds: number
): SceneAlignedVoiceEntry[] {
  return entries.map((entry) => {
    const originalStartSeconds = Math.max(0, entry.startSeconds)
    const originalEndSeconds = Math.min(videoDurationSeconds, entry.endSeconds)
    const overlaps = sceneClips
      .map((scene) => ({
        scene,
        duration: Math.max(
          0,
          Math.min(originalEndSeconds, scene.endSeconds) -
            Math.max(originalStartSeconds, scene.startSeconds)
        )
      }))
      .filter((candidate) => candidate.duration > 0.001)

    // On equal overlap, prefer the later scene. This is the safe choice for a
    // cue that crosses a cut: it cannot appear before the later scene starts.
    const assigned = overlaps.reduce<{ scene: CapCutSceneClip; duration: number } | null>(
      (best, candidate) => {
        if (!best || candidate.duration >= best.duration - 0.001) return candidate
        return best
      },
      null
    )
    const alignedStartSeconds = assigned
      ? Math.max(originalStartSeconds, assigned.scene.startSeconds)
      : originalStartSeconds
    const safeStartSeconds = alignedStartSeconds < originalEndSeconds - 0.001
      ? alignedStartSeconds
      : originalStartSeconds
    const cueDuration = Math.max(0, originalEndSeconds - safeStartSeconds)

    return {
      ...entry,
      startSeconds: safeStartSeconds,
      endSeconds: originalEndSeconds,
      fitRatio: entry.durationSeconds && cueDuration > 0
        ? entry.durationSeconds / cueDuration
        : entry.fitRatio,
      originalStartSeconds,
      originalEndSeconds,
      assignedSceneId: assigned?.scene.sceneId,
      alignmentDeltaSeconds: Math.max(0, safeStartSeconds - originalStartSeconds)
    }
  })
}

function formatSrtTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secondsPart = Math.floor((milliseconds % 60_000) / 1000)
  const millisPart = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')},${String(millisPart).padStart(3, '0')}`
}

function buildSrtFromEntries(entries: VoiceSyncEntry[]): string {
  return entries
    .filter((entry) => entry.endSeconds > entry.startSeconds)
    .map((entry, index) => [
      String(index + 1),
      `${formatSrtTimestamp(entry.startSeconds)} --> ${formatSrtTimestamp(entry.endSeconds)}`,
      entry.text,
      ''
    ].join('\n'))
    .join('\n')
}

/**
 * Build non-destructive scene/cue links. Visual scene files stay independent,
 * while a cue that crosses a visual cut keeps its single subtitle and voice
 * item. Adjacent scenes are coalesced into one logical group at such a cut so
 * an editor can move the whole spoken unit without trimming the audio.
 */
function buildSceneLinkPlan(
  sceneClips: CapCutSceneClip[],
  entries: SceneAlignedVoiceEntry[]
): SceneLinkPlan {
  const validEntries = entries.filter((entry) => entry.endSeconds > entry.startSeconds)
  const sceneIdsByCue = new Map<number, string[]>()
  const crossBoundaryByCue = new Map<number, boolean>()

  for (const entry of validEntries) {
    const sceneIds = sceneClips
      .filter((scene) => rangesOverlap(entry.startSeconds, entry.endSeconds, scene.startSeconds, scene.endSeconds))
      .map((scene) => scene.sceneId)
    sceneIdsByCue.set(entry.index, sceneIds)
    crossBoundaryByCue.set(entry.index, sceneIds.length > 1)
  }

  const rawGroups: CapCutSceneClip[][] = []
  for (const scene of sceneClips) {
    const previous = rawGroups.at(-1)
    const previousScene = previous?.at(-1)
    const crossesBoundary = previousScene
      ? validEntries.some((entry) =>
          entry.startSeconds < scene.startSeconds - 0.001 &&
          entry.endSeconds > scene.startSeconds + 0.001
        )
      : false
    if (previous && previousScene && crossesBoundary) previous.push(scene)
    else rawGroups.push([scene])
  }

  const sceneToGroup = new Map<string, string>()
  const groups: SceneGroupLink[] = rawGroups.map((groupScenes, groupIndex) => {
    const groupId = `scene-group-${String(groupIndex + 1).padStart(3, '0')}`
    for (const scene of groupScenes) sceneToGroup.set(scene.sceneId, groupId)
    const startSeconds = groupScenes[0].startSeconds
    const endSeconds = groupScenes.at(-1)!.endSeconds
    return {
      groupId,
      index: groupIndex + 1,
      startSeconds,
      endSeconds,
      sceneIds: groupScenes.map((scene) => scene.sceneId),
      cueIds: [],
      videoSegmentIds: [],
      subtitleSegmentIds: [],
      voiceSegmentIds: []
    }
  })

  const cues: SceneCueLink[] = validEntries.map((entry) => {
    const cueId = `cue-${String(entry.index).padStart(3, '0')}`
    const sceneIds = sceneIdsByCue.get(entry.index) ?? []
    const groupId = sceneIds.map((sceneId) => sceneToGroup.get(sceneId)).find(Boolean)
    const durationSeconds = Math.max(0, entry.endSeconds - entry.startSeconds)
    return {
      cueId,
      index: entry.index,
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      originalStartSeconds: entry.originalStartSeconds,
      originalEndSeconds: entry.originalEndSeconds,
      alignmentDeltaSeconds: entry.alignmentDeltaSeconds,
      assignedSceneId: entry.assignedSceneId,
      durationSeconds,
      text: entry.text,
      voiceFileName: entry.fileName,
      voiceDurationSeconds: entry.durationSeconds,
      speed: entry.durationSeconds && durationSeconds > 0
        ? Number((entry.durationSeconds / durationSeconds).toFixed(6))
        : undefined,
      sceneIds,
      groupId,
      crossesVisualSceneBoundary: crossBoundaryByCue.get(entry.index) ?? false
    }
  })

  const sceneLinks = sceneClips.map((scene) => {
    const groupId = sceneToGroup.get(scene.sceneId) ?? `scene-group-${String(scene.index).padStart(3, '0')}`
    const sceneCues = cues.filter((cue) => cue.sceneIds.includes(scene.sceneId))
    return {
      sceneId: scene.sceneId,
      index: scene.index,
      fileName: scene.fileName,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      durationSeconds: scene.durationSeconds,
      groupId,
      cueIds: sceneCues.map((cue) => cue.cueId),
      sharedCueIds: sceneCues.filter((cue) => cue.crossesVisualSceneBoundary).map((cue) => cue.cueId)
    }
  })

  for (const group of groups) {
    const groupScenes = new Set(group.sceneIds)
    group.cueIds = cues
      .filter((cue) => cue.sceneIds.some((sceneId) => groupScenes.has(sceneId)))
      .map((cue) => cue.cueId)
    group.videoSegmentIds = []
  }

  return {
    mode: 'non-destructive',
    alignment: {
      mode: 'scene-start-overlap',
      shiftedCueCount: cues.filter((cue) => (cue.alignmentDeltaSeconds ?? 0) > 0.001).length,
      maxShiftSeconds: Number(Math.max(...cues.map((cue) => cue.alignmentDeltaSeconds ?? 0), 0).toFixed(6))
    },
    scenes: sceneLinks,
    groups,
    cues,
    crossSceneCueCount: cues.filter((cue) => cue.crossesVisualSceneBoundary).length
  }
}

interface DraftSegmentRef {
  id: string
  startUs: number
  durationUs: number
}

async function readDraftSegmentRefs(
  projectPath: string,
  type: string,
  name: string
): Promise<DraftSegmentRef[]> {
  const candidates = ['draft_content.json', 'draft_info.json']
  let draftPath: string | null = null
  for (const candidate of candidates) {
    const path = join(projectPath, candidate)
    if (await isFile(path)) {
      draftPath = path
      break
    }
  }
  if (!draftPath) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(draftPath, 'utf8'))
  } catch {
    return []
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tracks)) return []

  const tracks = parsed.tracks.filter(isRecord)
  const matchingTracks = tracks.filter((track) => {
    const trackType = String(track.type ?? '')
    const trackName = String(track.name ?? '')
    return trackType === type && (trackName === name || trackName.length === 0)
  })
  const track = matchingTracks.find((candidate) => Array.isArray(candidate.segments) && candidate.segments.length > 0)
  if (!track || !Array.isArray(track.segments)) return []

  return track.segments
    .filter(isRecord)
    .map((segment) => {
      const target = isRecord(segment.target_timerange) ? segment.target_timerange : {}
      return {
        id: String(segment.id ?? ''),
        startUs: Number(target.start ?? 0),
        durationUs: Number(target.duration ?? 0)
      }
    })
    .filter((segment) => segment.id.length > 0)
    .sort((left, right) => left.startUs - right.startUs)
}

async function writeSceneLinkManifest(
  projectPath: string,
  projectName: string,
  sceneClips: CapCutSceneClip[],
  entries: SceneAlignedVoiceEntry[]
): Promise<{ path: string; warnings: string[] }> {
  const plan = buildSceneLinkPlan(sceneClips, entries)
  const warnings: string[] = []
  const videoSegments = await readDraftSegmentRefs(projectPath, 'video', 'Video nền')
  const audioSegments = await readDraftSegmentRefs(projectPath, 'audio', 'Voice')
  const subtitleSegments = await readDraftSegmentRefs(projectPath, 'text', 'Phụ đề')

  if (videoSegments.length !== sceneClips.length) {
    warnings.push(`Không xác định đủ segment video để gắn scene map (${videoSegments.length}/${sceneClips.length}).`)
  }
  if (audioSegments.length !== plan.cues.length) {
    warnings.push(`Không xác định đủ segment voice để gắn scene map (${audioSegments.length}/${plan.cues.length}); voice gốc vẫn được giữ nguyên.`)
  }
  if (subtitleSegments.length !== plan.cues.length) {
    warnings.push(`Không xác định đủ segment subtitle để gắn scene map (${subtitleSegments.length}/${plan.cues.length}).`)
  }

  plan.scenes.forEach((scene, index) => {
    scene.videoSegmentId = videoSegments[index]?.id
  })
  plan.cues.forEach((cue, index) => {
    cue.voiceSegmentId = audioSegments[index]?.id
    cue.subtitleSegmentId = subtitleSegments[index]?.id
  })
  plan.groups.forEach((group) => {
    group.videoSegmentIds = plan.scenes
      .filter((scene) => scene.groupId === group.groupId)
      .map((scene) => scene.videoSegmentId)
      .filter((id): id is string => Boolean(id))
    group.subtitleSegmentIds = plan.cues
      .filter((cue) => cue.groupId === group.groupId)
      .map((cue) => cue.subtitleSegmentId)
      .filter((id): id is string => Boolean(id))
    group.voiceSegmentIds = plan.cues
      .filter((cue) => cue.groupId === group.groupId)
      .map((cue) => cue.voiceSegmentId)
      .filter((id): id is string => Boolean(id))
  })

  const manifest = {
    schemaVersion: 1,
    kind: 'tblao.capcut.scene-links',
    projectName,
    mode: plan.mode,
    rules: {
      video: 'visual scenes remain separate clips',
      subtitle: 'subtitle cues remain intact; links are logical only',
      voice: 'voice files remain intact; only speed is adjusted to the full SRT cue',
      crossSceneCue: 'adjacent visual scenes are assigned to one logical group when a cue crosses their boundary'
    },
    scenes: plan.scenes,
    groups: plan.groups,
    cues: plan.cues,
    crossSceneCueCount: plan.crossSceneCueCount
  }
  const manifestPath = join(projectPath, 'tblao-scene-links.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return { path: manifestPath, warnings }
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const b = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

async function installedCapCutVersion(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const appRoots = unique(
    [process.env.LOCALAPPDATA, process.env.APPDATA]
      .filter((value): value is string => Boolean(value))
      .map((value) => join(value, 'CapCut', 'Apps'))
  )
  for (const appsDir of appRoots) {
    try {
      const versions = (await readdir(appsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+){1,3}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort(compareVersions)
      if (versions.length > 0) return versions.at(-1) ?? null
    } catch {
      // CapCut co the nam o LOCALAPPDATA hoac APPDATA tuy ban cai.
    }
  }
  return null
}

function capCutDraftCandidates(): string[] {
  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE || process.env.HOME
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.APPDATA,
      profile ? join(profile, 'Documents') : null,
      profile ? join(profile, 'Videos') : null,
      profile ? join(profile, 'Movies') : null
    ].filter((value): value is string => Boolean(value))
    return unique(
      roots.map((root) => join(root, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'))
    )
  }
  if (process.platform === 'darwin') {
    const home = process.env.HOME
    return home
      ? [join(home, 'Movies', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft')]
      : []
  }
  return []
}

export async function detectCapCutEnvironment(): Promise<CapCutFactoryEnvironment> {
  const normalized = capCutDraftCandidates()
  const existing: string[] = []
  for (const candidate of normalized) {
    if (await isDirectory(candidate)) existing.push(candidate)
  }
  const capCutVersion = await installedCapCutVersion()
  const capCutRoots = unique(
    [process.env.LOCALAPPDATA, process.env.APPDATA]
      .filter((value): value is string => Boolean(value))
      .map((value) => join(value, 'CapCut'))
  )
  const capCutInstalled = Boolean(capCutVersion) || (await Promise.all(capCutRoots.map(isDirectory))).some(Boolean)

  return {
    // CapCut may not create com.lveditor.draft until its first project.
    // Return the standard target so the factory can initialize it on a new PC.
    detectedDraftsDir: existing[0] ?? (capCutInstalled ? normalized[0] ?? null : null),
    candidates: normalized,
    capCutVersion,
    platform: process.platform
  }
}

function ffprobePath(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

function captureProcess(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; job?: ActiveJob }
): Promise<CliResult> {
  return new Promise((resolveResult) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(command, args, {
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (options.job) options.job.child = child

    const finish = (status: number | null, fallbackError = ''): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (options.job?.child === child) options.job.child = null
      resolveResult({ status, stdout, stderr: stderr || fallbackError })
    }

    const append = (current: string, data: Buffer): string => {
      const next = current + data.toString('utf8')
      return next.length > MAX_CAPTURE_BYTES ? next.slice(-MAX_CAPTURE_BYTES) : next
    }
    child.stdout?.on('data', (data: Buffer) => (stdout = append(stdout, data)))
    child.stderr?.on('data', (data: Buffer) => (stderr = append(stderr, data)))
    child.on('error', (error) => finish(null, error.message))
    child.on('close', (code) => finish(code))

    const timer = setTimeout(() => {
      killProcessTree(child)
      finish(null, `Quá thời gian chờ ${Math.round((options.timeoutMs ?? 900_000) / 1000)} giây.`)
    }, options.timeoutMs ?? 900_000)
  })
}

function parseFrameRate(raw: unknown): number {
  if (typeof raw !== 'string') return 30
  const [numerator, denominator] = raw.split('/').map(Number)
  const value = denominator ? numerator / denominator : numerator
  return Number.isFinite(value) && value > 0 ? value : 30
}

async function probeVideo(path: string): Promise<CapCutFactoryVideoInfo> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg/FFprobe để đọc thông tin video.')
  const ffprobe = ffprobePath(ffmpeg)
  const result = await captureProcess(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate:format=duration',
      '-of',
      'json',
      path
    ],
    { timeoutMs: 60_000 }
  )
  if (result.status !== 0) {
    throw new Error(`Không đọc được video${result.stderr.trim() ? `: ${result.stderr.trim()}` : '.'}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error('FFprobe trả về dữ liệu video không hợp lệ.')
  }
  if (!isRecord(parsed)) throw new Error('FFprobe không trả về thông tin video.')
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const stream = isRecord(streams[0]) ? streams[0] : {}
  const format = isRecord(parsed.format) ? parsed.format : {}
  const durationSeconds = Number(format.duration)
  const width = Number(stream.width)
  const height = Number(stream.height)
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    throw new Error('Video không có duration/kích thước hợp lệ.')
  }

  return {
    path,
    fileName: basename(path),
    durationSeconds,
    width,
    height,
    fps: parseFrameRate(stream.r_frame_rate)
  }
}

function sanitizeProjectName(value: string): string {
  let name = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  if (!name) name = 'CapCut Project'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`
  return name.slice(0, 120).replace(/[. ]+$/g, '') || 'CapCut Project'
}

async function allocateProjectName(
  baseName: string,
  draftsDir: string,
  reserved: Set<string>
): Promise<{ name: string; renamed: boolean }> {
  const clean = sanitizeProjectName(baseName)
  let candidate = clean
  let index = 2
  while (reserved.has(candidate.toLocaleLowerCase()) || (await isDirectory(join(draftsDir, candidate)))) {
    candidate = sanitizeProjectName(`${clean} (${index++})`)
  }
  reserved.add(candidate.toLocaleLowerCase())
  return { name: candidate, renamed: candidate !== clean }
}

async function validateEmptyTemplate(templateDir: string): Promise<string | null> {
  if (!(await isDirectory(templateDir))) return 'Thư mục template CapCut không tồn tại.'
  const candidates = ['draft_content.json', 'draft_info.json']
  let timelinePath: string | null = null
  for (const fileName of candidates) {
    const candidate = join(templateDir, fileName)
    if (await isFile(candidate)) {
      timelinePath = candidate
      break
    }
  }
  if (!timelinePath) return 'Template phải chứa draft_content.json hoặc draft_info.json.'
  try {
    const parsed = JSON.parse(await readFile(timelinePath, 'utf8')) as unknown
    if (!isRecord(parsed) || !Array.isArray(parsed.tracks)) {
      return 'Timeline trong template không đúng cấu trúc CapCut.'
    }
    const segmentCount = parsed.tracks.reduce((total: number, track: unknown) => {
      if (!isRecord(track) || !Array.isArray(track.segments)) return total
      return total + track.segments.length
    }, 0)
    if (segmentCount > 0) {
      return 'Template phải là project CapCut trống (không có segment trên timeline).'
    }
  } catch (error) {
    return `Không đọc được template: ${error instanceof Error ? error.message : String(error)}`
  }
  return null
}

async function hasOpenDraftLock(draftsDir: string): Promise<boolean> {
  try {
    const children = (await readdir(draftsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .slice(0, 500)
    for (const child of children) {
      if (await isFile(join(draftsDir, child.name, '.locked'))) return true
    }
  } catch {
    return false
  }
  return false
}

function setBaseName(request: CapCutFactoryRequest, videoPath: string): string {
  const prefix = request.projectPrefix?.trim()
  return sanitizeProjectName(prefix || parse(videoPath).name)
}

/**
 * Build an editable CapCut audio segment whose target range is the SRT cue.
 * CapCut's speed is source-duration / cue-duration, matching the atempo ratio
 * used by the "Đọc chữ video" flow while keeping the original voice file.
 */
function buildCapCutVoiceItem(
  entry: VoiceSyncEntry,
  videoDurationSeconds: number
): Record<string, string | number> | null {
  if (entry.status !== 'ok' || !entry.filePath || !entry.durationSeconds) return null
  const start = Math.max(0, entry.startSeconds)
  const end = Math.min(entry.endSeconds, videoDurationSeconds)
  const cueDuration = end - start
  if (!(cueDuration > 0)) return null

  const speed = entry.durationSeconds / cueDuration
  const item: Record<string, string | number> = {
    path: entry.filePath,
    start,
    duration: cueDuration,
    speed: Number(speed.toFixed(6)),
    volume: 1
  }

  // capcut-cli 0.17.2 rejects a target audio duration longer than the source
  // before it applies speed. Its audio compiler ignores `type`, so this marker
  // only skips that over-strict validation for slow-down clips; the generated
  // draft still contains a normal CapCut audio material/segment.
  if (cueDuration > entry.durationSeconds + 0.01) item.type = 'photo'
  return item
}

export async function inspectCapCutFactory(
  request: CapCutFactoryRequest
): Promise<CapCutFactoryPreflightResult> {
  const warnings: string[] = []
  const errors: string[] = []
  const sets: CapCutFactoryPreflightSet[] = []
  const videoPath = request?.videoPath?.trim() ?? ''
  const draftsDir = request?.draftsDir?.trim() ?? ''
  const inputSets = Array.isArray(request?.sets) ? request.sets : []

  if (!videoPath) errors.push('Chưa chọn video nền.')
  else if (!(await isFile(videoPath))) errors.push('Video nền không tồn tại.')
  else if (!VIDEO_EXTENSIONS.has(extname(videoPath).toLowerCase())) {
    errors.push(`Định dạng video chưa được hỗ trợ: ${extname(videoPath) || '(không có đuôi file)'}.`)
  }
  if (!draftsDir) errors.push('Chưa chọn thư mục project CapCut.')
  else if (!(await isDirectory(draftsDir))) {
    // A fresh CapCut installation often has no draft store yet. The CLI can
    // create it, so only reject a known-unwritable parent here.
    const parent = dirname(draftsDir)
    if (await isDirectory(parent)) {
      try {
        await access(parent, constants.R_OK | constants.W_OK)
      } catch {
        errors.push('Không có quyền tạo thư mục project CapCut.')
      }
    } else {
      warnings.push('Thư mục project CapCut chưa tồn tại; ứng dụng sẽ tự tạo khi bấm Tạo project.')
    }
  } else {
    try {
      await access(draftsDir, constants.R_OK | constants.W_OK)
    } catch {
      errors.push('Không có quyền đọc/ghi thư mục project CapCut.')
    }
    if (basename(draftsDir).toLowerCase() !== 'com.lveditor.draft') {
      warnings.push('Thư mục đã chọn không có tên com.lveditor.draft; hãy chắc đây là draft store mà CapCut đang dùng.')
    }
    if (await hasOpenDraftLock(draftsDir)) {
      warnings.push('Đang có draft CapCut mở. Hãy đóng CapCut trước khi bấm Tạo project để tránh metadata bị ghi đè.')
    }
  }
  if (request.templateDir?.trim()) {
    const templateError = await validateEmptyTemplate(request.templateDir.trim())
    if (templateError) errors.push(templateError)
  }
  if (inputSets.length === 0) errors.push('Cần ít nhất một bộ SRT + voice.')

  let video: CapCutFactoryVideoInfo | undefined
  if (errors.length === 0 || (videoPath && (await isFile(videoPath)))) {
    try {
      video = await probeVideo(videoPath)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  let sceneClips: CapCutSceneClip[] | undefined
  if (request.sceneDir?.trim() && video) {
    try {
      sceneClips = await loadSceneClips(request.sceneDir, video.path, video.durationSeconds)
      warnings.push(`${sceneClips.length} scene sẽ được đưa thành các đoạn video riêng trên timeline CapCut.`)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  const reservedNames = new Set<string>()
  const baseName = setBaseName(request, videoPath || 'CapCut Project')
  for (const [index, input] of inputSets.entries()) {
    const label = input.label?.trim() || `Ngôn ngữ ${index + 1}`
    const allocated = draftsDir
      ? await allocateProjectName(`${baseName} - ${label}`, draftsDir, reservedNames)
      : { name: sanitizeProjectName(`${baseName} - ${label}`), renamed: false }
    const itemWarnings: string[] = []
    if (allocated.renamed) itemWarnings.push('Tên project đã tồn tại; hệ thống sẽ dùng tên có hậu tố mới.')
    const result: CapCutFactoryPreflightSet = {
      id: input.id,
      label,
      projectName: allocated.name,
      cueCount: 0,
      audioCount: 0,
      matchedCount: 0,
      sceneGroupCount: undefined,
      crossSceneCueCount: undefined,
      warnings: itemWarnings
    }

    if (!input.srtPath?.trim()) result.error = 'Chưa chọn file SRT.'
    else if (!(await isFile(input.srtPath.trim()))) result.error = 'File SRT không tồn tại.'
    else if (extname(input.srtPath.trim()).toLowerCase() !== '.srt') result.error = 'Subtitle phải là file .srt.'
    else if (!input.voiceDir?.trim()) result.error = 'Chưa chọn thư mục voice.'
    else if (!(await isDirectory(input.voiceDir.trim()))) result.error = 'Thư mục voice không tồn tại.'

    if (!result.error) {
      const scan = await scanVoiceSync(input.srtPath.trim(), input.voiceDir.trim())
      result.cueCount = scan.cueCount
      result.audioCount = scan.audioCount
      result.matchedCount = scan.matchedCount
      if (!scan.ok) result.error = scan.error || 'Số voice chưa khớp 1:1 với SRT.'
      else if (video) {
        const alignedEntries = sceneClips
          ? alignEntriesToScenes(sceneClips, scan.entries, video.durationSeconds)
          : null
        const timelineEntries = alignedEntries ?? scan.entries
        if (sceneClips && alignedEntries) {
          const scenePlan = buildSceneLinkPlan(sceneClips, alignedEntries)
          result.sceneGroupCount = scenePlan.groups.length
          result.crossSceneCueCount = scenePlan.crossSceneCueCount
          if (scenePlan.alignment.shiftedCueCount > 0) {
            itemWarnings.push(
              `${scenePlan.alignment.shiftedCueCount} cue được neo vào đầu scene; ` +
                `dịch tối đa ${scenePlan.alignment.maxShiftSeconds.toFixed(3)}s; voice không bị cắt.`
            )
          }
          itemWarnings.push(
            `${scenePlan.groups.length} nhóm scene logic; subtitle và voice dùng chung mốc scene, không cắt voice.`
          )
          if (scenePlan.crossSceneCueCount > 0) {
            itemWarnings.push(
              `${scenePlan.crossSceneCueCount} cue SRT đi qua ranh giới scene; hệ thống chỉ liên kết logic và giữ nguyên nội dung.`
            )
          }
        }
        const lastCueEnd = Math.max(...timelineEntries.map((entry) => entry.endSeconds), 0)
        if (lastCueEnd > video.durationSeconds + 0.1) {
          result.error = `SRT dài ${lastCueEnd.toFixed(2)}s, vượt video ${video.durationSeconds.toFixed(2)}s.`
        }
        let previousVoiceEnd = 0
        let overlapCount = 0
        let nonMp3Count = 0
        let speedUpCount = 0
        let slowDownCount = 0
        for (const entry of timelineEntries) {
          if (entry.status !== 'ok' || !entry.durationSeconds) continue
          if (entry.startSeconds < previousVoiceEnd - 0.01) overlapCount++
          // Overlap is a property of the SRT cues, not of the unadjusted
          // source voice durations. The CapCut draft fits each clip to this
          // cue window with its speed value.
          previousVoiceEnd = Math.max(previousVoiceEnd, entry.endSeconds)
          const cueDuration = Math.max(0, entry.endSeconds - entry.startSeconds)
          const fitRatio = entry.fitRatio ?? (cueDuration > 0 ? entry.durationSeconds / cueDuration : 1)
          if (fitRatio > 1.01) speedUpCount++
          else if (fitRatio < 0.99) slowDownCount++
          if (entry.fileName && extname(entry.fileName).toLowerCase() !== '.mp3') nonMp3Count++
        }
        if (overlapCount) itemWarnings.push(`${overlapCount} voice bị chồng thời gian; CapCut vẫn giữ nguyên từng clip để chỉnh sửa.`)
        if (speedUpCount || slowDownCount) {
          const details: string[] = []
          if (speedUpCount) details.push(`${speedUpCount} voice tăng tốc`)
          if (slowDownCount) details.push(`${slowDownCount} voice giảm tốc`)
          itemWarnings.push(`${details.join(' và ')} theo đúng thời lượng SRT; file voice gốc không bị thay đổi.`)
        }
        if (nonMp3Count) itemWarnings.push(`${nonMp3Count} file voice không phải MP3 nhưng vẫn là định dạng audio được hỗ trợ.`)
      }
    }
    sets.push(result)
  }

  return {
    ok: errors.length === 0 && sets.length > 0 && sets.every((item) => !item.error),
    video,
    sceneCount: sceneClips?.length,
    sceneGroupCount: sets.find((item) => item.sceneGroupCount !== undefined)?.sceneGroupCount,
    crossSceneCueCount: sets.reduce((total, item) => total + (item.crossSceneCueCount ?? 0), 0) || undefined,
    sceneDir: sceneClips ? resolve(request.sceneDir!.trim()) : undefined,
    sets,
    warnings,
    errors
  }
}

function capCutCliPath(): string {
  const candidates: string[] = []
  if (process.resourcesPath) {
    // Prefer the unpacked copy: the child uses the Electron binary as a
    // Node-compatible runtime, where ordinary directory scans inside asar
    // are not reliable.
    candidates.push(
      join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'capcut-cli', 'dist', 'index.js'),
      join(process.resourcesPath, 'app.asar', 'node_modules', 'capcut-cli', 'dist', 'index.js')
    )
  }
  try {
    const packageJson = require.resolve('capcut-cli/package.json')
    candidates.push(join(dirname(packageJson), 'dist', 'index.js'))
  } catch {
    // Fall through to the explicit packaged-app locations above.
  }
  candidates.push(join(process.cwd(), 'node_modules', 'capcut-cli', 'dist', 'index.js'))
  const resolved = candidates.find((candidate) => existsSync(candidate))
  if (!resolved) {
    throw new Error(
      'Bản cài thiếu CapCut adapter (capcut-cli). Hãy tải lại bản T-blao mới nhất và cài lại ứng dụng.'
    )
  }
  return resolved
}

function childEnvironment(ffprobe: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const currentPath = env[pathKey] ?? ''
  const binaryDir = dirname(ffprobe)
  env[pathKey] = currentPath ? `${binaryDir}${delimiter}${currentPath}` : binaryDir
  return env
}

async function runCli(args: string[], ffprobe: string, job: ActiveJob): Promise<CliResult> {
  if (job.cancelled) return { status: null, stdout: '', stderr: 'Đã hủy.' }
  return captureProcess(process.execPath, [capCutCliPath(), ...args], {
    env: childEnvironment(ffprobe),
    timeoutMs: 30 * 60_000,
    job
  })
}

function cliError(command: string, result: CliResult): string {
  const details = (result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1)
  return `${command} thất bại${details ? `: ${details}` : '.'}`
}

function lintWarnings(result: CliResult): string[] {
  if (result.status === 0 || !result.stdout.trim()) return []
  try {
    const parsed = JSON.parse(result.stdout) as unknown
    if (!isRecord(parsed)) return []
    const issues = Array.isArray(parsed.issues) ? parsed.issues : []
    return issues.slice(0, 20).map((issue) => {
      if (!isRecord(issue)) return String(issue)
      return String(issue.message ?? issue.code ?? 'Cảnh báo lint CapCut')
    })
  } catch {
    return result.stdout.trim().split(/\r?\n/).filter(Boolean).slice(0, 20)
  }
}

function emitProgress(
  callback: (progress: CapCutFactoryProgress) => void,
  progress: CapCutFactoryProgress
): void {
  callback({ ...progress, percent: Math.max(0, Math.min(100, Math.round(progress.percent))) })
}

export async function runCapCutFactory(
  request: CapCutFactoryRequest,
  onProgress: (progress: CapCutFactoryProgress) => void
): Promise<CapCutFactoryResult> {
  if (activeJob) return { ok: false, projects: [], error: 'Đang có một batch CapCut chạy.' }
  const job: ActiveJob = { cancelled: false, child: null }
  activeJob = job
  const projects: CapCutFactoryProjectResult[] = []
  let temporaryRoot: string | null = null

  try {
    emitProgress(onProgress, {
      phase: 'validating',
      percent: 2,
      message: 'Đang kiểm tra video, SRT, voice và cấu hình CapCut…',
      completedProjects: 0,
      totalProjects: request.sets.length
    })
    const preflight = await inspectCapCutFactory(request)
    if (!preflight.ok || !preflight.video) {
      const details = [...preflight.errors, ...preflight.sets.flatMap((item) => item.error ? [`${item.label}: ${item.error}`] : [])]
      return { ok: false, projects, error: details.join('\n') || 'Dữ liệu đầu vào chưa hợp lệ.' }
    }
    await mkdir(request.draftsDir.trim(), { recursive: true })

    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) return { ok: false, projects, error: 'Thiếu FFmpeg/FFprobe.' }
    const ffprobe = ffprobePath(ffmpeg)
    const sceneClips = request.sceneDir?.trim()
      ? await loadSceneClips(request.sceneDir, preflight.video.path, preflight.video.durationSeconds)
      : null
    temporaryRoot = await mkdtemp(join(tmpdir(), 'tblao-capcut-factory-'))
    const total = preflight.sets.length

    for (const [index, input] of request.sets.entries()) {
      const prepared = preflight.sets[index]
      const preparedWarnings = [...preflight.warnings, ...prepared.warnings]
      const projectPath = join(request.draftsDir, prepared.projectName)
      if (job.cancelled) break

      emitProgress(onProgress, {
        phase: 'preparing',
        percent: 5 + (index / total) * 88,
        message: `Đang chuẩn bị ${prepared.projectName}…`,
        currentSetId: input.id,
        currentProjectName: prepared.projectName,
        completedProjects: index,
        totalProjects: total
      })

      const scan = await scanVoiceSync(input.srtPath, input.voiceDir)
      if (!scan.ok) {
        projects.push({
          inputSetId: input.id,
          label: prepared.label,
          projectName: prepared.projectName,
          ok: false,
          warnings: preparedWarnings,
          error: scan.error || 'Voice không còn khớp với SRT.'
        })
        continue
      }

      const alignedEntries = sceneClips
        ? alignEntriesToScenes(sceneClips, scan.entries, preflight.video.durationSeconds)
        : null
      const timelineEntries = alignedEntries ?? scan.entries
      const normalizedSrt = join(temporaryRoot, `subtitles-${index + 1}.srt`)
      const specPath = join(temporaryRoot, `project-${index + 1}.json`)
      await writeFile(normalizedSrt, buildSrtFromEntries(timelineEntries), 'utf8')
      const audioItems = timelineEntries.flatMap((entry) => {
        const item = buildCapCutVoiceItem(entry, preflight.video!.durationSeconds)
        return item ? [item] : []
      })
      const sceneLinkPlan = sceneClips && alignedEntries
        ? buildSceneLinkPlan(sceneClips, alignedEntries)
        : null
      const videoItems = sceneClips
        ? sceneClips.map((scene) => ({
            path: scene.filePath,
            start: scene.startSeconds,
            duration: scene.durationSeconds,
            width: preflight.video!.width,
            height: preflight.video!.height,
            volume: request.muteOriginalVideo === false ? 1 : 0
          }))
        : [
            {
              path: preflight.video.path,
              start: 0,
              duration: preflight.video.durationSeconds,
              width: preflight.video.width,
              height: preflight.video.height,
              volume: request.muteOriginalVideo === false ? 1 : 0
            }
          ]
      const spec: CompileSpec = {
        name: prepared.projectName,
        width: preflight.video.width,
        height: preflight.video.height,
        fps: preflight.video.fps,
        ratio: 'original',
        tracks: [
          {
            type: 'video',
            name: 'Video nền',
            items: videoItems
          },
          { type: 'audio', name: 'Voice', items: audioItems }
        ],
        operations: [{ op: 'captions', path: normalizedSrt, trackName: 'Phụ đề' }]
      }
      await writeFile(specPath, JSON.stringify(spec), 'utf8')

      emitProgress(onProgress, {
        phase: 'creating',
        percent: 10 + (index / total) * 88,
        message: `Đang tạo project ${index + 1}/${total}: ${prepared.projectName}`,
        currentSetId: input.id,
        currentProjectName: prepared.projectName,
        completedProjects: index,
        totalProjects: total
      })
      const compileArgs = ['compile', specPath, '--drafts', request.draftsDir]
      if (request.templateDir?.trim()) compileArgs.push('--template', request.templateDir.trim())
      const compile = await runCli(compileArgs, ffprobe, job)
      if (job.cancelled) {
        projects.push({
          inputSetId: input.id,
          label: prepared.label,
          projectName: prepared.projectName,
          projectPath: (await isDirectory(projectPath)) ? projectPath : undefined,
          ok: false,
          warnings: preparedWarnings,
          error: 'Đã hủy trong khi tạo project.'
        })
        break
      }
      if (compile.status !== 0) {
        projects.push({
          inputSetId: input.id,
          label: prepared.label,
          projectName: prepared.projectName,
          projectPath: (await isDirectory(projectPath)) ? projectPath : undefined,
          ok: false,
          warnings: preparedWarnings,
          error: cliError('Tạo draft', compile)
        })
        continue
      }

      emitProgress(onProgress, {
        phase: 'verifying',
        percent: 10 + ((index + 0.75) / total) * 88,
        message: `Đang kiểm tra timeline ${prepared.projectName}…`,
        currentSetId: input.id,
        currentProjectName: prepared.projectName,
        completedProjects: index,
        totalProjects: total
      })
      const sync = await runCli(['sync-timelines', projectPath, '--apply'], ffprobe, job)
      const registration = job.cancelled
        ? { status: null, stdout: '', stderr: 'Đã hủy.' }
        : await runCli(
            ['register', projectPath, '--apply', '--drafts', request.draftsDir],
            ffprobe,
            job
          )
      const lint = job.cancelled
        ? { status: null, stdout: '', stderr: 'Đã hủy.' }
        : await runCli(['lint', projectPath], ffprobe, job)
      const projectWarnings = [...preparedWarnings]
      let sceneLinkManifestPath: string | undefined
      let portableManifestPath: string | undefined
      if (sync.status !== 0) projectWarnings.push(cliError('Đồng bộ mirror timeline', sync))
      projectWarnings.push(...lintWarnings(lint))
      if (sceneLinkPlan) {
        try {
          const sceneLinkResult = await writeSceneLinkManifest(
            projectPath,
            prepared.projectName,
            sceneClips!,
            alignedEntries!
          )
          sceneLinkManifestPath = sceneLinkResult.path
          projectWarnings.push(
            `Đã ghi tblao-scene-links.json: ${sceneLinkPlan.groups.length} nhóm logic, ` +
              `${sceneLinkPlan.crossSceneCueCount} cue xuyên scene; voice không bị cắt.`
          )
          projectWarnings.push(...sceneLinkResult.warnings)
        } catch (error) {
          projectWarnings.push(
            `Không ghi được scene map không phá hủy: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      try {
        portableManifestPath = await writePortableCapCutManifest(projectPath, prepared.projectName)
        projectWarnings.push('Da ghi tblao-portable.json de co the di chuyen project sang may Windows khac.')
      } catch (error) {
        projectWarnings.push(
          `Khong ghi duoc manifest portable; project van duoc tao nhung can relink thu cong: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      const lintFailed = lint.status === null || lint.status >= 2
      const registrationFailed = registration.status !== 0
      const verificationError = registrationFailed
        ? cliError('Đăng ký project với CapCut', registration)
        : lintFailed
          ? cliError('Kiểm tra draft', lint)
          : undefined
      projects.push({
        inputSetId: input.id,
        label: prepared.label,
        projectName: prepared.projectName,
        projectPath,
        sceneLinkManifestPath,
        portableManifestPath,
        ok: !registrationFailed && !lintFailed && !job.cancelled,
        warnings: projectWarnings,
        error: job.cancelled ? 'Đã hủy.' : verificationError
      })
    }

    if (job.cancelled) {
      emitProgress(onProgress, {
        phase: 'cancelled',
        percent: 0,
        message: 'Đã dừng batch CapCut.',
        completedProjects: projects.filter((project) => project.ok).length,
        totalProjects: preflight.sets.length
      })
      return { ok: false, cancelled: true, draftsDir: request.draftsDir, projects }
    }

    const successCount = projects.filter((project) => project.ok).length
    const ok = successCount === preflight.sets.length
    emitProgress(onProgress, {
      phase: ok ? 'done' : 'error',
      percent: 100,
      message: ok
        ? `Đã tạo xong ${successCount} project CapCut.`
        : `Đã tạo ${successCount}/${preflight.sets.length} project; có mục cần kiểm tra.`,
      completedProjects: successCount,
      totalProjects: preflight.sets.length
    })
    return {
      ok,
      draftsDir: request.draftsDir,
      projects,
      error: ok ? undefined : 'Một hoặc nhiều project chưa tạo/kiểm tra thành công.'
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitProgress(onProgress, {
      phase: 'error',
      percent: 0,
      message,
      completedProjects: projects.filter((project) => project.ok).length,
      totalProjects: request.sets?.length ?? 0
    })
    return { ok: false, projects, error: message }
  } finally {
    if (job.child) killProcessTree(job.child)
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
    if (activeJob === job) activeJob = null
  }
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.unref()
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    /* process đã thoát */
  }
}

export function cancelCapCutFactory(): CapCutFactoryCancelResult {
  const job = activeJob
  if (!job) return { ok: true, wasRunning: false }
  job.cancelled = true
  if (job.child) killProcessTree(job.child)
  return { ok: true, wasRunning: true }
}
