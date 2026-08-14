import { app, dialog, type OpenDialogOptions } from 'electron'
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
import {
  cancelCapCutFactory,
  detectCapCutEnvironment,
  inspectCapCutFactory,
  runCapCutFactory
} from '../services/capCutFactory'
import { repairPortableCapCutProject } from '../services/capcutPortability'
import type { MainFeatureModule } from './contracts'

function dialogOptions(kind: CapCutFactoryPickKind): OpenDialogOptions {
  if (kind === 'directory') return { properties: ['openDirectory', 'createDirectory'] }
  if (kind === 'srt') {
    return {
      properties: ['openFile'],
      filters: [{ name: 'SubRip subtitle', extensions: ['srt'] }]
    }
  }
  return {
    properties: ['openFile'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts'] }
    ]
  }
}

export const capcutFactoryMainFeature = {
  id: FEATURE_ID,
  register({ handle, emit, getMainWindow }) {
    app.once('before-quit', () => {
      cancelCapCutFactory()
    })
    handle<[], CapCutFactoryEnvironment>(FEATURE_CHANNELS.detectEnvironment, () =>
      detectCapCutEnvironment()
    )
    handle<[kind: CapCutFactoryPickKind], string | null>(
      FEATURE_CHANNELS.pickPath,
      async (_event, kind) => {
        if (!['video', 'srt', 'directory'].includes(kind)) throw new Error('Loại đường dẫn không hợp lệ.')
        const window = getMainWindow()
        const options = dialogOptions(kind)
        const result = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options)
        return result.canceled ? null : result.filePaths[0] ?? null
      }
    )
    handle<[request: CapCutFactoryRequest], CapCutFactoryPreflightResult>(
      FEATURE_CHANNELS.inspect,
      (_event, request) => inspectCapCutFactory(request)
    )
    handle<[request: CapCutFactoryRequest], CapCutFactoryResult>(
      FEATURE_CHANNELS.run,
      (_event, request) =>
        runCapCutFactory(request, (progress: CapCutFactoryProgress) =>
          emit(FEATURE_CHANNELS.progress, progress)
        )
    )
    handle<[projectPath: string], CapCutFactoryPortabilityResult>(
      FEATURE_CHANNELS.repair,
      (_event, projectPath) => repairPortableCapCutProject(projectPath)
    )
    handle<[], CapCutFactoryCancelResult>(FEATURE_CHANNELS.cancel, () => cancelCapCutFactory())
  }
} satisfies MainFeatureModule
