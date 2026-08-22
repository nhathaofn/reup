import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createContentBlockWorkflow, detectOpenCapCutDraftLock } from '../src/main/services/contentBlockWorkflow.ts'
import { fingerprintSourceManifest, writeArtifactAtomic, validateLocaleAssetManifest, validateSourceBlockManifest } from '../src/main/services/contentBlockManifest.ts'
import { localeManifestFixture, sourceManifestFixture } from './helpers/content-block-fixtures.ts'

test('writes variant, locale timeline and regenerated SRT under canonical artifact folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-block-workflow-'))
  try {
    const source = sourceManifestFixture()
    const fingerprint = fingerprintSourceManifest(source)
    const sourcePath = join(root, 'analysis', 'source-blocks.json')
    const localePath = join(root, 'locales', 'vi-VN', 'assets.json')
    await writeArtifactAtomic(sourcePath, source, validateSourceBlockManifest)
    await writeArtifactAtomic(localePath, localeManifestFixture(fingerprint), validateLocaleAssetManifest)
    const workflow = createContentBlockWorkflow()
    const variant = await workflow.createVariant({
      projectDir: root, sourceManifestPath: sourcePath, variantId: 'variant-001', seed: '392831',
      constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
    })
    assert.equal(variant.variantPath, join(root, 'variants', 'variant-001.json'))
    const timeline = await workflow.buildTimeline({
      projectDir: root, sourceManifestPath: sourcePath, localeManifestPath: localePath, variantPath: variant.variantPath!
    })
    assert.equal(timeline.ok, true)
    assert.equal(timeline.timelinePath, join(root, 'timelines', 'variant-001.vi-VN.json'))
    assert.equal(timeline.subtitlePath, join(root, 'exports', 'subtitles', 'variant-001.vi-VN.srt'))
    assert.match(await readFile(timeline.subtitlePath!, 'utf8'), /^1\n/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source fingerprint mismatch blocks CapCut generation before writing a project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-block-export-gate-'))
  try {
    const source = sourceManifestFixture()
    source.source.path = join(root, 'source.mp4')
    await writeFile(source.source.path, 'changed-source', 'utf8')
    const sourcePath = join(root, 'analysis', 'source-blocks.json')
    await writeArtifactAtomic(sourcePath, source, validateSourceBlockManifest)
    let generated = false
    const workflow = createContentBlockWorkflow({
      hashFile: async () => `sha256:${'9'.repeat(64)}`,
      generateProject: async () => { generated = true; throw new Error('must not run') }
    })
    const result = await workflow.exportCapCut({
      sourceManifestPath: sourcePath,
      localeManifestPath: join(root, 'missing-locale.json'),
      timelinePath: join(root, 'missing-timeline.json'),
      draftsDir: join(root, 'drafts'), templateDir: join(root, 'template'), projectName: 'Mismatch'
    })
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /fingerprint/u)
    assert.equal(generated, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed locale import never overwrites another locale artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-locale-isolation-'))
  try {
    const viPath = join(root, 'locales', 'vi-VN', 'assets.json')
    await mkdir(join(root, 'locales', 'vi-VN'), { recursive: true })
    await writeFile(viPath, 'keep-vi', 'utf8')
    const workflow = createContentBlockWorkflow({ importLocaleFromFiles: async () => ({ ok: false, missingCueIds: ['cue-001'], invalidCueIds: [], extraFiles: [], error: 'missing' }) })
    const result = await workflow.importLocale({ projectDir: root, sourceManifestPath: 'source.json', locale: 'th-TH', localizedSrtPath: 'th.srt', voiceDir: 'voices' })
    assert.equal(result.ok, false)
    assert.equal(await readFile(viPath, 'utf8'), 'keep-vi')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detects an open CapCut draft lock before export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-draft-lock-'))
  try {
    await mkdir(join(root, 'Open Project'), { recursive: true })
    await writeFile(join(root, 'Open Project', '.locked'), '', 'utf8')
    assert.equal(await detectOpenCapCutDraftLock(root), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
