import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAnalyzeContentBlocks,
  canBuildContentTimeline,
  canExportContentBlockCapCut,
  createInitialContentBlockState,
  defaultVariantConstraints,
  makeBoundaryEdit,
  reviewIsComplete,
  upsertImportedLocale,
  visibleContentBlockStep
} from '../src/renderer/src/features/content-blocks/model.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

test('analyze gate requires four source paths and idle state', () => {
  const state = {
    ...createInitialContentBlockState(),
    projectDir: 'C:\\project', videoPath: 'C:\\source.mp4', srtPath: 'C:\\source.srt', sceneManifestPath: 'C:\\scene-splitter.json'
  }
  assert.equal(canAnalyzeContentBlocks(state), true)
  assert.equal(canAnalyzeContentBlocks({ ...state, sceneManifestPath: '' }), false)
  assert.equal(canAnalyzeContentBlocks({ ...state, running: true }), false)
})

test('fallback and odd cue issues keep review open until manual correction', () => {
  const manifest = sourceManifestFixture()
  assert.equal(reviewIsComplete(manifest), true)
  manifest.blocks[0].boundary.reviewState = 'needs-review'
  manifest.blocks[0].issues = ['srt-fallback']
  assert.equal(reviewIsComplete(manifest), false)
  manifest.blocks[0].boundary.reviewState = 'accepted'
  manifest.blocks[0].issues = []
  assert.equal(reviewIsComplete(manifest), true)
})

test('boundary editor converts UI seconds to integer microseconds', () => {
  assert.deepEqual(makeBoundaryEdit('block-a', 3.875, true), {
    kind: 'set-boundary', blockId: 'block-a', selectedUs: 3_875_000, locked: true
  })
  assert.throws(() => makeBoundaryEdit('block-a', -1, false), /không âm/u)
})

test('constraints derive intro start and outro/CTA end locks', () => {
  const manifest = sourceManifestFixture()
  manifest.blocks[0].semantic.role = 'intro'
  manifest.blocks[1].semantic.role = 'cta'
  assert.deepEqual(defaultVariantConstraints(manifest), {
    lockedStartBlockIds: ['block-a'], lockedEndBlockIds: ['block-b'], preserveDependencyChains: true
  })
})

test('timeline review and missing CapCut paths block export', () => {
  const state = createInitialContentBlockState()
  assert.equal(canBuildContentTimeline({ ...state, sourceManifestPath: 'source.json', localeManifestPath: 'locale.json', variantPath: 'variant.json' }), true)
  const ready = { ...state, timelinePath: 'timeline.json', localeManifestPath: 'locale.json', sourceManifestPath: 'source.json', draftsDir: 'drafts', templateDir: 'template', projectName: 'Project', timeline: { schemaVersion: 1, sourceManifestFingerprint: `sha256:${'a'.repeat(64)}` as const, variantId: 'v', locale: 'vi-VN', durationUs: 1, items: [], reviewBlockIds: [] } }
  assert.equal(canExportContentBlockCapCut(ready), true)
  assert.equal(canExportContentBlockCapCut({ ...ready, timeline: { ...ready.timeline, reviewBlockIds: ['block-a'] } }), false)
})

test('visible step follows source, review, locale, variant and export artifacts', () => {
  const state = createInitialContentBlockState()
  assert.equal(visibleContentBlockStep(state), 'source')
  const manifest = sourceManifestFixture()
  manifest.blocks[0].issues = ['srt-fallback']
  manifest.blocks[0].boundary.reviewState = 'needs-review'
  assert.equal(visibleContentBlockStep({ ...state, sourceManifest: manifest }), 'review')
  manifest.blocks[0].issues = []
  manifest.blocks[0].boundary.reviewState = 'accepted'
  assert.equal(visibleContentBlockStep({ ...state, sourceManifest: manifest }), 'locale')
})

test('locale import list replaces the same locale but preserves other locales', () => {
  const first = { locale: 'vi-VN', manifestPath: 'vi-old.json', manifest: null }
  const second = { locale: 'th-TH', manifestPath: 'th.json', manifest: null }
  const replacement = { locale: 'vi-VN', manifestPath: 'vi-new.json', manifest: null }
  assert.deepEqual(upsertImportedLocale(upsertImportedLocale([first], second), replacement), [replacement, second])
})
