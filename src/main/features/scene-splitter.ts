import { app } from 'electron'
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
import {
  cancelSceneSplitter,
  installSceneSplitterEngine,
  runSceneSplitter,
  sceneSplitterEngineStatus
} from '../services/sceneSplitter'
import type { MainFeatureModule } from './contracts'

export const sceneSplitterMainFeature = {
  id: FEATURE_ID,
  register({ handle, emit }) {
    app.once('before-quit', () => {
      cancelSceneSplitter()
    })
    handle<[], SceneSplitterEngineStatus>(FEATURE_CHANNELS.engineStatus, () =>
      sceneSplitterEngineStatus()
    )
    handle<[], SceneSplitterInstallResult>(FEATURE_CHANNELS.installEngine, () =>
      installSceneSplitterEngine((progress: SceneSplitterInstallProgress) =>
        emit(FEATURE_CHANNELS.installProgress, progress)
      )
    )
    handle<[request: SceneSplitterRequest], SceneSplitterResult>(
      FEATURE_CHANNELS.run,
      (_event, request) =>
        runSceneSplitter(request, (progress: SceneSplitterProgress) =>
          emit(FEATURE_CHANNELS.progress, progress)
        )
    )
    handle<[], SceneSplitterCancelResult>(FEATURE_CHANNELS.cancel, () => cancelSceneSplitter())
  }
} satisfies MainFeatureModule
