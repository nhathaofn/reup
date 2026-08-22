import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const preload = readFileSync(fileURLToPath(new URL('../src/preload/features/srt-translator.ts', import.meta.url)), 'utf8')
const main = readFileSync(fileURLToPath(new URL('../src/main/features/srt-translator.ts', import.meta.url)), 'utf8')

test('preload exposes every localization job operation', () => {
  for (const method of ['loadSrtTranslator', 'analyzeSrtTranslator', 'resolveSrtTranslator', 'runSrtTranslator', 'cancelSrtTranslator', 'releaseSrtTranslator', 'onSrtTranslatorProgress']) assert.match(preload, new RegExp(`\\b${method}\\b`))
})

test('Main feature delegates business logic to the job controller', () => {
  assert.match(main, /createProductionSrtTranslatorJobController/)
  assert.doesNotMatch(main, /generateContent|open\.er-api|buildRestorationSystemPrompt/)
})
