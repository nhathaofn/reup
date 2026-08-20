import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  ttsNormalizeChinese,
  ttsNormalizeSrt
} from '../src/main/services/srt-tts-normalization.ts'

test('ttsNormalizeChinese converts natural zero speech patterns', () => {
  // Safe zero patterns
  assert.equal(ttsNormalizeChinese('从0加速到时速600公里'), '从零加速到时速600公里')
  assert.equal(ttsNormalizeChinese('从0开始'), '从零开始')
  assert.equal(ttsNormalizeChinese('从0起步'), '从零起步')
  assert.equal(ttsNormalizeChinese('时速降到0'), '时速降到零')
  assert.equal(ttsNormalizeChinese('接近0误差'), '接近零误差')
  assert.equal(ttsNormalizeChinese('计数归0'), '计数归零')
  assert.equal(ttsNormalizeChinese('0到600公里加速'), '零到600公里加速')
  assert.equal(ttsNormalizeChinese('实现0排放'), '实现零排放')
})

test('ttsNormalizeChinese preserves alphanumeric product codes and numbers > 0', () => {
  // Must NOT modify product codes, years, or numbers > 0
  assert.equal(ttsNormalizeChinese('这是我国CR450高铁列车'), '这是我国CR450高铁列车')
  assert.equal(ttsNormalizeChinese('采用（GOA3）有人值守模式'), '采用（GOA3）有人值守模式')
  assert.equal(ttsNormalizeChinese('采用GOA4无人驾驶空中巴士'), '采用GOA4无人驾驶空中巴士')
  assert.equal(ttsNormalizeChinese('预计2030年通车'), '预计2030年通车')
  assert.equal(ttsNormalizeChinese('车内实现270度观景'), '车内实现270度观景')
  assert.equal(ttsNormalizeChinese('载客量约307人'), '载客量约307人')
  assert.equal(ttsNormalizeChinese('时速达600公里'), '时速达600公里')
})

test('ttsNormalizeSrt normalizes all cues in SRT format while preserving timestamps', () => {
  const inputSrt = [
    '1',
    '00:00:01,000 --> 00:00:03,000',
    '从0加速到时速600公里',
    '',
    '2',
    '00:00:03,500 --> 00:00:05,500',
    '这是我国CR450高铁列车'
  ].join('\n')

  const normalized = ttsNormalizeSrt(inputSrt)
  assert.match(normalized, /从零加速到时速600公里/u)
  assert.match(normalized, /这是我国CR450高铁列车/u)
  assert.match(normalized, /00:00:01,000 --> 00:00:03,000/u)
})
