import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteCli = resolve(root, 'node_modules/electron-vite/bin/electron-vite.js')
const builderCli = resolve(root, 'node_modules/electron-builder/cli.js')

function run(label, script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })

  if (result.error) {
    console.error(`${label} failed: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '') + `-${process.pid}`
const outputDir = process.env.TBLAO_PORTABLE_OUTPUT ?? `dist-local/releases/${stamp}`

// Build into the normal app output, but always give electron-builder a fresh
// artifact directory. A previously launched portable app can keep app.asar
// open, so reusing dist-local would make the next package operation fail.
run('electron-vite build', viteCli, ['build'])
run('electron-builder', builderCli, [
  '--config',
  'electron-builder.local.yml',
  '--config.directories.output=' + outputDir,
  '--win',
  'portable',
  '--publish',
  'never'
])

console.log(`Portable build written to ${resolve(root, outputDir)}`)
