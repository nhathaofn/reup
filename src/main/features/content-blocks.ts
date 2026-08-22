import { app, dialog, type OpenDialogOptions } from 'electron'
import {
  CONTENT_BLOCK_FEATURE_CHANNELS as CHANNELS,
  FEATURE_ID,
  type ContentBlockAnalyzeRequest,
  type ContentBlockAnalyzeResult,
  type ContentBlockCancelResult,
  type ContentBlockCapCutExportRequest,
  type ContentBlockCapCutExportResult,
  type ContentBlockEditRequest,
  type ContentBlockEditResult,
  type ContentBlockPickKind,
  type ContentBlockProgress,
  type LocaleAssetImportRequest,
  type LocaleAssetImportResult,
  type TimelineBuildRequest,
  type TimelineBuildResult,
  type VariantCreateRequest,
  type VariantCreateResult
} from '../../shared/features/content-blocks'
import { createContentBlockWorkflow } from '../services/contentBlockWorkflow'
import type { MainFeatureModule } from './contracts'

const workflow = createContentBlockWorkflow()

function pickerOptions(kind: ContentBlockPickKind): OpenDialogOptions {
  if (kind === 'directory') return { properties: ['openDirectory', 'createDirectory'] }
  if (kind === 'video') return { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts'] }] }
  if (kind === 'srt') return { properties: ['openFile'], filters: [{ name: 'SubRip subtitle', extensions: ['srt'] }] }
  return { properties: ['openFile'], filters: [{ name: 'JSON manifest', extensions: ['json'] }] }
}

export const contentBlocksMainFeature = {
  id: FEATURE_ID,
  register({ handle, emit }) {
    app.once('before-quit', () => workflow.cancel())
    const progress = (event: ContentBlockProgress): void => emit(CHANNELS.progress, event)

    handle<[ContentBlockPickKind], string | null>(CHANNELS.pickPath, async (_event, kind) => {
      if (!['video', 'srt', 'json', 'directory'].includes(kind)) throw new Error('Loại path không hợp lệ.')
      const result = await dialog.showOpenDialog(pickerOptions(kind))
      return result.canceled ? null : result.filePaths[0] ?? null
    })
    handle<[ContentBlockAnalyzeRequest], ContentBlockAnalyzeResult>(CHANNELS.analyze, (_event, request) => workflow.analyze(request, progress))
    handle<[ContentBlockEditRequest], ContentBlockEditResult>(CHANNELS.editManifest, (_event, request) => workflow.editManifest(request))
    handle<[LocaleAssetImportRequest], LocaleAssetImportResult>(CHANNELS.importLocale, (_event, request) => workflow.importLocale(request, progress))
    handle<[VariantCreateRequest], VariantCreateResult>(CHANNELS.createVariant, (_event, request) => workflow.createVariant(request))
    handle<[TimelineBuildRequest], TimelineBuildResult>(CHANNELS.buildTimeline, (_event, request) => workflow.buildTimeline(request))
    handle<[ContentBlockCapCutExportRequest], ContentBlockCapCutExportResult>(CHANNELS.exportCapCut, (_event, request) => workflow.exportCapCut(request, progress))
    handle<[], ContentBlockCancelResult>(CHANNELS.cancel, () => workflow.cancel())
  }
} satisfies MainFeatureModule
