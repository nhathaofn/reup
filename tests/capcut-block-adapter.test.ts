import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptRenderTimelineToCapCut } from '../src/main/services/capCutBlockAdapter.ts'
import { buildRenderTimeline } from '../src/main/services/blockTimeline.ts'
import { fingerprintSourceManifest } from '../src/main/services/contentBlockManifest.ts'
import { localeManifestFixture, sourceManifestFixture, variantFixture } from './helpers/content-block-fixtures.ts'

test('maps shuffled source ranges, original voices and captions to native items', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(fingerprint)
  const timeline = buildRenderTimeline(source, locale, variantFixture(fingerprint))
  const items = adaptRenderTimelineToCapCut({ source, locale, timeline, width: 1920, height: 1080, muteOriginalVideo: true })

  assert.equal(items.videoItems.length, 2)
  assert.deepEqual(items.videoItems.map((item) => item.sourceStartSeconds), [4, 0])
  assert.deepEqual(items.videoItems.map((item) => item.sourceDurationSeconds), [4, 4])
  assert.deepEqual(items.videoItems.map((item) => item.assetDurationSeconds), [8, 8])
  assert.equal(items.videoItems[0].assetName, items.videoItems[1].assetName)
  assert.equal(items.videoItems[0].volume, 0)
  assert.ok(Math.abs(items.videoItems[0].speed! - 4 / 3.9) < 0.000001)

  assert.equal(items.audioItems.length, 4)
  assert.ok(items.audioItems.every((item) => item.speed === 1 && item.durationSeconds === item.sourceDurationSeconds))
  assert.deepEqual(items.audioItems.map((item) => item.sourcePath), [
    'C:\\fixture\\cue-003.wav', 'C:\\fixture\\cue-004.wav',
    'C:\\fixture\\cue-001.wav', 'C:\\fixture\\cue-002.wav'
  ])
  assert.deepEqual(items.textItems.map((item) => item.text), ['Hỏi 2', 'Đáp 2', 'Hỏi 1', 'Đáp 1'])
})

test('adapter refuses a timeline that still has blocking review', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(fingerprint)
  for (const block of Object.values(locale.blocks)) for (const cue of block.cues) cue.voiceDurationUs = 500_000
  const timeline = buildRenderTimeline(source, locale, variantFixture(fingerprint))
  assert.throws(() => adaptRenderTimelineToCapCut({ source, locale, timeline, width: 1920, height: 1080, muteOriginalVideo: true }), /needs-review/u)
})
