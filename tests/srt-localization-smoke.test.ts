import test from 'node:test'
import assert from 'node:assert/strict'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import {
  SRT_LOCALE_PRESETS,
  makeLocalizedOutputFileName,
  type SrtSourceCue
} from '../src/shared/features/srt-translator.ts'
import { createExchangeRateProvider } from '../src/main/services/exchange-rates.ts'
import {
  createGeminiFilesTransport,
  type GeminiRemoteFile
} from '../src/main/services/gemini-files.ts'
import { resolveLocalizedTarget } from '../src/main/services/srt-locale-profiles.ts'
import { runLocalizedTargetBatch } from '../src/main/services/srt-localization.ts'
import { auditRestoration } from '../src/main/services/srt-source-audit.ts'
import { restoreSource } from '../src/main/services/srt-source-restoration.ts'
import {
  loadSrtSource,
  nodeStatFile,
  parseStrictSrtText,
  probeVideoDuration,
  spawnProbeProcess,
  validateVideoSource
} from '../src/main/services/srt-source-validation.ts'

const smokeEnabled = [
  process.env.TBLAO_GEMINI_SMOKE_KEY,
  process.env.TBLAO_SRT_SMOKE_VIDEO,
  process.env.TBLAO_SRT_SMOKE_SRT,
  process.env.TBLAO_SRT_SMOKE_OUTPUT_DIR
].every((value) => Boolean(value?.trim()))

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`)
  return value
}

function assertSameStructure(generatedSrt: string, sourceCues: readonly SrtSourceCue[]): void {
  const generated = parseStrictSrtText(generatedSrt, 'generated-target.srt')
  assert.equal(generated.length, sourceCues.length)
  for (let index = 0; index < sourceCues.length; index += 1) {
    assert.equal(generated[index]?.n, sourceCues[index]?.n)
    assert.equal(generated[index]?.time, sourceCues[index]?.time)
    assert.equal(generated[index]?.speakerLabel, sourceCues[index]?.speakerLabel)
  }
}

async function confirmRemoteDeleted(apiKey: string, remoteName: string): Promise<boolean> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${remoteName}?key=${encodeURIComponent(apiKey)}`,
    { method: 'GET' }
  )
  if (response.status === 404) return true
  if (response.ok) return false
  throw new Error(`Không thể xác nhận cleanup Gemini (${response.status}).`)
}

interface SmokeResult {
  remoteDeleteConfirmed: boolean
  targets: string[]
  structureValid: boolean
}

async function runConfiguredSmoke(): Promise<SmokeResult> {
  const apiKey = requiredEnv('TBLAO_GEMINI_SMOKE_KEY')
  const videoPath = requiredEnv('TBLAO_SRT_SMOKE_VIDEO')
  const srtPath = requiredEnv('TBLAO_SRT_SMOKE_SRT')
  const outputDir = requiredEnv('TBLAO_SRT_SMOKE_OUTPUT_DIR')
  for (const path of [videoPath, srtPath, outputDir]) {
    assert.equal(isAbsolute(path), true, 'Smoke paths must be absolute.')
  }

  const source = await loadSrtSource(srtPath)
  const validated = await validateVideoSource(videoPath, source, {
    statFile: nodeStatFile,
    probeDuration: (path, signal) => probeVideoDuration(path, {
      resolveFfmpeg: async () => process.env.TBLAO_FFMPEG_PATH?.trim() || 'ffmpeg',
      spawnProbe: spawnProbeProcess
    }, signal)
  })
  const transport = createGeminiFilesTransport({ apiKey })
  const rateSnapshot = await createExchangeRateProvider().getSnapshot()
  assert.ok(rateSnapshot, 'Live smoke requires an exchange-rate snapshot.')
  const requestedLocales = new Set(['vi-VN', 'ja-JP', 'th-TH', 'id-ID'])
  const targets = SRT_LOCALE_PRESETS
    .filter((item) => requestedLocales.has(item.profile.locale))
    .map((item) => resolveLocalizedTarget(item.profile))
  assert.equal(targets.length, 4)

  let remoteFile: GeminiRemoteFile | undefined
  let remoteDeleteConfirmed = false
  let completedTargetIds: string[] = []
  let structureValid = false
  try {
    const uploaded = await transport.uploadVideo({
      path: videoPath,
      mimeType: validated.videoMimeType,
      displayName: basename(videoPath)
    })
    remoteFile = await transport.waitUntilActive(uploaded)
    const draft = await restoreSource({ source: validated, transport, file: remoteFile })
    const canonical = await auditRestoration({
      jobId: 'live-smoke', source: validated, draft, transport, file: remoteFile
    })
    assert.deepEqual(
      canonical.unresolvedCueNumbers,
      [],
      'Mẫu smoke phải đủ rõ để không cần người dùng chọn candidate.'
    )
    assert.equal(canonical.cues.some((cue) => cue.issue === 'homophone'), true)
    assert.equal(canonical.cues.some((cue) => ['slang', 'dialect'].includes(cue.issue)), true)
    assert.equal(canonical.entities.some((entity) =>
      entity.category === 'species' && entity.confidence === 'high' && !entity.useNeutralReference
    ), true)
    assert.equal(canonical.moneyMentions.length > 0, true)
    assert.equal(canonical.measurementMentions.length > 0, true)
    const localized = await runLocalizedTargetBatch({
      canonical,
      targets,
      transport,
      file: remoteFile,
      rateSnapshot
    })
    assert.equal(localized.translations.length, 4)
    assert.equal(localized.translations.every((item) => item.ok && Boolean(item.srt)), true)

    await mkdir(outputDir, { recursive: true })
    for (const item of localized.translations) {
      assertSameStructure(item.srt!, source.cues)
      const outputPath = resolve(
        outputDir,
        makeLocalizedOutputFileName(srtPath, item.target, false)
      )
      const child = relative(outputDir, outputPath)
      assert.equal(child.startsWith('..') || isAbsolute(child), false)
      await writeFile(outputPath, item.srt!, 'utf8')
    }
    completedTargetIds = localized.translations.map((item) => item.target.id)
    structureValid = true
  } finally {
    if (remoteFile) {
      await transport.deleteFile(remoteFile.name).catch(() => undefined)
      remoteDeleteConfirmed = await confirmRemoteDeleted(apiKey, remoteFile.name)
    }
  }

  return { remoteDeleteConfirmed, targets: completedTargetIds, structureValid }
}

test('real Gemini multimodal SRT smoke', { skip: !smokeEnabled }, async () => {
  const result = await runConfiguredSmoke()
  assert.equal(result.remoteDeleteConfirmed, true)
  assert.equal(result.targets.length, 4)
  assert.equal(result.structureValid, true)
})
