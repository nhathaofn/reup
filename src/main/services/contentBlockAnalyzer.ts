import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  type ContentBlockAnalyzeRequest,
  type SourceBlockManifest,
  type SourceDialogueCue
} from '../../shared/features/content-blocks.ts'
import { parseSrt, readSrtFile, srtTimeToSeconds } from './srt.ts'
import {
  fingerprintSourceManifest,
  readSourceBlockManifest,
  sha256File,
  validateSourceBlockManifest,
  writeArtifactAtomic
} from './contentBlockManifest.ts'
import { groupDialoguePairs } from './dialogueGrouper.ts'
import { resolveBlockBoundaries, type BoundaryResolverConfig } from './boundaryResolver.ts'
import { probeVideoMetadata, type VideoProbeInfo } from './mediaProbe.ts'

function normalizedPath(path: string): string {
  return resolve(path).replace(/[\\/]+$/u, '').toLocaleLowerCase()
}

function timestampToMicroseconds(timestamp: string, label: string): number {
  if (!/^\d+:\d{2}:\d{2}[,.]\d{3}$/u.test(timestamp.trim())) {
    throw new Error(`${label} có timestamp không hợp lệ.`)
  }
  const seconds = srtTimeToSeconds(timestamp)
  if (!Number.isFinite(seconds)) throw new Error(`${label} có timestamp không hợp lệ.`)
  return Math.round(seconds * 1_000_000)
}

export function parseContentBlockSrt(raw: string): SourceDialogueCue[] {
  const cues = parseSrt(raw)
  if (!cues.length) throw new Error('Source SRT không có cue hợp lệ.')
  return cues.map((cue, index) => {
    const sourceStartUs = timestampToMicroseconds(cue.a, `Cue ${index + 1}`)
    const sourceEndUs = timestampToMicroseconds(cue.b, `Cue ${index + 1}`)
    if (sourceEndUs <= sourceStartUs) throw new Error(`Cue ${index + 1} có timestamp không hợp lệ.`)
    return {
      cueId: `cue-${String(index + 1).padStart(3, '0')}`,
      sourceIndex: index + 1,
      role: 'statement' as const,
      text: cue.chu.replace(/\\N/gu, '\n'),
      sourceStartUs,
      sourceEndUs
    }
  })
}

export function parseSceneBoundaryCandidates(raw: string, sourcePath: string): number[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`Không đọc được scene manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray((parsed as { scenes?: unknown }).scenes)) {
    throw new Error('Scene manifest phải có trường scenes dạng array.')
  }
  const targetPath = normalizedPath(sourcePath)
  const boundaries = (parsed as { scenes: unknown[] }).scenes
    .filter((scene): scene is Record<string, unknown> => Boolean(scene) && typeof scene === 'object' && !Array.isArray(scene))
    .filter((scene) => typeof scene.sourceVideo === 'string' && normalizedPath(scene.sourceVideo) === targetPath)
    .map((scene) => Number(scene.endSeconds))
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0)
    .map((seconds) => Math.round(seconds * 1_000_000))
    .filter((value) => Number.isSafeInteger(value) && value > 0)
  const unique = [...new Set(boundaries)].sort((left, right) => left - right)
  if (!unique.length) throw new Error('Scene manifest không có scene cho source video đã chọn.')
  return unique
}

export interface BuildSourceBlockManifestInput {
  sourcePath: string
  sourceFingerprint: `sha256:${string}`
  durationUs: number
  fps: number
  cues: SourceDialogueCue[]
  sceneBoundaryUs: number[]
  previousManifest?: SourceBlockManifest
  makeBlockId: () => string
  config?: Partial<BoundaryResolverConfig>
}

export function buildSourceBlockManifest(input: BuildSourceBlockManifestInput): SourceBlockManifest {
  const draftGroups = groupDialoguePairs(input.cues, { makeBlockId: input.makeBlockId })
  const priorIds = new Map(
    (input.previousManifest?.blocks ?? []).map((block) => [block.cueIds.join('\u0000'), block.id])
  )
  const groups = draftGroups.map((group) => ({
    ...group,
    id: priorIds.get(group.cueIds.join('\u0000')) ?? group.id
  }))
  const manifest: SourceBlockManifest = {
    schemaVersion: 1,
    source: { path: input.sourcePath, fingerprint: input.sourceFingerprint, durationUs: input.durationUs, fps: input.fps },
    revision: input.previousManifest ? input.previousManifest.revision + 1 : 1,
    blocks: resolveBlockBoundaries({
      groups,
      allCues: input.cues,
      sceneBoundaryUs: input.sceneBoundaryUs,
      sourceDurationUs: input.durationUs,
      config: input.config
    })
  }
  return validateSourceBlockManifest(manifest)
}

export interface ContentBlockAnalyzerDependencies {
  probeVideo: (path: string) => Promise<VideoProbeInfo>
  fingerprintFile: typeof sha256File
  makeBlockId: () => string
}

function absoluteInput(path: string, label: string): string {
  if (!path.trim() || !isAbsolute(path)) throw new Error(`${label} phải là đường dẫn tuyệt đối.`)
  return resolve(path)
}

async function ensureFile(path: string, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error(`${label} không phải file.`)
  } catch (error) {
    throw new Error(`${label} không tồn tại: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function analyzeContentBlocks(
  request: ContentBlockAnalyzeRequest,
  dependencies: Partial<ContentBlockAnalyzerDependencies> = {}
): Promise<import('../../shared/features/content-blocks.ts').ContentBlockAnalyzeResult> {
  try {
    const projectDir = absoluteInput(request.projectDir, 'projectDir')
    const videoPath = absoluteInput(request.videoPath, 'videoPath')
    const srtPath = absoluteInput(request.srtPath, 'srtPath')
    const sceneManifestPath = absoluteInput(request.sceneManifestPath, 'sceneManifestPath')
    await ensureFile(videoPath, 'Video source')
    await ensureFile(srtPath, 'Source SRT')
    await ensureFile(sceneManifestPath, 'Scene manifest')
    await mkdir(projectDir, { recursive: true })

    const fingerprintFile = dependencies.fingerprintFile ?? sha256File
    const probeVideo = dependencies.probeVideo ?? (async (path: string) => probeVideoMetadata(path))
    const sourceFingerprint = await fingerprintFile(videoPath)
    const video = await probeVideo(videoPath)
    const cues = parseContentBlockSrt(readSrtFile(srtPath))
    if (cues[cues.length - 1].sourceEndUs > video.durationUs) {
      throw new Error('Cue cuối của source SRT vượt quá thời lượng video.')
    }
    const sceneBoundaryUs = parseSceneBoundaryCandidates(await readFile(sceneManifestPath, 'utf8'), videoPath)

    let previousManifest: SourceBlockManifest | undefined
    if (request.existingManifestPath) {
      const existingPath = absoluteInput(request.existingManifestPath, 'existingManifestPath')
      try {
        const candidate = await readSourceBlockManifest(existingPath)
        if (normalizedPath(candidate.source.path) === normalizedPath(videoPath) && candidate.source.fingerprint === sourceFingerprint) {
          previousManifest = candidate
        }
      } catch {
        /* Existing artifacts are optional; a malformed/stale one is rebuilt. */
      }
    }

    const manifest = buildSourceBlockManifest({
      sourcePath: videoPath,
      sourceFingerprint,
      durationUs: video.durationUs,
      fps: video.fps,
      cues,
      sceneBoundaryUs,
      previousManifest,
      makeBlockId: dependencies.makeBlockId ?? (() => `block-${randomUUID()}`),
      config: {
        boundaryWindowUs: request.boundaryWindowUs,
        minimumBlockDurationUs: request.minimumBlockDurationUs,
        srtFallbackPaddingUs: request.srtFallbackPaddingUs
      }
    })
    const manifestPath = resolve(projectDir, 'analysis', 'source-blocks.json')
    await writeArtifactAtomic(manifestPath, manifest, validateSourceBlockManifest)
    const warnings = manifest.blocks.flatMap((block) => [
      ...(block.issues.includes('srt-fallback') ? [`Block ${block.id} dùng fallback theo SRT và cần review.`] : []),
      ...(block.issues.includes('odd-unpaired-cue') ? [`Block ${block.id} có cue lẻ chưa ghép.`] : [])
    ])
    return {
      ok: true,
      manifestPath,
      manifest,
      sourceManifestFingerprint: fingerprintSourceManifest(manifest),
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
