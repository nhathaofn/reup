import { ipcRenderer } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type SrtAnalyzeRequest,
  type SrtAnalyzeResult,
  type SrtCancelRequest,
  type SrtCancelResult,
  type SrtExportAllRequest,
  type SrtExportOneRequest,
  type SrtExportResult,
  type SrtLoadRequest,
  type SrtLoadResult,
  type SrtLocalizationProgress,
  type SrtLocalizationTranslateRequest,
  type SrtLocalizationTranslateResult,
  type SrtReleaseRequest,
  type SrtReleaseResult,
  type SrtResolveRequest,
  type SrtResolveResult
} from '../../shared/features/srt-translator'
import type { PreloadFeatureModule } from './contracts'

const api = {
  loadSrtTranslator: (request: SrtLoadRequest): Promise<SrtLoadResult> => ipcRenderer.invoke(FEATURE_CHANNELS.load, request),
  analyzeSrtTranslator: (request: SrtAnalyzeRequest): Promise<SrtAnalyzeResult> => ipcRenderer.invoke(FEATURE_CHANNELS.analyze, request),
  resolveSrtTranslator: (request: SrtResolveRequest): Promise<SrtResolveResult> => ipcRenderer.invoke(FEATURE_CHANNELS.resolve, request),
  runSrtTranslator: (request: SrtLocalizationTranslateRequest): Promise<SrtLocalizationTranslateResult> => ipcRenderer.invoke(FEATURE_CHANNELS.translate, request),
  cancelSrtTranslator: (request: SrtCancelRequest): Promise<SrtCancelResult> => ipcRenderer.invoke(FEATURE_CHANNELS.cancel, request),
  releaseSrtTranslator: (request: SrtReleaseRequest): Promise<SrtReleaseResult> => ipcRenderer.invoke(FEATURE_CHANNELS.release, request),
  exportSrtTranslatorOne: (request: SrtExportOneRequest): Promise<SrtExportResult> => ipcRenderer.invoke(FEATURE_CHANNELS.exportOne, request),
  exportSrtTranslatorAll: (request: SrtExportAllRequest): Promise<SrtExportResult> => ipcRenderer.invoke(FEATURE_CHANNELS.exportAll, request),
  onSrtTranslatorProgress: (listener: (progress: SrtLocalizationProgress) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: SrtLocalizationProgress): void => listener(progress)
    ipcRenderer.on(FEATURE_CHANNELS.progress, wrapped)
    return () => ipcRenderer.removeListener(FEATURE_CHANNELS.progress, wrapped)
  }
}

export const srtTranslatorPreloadFeature = { id: FEATURE_ID, api } as const satisfies PreloadFeatureModule
