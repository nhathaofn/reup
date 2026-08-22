import { ipcRenderer } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type SubtitlePipelineCancelRequest,
  type SubtitlePipelineCancelResult,
  type SubtitlePipelineProgress,
  type SubtitlePipelineRequest,
  type SubtitlePipelineResult
} from '../../shared/features/subtitle-pipeline'
import type { PreloadFeatureModule } from './contracts'

const api = {
  runSubtitlePipeline: (request: SubtitlePipelineRequest): Promise<SubtitlePipelineResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.run, request),
  cancelSubtitlePipeline: (request: SubtitlePipelineCancelRequest = {}): Promise<SubtitlePipelineCancelResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.cancel, request),
  onSubtitlePipelineProgress: (listener: (progress: SubtitlePipelineProgress) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: SubtitlePipelineProgress): void =>
      listener(progress)
    ipcRenderer.on(FEATURE_CHANNELS.progress, wrapped)
    return () => ipcRenderer.removeListener(FEATURE_CHANNELS.progress, wrapped)
  }
}

export const subtitlePipelinePreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
