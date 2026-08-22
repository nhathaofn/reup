import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBlockBoundaries } from '../src/main/services/boundaryResolver.ts'
import { groupDialoguePairs } from '../src/main/services/dialogueGrouper.ts'
import type { SourceDialogueCue } from '../src/shared/features/content-blocks.ts'

const cues: SourceDialogueCue[] = [
  { cueId: 'cue-001', sourceIndex: 1, role: 'statement', text: 'Q1', sourceStartUs: 0, sourceEndUs: 1_000_000 },
  { cueId: 'cue-002', sourceIndex: 2, role: 'statement', text: 'A1', sourceStartUs: 1_100_000, sourceEndUs: 3_600_000 },
  { cueId: 'cue-003', sourceIndex: 3, role: 'statement', text: 'Q2', sourceStartUs: 4_000_000, sourceEndUs: 5_000_000 },
  { cueId: 'cue-004', sourceIndex: 4, role: 'statement', text: 'A2', sourceStartUs: 5_100_000, sourceEndUs: 7_700_000 }
]
const groups = groupDialoguePairs(cues, { makeBlockId: (() => { const ids = ['block-a', 'block-b']; return () => ids.shift()! })() })

test('selects nearest legal scene boundary to answer end', () => {
  const blocks = resolveBlockBoundaries({ groups, allCues: cues, sceneBoundaryUs: [3_800_000, 8_000_000], sourceDurationUs: 8_000_000 })
  assert.equal(blocks[0].sourceRange.endUs, 3_800_000)
  assert.equal(blocks[0].boundary.reason, 'scene-near-srt')
  assert.equal(blocks[1].sourceRange.startUs, 3_800_000)
})

test('rejects a scene cut inside a spoken cue', () => {
  const blocks = resolveBlockBoundaries({ groups, allCues: cues, sceneBoundaryUs: [3_400_000, 3_900_000, 8_000_000], sourceDurationUs: 8_000_000 })
  assert.equal(blocks[0].sourceRange.endUs, 3_900_000)
})

test('falls back to padded SRT end and marks review', () => {
  const blocks = resolveBlockBoundaries({ groups, allCues: cues, sceneBoundaryUs: [8_000_000], sourceDurationUs: 8_000_000 })
  assert.equal(blocks[0].sourceRange.endUs, 3_700_000)
  assert.equal(blocks[0].boundary.reason, 'srt-fallback')
  assert.equal(blocks[0].boundary.reviewState, 'needs-review')
  assert.deepEqual(blocks[0].issues, ['srt-fallback'])
})

test('keeps a valid manually locked boundary exactly', () => {
  const blocks = resolveBlockBoundaries({
    groups,
    allCues: cues,
    sceneBoundaryUs: [3_800_000, 8_000_000],
    sourceDurationUs: 8_000_000,
    lockedBoundaryUs: { 'block-a': 3_750_000 }
  })
  assert.equal(blocks[0].sourceRange.endUs, 3_750_000)
  assert.equal(blocks[0].boundary.reviewState, 'locked')
  assert.equal(blocks[0].boundary.reason, 'manual-adjusted')
})
