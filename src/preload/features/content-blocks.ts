import { ipcRenderer } from 'electron'
import {
  CONTENT_BLOCK_FEATURE_CHANNELS as CHANNELS,
  FEATURE_ID,
  type ContentBlockCancelResult
} from '../../shared/features/content-blocks'
import type { PreloadFeatureModule } from './contracts'

const api = {
  cancelContentBlocks: (): Promise<ContentBlockCancelResult> => ipcRenderer.invoke(CHANNELS.cancel)
}

export const contentBlocksPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
