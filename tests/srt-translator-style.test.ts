import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { localMediaUrl, reviewClipRange } from '../src/renderer/src/features/srt-translator/media.ts'

const featureStyles = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/features/srt-translator/styles.css', import.meta.url)),
  'utf8'
)
const globalStyles = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/styles.css', import.meta.url)),
  'utf8'
)

test('workspace Dịch SRT chiếm vùng tab và tự cuộn theo chiều dọc', () => {
  const block = featureStyles.match(/\.srt-translator-workspace\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(block, /flex:\s*1\s+1\s+auto/)
  assert.match(block, /height:\s*100%/)
  assert.match(block, /overflow-y:\s*auto/)
})

test('preview SRT không co lại và cắt mất phần nội dung phía dưới', () => {
  const block = featureStyles.match(/\.srt-translator-preview-card\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(block, /flex-shrink:\s*0/)
})

test('scrollbar của workspace Dịch SRT hiện thumb khi hover', () => {
  assert.match(globalStyles, /\.srt-translator-workspace:hover::-webkit-scrollbar-thumb/)
})

test('review clip starts 1.5 seconds early and ends 2 seconds late', () => {
  assert.deepEqual(reviewClipRange({ startSeconds: 1, endSeconds: 2 }), { startSeconds: 0, endSeconds: 4 })
  assert.deepEqual(reviewClipRange({ startSeconds: 10, endSeconds: 12 }), { startSeconds: 8.5, endSeconds: 14 })
})

test('local video URL uses the established b64 protocol', () => {
  assert.match(localMediaUrl('C:\\video test\\a.mp4'), /^tblao:\/\/b64\//)
})

test('five-step UI classes preserve scroll and responsive review layout', () => {
  for (const selector of ['.srt-translator-stepper', '.srt-translator-review-list', '.srt-translator-review-card', '.srt-translator-country-option', '.srt-translator-preview-card']) {
    assert.match(featureStyles, new RegExp(selector.replace('.', '\\.') ))
  }
  assert.match(featureStyles, /overflow-y:\s*auto/)
  assert.match(featureStyles, /@media\s*\(max-width:\s*900px\)/)
})

test('Dịch SRT không giữ lại CSS của form locale thủ công đã bị thay thế', () => {
  assert.doesNotMatch(featureStyles, /\.srt-translator-locale-grid\b/)
  assert.doesNotMatch(featureStyles, /\.srt-translator-locale-card\b/)
  assert.doesNotMatch(featureStyles, /\.srt-translator-custom-locale-grid\b/)
})
