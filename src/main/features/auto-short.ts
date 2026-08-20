import { app } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type AutoShortCancelResult,
  type AutoShortProgress,
  type AutoShortRequest,
  type AutoShortResult
} from '../../shared/features/auto-short'
import { cancelAutoShort, runAutoShort } from '../services/autoShort'
import type { MainFeatureModule } from './contracts'

export const autoShortMainFeature = {
  id: FEATURE_ID,
  register({ handle, emit }) {
    app.once('before-quit', () => {
      cancelAutoShort()
    })
    handle<[request: AutoShortRequest], AutoShortResult>(
      FEATURE_CHANNELS.run,
      (_event, request) =>
        runAutoShort(request, (progress: AutoShortProgress) => emit(FEATURE_CHANNELS.progress, progress))
    )
    handle<[], AutoShortCancelResult>(FEATURE_CHANNELS.cancel, () => cancelAutoShort())
  }
} satisfies MainFeatureModule
