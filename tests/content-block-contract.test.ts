import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTENT_BLOCK_DEFAULTS,
  CONTENT_BLOCK_FEATURE_CHANNELS,
  CONTENT_BLOCK_SCHEMA_VERSION,
  FEATURE_ID
} from '../src/shared/features/content-blocks.ts'

test('content-block V1 constants lock timing and speed policy', () => {
  assert.equal(FEATURE_ID, 'content-blocks')
  assert.equal(CONTENT_BLOCK_SCHEMA_VERSION, 1)
  assert.deepEqual(CONTENT_BLOCK_DEFAULTS, {
    boundaryWindowUs: 500_000,
    minimumBlockDurationUs: 500_000,
    srtFallbackPaddingUs: 100_000,
    preRollUs: 0,
    postRollUs: 100_000,
    cueGapUs: 100_000,
    softSpeedMin: 0.92,
    softSpeedMax: 1.08,
    hardSpeedMin: 0.9,
    hardSpeedMax: 1.12
  })
})

test('every content-block channel is feature namespaced', () => {
  assert.deepEqual(Object.keys(CONTENT_BLOCK_FEATURE_CHANNELS), [
    'pickPath', 'analyze', 'editManifest', 'importLocale', 'createVariant',
    'buildTimeline', 'exportCapCut', 'cancel', 'progress'
  ])
  for (const channel of Object.values(CONTENT_BLOCK_FEATURE_CHANNELS)) {
    assert.match(channel, /^content-blocks:/u)
  }
})
