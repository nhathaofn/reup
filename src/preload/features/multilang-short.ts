import { ipcRenderer } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type MultiLangCancelResult,
  type MultiLangKeyStatus,
  type MultiLangProgress,
  type MultiLangRequest,
  type MultiLangResult
} from '../../shared/features/multilang-short'
import type { PreloadFeatureModule } from './contracts'

function subscribe<Payload>(channel: string, listener: (payload: Payload) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: Payload): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  runMultiLangShort: (request: MultiLangRequest): Promise<MultiLangResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.run, request),
  cancelMultiLangShort: (): Promise<MultiLangCancelResult> => ipcRenderer.invoke(FEATURE_CHANNELS.cancel),
  onMultiLangShortProgress: (listener: (progress: MultiLangProgress) => void): (() => void) =>
    subscribe(FEATURE_CHANNELS.progress, listener),
  saveElevenLabsKey: (key: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.saveElevenLabsKey, key),
  saveElevenLabsKeys: (keyText: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.saveElevenLabsKeys, keyText),
  hasElevenLabsKey: (): Promise<MultiLangKeyStatus> => ipcRenderer.invoke(FEATURE_CHANNELS.hasElevenLabsKey),
  checkElevenLabsKey: (key?: string, voiceId?: string): Promise<MultiLangKeyStatus> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.checkElevenLabsKey, key, voiceId),
  saveGeminiKeys: (keyText: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.saveGeminiKeys, keyText),
  hasGeminiKeys: (): Promise<MultiLangKeyStatus> => ipcRenderer.invoke(FEATURE_CHANNELS.hasGeminiKeys),
  checkGeminiKeys: (keyText?: string): Promise<MultiLangKeyStatus> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.checkGeminiKeys, keyText),
  checkOllama: (model?: string, url?: string): Promise<MultiLangKeyStatus> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.checkOllama, model, url)
}

export const multiLangShortPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
