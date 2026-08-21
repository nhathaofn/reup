import assert from 'node:assert/strict'
import test from 'node:test'
import { createVariantPlan } from '../src/main/services/blockVariantPlanner.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

function sixBlockManifest() {
  const manifest = sourceManifestFixture()
  const template = manifest.blocks[0]
  manifest.source.durationUs = 6_000_000
  manifest.blocks = Array.from({ length: 6 }, (_, index) => {
    const startUs = index * 1_000_000
    const id = `block-${index + 1}`
    return {
      ...structuredClone(template), id,
      sourceRange: { startUs, endUs: startUs + 1_000_000 },
      cueIds: [`cue-${index + 1}`],
      dialogue: [{ cueId: `cue-${index + 1}`, sourceIndex: index + 1, role: 'statement' as const, text: id, sourceStartUs: startUs, sourceEndUs: startUs + 900_000 }],
      boundary: { targetUs: startUs + 900_000, selectedUs: startUs + 1_000_000, reason: 'scene-near-srt' as const, reviewState: 'accepted' as const },
      semantic: { role: 'normal' as const, shuffleEligible: true, requiresPreviousBlockId: null }, issues: []
    }
  })
  return manifest
}

test('same input and seed produce the same permutation with every block once', () => {
  const source = sixBlockManifest()
  const request = { variantId: 'variant-001', seed: '392831', constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true as const } }
  const first = createVariantPlan(source, request)
  const second = createVariantPlan(source, request)
  assert.deepEqual(first, second)
  assert.deepEqual([...first.blockOrder].sort(), source.blocks.map((block) => block.id).sort())
  assert.equal(new Set(first.blockOrder).size, source.blocks.length)
})

test('locks intro first, outro last, fixed middle slot and dependency adjacency', () => {
  const source = sixBlockManifest()
  source.blocks[0].semantic = { role: 'intro', shuffleEligible: false, requiresPreviousBlockId: null }
  source.blocks[2].semantic.shuffleEligible = false
  source.blocks[4].semantic.requiresPreviousBlockId = 'block-4'
  source.blocks[5].semantic = { role: 'outro', shuffleEligible: false, requiresPreviousBlockId: null }
  const plan = createVariantPlan(source, {
    variantId: 'variant-locked', seed: 'abc',
    constraints: { lockedStartBlockIds: ['block-1'], lockedEndBlockIds: ['block-6'], preserveDependencyChains: true }
  })
  assert.equal(plan.blockOrder[0], 'block-1')
  assert.equal(plan.blockOrder.at(-1), 'block-6')
  assert.equal(plan.blockOrder.indexOf('block-5'), plan.blockOrder.indexOf('block-4') + 1)
  assert.equal(plan.blockOrder.indexOf('block-3'), 2)
})

test('semantic intro and CTA become effective edge locks even when caller omits them', () => {
  const source = sixBlockManifest()
  source.blocks[1].semantic = { role: 'intro', shuffleEligible: false, requiresPreviousBlockId: null }
  source.blocks[4].semantic = { role: 'cta', shuffleEligible: false, requiresPreviousBlockId: null }
  const plan = createVariantPlan(source, {
    variantId: 'variant-semantic-locks', seed: 'semantic',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })
  assert.equal(plan.blockOrder[0], 'block-2')
  assert.equal(plan.blockOrder.at(-1), 'block-5')
  assert.deepEqual(plan.constraints.lockedStartBlockIds, ['block-2'])
  assert.deepEqual(plan.constraints.lockedEndBlockIds, ['block-5'])
})

test('rejects missing locks, dependency cycle and dependency branch', () => {
  const source = sixBlockManifest()
  assert.throws(() => createVariantPlan(source, {
    variantId: 'x', seed: 'x', constraints: { lockedStartBlockIds: ['missing'], lockedEndBlockIds: [], preserveDependencyChains: true }
  }), /missing/u)
  source.blocks[1].semantic.requiresPreviousBlockId = 'block-1'
  source.blocks[2].semantic.requiresPreviousBlockId = 'block-1'
  assert.throws(() => createVariantPlan(source, {
    variantId: 'x', seed: 'x', constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  }), /branch/u)
})
