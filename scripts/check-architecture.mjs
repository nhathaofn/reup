import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

function toProjectPath(absolutePath) {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/')
}

function read(relativePath) {
  const absolutePath = join(projectRoot, relativePath)
  if (!existsSync(absolutePath)) {
    errors.push(`Thiếu file bắt buộc: ${relativePath}`)
    return ''
  }
  return readFileSync(absolutePath, 'utf8')
}

function walk(relativeDirectory) {
  const absoluteDirectory = join(projectRoot, relativeDirectory)
  if (!existsSync(absoluteDirectory)) return []

  const files = []
  for (const name of readdirSync(absoluteDirectory)) {
    const absolutePath = join(absoluteDirectory, name)
    if (statSync(absolutePath).isDirectory()) files.push(...walk(toProjectPath(absolutePath)))
    else files.push(absolutePath)
  }
  return files
}

function collectLiteralChannels(files, expression) {
  const occurrences = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    expression.lastIndex = 0
    for (const match of source.matchAll(expression)) {
      occurrences.push({ channel: match[1], file: toProjectPath(file) })
    }
  }
  return occurrences
}

function uniqueChannels(occurrences) {
  return new Set(occurrences.map(({ channel }) => channel))
}

function findDuplicates(occurrences, label) {
  const locations = new Map()
  for (const occurrence of occurrences) {
    const files = locations.get(occurrence.channel) ?? []
    files.push(occurrence.file)
    locations.set(occurrence.channel, files)
  }
  for (const [channel, files] of locations) {
    if (files.length > 1) errors.push(`${label} bị đăng ký lặp "${channel}": ${files.join(', ')}`)
  }
}

function compareChannelSets(left, right, leftLabel, rightLabel) {
  for (const channel of left) {
    if (!right.has(channel)) errors.push(`${leftLabel} "${channel}" không có ${rightLabel} tương ứng.`)
  }
}

function count(text, snippet) {
  return text.split(snippet).length - 1
}

function requireOnce(relativePath, snippet, purpose) {
  const source = read(relativePath)
  const occurrences = count(source, snippet)
  if (occurrences !== 1) {
    errors.push(`${relativePath}: cần đúng 1 ${purpose}, hiện có ${occurrences}.`)
  }
}

function importedFeatures(relativePath) {
  const source = read(relativePath)
  const features = new Set()
  for (const match of source.matchAll(
    /import\s+\{\s*([A-Za-z_$][\w$]*)\s*\}\s+from\s+['"]\.\/([^'"]+)['"]/g
  )) {
    const [, symbol, id] = match
    if (id === 'contracts') continue
    if (features.has(id)) errors.push(relativePath + ': import feature bị lặp: ' + id + '.')
    features.add(id)
    const symbolCount = [...source.matchAll(new RegExp('\\b' + symbol + '\\b', 'g'))].length
    if (symbolCount !== 2) {
      errors.push(relativePath + ': ' + symbol + ' phải xuất hiện ở import và module registry.')
    }
  }
  return features
}

function compareFeatureSets(expected, actual, expectedLabel, actualLabel) {
  for (const id of expected) {
    if (!actual.has(id)) errors.push(`Feature "${id}" có ở ${expectedLabel} nhưng thiếu ở ${actualLabel}.`)
  }
}

function featureFiles(relativeDirectory) {
  const absoluteDirectory = join(projectRoot, relativeDirectory)
  if (!existsSync(absoluteDirectory)) return new Set()
  return new Set(
    readdirSync(absoluteDirectory)
      .filter((name) => !['contracts.ts', 'registry.ts'].includes(name))
      .map((name) => name.replace(/\.(?:ts|tsx)$/, ''))
  )
}

function objectPropertyNames(relativePath, variableName) {
  const source = read(relativePath)
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  let objectLiteral = null
  function visit(node) {
    if (
      !objectLiteral &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      objectLiteral = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!objectLiteral) {
    errors.push(relativePath + ': không tìm thấy object ' + variableName + '.')
    return []
  }

  const names = []
  for (const property of objectLiteral.properties) {
    const name = property.name
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) {
      names.push(name.text)
    } else {
      errors.push(relativePath + ': preload API không được dùng computed property.')
    }
  }
  return names
}

const sourceFiles = walk('src').filter((file) => /\.(?:ts|tsx)$/.test(file))
const handlers = collectLiteralChannels(sourceFiles, /\bipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g)
const invocations = collectLiteralChannels(sourceFiles, /\bipcRenderer\.invoke\(\s*['"`]([^'"`]+)['"`]/g)
const eventSenders = collectLiteralChannels(
  sourceFiles,
  /\b(?:ipcRenderer|webContents|sender)\.send\(\s*['"`]([^'"`]+)['"`]/g
)
const eventListeners = collectLiteralChannels(
  sourceFiles,
  /\bipcRenderer\.(?:on|once)\(\s*['"`]([^'"`]+)['"`]/g
)

findDuplicates(handlers, 'IPC handler')
compareChannelSets(uniqueChannels(invocations), uniqueChannels(handlers), 'IPC invoke', 'handler')
compareChannelSets(uniqueChannels(handlers), uniqueChannels(invocations), 'IPC handler', 'invoke')
compareChannelSets(uniqueChannels(eventListeners), uniqueChannels(eventSenders), 'IPC listener', 'sender')
compareChannelSets(uniqueChannels(eventSenders), uniqueChannels(eventListeners), 'IPC sender', 'listener')

requireOnce('src/preload/index.ts', "contextBridge.exposeInMainWorld('api', api)", 'contextBridge public API')
requireOnce(
  'src/preload/index.ts',
  'assertNoPreloadApiCollisions(coreApi, featureApi)',
  'kiểm tra xung đột preload API'
)
requireOnce('src/main/index.ts', 'registerMainFeatures(() => mainWindow)', 'điểm đăng ký Main feature')
requireOnce('src/renderer/src/App.tsx', 'rendererFeatures.map(renderFeaturePane)', 'điểm gắn Renderer feature')

const registryPaths = [
  'src/main/features/registry.ts',
  'src/preload/features/registry.ts',
  'src/renderer/src/features/registry.ts'
]
for (const registryPath of registryPaths) {
  requireOnce(registryPath, '// feature-scaffold:imports', 'marker imports')
  requireOnce(registryPath, '// feature-scaffold:modules', 'marker modules')
}

const mainFeatures = importedFeatures(registryPaths[0])
const preloadFeatures = importedFeatures(registryPaths[1])
const rendererFeatures = importedFeatures(registryPaths[2])
for (const [left, right, leftLabel, rightLabel] of [
  [mainFeatures, preloadFeatures, 'Main registry', 'Preload registry'],
  [mainFeatures, rendererFeatures, 'Main registry', 'Renderer registry'],
  [preloadFeatures, mainFeatures, 'Preload registry', 'Main registry'],
  [rendererFeatures, mainFeatures, 'Renderer registry', 'Main registry']
]) {
  compareFeatureSets(left, right, leftLabel, rightLabel)
}

const physicalFeatureSets = [
  ['src/main/features', featureFiles('src/main/features')],
  ['src/preload/features', featureFiles('src/preload/features')],
  ['src/shared/features', featureFiles('src/shared/features')],
  ['src/renderer/src/features', featureFiles('src/renderer/src/features')]
]
for (const [location, physicalFeatures] of physicalFeatureSets) {
  compareFeatureSets(mainFeatures, physicalFeatures, 'feature registry', location)
  compareFeatureSets(physicalFeatures, mainFeatures, location, 'feature registry')
}

const apiOwners = new Map()
for (const name of objectPropertyNames('src/preload/index.ts', 'coreApi')) apiOwners.set(name, 'coreApi')
for (const id of mainFeatures) {
  const relativePath = 'src/preload/features/' + id + '.ts'
  const names = objectPropertyNames(relativePath, 'api')
  if (!names.length) errors.push(relativePath + ': feature phải expose ít nhất một API method.')
  for (const name of names) {
    const owner = apiOwners.get(name)
    if (owner) errors.push('Preload API "' + name + '" bị trùng giữa ' + owner + ' và ' + id + '.')
    else apiOwners.set(name, id)
  }
}

const sharedContracts = read('src/shared/features/contracts.ts')
const reservedBlock = sharedContracts.match(/RESERVED_FEATURE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/)
if (!reservedBlock) errors.push('Không đọc được RESERVED_FEATURE_IDS từ shared feature contracts.')
const reservedIds = new Set(
  [...(reservedBlock?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
)
const reservedEntries = [...(reservedBlock?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map(
  (match) => match[1]
)
if (reservedEntries.length !== reservedIds.size) {
  errors.push('RESERVED_FEATURE_IDS chứa ID bị lặp.')
}

for (const namespace of new Set(handlers.map(({ channel }) => channel.split(':')[0]))) {
  if (!reservedIds.has(namespace)) {
    errors.push('Namespace IPC core "' + namespace + '" chưa có trong RESERVED_FEATURE_IDS.')
  }
}

const appSource = read('src/renderer/src/App.tsx')
const coreTabBlock = appSource.match(/type CoreTabKey\s*=\s*([\s\S]*?)\n\s*type TabKey/)
if (!coreTabBlock) {
  errors.push('Không đọc được CoreTabKey từ App.tsx.')
} else {
  for (const match of coreTabBlock[1].matchAll(/'([^']+)'/g)) {
    if (!reservedIds.has(match[1])) {
      errors.push('Core tab "' + match[1] + '" chưa có trong RESERVED_FEATURE_IDS.')
    }
  }
}

for (const id of mainFeatures) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
    errors.push(`Feature ID không hợp lệ: "${id}".`)
  }
  if (reservedIds.has(id)) errors.push(`Feature ID "${id}" trùng namespace của core.`)

  const sharedFeature = read(`src/shared/features/${id}.ts`)
  if (!sharedFeature.includes(`FEATURE_ID = '${id}'`)) {
    errors.push(`src/shared/features/${id}.ts: FEATURE_ID phải là "${id}".`)
  }

  const layers = [
    ['src/main/features/' + id + '.ts', "from '../../shared/features/" + id + "'", 'id: FEATURE_ID'],
    ['src/preload/features/' + id + '.ts', "from '../../shared/features/" + id + "'", 'id: FEATURE_ID'],
    [
      'src/renderer/src/features/' + id + '/index.tsx',
      "from '../../../../shared/features/" + id + "'",
      '...FEATURE_META'
    ]
  ]
  for (const [relativePath, contractImport, moduleId] of layers) {
    const source = read(relativePath)
    if (!source.includes(contractImport)) {
      errors.push(relativePath + ': phải import đúng shared contract của feature.')
    }
    if (!source.includes(moduleId)) {
      errors.push(relativePath + ': module ID/metadata phải lấy từ shared contract.')
    }
  }
}

if (errors.length) {
  console.error(`Architecture check thất bại (${errors.length} lỗi):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(
  `Architecture OK: ${uniqueChannels(handlers).size} request channels, ` +
    `${uniqueChannels(eventSenders).size} event channels, ${mainFeatures.size} extension features.`
)
