import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptRenderTimelineToCapCut } from '../src/main/services/capCutBlockAdapter.ts'
import { assertVariantMatchesSource, fingerprintSourceManifest } from '../src/main/services/contentBlockManifest.ts'
import { buildRenderTimeline } from '../src/main/services/blockTimeline.ts'
import { createVariantPlan } from '../src/main/services/blockVariantPlanner.ts'
import type { LocaleAssetManifest, SourceBlockManifest } from '../src/shared/features/content-blocks.ts'

function threeBlockSourceFixture(): SourceBlockManifest {
  return {
    schemaVersion: 1,
    source: { path: 'C:\\fixture\\source.mp4', fingerprint: `sha256:${'a'.repeat(64)}`, durationUs: 12_000_000, fps: 30 },
    revision: 1,
    blocks: Array.from({ length: 3 }, (_, index) => {
      const blockNumber = index + 1
      const startUs = index * 4_000_000
      const questionId = `cue-${String(index * 2 + 1).padStart(3, '0')}`
      const answerId = `cue-${String(index * 2 + 2).padStart(3, '0')}`
      return {
        id: `block-${blockNumber}`,
        sourceRange: { startUs, endUs: startUs + 4_000_000 },
        cueIds: [questionId, answerId],
        dialogue: [
          { cueId: questionId, sourceIndex: index * 2 + 1, role: 'question' as const, text: `Q${blockNumber}`, sourceStartUs: startUs + 100_000, sourceEndUs: startUs + 1_000_000 },
          { cueId: answerId, sourceIndex: index * 2 + 2, role: 'answer' as const, text: `A${blockNumber}`, sourceStartUs: startUs + 1_100_000, sourceEndUs: startUs + 3_800_000 }
        ],
        boundary: { targetUs: startUs + 3_800_000, selectedUs: startUs + 4_000_000, reason: 'scene-near-srt' as const, reviewState: 'accepted' as const },
        semantic: { role: 'normal' as const, shuffleEligible: true, requiresPreviousBlockId: null },
        issues: []
      }
    })
  }
}

function threeBlockLocaleFixture(
  sourceManifestFingerprint: `sha256:${string}`,
  locale: string,
  questionDurationUs: number
): LocaleAssetManifest {
  const source = threeBlockSourceFixture()
  const answerDurationUs = 2_700_000 + (questionDurationUs - 1_000_000)
  return {
    schemaVersion: 1,
    sourceManifestFingerprint,
    locale,
    blocks: Object.fromEntries(source.blocks.map((block, blockIndex) => [
      block.id,
      { cues: block.cueIds.map((cueId, cueIndex) => ({
        cueId,
        text: `${locale}:${cueIndex === 0 ? 'Q' : 'A'}${blockIndex + 1}`,
        voicePath: `C:\\fixture\\${locale}\\${cueId}.wav`,
        voiceDurationUs: cueIndex === 0 ? questionDurationUs : answerDurationUs
      })) }
    ]))
  }
}

test('one source variant renders two locale timelines without content drift', () => {
  const source = threeBlockSourceFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const variant = createVariantPlan(source, {
    variantId: 'variant-e2e', seed: 'e2e-seed',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })
  const vi = buildRenderTimeline(source, threeBlockLocaleFixture(fingerprint, 'vi-VN', 1_000_000), variant)
  const th = buildRenderTimeline(source, threeBlockLocaleFixture(fingerprint, 'th-TH', 1_080_000), variant)

  assert.deepEqual(vi.items.map((item) => item.blockId), variant.blockOrder)
  assert.deepEqual(th.items.map((item) => item.blockId), variant.blockOrder)
  assert.notEqual(vi.durationUs, th.durationUs)
  assert.equal(new Set(variant.blockOrder).size, 3)

  const viCapCut = adaptRenderTimelineToCapCut({ source, locale: threeBlockLocaleFixture(fingerprint, 'vi-VN', 1_000_000), timeline: vi, width: 1920, height: 1080, muteOriginalVideo: true })
  const thCapCut = adaptRenderTimelineToCapCut({ source, locale: threeBlockLocaleFixture(fingerprint, 'th-TH', 1_080_000), timeline: th, width: 1920, height: 1080, muteOriginalVideo: true })
  assert.equal(viCapCut.videoItems.length, 3)
  assert.equal(viCapCut.audioItems.length, 6)
  assert.equal(viCapCut.textItems.length, 6)
  assert.deepEqual(viCapCut.textItems.map((item) => item.text.replace(/^vi-VN:/u, '')), thCapCut.textItems.map((item) => item.text.replace(/^th-TH:/u, '')))
})

test('full stack rejects missing voice, stale fingerprint, duplicate block and hard speed', () => {
  const source = threeBlockSourceFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const variant = createVariantPlan(source, {
    variantId: 'variant-negative', seed: 'negative-seed',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })

  const missing = threeBlockLocaleFixture(fingerprint, 'vi-VN', 1_000_000)
  missing.blocks['block-1'].cues.pop()
  assert.throws(() => buildRenderTimeline(source, missing, variant), /cue IDs/u)

  const stale = threeBlockLocaleFixture(`sha256:${'f'.repeat(64)}`, 'vi-VN', 1_000_000)
  assert.throws(() => buildRenderTimeline(source, stale, variant), /fingerprint/u)

  const duplicate = structuredClone(variant)
  duplicate.blockOrder[2] = duplicate.blockOrder[1]
  assert.throws(() => assertVariantMatchesSource(duplicate, source), /blockOrder chứa giá trị trùng/u)

  const tooShort = threeBlockLocaleFixture(fingerprint, 'vi-VN', 200_000)
  for (const block of Object.values(tooShort.blocks)) for (const cue of block.cues) cue.voiceDurationUs = 200_000
  const reviewTimeline = buildRenderTimeline(source, tooShort, variant)
  assert.equal(reviewTimeline.reviewBlockIds.length, 3)
  assert.throws(() => adaptRenderTimelineToCapCut({ source, locale: tooShort, timeline: reviewTimeline, width: 1920, height: 1080, muteOriginalVideo: true }), /needs-review/u)
})
