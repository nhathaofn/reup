import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { materializeSrtBatchOutput } from '../src/main/services/srt-batch-output.ts'

async function withTempDir<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(os.tmpdir(), 'tblao-srt-batch-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('materializes the SRT sidecar and Batch files like the PowerShell converter', async () => {
  await withTempDir(async (directory) => {
    const srtPath = join(directory, 'batch_trung.srt')
    const splitDir = join(directory, 'Batchbatch_trung')
    await writeFile(srtPath, [
      '\uFEFF1',
      '00:00:00,000 --> 00:00:01,000 X1:42',
      'Câu đầu tiên',
      '',
      '2',
      '00:00:01,000 --> 00:00:02,000',
      'Câu thứ hai',
      '',
      '2025',
      'Dòng này không phải số cue',
      ''
    ].join('\r\n'), 'utf8')
    await mkdir(splitDir)
    await writeFile(join(splitDir, '1.txt'), 'stale')
    await writeFile(join(splitDir, '99.txt'), 'stale')
    await writeFile(join(splitDir, 'keep.md'), 'keep')

    const result = await materializeSrtBatchOutput(srtPath)

    assert.equal(await readFile(join(directory, 'batch_trung.txt'), 'utf8'), 'Câu đầu tiên\nCâu thứ hai\n2025\nDòng này không phải số cue\n')
    assert.equal(result.splitDir, splitDir)
    assert.deepEqual(await readdir(splitDir), ['1.txt', '2.txt', '3.txt', '4.txt', 'keep.md'])
    assert.equal(await readFile(join(splitDir, '1.txt'), 'utf8'), 'Câu đầu tiên')
    assert.equal(await readFile(join(splitDir, '2.txt'), 'utf8'), 'Câu thứ hai')
    assert.equal(await readFile(join(splitDir, '3.txt'), 'utf8'), '2025')
    assert.equal(await readFile(join(splitDir, '4.txt'), 'utf8'), 'Dòng này không phải số cue')
  })
})

test('keeps a numeric subtitle line when it is not followed by a timestamp', async () => {
  await withTempDir(async (directory) => {
    const srtPath = join(directory, 'batch_viet.srt')
    await writeFile(srtPath, '1\n00:00:00,000 --> 00:00:01,000\nMục 123\n42\nKhông phải timestamp\n', 'utf8')

    const result = await materializeSrtBatchOutput(srtPath)

    assert.equal(await readFile(result.textPath, 'utf8'), 'Mục 123\n42\nKhông phải timestamp\n')
    assert.equal(await readFile(join(result.splitDir, '2.txt'), 'utf8'), '42')
  })
})

test('rejects a Batch output path that is already a file', async () => {
  await withTempDir(async (directory) => {
    const srtPath = join(directory, 'batch_ja.srt')
    await writeFile(srtPath, '1\n00:00:00,000 --> 00:00:01,000\n字幕\n', 'utf8')
    await writeFile(join(directory, 'Batchbatch_ja'), 'not a directory', 'utf8')

    await assert.rejects(
      () => materializeSrtBatchOutput(srtPath),
      /Đường dẫn thư mục Batch đã tồn tại nhưng không phải thư mục/u
    )
  })
})
