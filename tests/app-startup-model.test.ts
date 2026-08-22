import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INITIAL_STARTUP_STAGE,
  transitionStartup
} from '../src/renderer/src/startup.ts'

test('không cho kết quả dependency mở ứng dụng trước handshake server', () => {
  assert.equal(INITIAL_STARTUP_STAGE, 'server-checking')
  assert.equal(transitionStartup('server-checking', { type: 'dependencies-ready' }), 'server-checking')
  assert.equal(transitionStartup('server-required', { type: 'dependencies-ready' }), 'server-required')
  assert.equal(transitionStartup('server-required', { type: 'dependencies-missing' }), 'server-required')
})

test('handshake hợp lệ mới chuyển sang kiểm tra dependency rồi mở ứng dụng', () => {
  const dependencyStage = transitionStartup('server-checking', { type: 'server-connected' })
  assert.equal(dependencyStage, 'dependency-checking')
  assert.equal(transitionStartup(dependencyStage, { type: 'dependencies-ready' }), 'ready')
  assert.equal(transitionStartup(dependencyStage, { type: 'dependencies-missing' }), 'setup')
})

test('mất heartbeat server khóa lại ứng dụng từ mọi trạng thái sử dụng được', () => {
  assert.equal(transitionStartup('ready', { type: 'server-unavailable' }), 'server-required')
  assert.equal(transitionStartup('setup', { type: 'server-unavailable' }), 'server-required')
  assert.equal(
    transitionStartup('dependency-checking', { type: 'server-unavailable' }),
    'server-required'
  )
})

test('heartbeat thành công không khởi động lại dependency check khi app đang sẵn sàng', () => {
  assert.equal(transitionStartup('ready', { type: 'server-connected' }), 'ready')
})
