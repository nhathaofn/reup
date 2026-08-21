import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSourceBlockManifest,
  parseContentBlockSrt,
  parseSceneBoundaryCandidates
} from '../src/main/services/contentBlockAnalyzer.ts'

const sourceSrt = [
  '1\n00:00:00,100 --> 00:00:01,000\nQ1',
  '2\n00:00:01,100 --> 00:00:03,600\nA1',
  '3\n00:00:04,000 --> 00:00:05,000\nQ2',
  '4\n00:00:05,100 --> 00:00:07,700\nA2'
].join('\n\n')

test('parses source SRT into stable ordered cue IDs and integer microseconds', () => {
  assert.deepEqual(parseContentBlockSrt(sourceSrt), [
    { cueId: 'cue-001', sourceIndex: 1, role: 'statement', text: 'Q1', sourceStartUs: 100_000, sourceEndUs: 1_000_000 },
    { cueId: 'cue-002', sourceIndex: 2, role: 'statement', text: 'A1', sourceStartUs: 1_100_000, sourceEndUs: 3_600_000 },
    { cueId: 'cue-003', sourceIndex: 3, role: 'statement', text: 'Q2', sourceStartUs: 4_000_000, sourceEndUs: 5_000_000 },
    { cueId: 'cue-004', sourceIndex: 4, role: 'statement', text: 'A2', sourceStartUs: 5_100_000, sourceEndUs: 7_700_000 }
  ])
})

test('takes scene ends only from the selected source video', () => {
  const raw = JSON.stringify({
    version: 1,
    scenes: [
      { sourceVideo: 'C:\\input\\source.mp4', endSeconds: 3.8 },
      { sourceVideo: 'C:\\other\\source.mp4', endSeconds: 4.2 },
      { sourceVideo: 'C:\\input\\source.mp4', endSeconds: 8 }
    ]
  })
  assert.deepEqual(parseSceneBoundaryCandidates(raw, 'C:\\input\\source.mp4'), [3_800_000, 8_000_000])
})

test('builds a manifest and reuses IDs when cue membership is unchanged', () => {
  let id = 0
  const first = buildSourceBlockManifest({
    sourcePath: 'C:\\input\\source.mp4',
    sourceFingerprint: `sha256:${'1'.repeat(64)}`,
    durationUs: 8_000_000,
    fps: 30,
    cues: parseContentBlockSrt(sourceSrt),
    sceneBoundaryUs: [3_800_000, 8_000_000],
    makeBlockId: () => `block-new-${++id}`
  })
  const second = buildSourceBlockManifest({
    sourcePath: first.source.path,
    sourceFingerprint: first.source.fingerprint,
    durationUs: first.source.durationUs,
    fps: first.source.fps,
    cues: parseContentBlockSrt(sourceSrt),
    sceneBoundaryUs: [3_800_000, 8_000_000],
    previousManifest: first,
    makeBlockId: () => `block-new-${++id}`
  })
  assert.deepEqual(second.blocks.map((block) => block.id), first.blocks.map((block) => block.id))
  assert.equal(second.revision, 2)
})
