import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertSourceFingerprint,
  loadSrtSource,
  parseStrictSrtText,
  probeVideoDuration,
  spawnProbeProcess,
  validateVideoSource
} from '../src/main/services/srt-source-validation.ts'

const raw = [
  '1',
  '00:00:01,000 --> 00:00:02,500',
  '[SPEAKER_00] 你好',
  '',
  '2',
  '00:00:03,000 --> 00:00:04,000',
  '再见',
  ''
].join('\n')

const sourceDeps = {
  readText: async () => raw,
  statFile: async () => ({ size: 99, modifiedMs: 123 })
}

test('strict parser preserves index, timestamp and speaker label', async () => {
  const loaded = await loadSrtSource('clip.srt', sourceDeps)
  assert.equal(loaded.cues[0]?.n, 1)
  assert.equal(loaded.cues[0]?.time, '00:00:01,000 --> 00:00:02,500')
  assert.equal(loaded.cues[0]?.speakerLabel, '[SPEAKER_00]')
  assert.equal(loaded.cues[0]?.text, '[SPEAKER_00] 你好')
  assert.equal(loaded.cues[1]?.endSeconds, 4)
  assert.equal(loaded.lastCueEndSeconds, 4)
})

test('parser accepts BOM and CRLF while preserving timestamp content', () => {
  const cues = parseStrictSrtText(`\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\n你好\r\n`, 'clip.srt')
  assert.equal(cues[0]?.time, '00:00:01,000 --> 00:00:02,000')
  assert.equal(cues[0]?.text, '你好')
})

test('parser rejects non-canonical timestamp spacing and backwards cue time', () => {
  assert.throws(
    () => parseStrictSrtText(
      '1\n00:00:01,000  --> 00:00:02,000\n你好',
      'clip.srt'
    ),
    /SRT không hợp lệ/
  )
  assert.throws(
    () => parseStrictSrtText([
      '1', '00:00:03,000 --> 00:00:04,000', '一', '',
      '2', '00:00:02,000 --> 00:00:03,000', '二'
    ].join('\n'), 'clip.srt'),
    /SRT không hợp lệ/
  )
})

test('video may exceed final cue but cue may not exceed video by over two seconds', async () => {
  const loaded = await loadSrtSource('clip.srt', sourceDeps)
  await assert.doesNotReject(() => validateVideoSource('clip.mp4', loaded, {
    statFile: async () => ({ size: 1000, modifiedMs: 456 }),
    probeDuration: async () => 5
  }))
  await assert.rejects(() => validateVideoSource('clip.mp4', loaded, {
    statFile: async () => ({ size: 1000, modifiedMs: 456 }),
    probeDuration: async () => 1
  }), /vượt thời lượng video quá 2 giây/)
})

test('unsupported container is rejected before network', async () => {
  const loaded = await loadSrtSource('clip.srt', sourceDeps)
  let probed = false
  await assert.rejects(() => validateVideoSource('clip.mkv', loaded, {
    statFile: async () => ({ size: 1000, modifiedMs: 456 }),
    probeDuration: async () => { probed = true; return 5 }
  }), /định dạng video/)
  assert.equal(probed, false)
})

const invalidSrtCases = [
  ['missing cue number', ['2', '00:00:01,000 --> 00:00:02,000', '你好', ''].join('\n')],
  ['duplicate cue number', [
    '1', '00:00:01,000 --> 00:00:02,000', '你好', '',
    '1', '00:00:03,000 --> 00:00:04,000', '再见', ''
  ].join('\n')],
  ['malformed timestamp', ['1', '00:00:01.000 --> 00:00:02,000', '你好', ''].join('\n')],
  ['start after end', ['1', '00:00:03,000 --> 00:00:02,000', '你好', ''].join('\n')],
  ['empty cue text', ['1', '00:00:01,000 --> 00:00:02,000', '', ''].join('\n')]
] as const

for (const [name, sourceText] of invalidSrtCases) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(() => loadSrtSource('clip.srt', {
      readText: async () => sourceText,
      statFile: async () => ({ size: sourceText.length, modifiedMs: 123 })
    }), /SRT không hợp lệ/)
  })
}

test('fingerprint rejects size or modified-time changes', async () => {
  const expected = { path: 'clip.srt', size: 99, modifiedMs: 123 }
  for (const current of [
    { size: 100, modifiedMs: 123 },
    { size: 99, modifiedMs: 124 }
  ]) {
    await assert.rejects(
      () => assertSourceFingerprint(expected, async () => current),
      /File nguồn đã thay đổi/
    )
  }
})

test('probeVideoDuration uses the sibling ffprobe command and exact args', async () => {
  let seen: { command: string; args: readonly string[]; timeoutMs: number } | undefined
  const duration = await probeVideoDuration('clip.mp4', {
    resolveFfmpeg: async () => 'C:\\tools\\ffmpeg.exe',
    spawnProbe: async (command, args, options) => {
      seen = { command, args, timeoutMs: options.timeoutMs }
      return { code: 0, stdout: '12.5\n' }
    }
  })
  assert.equal(duration, 12.5)
  assert.equal(seen?.command, 'C:\\tools\\ffprobe.exe')
  assert.deepEqual(seen?.args, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', 'clip.mp4'
  ])
  assert.equal(seen?.timeoutMs, 60_000)
})

test('spawnProbeProcess returns stdout only and supports abort', async () => {
  const result = await spawnProbeProcess(process.execPath, [
    '-e', 'process.stderr.write("secret"); process.stdout.write("7")'
  ], { timeoutMs: 2_000, windowsHide: true })
  assert.equal(result.code, 0)
  assert.equal(result.stdout, '7')

  const controller = new AbortController()
  const pending = spawnProbeProcess(process.execPath, [
    '-e', 'setTimeout(() => {}, 10_000)'
  ], { signal: controller.signal, timeoutMs: 10_000, windowsHide: true })
  controller.abort()
  await assert.rejects(pending, /hủy kiểm tra video/)
})
