import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSrtTimelineExpression } from '../src/main/services/srt.ts'

test('buildSrtTimelineExpression generates accurate between expressions and merges overlapping intervals', () => {
  const cues = [
    { a: '00:00:01,000', b: '00:00:03,500', chu: 'Câu 1' },
    { a: '00:00:03,520', b: '00:00:06,000', chu: 'Câu 2 (liền kề)' },
    { a: '00:00:10,000', b: '00:00:12,250', chu: 'Câu 3' }
  ]

  const expr = buildSrtTimelineExpression(cues)
  // Câu 1 (1.0 -> 3.5) và câu 2 (3.52 -> 6.0) cách nhau 0.02s (<0.05s) nên được gộp thành 1 -> 6
  assert.equal(expr, 'between(t,1,6)+between(t,10,12.25)')
})

test('buildSrtTimelineExpression returns empty string for empty cues', () => {
  assert.equal(buildSrtTimelineExpression([]), '')
})

import { wrapWidthFromBox, estimateTextWidthPx } from '../src/shared/subWrap.ts'

test('wrapWidthFromBox reduces box width by 2x padding', () => {
  assert.equal(wrapWidthFromBox(500, 10), 480)
  assert.equal(wrapWidthFromBox(500, 0), 500)
})

test('estimateTextWidthPx computes width based on CJK and Latin characters', () => {
  const widthLatin = estimateTextWidthPx('Hello', 20)
  assert.equal(widthLatin, 5 * 10) // 5 chars * 10px = 50px
  const widthCjk = estimateTextWidthPx('你好', 20)
  assert.equal(widthCjk, 2 * 20) // 2 CJK chars * 20px = 40px
})
