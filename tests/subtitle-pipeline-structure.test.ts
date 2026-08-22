import assert from 'node:assert/strict'
import test from 'node:test'
import { fuseSubtitleEvidence } from '../src/main/services/subtitle-pipeline-fusion.ts'
import {
  alignCanonicalToOcrStructure,
  buildOcrStructure
} from '../src/main/services/subtitle-pipeline-structure.ts'
import type { CanonicalSource, RestoredCue } from '../src/shared/features/srt-translator.ts'

const asrTrack = [
  '1',
  '00:00:00,000 --> 00:00:01,000',
  '这是哪国空姐?',
  '',
  '2',
  '00:00:01,600 --> 00:00:05,460',
  '这是阿联酋空解,月薪约3.8万到4.6万元',
  '',
  '3',
  '00:00:05,460 --> 00:00:07,040',
  '这是哪国空姐?',
  ''
].join('\n')

const ocrTrack = [
  '1',
  '00:00:00,000 --> 00:00:02,000',
  '这是哪国空姐？',
  '',
  '2',
  '00:00:02,000 --> 00:00:03,000',
  '这是阿联酋空姐',
  '',
  '3',
  '00:00:03,000 --> 00:00:06,000',
  '月薪约3.8万～4.6万元',
  '',
  '4',
  '00:00:06,000 --> 00:00:07,000',
  '这是哪国空姐？ DAX',
  '',
  '5',
  '00:00:07,000 --> 00:00:07,500',
  '这是哪国空姐？ cabin safety text',
  '',
  '6',
  '00:00:07,500 --> 00:00:10,000',
  '这是卡塔尔空姐',
  '',
  '7',
  '00:00:10,000 --> 00:00:11,000',
  '月薪约3万～3.2万元',
  '',
  '8',
  '00:00:11,000 --> 00:00:12,000',
  '这是泰国空姐 126960',
  '',
  '9',
  '00:00:12,000 --> 00:00:13,000',
  '艺 这是泰国空姐',
  ''
].join('\n')

function summaryFixture() {
  return fuseSubtitleEvidence([
    { source: 'asr', text: asrTrack, language: 'zh' },
    { source: 'ocr', text: ocrTrack, language: 'zh' }
  ])
}

function restoredCue(n: number, time: string, text: string): RestoredCue {
  return {
    n,
    time,
    originalZh: text,
    correctedZh: text,
    meaningVi: text,
    changed: false,
    confidence: 'high',
    issue: 'none',
    evidenceVi: '',
    candidates: [],
    needsReview: false,
    disposition: 'pass',
    finalAction: 'keep'
  }
}

test('OCR structure keeps real overlay changes but merges noisy repeated frames', () => {
  const structure = buildOcrStructure(summaryFixture())

  assert.deepEqual(
    structure.slice(0, 4).map((cue) => [cue.startMs, cue.endMs]),
    [
      [0, 2_000],
      [2_000, 3_000],
      [3_000, 6_000],
      [6_000, 7_500]
    ]
  )
  assert.equal(structure.filter((cue) => cue.startMs === 6_000).length, 1)
  assert.equal(structure.filter((cue) => cue.startMs === 11_000).length, 1)
  assert.equal(structure.find((cue) => cue.startMs === 11_000)?.endMs, 13_000)
})

test('canonical restoration follows OCR boundaries without copying OCR text', () => {
  const summary = summaryFixture()
  const canonical: CanonicalSource = {
    jobId: 'job-ocr-structure',
    topicVi: 'Tiếp viên hàng không',
    cues: [
      restoredCue(1, '00:00:00,000 --> 00:00:01,000', '这是哪国空姐？'),
      restoredCue(2, '00:00:01,600 --> 00:00:05,460', '这是阿联酋空姐，月薪约3.8万到4.6万元'),
      restoredCue(3, '00:00:05,460 --> 00:00:07,040', '这是哪国空姐？')
    ],
    entities: [],
    moneyMentions: [{
      id: 'money:2:0',
      cueNumber: 2,
      sourceAmount: 38_000,
      sourceCurrencyCode: 'CNY',
      sourceSurface: '3.8万到4.6万元',
      confidence: 'high',
      shouldConvert: true
    }],
    measurementMentions: [],
    unresolvedCueNumbers: []
  }

  const structured = alignCanonicalToOcrStructure(canonical, summary)

  assert.deepEqual(structured.cues.map((cue) => [cue.time, cue.correctedZh]), [
    ['00:00:00,000 --> 00:00:01,000', '这是哪国空姐？'],
    ['00:00:01,600 --> 00:00:03,000', '这是阿联酋空姐，'],
    ['00:00:03,000 --> 00:00:05,460', '月薪约3.8万到4.6万元'],
    ['00:00:05,460 --> 00:00:07,040', '这是哪国空姐？']
  ])
  assert.equal(structured.cues.some((cue) => cue.correctedZh.includes('cabin safety text')), false)
  assert.equal(structured.moneyMentions[0]?.cueNumber, 3)
  assert.equal(structured.cues.map((cue) => cue.correctedZh).join(''), '这是哪国空姐？这是阿联酋空姐，月薪约3.8万到4.6万元这是哪国空姐？')
})
