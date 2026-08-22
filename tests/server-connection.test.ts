import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createServerConnectionService,
  type ServerEndpointStore
} from '../src/main/services/serverConnection.ts'

const validHandshake = {
  ok: true,
  product: 'tediapros-server',
  apiVersion: 'v1',
  serverVersion: '0.1.0',
  capabilities: ['session']
}

function memoryStore(initial: string | null = null): ServerEndpointStore & { writes: string[] } {
  let endpoint = initial
  const writes: string[] = []
  return {
    writes,
    read: async () => endpoint,
    write: async (value) => {
      writes.push(value)
      endpoint = value
    }
  }
}

test('handshake thành công mới lưu endpoint và gửi đúng contract Windows', async () => {
  const store = memoryStore()
  let requestUrl = ''
  let requestInit: RequestInit | undefined
  const service = createServerConnectionService({
    store,
    clientVersion: '0.1.27',
    platform: 'win32',
    architecture: 'x64',
    fetcher: async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return Response.json(validHandshake)
    }
  })

  const status = await service.connect('http://192.168.1.20:48191/')

  assert.equal(requestUrl, 'http://192.168.1.20:48191/api/v1/session/handshake')
  assert.equal(requestInit?.method, 'POST')
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    product: 'tediapros',
    apiVersion: 'v1',
    clientVersion: '0.1.27',
    platform: 'win32',
    architecture: 'x64'
  })
  assert.deepEqual(store.writes, ['http://192.168.1.20:48191'])
  assert.deepEqual(status, {
    state: 'connected',
    endpoint: 'http://192.168.1.20:48191',
    serverVersion: '0.1.0',
    capabilities: ['session'],
    managed: false
  })
})

test('không lưu endpoint khi server không truy cập được hoặc handshake không tương thích', async () => {
  const store = memoryStore()
  const unreachable = createServerConnectionService({
    store,
    clientVersion: '0.1.27',
    platform: 'win32',
    architecture: 'x64',
    fetcher: async () => {
      throw new Error('ECONNREFUSED')
    }
  })

  assert.deepEqual(await unreachable.connect('http://192.168.1.20:48191'), {
    state: 'unavailable',
    endpoint: 'http://192.168.1.20:48191',
    capabilities: [],
    errorCode: 'unreachable',
    managed: false
  })

  const incompatible = createServerConnectionService({
    store,
    clientVersion: '0.1.27',
    platform: 'win32',
    architecture: 'x64',
    fetcher: async () => Response.json({ ...validHandshake, apiVersion: 'v2' })
  })
  assert.equal(
    (await incompatible.connect('http://192.168.1.20:48191')).state,
    'unavailable'
  )
  assert.deepEqual(store.writes, [])
})

test('status ưu tiên endpoint environment và đánh dấu cấu hình được quản lý', async () => {
  const store = memoryStore('http://192.168.1.30:48191')
  let requestUrl = ''
  const service = createServerConnectionService({
    store,
    environmentEndpoint: 'http://10.0.0.20:48191',
    clientVersion: '0.1.27',
    platform: 'win32',
    architecture: 'x64',
    fetcher: async (input) => {
      requestUrl = String(input)
      return Response.json(validHandshake)
    }
  })

  const status = await service.status()

  assert.equal(requestUrl, 'http://10.0.0.20:48191/api/v1/session/handshake')
  assert.equal(status.endpoint, 'http://10.0.0.20:48191')
  assert.equal(status.managed, true)
  assert.deepEqual(store.writes, [])
})

test('environment endpoint không thể bị thay thế từ renderer', async () => {
  const store = memoryStore()
  const service = createServerConnectionService({
    store,
    environmentEndpoint: 'http://10.0.0.20:48191',
    clientVersion: '0.1.27',
    platform: 'win32',
    architecture: 'x64',
    fetcher: async (input) => {
      assert.equal(String(input), 'http://10.0.0.20:48191/api/v1/session/handshake')
      return Response.json(validHandshake)
    }
  })

  const status = await service.connect('http://192.168.1.99:48191')

  assert.equal(status.endpoint, 'http://10.0.0.20:48191')
  assert.equal(status.managed, true)
  assert.deepEqual(store.writes, [])
})
