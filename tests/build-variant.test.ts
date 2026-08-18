import test from 'node:test'
import assert from 'node:assert/strict'
import { isLocalPortableBuild } from '../src/shared/build-variant.ts'

test('chỉ nhận local portable khi app đã packaged và có PORTABLE_EXECUTABLE_DIR', () => {
  assert.equal(isLocalPortableBuild({ PORTABLE_EXECUTABLE_DIR: 'F:\\Apps' }, true), true)
  assert.equal(isLocalPortableBuild({ PORTABLE_EXECUTABLE_DIR: 'F:\\Apps' }, false), false)
  assert.equal(isLocalPortableBuild({}, true), false)
  assert.equal(isLocalPortableBuild({ PORTABLE_EXECUTABLE_DIR: '   ' }, true), false)
})


