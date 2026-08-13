import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argumentsList = process.argv.slice(2)
const dryRun = argumentsList.includes('--dry-run')
const positional = argumentsList.filter((argument) => !argument.startsWith('--'))

function fail(message) {
  console.error(message)
  console.error('Dùng: npm run feature:create -- <feature-id> ["Tên hiển thị"] [--dry-run]')
  process.exit(1)
}

if (argumentsList.some((argument) => argument.startsWith('--') && argument !== '--dry-run')) {
  fail('Có tùy chọn không được hỗ trợ.')
}
if (positional.length < 1 || positional.length > 2) fail('Thiếu hoặc thừa tham số.')

const id = positional[0]
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
  fail('Feature ID phải là kebab-case, bắt đầu bằng chữ thường; ví dụ: media-inspector.')
}

const words = id.split('-')
const pascalName = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('')
const camelName = pascalName[0].toLowerCase() + pascalName.slice(1)
const label = (positional[1] ?? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')).trim()
if (!label || /[\r\n]/.test(label)) fail('Tên hiển thị không được rỗng hoặc chứa ký tự xuống dòng.')

const contractsPath = join(projectRoot, 'src/shared/features/contracts.ts')
const contractsSource = readFileSync(contractsPath, 'utf8')
const reservedBlock = contractsSource.match(/RESERVED_FEATURE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/)
if (!reservedBlock) fail('Không đọc được RESERVED_FEATURE_IDS từ shared feature contracts.')
const reservedIds = new Set(
  [...(reservedBlock?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
)
if (reservedIds.has(id)) fail(`Feature ID "${id}" đã được core sử dụng.`)

const paths = {
  shared: join(projectRoot, `src/shared/features/${id}.ts`),
  main: join(projectRoot, `src/main/features/${id}.ts`),
  preload: join(projectRoot, `src/preload/features/${id}.ts`),
  renderer: join(projectRoot, `src/renderer/src/features/${id}/index.tsx`)
}
for (const path of Object.values(paths)) {
  if (existsSync(path)) fail(`Không ghi đè file đã có: ${path}`)
}

const proposedApiMethods = ['run' + pascalName, 'on' + pascalName + 'Progress']
const preloadSources = [
  {
    owner: 'coreApi',
    source: readFileSync(join(projectRoot, 'src/preload/index.ts'), 'utf8')
  }
]
const preloadFeatureDirectory = join(projectRoot, 'src/preload/features')
for (const name of readdirSync(preloadFeatureDirectory)) {
  if (!name.endsWith('.ts') || ['contracts.ts', 'registry.ts'].includes(name)) continue
  preloadSources.push({
    owner: name,
    source: readFileSync(join(preloadFeatureDirectory, name), 'utf8')
  })
}
for (const method of proposedApiMethods) {
  const propertyPattern = new RegExp('\\b' + method + '\\s*:')
  const collision = preloadSources.find(({ source }) => propertyPattern.test(source))
  if (collision) fail('Preload API "' + method + '" đã được dùng trong ' + collision.owner + '.')
}

const registrySpecs = [
  {
    path: join(projectRoot, 'src/main/features/registry.ts'),
    importLine: `import { ${camelName}MainFeature } from './${id}'`,
    moduleLine: `${camelName}MainFeature,`
  },
  {
    path: join(projectRoot, 'src/preload/features/registry.ts'),
    importLine: `import { ${camelName}PreloadFeature } from './${id}'`,
    moduleLine: `${camelName}PreloadFeature,`
  },
  {
    path: join(projectRoot, 'src/renderer/src/features/registry.ts'),
    importLine: `import { ${camelName}RendererFeature } from './${id}'`,
    moduleLine: `${camelName}RendererFeature,`
  }
]

function insertAfterMarker(source, marker, insertedLine, indentation = '') {
  if (source.split(marker).length !== 2) fail(`Marker "${marker}" phải xuất hiện đúng một lần.`)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  return source.replace(marker, `${marker}${eol}${indentation}${insertedLine}`)
}

const registryChanges = registrySpecs.map((spec) => {
  const original = readFileSync(spec.path, 'utf8')
  if (original.includes(spec.importLine) || original.includes(spec.moduleLine)) {
    fail(`Registry đã chứa feature "${id}": ${spec.path}`)
  }
  let updated = insertAfterMarker(original, '// feature-scaffold:imports', spec.importLine)
  updated = insertAfterMarker(updated, '// feature-scaffold:modules', spec.moduleLine, '  ')
  return { ...spec, original, updated }
})

const labelLiteral = JSON.stringify(label)
const templates = {
  [paths.shared]: `import type { FeatureMetadata } from './contracts'

export const FEATURE_ID = '${id}' as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: ${labelLiteral},
  icon: '🧩',
  title: ${labelLiteral},
  subtitle: 'Feature được tạo từ cấu trúc mở rộng an toàn.',
  placement: 'main',
  keepAlive: false
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const FEATURE_CHANNELS = {
  run: \`\${FEATURE_ID}:run\`,
  progress: \`\${FEATURE_ID}:progress\`
} as const

export interface ${pascalName}Request {
  input: string
}

export interface ${pascalName}Result {
  output: string
  completedAt: string
}

export interface ${pascalName}Progress {
  percent: number
  message: string
}
`,
  [paths.main]: `import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type ${pascalName}Progress,
  type ${pascalName}Request,
  type ${pascalName}Result
} from '../../shared/features/${id}'
import type { MainFeatureModule } from './contracts'

export const ${camelName}MainFeature = {
  id: FEATURE_ID,
  register({ handle, emit }) {
    handle<[request: ${pascalName}Request], ${pascalName}Result>(
      FEATURE_CHANNELS.run,
      async (_event, request) => {
        const input = request?.input?.trim()
        if (!input) throw new Error('Vui lòng nhập dữ liệu trước khi chạy.')

        emit<${pascalName}Progress>(FEATURE_CHANNELS.progress, {
          percent: 10,
          message: 'Đã nhận yêu cầu.'
        })

        // TODO: Đặt nghiệp vụ của feature tại đây hoặc gọi sang service riêng.
        const result: ${pascalName}Result = {
          output: input,
          completedAt: new Date().toISOString()
        }

        emit<${pascalName}Progress>(FEATURE_CHANNELS.progress, {
          percent: 100,
          message: 'Hoàn tất.'
        })
        return result
      }
    )
  }
} satisfies MainFeatureModule
`,
  [paths.preload]: `import { ipcRenderer } from 'electron'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type ${pascalName}Progress,
  type ${pascalName}Request,
  type ${pascalName}Result
} from '../../shared/features/${id}'
import type { PreloadFeatureModule } from './contracts'

const api = {
  run${pascalName}: (request: ${pascalName}Request): Promise<${pascalName}Result> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.run, request),
  on${pascalName}Progress: (listener: (progress: ${pascalName}Progress) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: ${pascalName}Progress): void =>
      listener(progress)
    ipcRenderer.on(FEATURE_CHANNELS.progress, wrapped)
    return () => ipcRenderer.removeListener(FEATURE_CHANNELS.progress, wrapped)
  }
}

export const ${camelName}PreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
`,
  [paths.renderer]: `import { useEffect, useState, type FormEvent, type JSX } from 'react'
import {
  FEATURE_ID,
  FEATURE_META,
  type ${pascalName}Progress,
  type ${pascalName}Result
} from '../../../../shared/features/${id}'
import type { RendererFeature } from '../contracts'

function ${pascalName}Panel(): JSX.Element {
  const [input, setInput] = useState('')
  const [progress, setProgress] = useState<${pascalName}Progress | null>(null)
  const [result, setResult] = useState<${pascalName}Result | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => window.api.on${pascalName}Progress(setProgress), [])

  const run = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setRunning(true)
    setError('')
    setResult(null)
    try {
      setResult(await window.api.run${pascalName}({ input }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="panel">
      <form className="card" onSubmit={run}>
        <label className="field">
          <span>Dữ liệu đầu vào</span>
          <input value={input} onChange={(event) => setInput(event.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={running || !input.trim()}>
          {running ? 'Đang chạy…' : 'Chạy'}
        </button>
      </form>
      {progress && <p className="muted">{progress.percent}% — {progress.message}</p>}
      {result && <pre>{result.output}</pre>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export const ${camelName}RendererFeature = {
  ...FEATURE_META,
  component: ${pascalName}Panel
} as const satisfies RendererFeature<typeof FEATURE_ID>
`
}

if (dryRun) {
  console.log(`Feature hợp lệ: ${id} (${label})`)
  console.log('Sẽ tạo:')
  for (const path of Object.keys(templates)) console.log(`- ${path}`)
  console.log('Sẽ cập nhật 3 registry; chưa có file nào bị thay đổi.')
  process.exit(0)
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporaryPath, content, 'utf8')
  try {
    renameSync(temporaryPath, path)
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    throw error
  }
}

const createdPaths = []
try {
  for (const [path, content] of Object.entries(templates)) {
    writeAtomic(path, content)
    createdPaths.push(path)
  }
  for (const change of registryChanges) writeAtomic(change.path, change.updated)

  const typeScriptCli = join(projectRoot, 'node_modules/typescript/bin/tsc')
  for (const config of ['tsconfig.node.json', 'tsconfig.web.json']) {
    const typecheck = spawnSync(
      process.execPath,
      [typeScriptCli, '--noEmit', '-p', config, '--composite', 'false'],
      { cwd: projectRoot, encoding: 'utf8', stdio: 'inherit' }
    )
    if (typecheck.status !== 0) throw new Error(`TypeScript typecheck thất bại: ${config}.`)
  }

  const architecture = spawnSync(process.execPath, [join(projectRoot, 'scripts/check-architecture.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'inherit'
  })
  if (architecture.status !== 0) throw new Error('Architecture check thất bại.')

  console.log(`Đã tạo feature "${id}" và đăng ký đủ Main / Preload / Renderer.`)
} catch (error) {
  for (const change of registryChanges) writeAtomic(change.path, change.original)
  for (const path of createdPaths.reverse()) {
    if (existsSync(path)) unlinkSync(path)
  }
  const rendererDirectory = dirname(paths.renderer)
  if (existsSync(rendererDirectory) && readdirSyncSafe(rendererDirectory).length === 0) {
    rmdirSync(rendererDirectory)
  }
  console.error(`Đã hoàn tác feature "${id}": ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

function readdirSyncSafe(path) {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}
