import type {
  CanonicalMoneyMention,
  CanonicalSource,
  ExchangeRateSnapshot,
  LocalizedTarget,
  RestoredCue,
  SrtLocalizationTranslateResult,
  SrtLocaleTargetInput,
  SrtSourceCue
} from '../../src/shared/features/srt-translator.ts'
import type {
  GeminiMultimodalTransport,
  GeminiRemoteFile
} from '../../src/main/services/gemini-files.ts'
import type {
  LoadedSrtSource,
  ValidatedLocalizationSource
} from '../../src/main/services/srt-source-validation.ts'
import type { RestorationDraft } from '../../src/main/services/srt-source-restoration.ts'
import type { SubtitlePipelineEvidenceContext } from '../../src/shared/features/subtitle-pipeline.ts'

export const sourceCuesFixture: SrtSourceCue[] = [
  { n: 1, time: '00:00:01,000 --> 00:00:02,000', startSeconds: 1, endSeconds: 2, text: '[SPEAKER_00] 这种鹅咬人吗', speakerLabel: '[SPEAKER_00]' },
  { n: 2, time: '00:00:03,000 --> 00:00:04,000', startSeconds: 3, endSeconds: 4, text: '它值一百元' }
]

export const pipelineEvidenceFixture: SubtitlePipelineEvidenceContext = {
  sourceCounts: { srt: 2, asr: 2, ocr: 2 },
  conflictCueNumbers: [],
  cues: sourceCuesFixture.map((cue) => ({
    n: cue.n,
    startMs: cue.startSeconds * 1_000,
    endMs: cue.endSeconds * 1_000,
    text: cue.text,
    primarySource: 'srt',
    confidence: 'high',
    conflict: false,
    sources: (['srt', 'asr', 'ocr'] as const).map((source) => ({
      id: `${source}:${cue.n}`,
      source,
      n: cue.n,
      startMs: cue.startSeconds * 1_000,
      endMs: cue.endSeconds * 1_000,
      text: cue.text,
      confidence: null,
      similarity: 1,
      overlapMs: (cue.endSeconds - cue.startSeconds) * 1_000,
      distanceMs: 0
    }))
  }))
}

export const remoteFileFixture: GeminiRemoteFile = {
  name: 'files/abc', uri: 'https://files.test/abc', mimeType: 'video/mp4', state: 'ACTIVE'
}

export const viTargetInputFixture: SrtLocaleTargetInput = {
  id: 'vi-vn', languageLabel: 'Tiếng Việt', locale: 'vi-VN', regionLabel: 'Việt Nam', currencyCode: 'VND'
}
export const jaTargetInputFixture: SrtLocaleTargetInput = {
  id: 'ja-jp', languageLabel: 'Tiếng Nhật', locale: 'ja-JP', regionLabel: 'Nhật Bản', currencyCode: 'JPY'
}

export const rateFixture: ExchangeRateSnapshot = {
  provider: 'exchange-rate-api-open', baseCode: 'USD', capturedAt: '2026-08-18T00:00:00.000Z', sourceUpdatedAt: '2026-08-18T00:00:00.000Z',
  rates: { USD: 1, CNY: 7, VND: 25_000, JPY: 155 }, attributionUrl: 'https://www.exchangerate-api.com'
}

export function createFakeGeminiTransport(responses: readonly unknown[]): GeminiMultimodalTransport {
  const queue = [...responses]
  return {
    uploadVideo: async () => remoteFileFixture,
    waitUntilActive: async (file) => ({ ...file, state: 'ACTIVE' }),
    generateJson: async <T>() => {
      if (!queue.length) throw new Error('fake response queue exhausted')
      return queue.shift() as T
    },
    deleteFile: async () => {}
  }
}

export const loadedSourceFixture: LoadedSrtSource = {
  sourcePath: 'clip.srt',
  sourceText: ['1', '00:00:01,000 --> 00:00:02,000', '[SPEAKER_00] 这种鹅咬人吗', '', '2', '00:00:03,000 --> 00:00:04,000', '它值一百元', ''].join('\n'),
  fingerprint: { path: 'clip.srt', size: 100, modifiedMs: 10 }, cues: sourceCuesFixture, lastCueEndSeconds: 4
}

export const validatedSourceFixture: ValidatedLocalizationSource = {
  ...loadedSourceFixture, videoPath: 'clip.mp4', videoFingerprint: { path: 'clip.mp4', size: 1000, modifiedMs: 20 }, videoMimeType: 'video/mp4', videoDurationSeconds: 5
}

const restoredCuesFixture: RestoredCue[] = [
  { n: 1, time: sourceCuesFixture[0]!.time, originalZh: sourceCuesFixture[0]!.text, correctedZh: sourceCuesFixture[0]!.text, meaningVi: 'Con này có cắn người không?', changed: true, confidence: 'high', issue: 'taxonomy', evidenceVi: 'Hình ảnh cần cách gọi trung tính.', visualContextVi: 'Một loài chim nước.', candidates: [], needsReview: false },
  { n: 2, time: sourceCuesFixture[1]!.time, originalZh: sourceCuesFixture[1]!.text, correctedZh: sourceCuesFixture[1]!.text, meaningVi: 'Nó có giá một trăm nhân dân tệ.', changed: true, confidence: 'medium', issue: 'number-or-currency', evidenceVi: 'Nghe rõ số tiền.', candidates: [], needsReview: false }
]
const moneyMentionsFixture: CanonicalMoneyMention[] = [{ id: 'money:2:0', cueNumber: 2, sourceAmount: 100, sourceCurrencyCode: 'CNY', sourceSurface: '一百元', confidence: 'high', shouldConvert: true }]
export const restorationDraftFixture: RestorationDraft = { topicVi: 'Tập tính và giá trị của chim', cues: restoredCuesFixture, entities: [], moneyMentions: moneyMentionsFixture, measurementMentions: [] }
export const resolvedCanonicalFixture: CanonicalSource = { jobId: 'job-1', ...restorationDraftFixture, unresolvedCueNumbers: [], cues: restorationDraftFixture.cues.map((cue) => ({ ...cue, confidence: 'high', needsReview: false })) }
export const unresolvedCanonicalFixture: CanonicalSource = { ...resolvedCanonicalFixture, cues: resolvedCanonicalFixture.cues.map((cue) => cue.n === 2 ? { ...cue, confidence: 'low', needsReview: true, candidates: [{ id: '2:0', correctedZh: '它值一百元', meaningVi: 'Nó có giá một trăm nhân dân tệ.', evidenceVi: 'Nghe giống 一百元.' }, { id: '2:1', correctedZh: '它值一百块', meaningVi: 'Nó có giá một trăm tệ.', evidenceVi: 'Có thể là cách nói khẩu ngữ.' }] } : cue), unresolvedCueNumbers: [2] }
export const viTargetFixture: LocalizedTarget = { id: 'vi-vn', profile: { ...viTargetInputFixture, unitSystem: 'metric', styleGuide: 'Văn nói reviewer/TikToker Việt; dùng con này khi taxonomy chưa chắc.' } }
export const jaTargetFixture: LocalizedTarget = { id: 'ja-jp', profile: { ...jaTargetInputFixture, unitSystem: 'metric', styleGuide: '自然なショート動画の話し言葉。' } }
export const successfulTranslationFixture: SrtLocalizationTranslateResult = { ok: true, translations: [{ target: viTargetInputFixture, ok: true, srt: loadedSourceFixture.sourceText, count: 2, unverified: false, rateStatus: 'converted' }], rateSnapshot: { sourceUpdatedAt: rateFixture.sourceUpdatedAt, attributionUrl: rateFixture.attributionUrl } }
