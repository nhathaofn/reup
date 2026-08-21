import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import {
  type ContentBlockAnalyzeRequest,
  type ContentBlockAnalyzeResult,
  type ContentBlockCancelResult,
  type ContentBlockCapCutExportRequest,
  type ContentBlockCapCutExportResult,
  type ContentBlockEditRequest,
  type ContentBlockEditResult,
  type ContentBlockProgress,
  type LocaleAssetImportRequest,
  type LocaleAssetImportResult,
  type TimelineBuildRequest,
  type TimelineBuildResult,
  type VariantCreateRequest,
  type VariantCreateResult
} from '../../shared/features/content-blocks.ts'
import {
  assertLocaleMatchesSource,
  assertSourceFingerprint,
  assertVariantMatchesSource,
  fingerprintSourceManifest,
  readLocaleAssetManifest,
  readRenderTimeline,
  readSourceBlockManifest,
  readVariantPlan,
  sha256File,
  validateRenderTimeline,
  validateSourceBlockManifest,
  writeArtifactAtomic
} from './contentBlockManifest.ts'
import { analyzeContentBlocks } from './contentBlockAnalyzer.ts'
import { applyContentBlockEdits } from './contentBlockEdits.ts'
import { importLocaleAssetsFromFiles } from './localeAssetImporter.ts'
import { createVariantPlan } from './blockVariantPlanner.ts'
import { buildRenderTimeline } from './blockTimeline.ts'
import { serializeRenderTimelineSrt } from './blockSrt.ts'
import { probeVideoMetadata, type VideoProbeInfo } from './mediaProbe.ts'
import { adaptRenderTimelineToCapCut } from './capCutBlockAdapter.ts'
import { generateNativeCapCutProject, validateNativeCapCutTemplate, type NativeCapCutProjectInput } from './nativeCapCutGenerator.ts'
import { writePortableCapCutManifest } from './capcutPortability.ts'

type ProgressSink = (progress: ContentBlockProgress) => void

export interface ContentBlockWorkflowDependencies {
  hashFile: typeof sha256File
  probeVideo: typeof probeVideoMetadata
  analyzeSource: typeof analyzeContentBlocks
  importLocaleFromFiles: typeof importLocaleAssetsFromFiles
  generateProject: typeof generateNativeCapCutProject
  writePortableManifest: typeof writePortableCapCutManifest
}

interface ActiveOperation {
  cancelled: boolean
}

function safePath(path: string, label: string): string {
  if (!path.trim() || !isAbsolute(path)) throw new Error(`${label} phải là đường dẫn tuyệt đối.`)
  return resolve(path)
}

function safeFileSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) throw new Error(`${label} không hợp lệ.`)
  return value
}

function emitProgress(sink: ProgressSink | undefined, progress: ContentBlockProgress): void {
  if (!sink) return
  sink({ ...progress, percent: Math.max(0, Math.min(100, progress.percent)) })
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}

export async function detectOpenCapCutDraftLock(draftsDir: string): Promise<boolean> {
  try {
    const children = (await readdir(draftsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .slice(0, 500)
    for (const child of children) {
      try {
        if ((await stat(join(draftsDir, child.name, '.locked'))).isFile()) return true
      } catch {
        /* draft này không bị lock */
      }
    }
  } catch {
    /* thư mục có thể được tạo sau khi các gate khác đã pass */
  }
  return false
}

function warningList(manifest: { blocks: Array<{ id: string; issues: string[] }> }): string[] {
  return manifest.blocks.flatMap((block) => [
    ...(block.issues.includes('srt-fallback') ? [`Block ${block.id} dùng fallback theo SRT và cần review.`] : []),
    ...(block.issues.includes('odd-unpaired-cue') ? [`Block ${block.id} có cue lẻ chưa ghép.`] : [])
  ])
}

function createLongOperationGuard(): {
  enter(): ActiveOperation
  leave(operation: ActiveOperation): void
  ensureIdle(): void
  cancel(): ContentBlockCancelResult
} {
  let active: ActiveOperation | null = null
  return {
    enter(): ActiveOperation {
      if (active) throw new Error('Đang có một tác vụ Content Block khác chạy.')
      active = { cancelled: false }
      return active
    },
    leave(operation: ActiveOperation): void {
      if (active === operation) active = null
    },
    ensureIdle(): void {
      if (active) throw new Error('Đang có một tác vụ Content Block khác chạy.')
    },
    cancel(): ContentBlockCancelResult {
      if (!active) return { ok: true, wasRunning: false }
      active.cancelled = true
      return { ok: true, wasRunning: true }
    }
  }
}

export interface ContentBlockWorkflow {
  analyze(request: ContentBlockAnalyzeRequest, onProgress?: ProgressSink): Promise<ContentBlockAnalyzeResult>
  editManifest(request: ContentBlockEditRequest): Promise<ContentBlockEditResult>
  importLocale(request: LocaleAssetImportRequest, onProgress?: ProgressSink): Promise<LocaleAssetImportResult>
  createVariant(request: VariantCreateRequest): Promise<VariantCreateResult>
  buildTimeline(request: TimelineBuildRequest): Promise<TimelineBuildResult>
  exportCapCut(request: ContentBlockCapCutExportRequest, onProgress?: ProgressSink): Promise<ContentBlockCapCutExportResult>
  cancel(): ContentBlockCancelResult
}

export function createContentBlockWorkflow(
  overrides: Partial<ContentBlockWorkflowDependencies> = {}
): ContentBlockWorkflow {
  const dependencies: ContentBlockWorkflowDependencies = {
    hashFile: sha256File,
    probeVideo: probeVideoMetadata,
    analyzeSource: analyzeContentBlocks,
    importLocaleFromFiles: importLocaleAssetsFromFiles,
    generateProject: generateNativeCapCutProject,
    writePortableManifest: writePortableCapCutManifest,
    ...overrides
  }
  const guard = createLongOperationGuard()

  const analyze = async (request: ContentBlockAnalyzeRequest, onProgress?: ProgressSink): Promise<ContentBlockAnalyzeResult> => {
    let operation: ActiveOperation
    try { operation = guard.enter() } catch (error) {
      return { ok: false, warnings: [], error: error instanceof Error ? error.message : String(error) }
    }
    try {
      emitProgress(onProgress, { phase: 'validating', percent: 2, message: 'Đang kiểm tra source Content Block.' })
      const result = await dependencies.analyzeSource(request, { fingerprintFile: dependencies.hashFile })
      emitProgress(onProgress, { phase: result.ok ? 'done' : 'error', percent: result.ok ? 100 : 100, message: result.ok ? 'Đã tạo source block manifest.' : result.error ?? 'Analyze thất bại.' })
      return result
    } catch (error) {
      return { ok: false, warnings: [], error: error instanceof Error ? error.message : String(error) }
    } finally {
      guard.leave(operation)
    }
  }

  const editManifest = async (request: ContentBlockEditRequest): Promise<ContentBlockEditResult> => {
    try {
      guard.ensureIdle()
      const source = await readSourceBlockManifest(safePath(request.manifestPath, 'manifestPath'))
      const edited = applyContentBlockEdits(source, request.operations)
      await writeArtifactAtomic(request.manifestPath, edited, validateSourceBlockManifest)
      return { ok: true, manifestPath: request.manifestPath, manifest: edited, sourceManifestFingerprint: fingerprintSourceManifest(edited), warnings: warningList(edited) }
    } catch (error) {
      return { ok: false, warnings: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  const importLocale = async (request: LocaleAssetImportRequest, onProgress?: ProgressSink): Promise<LocaleAssetImportResult> => {
    let operation: ActiveOperation
    try { operation = guard.enter() } catch (error) {
      return { ok: false, missingCueIds: [], invalidCueIds: [], extraFiles: [], error: error instanceof Error ? error.message : String(error) }
    }
    try {
      emitProgress(onProgress, { phase: 'probing-voice', percent: 20, message: `Đang nhập voice ${request.locale}.` })
      const result = await dependencies.importLocaleFromFiles(request)
      emitProgress(onProgress, { phase: result.ok ? 'done' : 'error', percent: 100, message: result.ok ? `Đã nhập locale ${request.locale}.` : result.error ?? 'Nhập locale thất bại.' })
      return result
    } catch (error) {
      return { ok: false, missingCueIds: [], invalidCueIds: [], extraFiles: [], error: error instanceof Error ? error.message : String(error) }
    } finally {
      guard.leave(operation)
    }
  }

  const createVariant = async (request: VariantCreateRequest): Promise<VariantCreateResult> => {
    try {
      guard.ensureIdle()
      const projectDir = safePath(request.projectDir, 'projectDir')
      const sourcePath = safePath(request.sourceManifestPath, 'sourceManifestPath')
      const variantId = safeFileSegment(request.variantId, 'variantId')
      const source = await readSourceBlockManifest(sourcePath)
      const variant = createVariantPlan(source, request)
      const variantPath = join(projectDir, 'variants', `${variantId}.json`)
      await writeArtifactAtomic(variantPath, variant, (value) => value as typeof variant)
      return { ok: true, variantPath, variant }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const buildTimeline = async (request: TimelineBuildRequest): Promise<TimelineBuildResult> => {
    try {
      guard.ensureIdle()
      const projectDir = safePath(request.projectDir, 'projectDir')
      const source = await readSourceBlockManifest(safePath(request.sourceManifestPath, 'sourceManifestPath'))
      const locale = await readLocaleAssetManifest(safePath(request.localeManifestPath, 'localeManifestPath'))
      const variant = await readVariantPlan(safePath(request.variantPath, 'variantPath'))
      const timeline = buildRenderTimeline(source, locale, variant, request)
      const localeSegment = safeFileSegment(locale.locale, 'locale')
      const timelinePath = join(projectDir, 'timelines', `${variant.variantId}.${localeSegment}.json`)
      const subtitlePath = join(projectDir, 'exports', 'subtitles', `${variant.variantId}.${localeSegment}.srt`)
      await writeArtifactAtomic(timelinePath, timeline, validateRenderTimeline)
      await mkdir(join(projectDir, 'exports', 'subtitles'), { recursive: true })
      await writeFile(subtitlePath, serializeRenderTimelineSrt(timeline), 'utf8')
      return { ok: true, timelinePath, subtitlePath, timeline }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const exportCapCut = async (request: ContentBlockCapCutExportRequest, onProgress?: ProgressSink): Promise<ContentBlockCapCutExportResult> => {
    let operation: ActiveOperation
    try { operation = guard.enter() } catch (error) {
      return { ok: false, warnings: [], error: error instanceof Error ? error.message : String(error) }
    }
    try {
      emitProgress(onProgress, { phase: 'validating', percent: 2, message: 'Đang kiểm tra artifact Content Block.' })
      const source = await readSourceBlockManifest(safePath(request.sourceManifestPath, 'sourceManifestPath'))
      emitProgress(onProgress, { phase: 'hashing', percent: 8, message: 'Đang xác minh fingerprint video source.' })
      assertSourceFingerprint(await dependencies.hashFile(source.source.path), source.source.fingerprint, 'Video source')
      const locale = await readLocaleAssetManifest(safePath(request.localeManifestPath, 'localeManifestPath'))
      const timeline = await readRenderTimeline(safePath(request.timelinePath, 'timelinePath'))
      assertLocaleMatchesSource(locale, source)
      assertSourceFingerprint(timeline.sourceManifestFingerprint, fingerprintSourceManifest(source), 'Timeline')
      if (timeline.reviewBlockIds.length) throw new Error(`Timeline còn block needs-review: ${timeline.reviewBlockIds.join(', ')}.`)
      for (const block of Object.values(locale.blocks)) {
        for (const cue of block.cues) if (!(await isFile(cue.voicePath))) throw new Error(`Thiếu voice asset: ${cue.voicePath}`)
      }
      const draftsDir = safePath(request.draftsDir, 'draftsDir')
      const templateDir = safePath(request.templateDir, 'templateDir')
      const projectName = safeFileSegment(request.projectName, 'projectName')
      if (await detectOpenCapCutDraftLock(draftsDir)) throw new Error('Có draft CapCut đang mở; hãy đóng CapCut trước khi export.')
      const templateError = await validateNativeCapCutTemplate(templateDir)
      if (templateError) throw new Error(templateError)
      const projectPath = join(draftsDir, projectName)
      if (await isFile(join(projectPath, 'draft_content.json'))) throw new Error(`Project đích đã tồn tại: ${projectPath}`)
      const video = await dependencies.probeVideo(source.source.path)
      if (Math.abs(video.durationUs - source.source.durationUs) > 50_000 || Math.abs(video.fps - source.source.fps) > 0.01) {
        throw new Error('Video source hiện tại không khớp metadata của source manifest.')
      }
      if (operation.cancelled) return { ok: false, cancelled: true, warnings: [], error: 'Đã hủy.' }
      emitProgress(onProgress, { phase: 'creating-capcut', percent: 45, message: 'Đang tạo draft CapCut.' })
      const items = adaptRenderTimelineToCapCut({ source, locale, timeline, width: video.width, height: video.height, muteOriginalVideo: request.muteOriginalVideo ?? true })
      await mkdir(draftsDir, { recursive: true })
      const generatorInput: NativeCapCutProjectInput = {
        projectPath,
        projectName,
        templateDir,
        width: video.width,
        height: video.height,
        fps: video.fps,
        videoItems: items.videoItems,
        audioItems: items.audioItems,
        textItems: items.textItems,
        onProgress: (message) => emitProgress(onProgress, { phase: 'creating-capcut', percent: 70, message }),
        isCancelled: () => operation.cancelled
      }
      const generated = await dependencies.generateProject(generatorInput)
      const warnings = [...items.warnings]
      let portableManifestPath: string | undefined
      try {
        portableManifestPath = await dependencies.writePortableManifest(projectPath, projectName)
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error))
      }
      const provenanceManifestPath = join(projectPath, 'tblao-content-blocks.json')
      await writeFile(provenanceManifestPath, `${JSON.stringify({
        schemaVersion: 1,
        kind: 'tblao.content-blocks.capcut',
        sourceManifestPath: resolve(request.sourceManifestPath),
        localeManifestPath: resolve(request.localeManifestPath),
        timelinePath: resolve(request.timelinePath),
        sourceManifestFingerprint: fingerprintSourceManifest(source),
        variantId: timeline.variantId,
        locale: timeline.locale,
        blockOrder: timeline.items.map((item) => item.blockId),
        generatedAt: new Date().toISOString()
      }, null, 2)}\n`, 'utf8')
      emitProgress(onProgress, { phase: 'done', percent: 100, message: 'Đã tạo draft CapCut.' })
      return {
        ok: true,
        projectPath,
        portableManifestPath,
        provenanceManifestPath,
        videoSegmentCount: generated.videoSegmentIds.length,
        audioSegmentCount: generated.audioSegmentIds.length,
        textSegmentCount: generated.textSegmentIds.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emitProgress(onProgress, { phase: 'error', percent: 100, message })
      return { ok: false, warnings: [], error: message }
    } finally {
      guard.leave(operation)
    }
  }

  return { analyze, editManifest, importLocale, createVariant, buildTimeline, exportCapCut, cancel: guard.cancel }
}
