import type {
  LocaleAssetManifest,
  SourceBlockManifest,
  VariantPlan
} from '../../src/shared/features/content-blocks.ts'

export const SHA_A = `sha256:${'a'.repeat(64)}` as const

export function sourceManifestFixture(): SourceBlockManifest {
  return {
    schemaVersion: 1,
    source: { path: 'C:\\fixture\\source.mp4', fingerprint: SHA_A, durationUs: 8_000_000, fps: 30 },
    revision: 1,
    blocks: [
      {
        id: 'block-a',
        sourceRange: { startUs: 0, endUs: 4_000_000 },
        cueIds: ['cue-001', 'cue-002'],
        dialogue: [
          { cueId: 'cue-001', sourceIndex: 1, role: 'question', text: 'Q1', sourceStartUs: 100_000, sourceEndUs: 1_100_000 },
          { cueId: 'cue-002', sourceIndex: 2, role: 'answer', text: 'A1', sourceStartUs: 1_200_000, sourceEndUs: 3_800_000 }
        ],
        boundary: { targetUs: 3_800_000, selectedUs: 4_000_000, reason: 'scene-near-srt', reviewState: 'accepted' },
        semantic: { role: 'normal', shuffleEligible: true, requiresPreviousBlockId: null },
        issues: []
      },
      {
        id: 'block-b',
        sourceRange: { startUs: 4_000_000, endUs: 8_000_000 },
        cueIds: ['cue-003', 'cue-004'],
        dialogue: [
          { cueId: 'cue-003', sourceIndex: 3, role: 'question', text: 'Q2', sourceStartUs: 4_100_000, sourceEndUs: 5_100_000 },
          { cueId: 'cue-004', sourceIndex: 4, role: 'answer', text: 'A2', sourceStartUs: 5_200_000, sourceEndUs: 7_800_000 }
        ],
        boundary: { targetUs: 7_800_000, selectedUs: 8_000_000, reason: 'scene-near-srt', reviewState: 'accepted' },
        semantic: { role: 'normal', shuffleEligible: true, requiresPreviousBlockId: null },
        issues: []
      }
    ]
  }
}

export function localeManifestFixture(sourceManifestFingerprint: `sha256:${string}`): LocaleAssetManifest {
  return {
    schemaVersion: 1,
    sourceManifestFingerprint,
    locale: 'vi-VN',
    blocks: {
      'block-a': { cues: [
        { cueId: 'cue-001', text: 'Hỏi 1', voicePath: 'C:\\fixture\\cue-001.wav', voiceDurationUs: 1_000_000 },
        { cueId: 'cue-002', text: 'Đáp 1', voicePath: 'C:\\fixture\\cue-002.wav', voiceDurationUs: 2_700_000 }
      ] },
      'block-b': { cues: [
        { cueId: 'cue-003', text: 'Hỏi 2', voicePath: 'C:\\fixture\\cue-003.wav', voiceDurationUs: 1_000_000 },
        { cueId: 'cue-004', text: 'Đáp 2', voicePath: 'C:\\fixture\\cue-004.wav', voiceDurationUs: 2_700_000 }
      ] }
    }
  }
}

export function variantFixture(sourceManifestFingerprint: `sha256:${string}`): VariantPlan {
  return {
    schemaVersion: 1,
    variantId: 'variant-001',
    sourceManifestFingerprint,
    seed: '392831',
    blockOrder: ['block-b', 'block-a'],
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  }
}
