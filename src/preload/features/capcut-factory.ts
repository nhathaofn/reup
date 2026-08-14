import { ipcRenderer } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type CapCutFactoryCancelResult,
  type CapCutFactoryEnvironment,
  type CapCutFactoryPortabilityResult,
  type CapCutFactoryPickKind,
  type CapCutFactoryPreflightResult,
  type CapCutFactoryProgress,
  type CapCutFactoryRequest,
  type CapCutFactoryResult
} from '../../shared/features/capcut-factory'
import type { PreloadFeatureModule } from './contracts'

const api = {
  capCutFactoryDetectEnvironment: (): Promise<CapCutFactoryEnvironment> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.detectEnvironment),
  capCutFactoryPickPath: (kind: CapCutFactoryPickKind): Promise<string | null> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.pickPath, kind),
  inspectCapCutFactory: (request: CapCutFactoryRequest): Promise<CapCutFactoryPreflightResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.inspect, request),
  runCapCutFactory: (request: CapCutFactoryRequest): Promise<CapCutFactoryResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.run, request),
  repairCapCutProject: (projectPath: string): Promise<CapCutFactoryPortabilityResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.repair, projectPath),
  cancelCapCutFactory: (): Promise<CapCutFactoryCancelResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.cancel),
  onCapCutFactoryProgress: (
    listener: (progress: CapCutFactoryProgress) => void
  ): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: CapCutFactoryProgress): void =>
      listener(progress)
    ipcRenderer.on(FEATURE_CHANNELS.progress, wrapped)
    return () => ipcRenderer.removeListener(FEATURE_CHANNELS.progress, wrapped)
  }
}

export const capcutFactoryPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
