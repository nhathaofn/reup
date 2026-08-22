import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  canonicalJson,
  fingerprintSourceManifest,
  readSourceBlockManifest,
  validateSourceBlockManifest,
  writeArtifactAtomic
} from '../src/main/services/contentBlockManifest.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

test('canonical JSON sorts nested keys and yields stable manifest fingerprint', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}')
  const left = sourceManifestFixture()
  const right = { ...left, source: { ...left.source } }
  assert.equal(fingerprintSourceManifest(left), fingerprintSourceManifest(right))
  right.revision = 2
  assert.notEqual(fingerprintSourceManifest(left), fingerprintSourceManifest(right))
})

test('validator rejects duplicate IDs, non-integer time and discontinuous ranges', () => {
  const duplicate = sourceManifestFixture()
  duplicate.blocks[1].id = duplicate.blocks[0].id
  assert.throws(() => validateSourceBlockManifest(duplicate), /block ID.*trùng/u)

  const fractional = sourceManifestFixture()
  fractional.blocks[0].sourceRange.endUs = 4_000_000.5
  assert.throws(() => validateSourceBlockManifest(fractional), /microseconds.*integer/u)

  const gap = sourceManifestFixture()
  gap.blocks[1].sourceRange.startUs = 4_100_000
  assert.throws(() => validateSourceBlockManifest(gap), /liên tục/u)
})

test('atomic writer round-trips a validated source manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tediapros-content-block-manifest-'))
  try {
    const path = join(root, 'source-blocks.json')
    await writeArtifactAtomic(path, sourceManifestFixture(), validateSourceBlockManifest)
    const loaded = await readSourceBlockManifest(path)
    assert.deepEqual(loaded, sourceManifestFixture())
    assert.doesNotMatch(await readFile(path, 'utf8'), /generatedAt/u)
    await writeFile(path, '{broken', 'utf8')
    await assert.rejects(() => readSourceBlockManifest(path), /JSON/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
