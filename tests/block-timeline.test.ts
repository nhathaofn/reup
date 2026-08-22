import assert from 'node:assert/strict'
import test from 'node:test'
import { fingerprintSourceManifest } from '../src/main/services/contentBlockManifest.ts'
import { serializeRenderTimelineSrt } from '../src/main/services/blockSrt.ts'
import { buildRenderTimeline } from '../src/main/services/blockTimeline.ts'
import {
  localeManifestFixture,
  sourceManifestFixture,
  variantFixture
} from './helpers/content-block-fixtures.ts'

test('builds a new cumulative locale timeline from original voice durations', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const timeline = buildRenderTimeline(
    source,
    localeManifestFixture(fingerprint),
    variantFixture(fingerprint)
  )
  assert.equal(timeline.items[0].blockId, 'block-b')
  assert.equal(timeline.items[0].timelineStartUs, 0)
  assert.equal(timeline.items[0].timelineEndUs, 3_900_000)
  assert.equal(timeline.items[1].timelineStartUs, 3_900_000)
  assert.equal(timeline.durationUs, 7_800_000)
  assert.deepEqual(timeline.items[0].subtitleCues.map((cue) => [cue.startUs, cue.endUs]), [
    [0, 1_000_000],
    [1_100_000, 3_800_000]
  ])
  assert.equal(timeline.items[0].adaptation, 'stretch-within-soft-limit')
  assert.ok(Math.abs(timeline.items[0].mediaSpeed - 4_000_000 / 3_900_000) < 0.000001)
})

test('different voice duration creates a separate locale timeline', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(fingerprint)
  locale.locale = 'th-TH'
  locale.blocks['block-a'].cues[1].voiceDurationUs = 3_000_000
  const timeline = buildRenderTimeline(source, locale, variantFixture(fingerprint))
  assert.equal(timeline.locale, 'th-TH')
  assert.notEqual(timeline.items[1].timelineEndUs - timeline.items[1].timelineStartUs, 3_900_000)
})

test('outside hard speed limit is reviewable and voice is never trimmed', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(fingerprint)
  for (const block of Object.values(locale.blocks)) {
    for (const cue of block.cues) cue.voiceDurationUs = 500_000
  }
  const timeline = buildRenderTimeline(source, locale, variantFixture(fingerprint))
  assert.deepEqual(timeline.reviewBlockIds, ['block-b', 'block-a'])
  assert.equal(timeline.items[0].adaptation, 'needs-review')
  assert.equal(timeline.items[0].subtitleCues[1].endUs - timeline.items[0].subtitleCues[1].startUs, 500_000)
})

test('regenerates monotonic SRT from render positions', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const timeline = buildRenderTimeline(source, localeManifestFixture(fingerprint), variantFixture(fingerprint))
  const srt = serializeRenderTimelineSrt(timeline)
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,000\nHỏi 2/u)
  assert.match(srt, /2\n00:00:01,100 --> 00:00:03,800\nĐáp 2/u)
  assert.match(srt, /3\n00:00:03,900 --> 00:00:04,900\nHỏi 1/u)
})

test('rejects locale or variant built from another source fingerprint', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(`sha256:${'f'.repeat(64)}`)
  assert.throws(() => buildRenderTimeline(source, locale, variantFixture(fingerprint)), /fingerprint/u)
})
