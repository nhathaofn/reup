import { ipcRenderer } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type AutoShortCancelResult,
  type AutoShortProgress,
  type AutoShortRequest,
  type AutoShortResult
} from '../../shared/features/auto-short'
import type { PreloadFeatureModule } from './contracts'

function subscribe<Payload>(channel: string, listener: (payload: Payload) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: Payload): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  runAutoShort: (request: AutoShortRequest): Promise<AutoShortResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.run, request),
  cancelAutoShort: (): Promise<AutoShortCancelResult> => ipcRenderer.invoke(FEATURE_CHANNELS.cancel),
  onAutoShortProgress: (listener: (progress: AutoShortProgress) => void): (() => void) =>
    subscribe(FEATURE_CHANNELS.progress, listener)
}

export const autoShortPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
