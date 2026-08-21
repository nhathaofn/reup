import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

test('content block renderer has five steps and only typed window API access', () => {
  const files = [
    '../src/renderer/src/features/content-blocks/index.tsx',
    '../src/renderer/src/features/content-blocks/model.ts',
    '../src/renderer/src/features/content-blocks/components/SourceStep.tsx',
    '../src/renderer/src/features/content-blocks/components/ReviewStep.tsx',
    '../src/renderer/src/features/content-blocks/components/LocaleStep.tsx',
    '../src/renderer/src/features/content-blocks/components/VariantStep.tsx',
    '../src/renderer/src/features/content-blocks/components/ExportStep.tsx'
  ].map(read).join('\n')
  for (const name of ['SourceStep', 'ReviewStep', 'LocaleStep', 'VariantStep', 'ExportStep']) assert.match(files, new RegExp(`\\b${name}\\b`, 'u'))
  for (const name of [
    'contentBlockPickPath', 'analyzeContentBlocks', 'editContentBlockManifest',
    'importContentBlockLocale', 'createContentBlockVariant', 'buildContentBlockTimeline',
    'exportContentBlockCapCut', 'cancelContentBlocks', 'onContentBlockProgress'
  ]) assert.match(files, new RegExp(`\\b${name}\\b`, 'u'))
  assert.doesNotMatch(files, /from ['"]electron['"]|node:fs/u)
  assert.match(read('../src/renderer/src/features/content-blocks/index.tsx'), /\.\.\.FEATURE_META/u)
})
