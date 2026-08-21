import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { groupDialoguePairs } from '../src/main/services/dialogueGrouper.ts'
import type { SourceDialogueCue } from '../src/shared/features/content-blocks.ts'

const cue = (sourceIndex: number): SourceDialogueCue => ({
  cueId: `cue-${String(sourceIndex).padStart(3, '0')}`,
  sourceIndex,
  role: 'statement',
  text: `Cue ${sourceIndex}`,
  sourceStartUs: (sourceIndex - 1) * 1_000_000,
  sourceEndUs: sourceIndex * 1_000_000
})

test('pair profile groups two cues and assigns question/answer roles', () => {
  const ids = ['block-a', 'block-b']
  const groups = groupDialoguePairs([cue(1), cue(2), cue(3), cue(4)], {
    makeBlockId: () => ids.shift()!
  })
  assert.deepEqual(groups.map((group) => group.id), ['block-a', 'block-b'])
  assert.deepEqual(groups[0].dialogue.map((item) => item.role), ['question', 'answer'])
  assert.deepEqual(groups[1].cueIds, ['cue-003', 'cue-004'])
})

test('odd final cue becomes a reviewable standalone block', () => {
  const groups = groupDialoguePairs([cue(1), cue(2), cue(3)], { makeBlockId: () => randomUUID() })
  assert.equal(groups.length, 2)
  assert.equal(groups[1].dialogue[0].role, 'statement')
  assert.deepEqual(groups[1].issues, ['odd-unpaired-cue'])
})

test('declared intro and outro cues remain standalone', () => {
  const groups = groupDialoguePairs([cue(1), cue(2), cue(3), cue(4), cue(5), cue(6)], {
    makeBlockId: () => randomUUID(),
    standalone: { 'cue-001': 'intro', 'cue-006': 'outro' }
  })
  assert.deepEqual(groups.map((group) => group.dialogue.length), [1, 2, 2, 1])
  assert.equal(groups[0].semantic.role, 'intro')
  assert.equal(groups[0].semantic.shuffleEligible, false)
  assert.equal(groups[3].semantic.role, 'outro')
})
