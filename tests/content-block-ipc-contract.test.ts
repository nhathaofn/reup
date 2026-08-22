import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

test('preload exposes the complete content-block workflow', () => {
  const preload = read('../src/preload/features/content-blocks.ts')
  for (const method of [
    'contentBlockPickPath', 'analyzeContentBlocks', 'editContentBlockManifest',
    'importContentBlockLocale', 'createContentBlockVariant', 'buildContentBlockTimeline',
    'exportContentBlockCapCut', 'cancelContentBlocks', 'onContentBlockProgress'
  ]) assert.match(preload, new RegExp(`\\b${method}\\b`, 'u'))
  assert.doesNotMatch(preload, /node:fs|child_process|generateNativeCapCutProject/u)
})

test('Main adapter delegates all business logic to one workflow facade', () => {
  const main = read('../src/main/features/content-blocks.ts')
  assert.match(main, /createContentBlockWorkflow/u)
  assert.doesNotMatch(main, /groupDialoguePairs|resolveBlockBoundaries|buildRenderTimeline|generateNativeCapCutProject/u)
})

test('all three registries contain content-blocks exactly once', () => {
  for (const path of [
    '../src/main/features/registry.ts',
    '../src/preload/features/registry.ts',
    '../src/renderer/src/features/registry.ts'
  ]) {
    const source = read(path)
    assert.equal(source.match(/from ['"]\.\/content-blocks['"]/gu)?.length, 1)
  }
})
