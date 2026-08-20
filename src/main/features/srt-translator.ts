import { app, dialog } from 'electron'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  makeLocalizedOutputFileName,
  makeOutputFileName,
  type LocalizedTarget,
  type SrtAnalyzeRequest,
  type SrtAnalyzeResult,
  type SrtCancelRequest,
  type SrtCancelResult,
  type SrtExportAllRequest,
  type SrtExportOneRequest,
  type SrtExportResult,
  type SrtExportItem,
  type SrtLoadRequest,
  type SrtLoadResult,
  type SrtLocaleTargetInput,
  type SrtLocalizationTranslateRequest,
  type SrtLocalizationTranslateResult,
  type SrtReleaseRequest,
  type SrtReleaseResult,
  type SrtResolveRequest,
  type SrtResolveResult,
  type SrtTargetLanguage
} from '../../shared/features/srt-translator'
import { loadSrtSource } from '../services/srt-source-validation'
import { createProductionSrtTranslatorJobController } from '../services/srt-translator-production'
import type { MainFeatureModule } from './contracts'

function outputFileName(sourceName: string, target: SrtTargetLanguage | SrtLocaleTargetInput | LocalizedTarget, unverified = false, index = 0): string {
  if ('profile' in target || 'languageLabel' in target) return makeLocalizedOutputFileName(sourceName, target as LocalizedTarget | SrtLocaleTargetInput, unverified)
  return makeOutputFileName(sourceName, target, index)
}

function outputItemValid(item: unknown): item is SrtExportItem {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const value = item as Record<string, unknown>
  return value.ok === true && typeof value.srt === 'string' && value.srt.length > 0 && Boolean(value.target && typeof value.target === 'object')
}

function outputNameWithNumber(fileName: string, number: number): string {
  return fileName.replace(/\.srt$/iu, '') + ` (${number}).srt`
}

async function nextAvailablePath(directory: string, fileName: string): Promise<string> {
  let candidate = join(directory, fileName)
  let number = 1
  while (true) {
    try {
      await access(candidate)
      candidate = join(directory, outputNameWithNumber(fileName, number))
      number += 1
    } catch {
      return candidate
    }
  }
}

async function exportOne(request: SrtExportOneRequest, getMainWindow: () => Electron.BrowserWindow | null): Promise<SrtExportResult> {
  if (!request || typeof request.sourceName !== 'string' || !outputItemValid(request.item)) return { ok: false, error: 'Bản dịch này chưa sẵn sàng để xuất.' }
  const suggestedName = outputFileName(request.sourceName, request.item.target, Boolean(request.item.unverified), 0)
  const owner = getMainWindow()
  const chosen = owner
    ? await dialog.showSaveDialog(owner, { defaultPath: suggestedName, filters: [{ name: 'Phụ đề SRT', extensions: ['srt'] }] })
    : await dialog.showSaveDialog({ defaultPath: suggestedName, filters: [{ name: 'Phụ đề SRT', extensions: ['srt'] }] })
  if (chosen.canceled || !chosen.filePath) return { ok: false, cancelled: true }
  try {
    await writeFile(chosen.filePath, request.item.srt as string, 'utf8')
    return { ok: true, paths: [chosen.filePath] }
  } catch {
    return { ok: false, error: 'Không ghi được file phụ đề đã chọn.' }
  }
}

async function exportAll(request: SrtExportAllRequest, getMainWindow: () => Electron.BrowserWindow | null): Promise<SrtExportResult> {
  if (!request || typeof request.sourceName !== 'string' || !Array.isArray(request.items)) return { ok: false, error: 'Danh sách bản dịch không hợp lệ.' }
  const items = request.items.filter(outputItemValid)
  if (!items.length) return { ok: false, error: 'Chưa có bản dịch nào hoàn tất để xuất.' }
  const owner = getMainWindow()
  const chosen = owner
    ? await dialog.showOpenDialog(owner, { properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (chosen.canceled || !chosen.filePaths[0]) return { ok: false, cancelled: true }
  const paths: string[] = []
  try {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const fileName = outputFileName(request.sourceName, item.target, Boolean(item.unverified), index)
      const outputPath = await nextAvailablePath(chosen.filePaths[0], fileName)
      await writeFile(outputPath, item.srt as string, 'utf8')
      paths.push(outputPath)
    }
    return { ok: true, paths }
  } catch {
    return { ok: false, paths, error: 'Không ghi được toàn bộ file phụ đề. Các file đã ghi vẫn được giữ lại.' }
  }
}

export const srtTranslatorMainFeature = {
  id: FEATURE_ID,
  register({ handle, emit, getMainWindow }) {
    const controller = createProductionSrtTranslatorJobController()
    app.once('before-quit', () => { void controller.dispose() })

    handle<[SrtLoadRequest], SrtLoadResult>(FEATURE_CHANNELS.load, async (_event, request) => {
      try {
        const loaded = await loadSrtSource(request?.sourcePath ?? '')
        return { ok: true, sourcePath: loaded.sourcePath, sourceText: loaded.sourceText, count: loaded.cues.length, lastCueEndSeconds: loaded.lastCueEndSeconds, fingerprint: loaded.fingerprint }
      } catch (reason) {
        return { ok: false, sourcePath: request?.sourcePath ?? '', error: reason instanceof Error ? reason.message.split('(')[0].trim() : 'Không đọc được file SRT nguồn.' }
      }
    })

    handle<[SrtAnalyzeRequest], SrtAnalyzeResult>(FEATURE_CHANNELS.analyze, (_event, request) => controller.analyze(request, (progress) => emit(FEATURE_CHANNELS.progress, progress)))
    handle<[SrtResolveRequest], SrtResolveResult>(FEATURE_CHANNELS.resolve, (_event, request) => controller.resolve(request))
    handle<[SrtLocalizationTranslateRequest], SrtLocalizationTranslateResult>(FEATURE_CHANNELS.translate, (_event, request) => controller.translate(request, (progress) => emit(FEATURE_CHANNELS.progress, progress)))
    handle<[SrtCancelRequest], SrtCancelResult>(FEATURE_CHANNELS.cancel, (_event, request) => controller.cancel(request))
    handle<[SrtReleaseRequest], SrtReleaseResult>(FEATURE_CHANNELS.release, (_event, request) => controller.release(request))
    handle<[SrtExportOneRequest], SrtExportResult>(FEATURE_CHANNELS.exportOne, (_event, request) => exportOne(request, getMainWindow))
    handle<[SrtExportAllRequest], SrtExportResult>(FEATURE_CHANNELS.exportAll, (_event, request) => exportAll(request, getMainWindow))
  }
} satisfies MainFeatureModule
