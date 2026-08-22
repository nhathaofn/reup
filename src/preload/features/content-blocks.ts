import { ipcRenderer } from 'electron'
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
import type { PreloadFeatureModule } from './contracts'

function subscribe<Payload>(channel: string, listener: (payload: Payload) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: Payload): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  contentBlockPickPath: (kind: ContentBlockPickKind): Promise<string | null> =>
    ipcRenderer.invoke(CHANNELS.pickPath, kind),
  analyzeContentBlocks: (request: ContentBlockAnalyzeRequest): Promise<ContentBlockAnalyzeResult> =>
    ipcRenderer.invoke(CHANNELS.analyze, request),
  editContentBlockManifest: (request: ContentBlockEditRequest): Promise<ContentBlockEditResult> =>
    ipcRenderer.invoke(CHANNELS.editManifest, request),
  importContentBlockLocale: (request: LocaleAssetImportRequest): Promise<LocaleAssetImportResult> =>
    ipcRenderer.invoke(CHANNELS.importLocale, request),
  createContentBlockVariant: (request: VariantCreateRequest): Promise<VariantCreateResult> =>
    ipcRenderer.invoke(CHANNELS.createVariant, request),
  buildContentBlockTimeline: (request: TimelineBuildRequest): Promise<TimelineBuildResult> =>
    ipcRenderer.invoke(CHANNELS.buildTimeline, request),
  exportContentBlockCapCut: (request: ContentBlockCapCutExportRequest): Promise<ContentBlockCapCutExportResult> =>
    ipcRenderer.invoke(CHANNELS.exportCapCut, request),
  cancelContentBlocks: (): Promise<ContentBlockCancelResult> => ipcRenderer.invoke(CHANNELS.cancel),
  onContentBlockProgress: (listener: (progress: ContentBlockProgress) => void): (() => void) =>
    subscribe(CHANNELS.progress, listener)
}

export const contentBlocksPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
