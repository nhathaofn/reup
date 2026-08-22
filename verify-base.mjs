import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const requestedStage = process.argv[2] ?? 'all'
const supportedStages = new Set(['all', 'server', 'client'])

if (!supportedStages.has(requestedStage)) {
  console.error('Cách dùng: node verify-base.mjs [server|client]')
  process.exit(2)
}

const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm'
const npmArgs = (args) => process.platform === 'win32' ? [npmCli, ...args] : args
const steps = [
  {
    stage: 'server',
    label: 'Go server tests',
    command: 'go',
    args: ['test', './...'],
    cwd: join(root, 'server')
  },
  {
    stage: 'client',
    label: 'TypeScript typecheck',
    command: npmCommand,
    args: npmArgs(['run', 'typecheck']),
    cwd: root
  },
  {
    stage: 'client',
    label: 'Client unit tests',
    command: npmCommand,
    args: npmArgs(['run', 'test:unit']),
    cwd: root
  },
  {
    stage: 'client',
    label: 'Architecture check',
    command: npmCommand,
    args: npmArgs(['run', 'check:architecture']),
    cwd: root
  }
]

for (const step of steps) {
  if (requestedStage !== 'all' && requestedStage !== step.stage) continue

  console.log(`\n[verify-base] ${step.label}`)
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    env: process.env,
    stdio: 'inherit',
    shell: false
  })

  if (result.error) {
    console.error(`[verify-base] Không thể chạy ${step.label}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[verify-base] FAIL: ${step.label}`)
    process.exit(result.status ?? 1)
  }
}

console.log(`\n[verify-base] PASS: ${requestedStage === 'all' ? 'server + client' : requestedStage}`)
