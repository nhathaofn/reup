import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTranslatedBlocks } from '../src/shared/features/srt-translator.ts'

test('ghép bản dịch theo số cue nhưng giữ nguyên timestamp', () => {
  const source = [
    { time: '00:00:01,000 --> 00:00:02,000', text: '你好' },
    { time: '00:00:03,000 --> 00:00:04,000', text: '再见' }
  ]

  const merged = mergeTranslatedBlocks(source, [
    { n: 1, t: 'Xin chào' },
    { n: 2, t: 'Tạm biệt' }
  ])

  assert.deepEqual(merged, [
    { time: '00:00:01,000 --> 00:00:02,000', text: 'Xin chào' },
    { time: '00:00:03,000 --> 00:00:04,000', text: 'Tạm biệt' }
  ])
})

test('thiếu row dịch thì giữ nguyên text gốc', () => {
  const source = [{ time: '00:00:01,000 --> 00:00:02,000', text: '原文' }]
  const merged = mergeTranslatedBlocks(source, [])
  assert.equal(merged[0]?.text, '原文')
})


