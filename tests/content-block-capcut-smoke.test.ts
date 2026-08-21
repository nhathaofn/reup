import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { createVariantPlan } from '../src/main/services/blockVariantPlanner.ts'
import { createContentBlockWorkflow } from '../src/main/services/contentBlockWorkflow.ts'
import type { RenderTimeline } from '../src/shared/features/content-blocks.ts'

interface SmokeLocale {
  locale: string
  localizedSrtPath: string
  voiceDir: string
  voiceMapPath?: string
}

interface SmokeConfig {
  projectDir: string
  videoPath: string
  sourceSrtPath: string
  sceneManifestPath: string
  templateDir: string
  draftsDir: string
  locales: SmokeLocale[]
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} phải là chuỗi không rỗng.`)
  return value
}

async function loadSmokeConfig(configPath: string | undefined): Promise<SmokeConfig> {
  if (!configPath || !isAbsolute(configPath)) throw new Error('CONTENT_BLOCK_SMOKE_CONFIG phải là đường dẫn tuyệt đối.')
  const parsed = JSON.parse(await readFile(configPath, 'utf8')) as Partial<SmokeConfig>
  const config: SmokeConfig = {
    projectDir: requiredString(parsed.projectDir, 'projectDir'),
    videoPath: requiredString(parsed.videoPath, 'videoPath'),
    sourceSrtPath: requiredString(parsed.sourceSrtPath, 'sourceSrtPath'),
    sceneManifestPath: requiredString(parsed.sceneManifestPath, 'sceneManifestPath'),
    templateDir: requiredString(parsed.templateDir, 'templateDir'),
    draftsDir: requiredString(parsed.draftsDir, 'draftsDir'),
    locales: Array.isArray(parsed.locales) ? parsed.locales.map((locale, index) => ({
      locale: requiredString(locale?.locale, `locales[${index}].locale`),
      localizedSrtPath: requiredString(locale?.localizedSrtPath, `locales[${index}].localizedSrtPath`),
      voiceDir: requiredString(locale?.voiceDir, `locales[${index}].voiceDir`),
      ...(locale?.voiceMapPath ? { voiceMapPath: requiredString(locale.voiceMapPath, `locales[${index}].voiceMapPath`) } : {})
    })) : []
  }
  if (config.locales.length < 2) throw new Error('Smoke cần ít nhất hai locale.')
  const requiredPaths = [
    config.projectDir, config.videoPath, config.sourceSrtPath, config.sceneManifestPath,
    config.templateDir, config.draftsDir,
    ...config.locales.flatMap((locale) => [locale.localizedSrtPath, locale.voiceDir, locale.voiceMapPath].filter((path): path is string => Boolean(path)))
  ]
  if (requiredPaths.some((path) => !isAbsolute(path))) throw new Error('Mọi path trong smoke config phải tuyệt đối.')
  const projectDir = resolve(config.projectDir)
  const draftsDir = resolve(config.draftsDir)
  const draftsRelative = relative(projectDir, draftsDir)
  if (!draftsRelative || draftsRelative.startsWith('..') || isAbsolute(draftsRelative) || basename(draftsDir) !== 'smoke-drafts') {
    throw new Error('draftsDir phải là thư mục con smoke-drafts bên trong projectDir.')
  }
  if (/capcut user data/i.test(draftsDir)) throw new Error('Không được dùng CapCut User Data thật làm draftsDir smoke.')
  await stat(projectDir)
  for (const inputPath of [
    config.videoPath, config.sourceSrtPath, config.sceneManifestPath, config.templateDir,
    ...config.locales.flatMap((locale) => [locale.localizedSrtPath, locale.voiceDir, locale.voiceMapPath].filter((path): path is string => Boolean(path)))
  ]) await stat(inputPath)
  return { ...config, projectDir, draftsDir }
}

async function assertDraftMatchesTimeline(draft: Record<string, unknown>, timeline: RenderTimeline): Promise<void> {
  const tracks = draft.tracks as Array<{ type: string; segments: Array<{ target_timerange: { start: number; duration: number } }> }>
  const video = tracks.find((track) => track.type === 'video')?.segments ?? []
  const audio = tracks.find((track) => track.type === 'audio')?.segments ?? []
  const text = tracks.find((track) => track.type === 'text')?.segments ?? []
  const expectedCues = timeline.items.flatMap((item) => item.subtitleCues)
  assert.equal(video.length, timeline.items.length)
  assert.equal(audio.length, expectedCues.length)
  assert.equal(text.length, expectedCues.length)
  for (const [index, cue] of expectedCues.entries()) {
    const expectedRange = { start: cue.startUs, duration: cue.endUs - cue.startUs }
    assert.deepEqual(audio[index].target_timerange, expectedRange)
    assert.deepEqual(text[index].target_timerange, expectedRange)
  }
  const materials = draft.materials as Record<string, Array<Record<string, unknown>>>
  for (const material of [...(materials.videos ?? []), ...(materials.audios ?? [])]) {
    const path = ['path', 'local_material_file_path', 'file_Path', 'file_path']
      .map((key) => material[key])
      .find((value): value is string => typeof value === 'string' && value.length > 0)
    assert.ok(path, 'Media material phải có local path.')
    assert.equal((await stat(path)).isFile(), true)
  }
}

const runSmoke = process.env.RUN_CONTENT_BLOCK_CAPCUT_SMOKE === '1'

test('real media creates two aligned and parseable CapCut drafts', {
  skip: runSmoke ? false : 'Set RUN_CONTENT_BLOCK_CAPCUT_SMOKE=1 to run real CapCut smoke.'
}, async () => {
  const config = await loadSmokeConfig(process.env.CONTENT_BLOCK_SMOKE_CONFIG)
  const workflow = createContentBlockWorkflow()
  const analyzed = await workflow.analyze({
    projectDir: config.projectDir,
    videoPath: config.videoPath,
    srtPath: config.sourceSrtPath,
    sceneManifestPath: config.sceneManifestPath
  })
  assert.equal(analyzed.ok, true, analyzed.error)
  assert.ok(analyzed.manifest && analyzed.manifest.blocks.length >= 3)

  const localeResults = []
  for (const locale of config.locales) {
    const imported = await workflow.importLocale({
      projectDir: config.projectDir,
      sourceManifestPath: analyzed.manifestPath!,
      locale: locale.locale,
      localizedSrtPath: locale.localizedSrtPath,
      voiceDir: locale.voiceDir,
      voiceMapPath: locale.voiceMapPath ?? null
    })
    assert.equal(imported.ok, true, imported.error)
    localeResults.push(imported)
  }

  const variant = await workflow.createVariant({
    projectDir: config.projectDir,
    sourceManifestPath: analyzed.manifestPath!,
    variantId: 'smoke-variant',
    seed: 'smoke-seed',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })
  assert.equal(variant.ok, true, variant.error)

  const provenOrders: string[][] = []
  for (const [index, locale] of config.locales.entries()) {
    const timeline = await workflow.buildTimeline({
      projectDir: config.projectDir,
      sourceManifestPath: analyzed.manifestPath!,
      localeManifestPath: localeResults[index].manifestPath!,
      variantPath: variant.variantPath!
    })
    assert.equal(timeline.ok, true, timeline.error)
    assert.deepEqual(timeline.timeline?.reviewBlockIds, [])
    const exported = await workflow.exportCapCut({
      sourceManifestPath: analyzed.manifestPath!,
      localeManifestPath: localeResults[index].manifestPath!,
      timelinePath: timeline.timelinePath!,
      draftsDir: config.draftsDir,
      templateDir: config.templateDir,
      projectName: `Smoke ${locale.locale}`,
      muteOriginalVideo: true
    })
    assert.equal(exported.ok, true, exported.error)
    const draft = JSON.parse(await readFile(join(exported.projectPath!, 'draft_content.json'), 'utf8')) as Record<string, unknown>
    await assertDraftMatchesTimeline(draft, timeline.timeline!)
    const provenance = JSON.parse(await readFile(exported.provenanceManifestPath!, 'utf8')) as { blockOrder: string[] }
    provenOrders.push(provenance.blockOrder)
  }
  assert.deepEqual(provenOrders[0], provenOrders[1])
  const replayed = createVariantPlan(analyzed.manifest!, {
    variantId: 'smoke-variant', seed: 'smoke-seed',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })
  assert.deepEqual(replayed.blockOrder, provenOrders[0])
})
