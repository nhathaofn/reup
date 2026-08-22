import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
  parseServerHandshake
} from '../src/shared/server-contract.ts'

test('chuẩn hóa endpoint local và loại bỏ dấu gạch chéo cuối', () => {
  assert.equal(DEFAULT_SERVER_URL, 'http://127.0.0.1:48191')
  assert.equal(normalizeServerUrl(' http://127.0.0.1:48191/ '), DEFAULT_SERVER_URL)
  assert.equal(normalizeServerUrl('http://localhost:48191'), 'http://localhost:48191')
})

test('cho phép HTTP với địa chỉ loopback, private và link-local trong LAN', () => {
  const endpoints = [
    'http://127.0.0.1:48191',
    'http://10.20.30.40:48191',
    'http://172.16.0.1:48191',
    'http://172.31.255.254:48191',
    'http://192.168.1.20:48191',
    'http://169.254.20.1:48191',
    'http://[::1]:48191',
    'http://[fd12:3456::20]:48191',
    'http://[fe80::20]:48191'
  ]

  for (const endpoint of endpoints) {
    assert.equal(normalizeServerUrl(endpoint), endpoint)
  }
})

test('từ chối HTTP công khai và endpoint có thành phần không an toàn', () => {
  const invalidEndpoints = [
    'http://8.8.8.8:48191',
    'http://example.com:48191',
    'ftp://192.168.1.20:48191',
    'http://user:secret@192.168.1.20:48191',
    'http://192.168.1.20:48191/api',
    'http://192.168.1.20:48191/?token=x',
    'http://192.168.1.20:48191/#fragment'
  ]

  for (const endpoint of invalidEndpoints) {
    assert.throws(() => normalizeServerUrl(endpoint))
  }
})

test('cho phép hostname công khai khi dùng HTTPS', () => {
  assert.equal(normalizeServerUrl('https://server.tediapros.vn/'), 'https://server.tediapros.vn')
})

test('đọc handshake hợp lệ và yêu cầu capability session', () => {
  assert.deepEqual(
    parseServerHandshake({
      ok: true,
      product: 'tediapros-server',
      apiVersion: 'v1',
      serverVersion: '0.1.0',
      capabilities: ['session']
    }),
    {
      ok: true,
      product: 'tediapros-server',
      apiVersion: 'v1',
      serverVersion: '0.1.0',
      capabilities: ['session']
    }
  )

  assert.throws(() =>
    parseServerHandshake({
      ok: true,
      product: 'tediapros-server',
      apiVersion: 'v1',
      serverVersion: '0.1.0',
      capabilities: []
    })
  )
})

test('từ chối handshake sai product, API hoặc kiểu dữ liệu', () => {
  const invalidResponses = [
    null,
    {},
    {
      ok: true,
      product: 'other-server',
      apiVersion: 'v1',
      serverVersion: '0.1.0',
      capabilities: ['session']
    },
    {
      ok: true,
      product: 'tediapros-server',
      apiVersion: 'v2',
      serverVersion: '0.1.0',
      capabilities: ['session']
    },
    {
      ok: true,
      product: 'tediapros-server',
      apiVersion: 'v1',
      serverVersion: 1,
      capabilities: ['session']
    }
  ]

  for (const response of invalidResponses) {
    assert.throws(() => parseServerHandshake(response))
  }
})
