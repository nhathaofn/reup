import { app } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type MultiLangCancelResult,
  type MultiLangKeyStatus,
  type MultiLangProgress,
  type MultiLangRequest,
  type MultiLangResult
} from '../../shared/features/multilang-short'
import {
  checkKeyPool as checkGeminiKeyPool,
  loadKeys as loadGeminiKeys,
  saveKeys as saveGeminiKeys
} from '../gemini'
import { checkOllama } from '../ollama'
import {
  cancelMultiLangShort,
  checkElevenLabsKeyPool,
  loadElevenLabsKeys,
  runMultiLangShort,
  saveElevenLabsKey,
  saveElevenLabsKeys
} from '../services/multilangShort'
import type { MainFeatureModule } from './contracts'

export const multiLangShortMainFeature = {
  id: FEATURE_ID,
  register({ handle, emit }) {
    app.once('before-quit', () => {
      cancelMultiLangShort()
    })
    handle<[request: MultiLangRequest], MultiLangResult>(
      FEATURE_CHANNELS.run,
      (_event, request) => runMultiLangShort(request, (progress: MultiLangProgress) => emit(FEATURE_CHANNELS.progress, progress))
    )
    handle<[], MultiLangCancelResult>(FEATURE_CHANNELS.cancel, () => cancelMultiLangShort())
    handle<[key: string], { ok: boolean; message: string }>(
      FEATURE_CHANNELS.saveElevenLabsKey,
      async (_event, key) => {
        await saveElevenLabsKey(key)
        return { ok: true, message: key.trim() ? 'Đã lưu ElevenLabs API key an toàn trên máy này.' : 'Đã xóa ElevenLabs API key.' }
      }
    )
    handle<[keyText: string], { ok: boolean; message: string }>(
      FEATURE_CHANNELS.saveElevenLabsKeys,
      async (_event, keyText) => {
        await saveElevenLabsKeys(keyText.split(/[\r\n,;]+/))
        return { ok: true, message: 'Đã lưu pool ElevenLabs key an toàn trên máy này.' }
      }
    )
    handle<[], MultiLangKeyStatus>(FEATURE_CHANNELS.hasElevenLabsKey, async () => ({
      ok: true,
      hasKey: (await loadElevenLabsKeys()).length > 0,
      keyCount: (await loadElevenLabsKeys()).length,
      message: ''
    }))
    handle<[key?: string, voiceId?: string], MultiLangKeyStatus>(
      FEATURE_CHANNELS.checkElevenLabsKey,
      (_event, keyText, voiceId) => checkElevenLabsKeyPool(keyText, voiceId)
    )
    handle<[keyText: string], { ok: boolean; message: string }>(
      FEATURE_CHANNELS.saveGeminiKeys,
      async (_event, keyText) => {
        await saveGeminiKeys(keyText.split(/[\r\n,;]+/))
        return { ok: true, message: 'Đã lưu pool Gemini key an toàn trên máy này.' }
      }
    )
    handle<[], MultiLangKeyStatus>(FEATURE_CHANNELS.hasGeminiKeys, async () => {
      const count = (await loadGeminiKeys()).length
      return { ok: true, hasKey: count > 0, keyCount: count, message: '' }
    })
    handle<[keyText?: string], MultiLangKeyStatus>(
      FEATURE_CHANNELS.checkGeminiKeys,
      async (_event, keyText) => {
        const result = await checkGeminiKeyPool(keyText)
        return { ...result, hasKey: result.keyCount > 0 }
      }
    )
    handle<[model?: string, url?: string], MultiLangKeyStatus>(
      FEATURE_CHANNELS.checkOllama,
      (_event, model, url) => checkOllama(model, url)
    )
  }
} satisfies MainFeatureModule
