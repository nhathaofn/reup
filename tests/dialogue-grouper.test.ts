import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { groupDialogueByQuestionBoundaries, groupDialoguePairs } from '../src/main/services/dialogueGrouper.ts'
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

test('question-boundary grouping keeps multi-cue answers together', () => {
  const texts = [
    '这是哪国空姐？',
    '这是日本空姐，月薪约1.44万到1.68万元',
    '这是哪国空姐',
    '这是挪威空姐，月薪约1.45万到1.58万元',
    '这是哪国空姐',
    '这是泰国空姐',
    '月薪约9500元到1.14万元',
    '这是哪国空姐',
    '这是越南空姐',
    '月薪约5400元到7150元',
    '这是哪国空姐',
    '这是新加坡空姐',
    '月薪约1.9万到2.9万元'
  ]
  const cues = texts.map((text, index) => ({ ...cue(index + 7), text }))
  const ids = ['block-japan', 'block-norway', 'block-thailand', 'block-vietnam', 'block-singapore']
  const groups = groupDialogueByQuestionBoundaries(cues, { makeBlockId: () => ids.shift()! })

  assert.deepEqual(groups.map((group) => group.cueIds), [
    ['cue-007', 'cue-008'],
    ['cue-009', 'cue-010'],
    ['cue-011', 'cue-012', 'cue-013'],
    ['cue-014', 'cue-015', 'cue-016'],
    ['cue-017', 'cue-018', 'cue-019']
  ])
  assert.deepEqual(groups[2].dialogue.map((item) => item.role), ['question', 'answer', 'statement'])
  assert.equal(groups.every((group) => group.issues.length === 0), true)
})

test('question-boundary grouping marks sources without question anchors for review', () => {
  const groups = groupDialogueByQuestionBoundaries([cue(1), cue(2), cue(3)], { makeBlockId: () => 'block-review' })
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].cueIds, ['cue-001', 'cue-002', 'cue-003'])
  assert.deepEqual(groups[0].issues, ['grouping-review'])
  assert.equal(groups[0].semantic.shuffleEligible, false)
})
