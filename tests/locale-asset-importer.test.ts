import assert from 'node:assert/strict'
import test from 'node:test'
import { fingerprintSourceManifest } from '../src/main/services/contentBlockManifest.ts'
import { importLocaleAssetManifest } from '../src/main/services/localeAssetImporter.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

const localizedSrt = [
  '1\n00:00:00,000 --> 00:00:01,000\nHỏi 1',
  '2\n00:00:01,000 --> 00:00:02,000\nĐáp 1',
  '3\n00:00:02,000 --> 00:00:03,000\nHỏi 2',
  '4\n00:00:03,000 --> 00:00:04,000\nĐáp 2'
].join('\n\n')

test('maps voice explicitly by cue ID even when filenames are out of order', async () => {
  const source = sourceManifestFixture()
  const durations: Record<string, number> = {
    'z-answer.wav': 2_000_000,
    'a-question.wav': 1_000_000,
    'z-answer-2.wav': 2_100_000,
    'a-question-2.wav': 1_100_000
  }
  const result = await importLocaleAssetManifest({
    source,
    locale: 'vi-VN',
    localizedSrtRaw: localizedSrt,
    voiceDir: 'C:\\voices',
    audioFileNames: Object.keys(durations),
    voiceMap: {
      'cue-001': 'a-question.wav',
      'cue-002': 'z-answer.wav',
      'cue-003': 'a-question-2.wav',
      'cue-004': 'z-answer-2.wav'
    },
    probeDurationUs: async (path) => durations[path.split('\\').at(-1)!] ?? 0,
    isFile: async () => true
  })
  assert.equal(result.ok, true)
  assert.equal(result.manifest?.sourceManifestFingerprint, fingerprintSourceManifest(source))
  assert.equal(result.manifest?.blocks['block-a'].cues[1].voicePath, 'C:\\voices\\z-answer.wav')
  assert.equal(result.manifest?.blocks['block-a'].cues[1].text, 'Đáp 1')
})

test('reports missing, invalid and extra files without emitting a manifest', async () => {
  const result = await importLocaleAssetManifest({
    source: sourceManifestFixture(),
    locale: 'th-TH',
    localizedSrtRaw: localizedSrt,
    voiceDir: 'C:\\voices',
    audioFileNames: ['cue-001.wav', 'cue-002.wav', 'extra.wav'],
    voiceMap: null,
    probeDurationUs: async (path) => path.endsWith('cue-002.wav') ? 0 : 1_000_000,
    isFile: async () => true
  })
  assert.equal(result.ok, false)
  assert.equal(result.manifest, undefined)
  assert.deepEqual(result.missingCueIds, ['cue-003', 'cue-004'])
  assert.deepEqual(result.invalidCueIds, ['cue-002'])
  assert.deepEqual(result.extraFiles, ['extra.wav'])
})

test('localized SRT must contain exactly the source cue count', async () => {
  await assert.rejects(() => importLocaleAssetManifest({
    source: sourceManifestFixture(), locale: 'ja-JP', localizedSrtRaw: localizedSrt.split('\n\n').slice(0, 3).join('\n\n'),
    voiceDir: 'C:\\voices', audioFileNames: [], voiceMap: null,
    probeDurationUs: async () => 1_000_000, isFile: async () => true
  }), /4 cue/u)
})
