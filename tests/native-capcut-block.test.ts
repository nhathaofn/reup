import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { generateNativeCapCutProject } from '../src/main/services/nativeCapCutGenerator.ts'
import { writeMinimalCapCutTemplate } from './helpers/native-capcut-template.ts'

test('native generator writes video speed/full asset duration/source range and copies shared source once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-native-block-'))
  try {
    const templateDir = await writeMinimalCapCutTemplate(root)
    const video = join(root, 'source.mp4')
    const voice = join(root, 'voice.wav')
    await writeFile(video, Buffer.from('video-fixture'))
    await writeFile(voice, Buffer.from('voice-fixture'))
    await mkdir(join(root, 'drafts'), { recursive: true })
    const projectPath = join(root, 'drafts', 'Block Test')
    const result = await generateNativeCapCutProject({
      projectPath, projectName: 'Block Test', templateDir, width: 1920, height: 1080, fps: 30,
      videoItems: [
        { sourcePath: video, assetName: 'tblao-source.mp4', startSeconds: 0, durationSeconds: 3.9, sourceStartSeconds: 4, sourceDurationSeconds: 4, assetDurationSeconds: 8, speed: 4 / 3.9, width: 1920, height: 1080, volume: 0 },
        { sourcePath: video, assetName: 'tblao-source.mp4', startSeconds: 3.9, durationSeconds: 3.9, sourceStartSeconds: 0, sourceDurationSeconds: 4, assetDurationSeconds: 8, speed: 4 / 3.9, width: 1920, height: 1080, volume: 0 }
      ],
      audioItems: [{ sourcePath: voice, assetName: 'voice.wav', startSeconds: 0, durationSeconds: 1, sourceDurationSeconds: 1, speed: 1, volume: 1 }],
      textItems: [{ startSeconds: 0, durationSeconds: 1, text: 'Caption' }]
    })
    const draft = JSON.parse(await readFile(join(projectPath, 'draft_content.json'), 'utf8'))
    const videoSegments = draft.tracks.find((track: { type: string }) => track.type === 'video').segments
    assert.equal(videoSegments[0].speed, Number((4 / 3.9).toFixed(6)))
    assert.deepEqual(videoSegments[0].source_timerange, { start: 4_000_000, duration: 4_000_000 })
    const videoMaterial = draft.materials.videos[0]
    assert.equal(videoMaterial.duration, 8_000_000)
    assert.equal(result.assetFiles.filter((path) => path.endsWith('tblao-source.mp4')).length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
