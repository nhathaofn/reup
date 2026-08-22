import assert from 'node:assert/strict'
import test from 'node:test'
import { applyContentBlockEdits } from '../src/main/services/contentBlockEdits.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

test('merge adjacent blocks keeps left ID and complete cue membership', () => {
  const edited = applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'merge', leftBlockId: 'block-a', rightBlockId: 'block-b' }
  ], () => 'unused')
  assert.equal(edited.revision, 2)
  assert.deepEqual(edited.blocks.map((block) => block.id), ['block-a'])
  assert.deepEqual(edited.blocks[0].cueIds, ['cue-001', 'cue-002', 'cue-003', 'cue-004'])
  assert.equal(edited.blocks[0].sourceRange.endUs, 8_000_000)
})

test('split keeps original ID on left and assigns a new ID on right', () => {
  const merged = applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'merge', leftBlockId: 'block-a', rightBlockId: 'block-b' }
  ], () => 'unused')
  const split = applyContentBlockEdits(merged, [
    { kind: 'split', blockId: 'block-a', afterCueId: 'cue-002' }
  ], () => 'block-c')
  assert.deepEqual(split.blocks.map((block) => block.id), ['block-a', 'block-c'])
  assert.equal(split.blocks[0].boundary.reason, 'srt-fallback')
  assert.equal(split.blocks[0].boundary.reviewState, 'needs-review')
})

test('manual boundary updates adjacent ranges and can lock it', () => {
  const edited = applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'set-boundary', blockId: 'block-a', selectedUs: 3_900_000, locked: true }
  ], () => 'unused')
  assert.equal(edited.blocks[0].sourceRange.endUs, 3_900_000)
  assert.equal(edited.blocks[1].sourceRange.startUs, 3_900_000)
  assert.equal(edited.blocks[0].boundary.reason, 'manual-adjusted')
  assert.equal(edited.blocks[0].boundary.reviewState, 'locked')
})

test('rejects non-adjacent merge, cue-splitting boundary and dependency cycle', () => {
  assert.throws(() => applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'set-boundary', blockId: 'block-a', selectedUs: 2_000_000, locked: false }
  ], () => 'unused'), /cue/u)
  assert.throws(() => applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'set-semantic', blockId: 'block-a', role: 'normal', shuffleEligible: true, requiresPreviousBlockId: 'block-b' },
    { kind: 'set-semantic', blockId: 'block-b', role: 'normal', shuffleEligible: true, requiresPreviousBlockId: 'block-a' }
  ], () => 'unused'), /cycle/u)
})
