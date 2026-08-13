import { ipcRenderer } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type MediaInspectorProgress,
  type MediaInspectorRequest,
  type MediaInspectorResult
} from '../../shared/features/media-inspector'
import type { PreloadFeatureModule } from './contracts'

const api = {
  runMediaInspector: (request: MediaInspectorRequest): Promise<MediaInspectorResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.run, request),
  onMediaInspectorProgress: (listener: (progress: MediaInspectorProgress) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: MediaInspectorProgress): void =>
      listener(progress)
    ipcRenderer.on(FEATURE_CHANNELS.progress, wrapped)
    return () => ipcRenderer.removeListener(FEATURE_CHANNELS.progress, wrapped)
  }
}

export const mediaInspectorPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
