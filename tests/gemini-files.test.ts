import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGeminiFilesTransport,
  type GeminiFilesDeps,
  type GeminiRemoteFile
} from '../src/main/services/gemini-files.ts'
import { LOCKED_GEMINI_MODEL } from '../src/main/gemini-model.ts'

function transportFromResponses(
  responses: readonly Response[],
  overrides: Omit<Partial<GeminiFilesDeps>, 'apiKey'> = {}
) {
  const queue = [...responses]
  return createGeminiFilesTransport({
    apiKey: 'secret-key',
    models: ['gemini-test'],
    fetchImpl: async () => queue.shift() ?? new Response('', { status: 500 }),
    openUploadBody: async () => ({ body: '', size: 0 }),
    sleep: async () => {},
    now: () => 0,
    random: () => 0,
    ...overrides
  })
}

const processingFile: GeminiRemoteFile = {
  name: 'files/abc', uri: 'https://secret/file/abc', mimeType: 'video/mp4', state: 'PROCESSING'
}

test('uploads once, polls ACTIVE, generates with same URI and deletes by name', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const responses = [
    new Response('', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.test/session' } }),
    new Response(JSON.stringify({ file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'video/mp4', state: 'PROCESSING' } }), { status: 200 }),
    new Response(JSON.stringify({ name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'video/mp4', state: 'ACTIVE' }), { status: 200 }),
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 }),
    new Response('', { status: 200 })
  ]
  const transport = createGeminiFilesTransport({
    apiKey: 'secret-key', models: ['gemini-test'],
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return responses.shift() as Response },
    openUploadBody: async () => ({ body: 'video-bytes', size: 11 }),
    sleep: async () => {}, now: () => 0, random: () => 0
  })
  const uploaded = await transport.uploadVideo({ path: 'clip.mp4', mimeType: 'video/mp4', displayName: 'clip.mp4' })
  const active = await transport.waitUntilActive(uploaded)
  const result = await transport.generateJson({ systemInstruction: 'system', userText: 'user', file: active, responseSchema: { type: 'OBJECT' } })
  await transport.deleteFile(active.name)
  assert.deepEqual(result, { ok: true })
  assert.equal(calls.filter((call) => call.url === 'https://upload.test/session').length, 1)
  assert.equal(calls[2]?.url, 'https://generativelanguage.googleapis.com/v1beta/files/abc?key=secret-key')
  assert.match(JSON.stringify(calls[3]?.init?.body), /https:\/\/generativelanguage/)
  assert.equal(calls.at(-1)?.url, 'https://generativelanguage.googleapis.com/v1beta/files/abc?key=secret-key')
  assert.equal(calls.at(-1)?.init?.method, 'DELETE')
})

test('429 retries at most three calls and honors injected sleeps', async () => {
  let calls = 0
  const waits: number[] = []
  const transport = createGeminiFilesTransport({
    apiKey: 'secret-key', models: ['gemini-test'],
    fetchImpl: async () => {
      calls += 1
      if (calls < 3) return new Response('', { status: 429 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 })
    },
    openUploadBody: async () => ({ body: '', size: 0 }),
    sleep: async (ms) => waits.push(ms), now: () => 0, random: () => 0
  })
  assert.deepEqual(await transport.generateJson({ systemInstruction: '', userText: 'x', responseSchema: { type: 'OBJECT' } }), { ok: true })
  assert.equal(calls, 3)
  assert.deepEqual(waits, [1000, 2000])
})

test('production transport uses the locked model without model discovery', async () => {
  const urls: string[] = []
  const transport = createGeminiFilesTransport({
    apiKey: 'secret-key',
    fetchImpl: async (url) => {
      urls.push(String(url))
      if (String(url).endsWith('/models?key=secret-key')) {
        return new Response(JSON.stringify({ models: [
          { name: 'models/gemini-2.5-flash-preview', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-tts', supportedGenerationMethods: ['generateContent'] }
        ] }), { status: 200 })
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 })
    },
    openUploadBody: async () => ({ body: '', size: 0 }), sleep: async () => {}, now: () => 0, random: () => 0
  })
  await transport.generateJson({ systemInstruction: '', userText: 'x', responseSchema: {} })
  assert.equal(urls.some((url) => url.endsWith('/models?key=secret-key')), false)
  assert.equal(urls[0]?.includes(`/models/${LOCKED_GEMINI_MODEL}:generateContent`), true)
})

test('abort during retry stops before another request', async () => {
  const controller = new AbortController()
  let requests = 0
  const transport = transportFromResponses([], {
    fetchImpl: async () => { requests += 1; return new Response('', { status: 429 }) },
    sleep: async () => { controller.abort(new DOMException('cancelled', 'AbortError')); throw controller.signal.reason }
  })
  await assert.rejects(() => transport.generateJson({ systemInstruction: '', userText: 'x', responseSchema: {}, signal: controller.signal }), { name: 'AbortError' })
  assert.equal(requests, 1)
})

test('generate timeout remains a timeout instead of becoming cancellation', async () => {
  const transport = createGeminiFilesTransport({
    apiKey: 'secret-key', models: ['gemini-test'], generateTimeoutMs: 1,
    fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) {
        reject(new Error('missing abort signal'))
        return
      }
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
    openUploadBody: async () => ({ body: '', size: 0 }), sleep: async () => {}, now: () => 0, random: () => 0
  })
  await assert.rejects(
    () => transport.generateJson({ systemInstruction: '', userText: 'x', responseSchema: {} }),
    { name: 'TimeoutError' }
  )
})

test('upload start requires x-goog-upload-url', async () => {
  const transport = transportFromResponses([new Response('', { status: 200 })])
  await assert.rejects(() => transport.uploadVideo({ path: 'clip.mp4', mimeType: 'video/mp4', displayName: 'clip.mp4' }), /Không thể bắt đầu tải video/)
})

test('FAILED remote state is terminal and polling has a deadline', async () => {
  const failed = transportFromResponses([new Response(JSON.stringify({ ...processingFile, state: 'FAILED' }), { status: 200 })])
  await assert.rejects(() => failed.waitUntilActive(processingFile), /xử lý video thất bại/)

  let now = 0
  const timedOut = transportFromResponses([], {
    fetchImpl: async () => new Response(JSON.stringify(processingFile), { status: 200 }),
    sleep: async () => { now = 20 * 60 * 1000 + 1 },
    now: () => now
  })
  await assert.rejects(() => timedOut.waitUntilActive(processingFile), /quá thời gian/)
})

test('invalid structured JSON is cleaned and delete retries twice with 404 success', async () => {
  const invalid = transportFromResponses([new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'RAW_SECRET_NOT_JSON' }] } }] }), { status: 200 })])
  const reason = await invalid.generateJson({ systemInstruction: '', userText: 'x', responseSchema: {} }).catch((error: unknown) => error)
  assert.equal(String(reason).includes('RAW_SECRET_NOT_JSON'), false)

  let requests = 0
  const deleteTransport = transportFromResponses([], {
    fetchImpl: async () => { requests += 1; return new Response('RAW_DELETE_BODY', { status: 503 }) },
    sleep: async () => {}
  })
  await assert.rejects(() => deleteTransport.deleteFile('files/abc'))
  assert.equal(requests, 2)
  const missing = transportFromResponses([new Response('', { status: 404 })])
  await assert.doesNotReject(() => missing.deleteFile('files/already-gone'))
})

test('public errors never expose key, URI or response body', async () => {
  const transport = transportFromResponses([new Response('RAW_RESPONSE_SECRET', { status: 400 })])
  const reason = await transport.generateJson({ systemInstruction: '', userText: 'x', responseSchema: {}, file: processingFile }).catch((error: unknown) => error)
  const publicText = String(reason)
  for (const secret of ['secret-key', processingFile.uri, 'RAW_RESPONSE_SECRET']) {
    assert.equal(publicText.includes(secret), false)
  }
})

test('Retry-After is capped at thirty seconds', async () => {
  const waits: number[] = []
  let requests = 0
  const transport = transportFromResponses([], {
    fetchImpl: async () => {
      requests += 1
      if (requests === 1) return new Response('', { status: 429, headers: { 'Retry-After': '120' } })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 })
    },
    sleep: async (ms) => waits.push(ms)
  })
  await transport.generateJson({ systemInstruction: '', userText: 'x', responseSchema: {} })
  assert.deepEqual(waits, [30_000])
})
