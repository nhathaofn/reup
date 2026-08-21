import {
  CONTENT_BLOCK_FEATURE_CHANNELS as CHANNELS,
  FEATURE_ID,
  type ContentBlockCancelResult
} from '../../shared/features/content-blocks'
import type { MainFeatureModule } from './contracts'

export const contentBlocksMainFeature = {
  id: FEATURE_ID,
  register({ handle }) {
    handle<[], ContentBlockCancelResult>(CHANNELS.cancel, () => ({ ok: true, wasRunning: false }))
  }
} satisfies MainFeatureModule
