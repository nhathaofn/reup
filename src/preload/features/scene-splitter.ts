import { ipcRenderer } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type SceneSplitterCancelResult,
  type SceneSplitterEngineStatus,
  type SceneSplitterInstallProgress,
  type SceneSplitterInstallResult,
  type SceneSplitterProgress,
  type SceneSplitterRequest,
  type SceneSplitterResult
} from '../../shared/features/scene-splitter'
import type { PreloadFeatureModule } from './contracts'

function subscribe<Payload>(channel: string, listener: (payload: Payload) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: Payload): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  sceneSplitterEngineStatus: (): Promise<SceneSplitterEngineStatus> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.engineStatus),
  sceneSplitterInstallEngine: (): Promise<SceneSplitterInstallResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.installEngine),
  runSceneSplitter: (request: SceneSplitterRequest): Promise<SceneSplitterResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.run, request),
  cancelSceneSplitter: (): Promise<SceneSplitterCancelResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.cancel),
  onSceneSplitterInstallProgress: (
    listener: (progress: SceneSplitterInstallProgress) => void
  ): (() => void) => subscribe(FEATURE_CHANNELS.installProgress, listener),
  onSceneSplitterProgress: (listener: (progress: SceneSplitterProgress) => void): (() => void) =>
    subscribe(FEATURE_CHANNELS.progress, listener)
}

export const sceneSplitterPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
