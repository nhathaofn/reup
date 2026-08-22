import type {
  ContentBlockCapCutExportResult,
  ContentBlockEditOperation,
  ContentBlockProgress,
  LocaleAssetImportResult,
  LocaleAssetManifest,
  RenderTimeline,
  SourceBlockManifest,
  VariantConstraints,
  VariantPlan
} from '../../../../shared/features/content-blocks.ts'

export type ContentBlockUiStep = 'source' | 'review' | 'locale' | 'variant' | 'export'

export interface ImportedLocaleView {
  locale: string
  manifestPath: string
  manifest: LocaleAssetManifest | null
}

export interface ContentBlockViewState {
  projectDir: string
  videoPath: string
  srtPath: string
  sceneManifestPath: string
  sourceManifestPath: string
  sourceManifest: SourceBlockManifest | null
  importedLocales: ImportedLocaleView[]
  localeManifestPath: string
  localeManifest: LocaleAssetManifest | null
  variantPath: string
  variant: VariantPlan | null
  timelinePath: string
  subtitlePath: string
  timeline: RenderTimeline | null
  draftsDir: string
  templateDir: string
  projectName: string
  running: boolean
  progress: ContentBlockProgress | null
  error: string
  exportResult: ContentBlockCapCutExportResult | null
}

export function createInitialContentBlockState(): ContentBlockViewState {
  return {
    projectDir: '',
    videoPath: '',
    srtPath: '',
    sceneManifestPath: '',
    sourceManifestPath: '',
    sourceManifest: null,
    importedLocales: [],
    localeManifestPath: '',
    localeManifest: null,
    variantPath: '',
    variant: null,
    timelinePath: '',
    subtitlePath: '',
    timeline: null,
    draftsDir: '',
    templateDir: '',
    projectName: 'content-block-variant-001',
    running: false,
    progress: null,
    error: '',
    exportResult: null
  }
}

export function visibleContentBlockStep(state: ContentBlockViewState): ContentBlockUiStep {
  if (!state.sourceManifest) return 'source'
  if (!reviewIsComplete(state.sourceManifest)) return 'review'
  if (!state.localeManifest) return 'locale'
  if (!state.variant) return 'variant'
  return 'export'
}

export function upsertImportedLocale(items: readonly ImportedLocaleView[], next: ImportedLocaleView): ImportedLocaleView[] {
  const index = items.findIndex((item) => item.locale === next.locale)
  if (index < 0) return [...items, next]
  const result = [...items]
  result[index] = next
  return result
}

export function canAnalyzeContentBlocks(state: ContentBlockViewState): boolean {
  return Boolean(state.projectDir.trim() && state.videoPath.trim() && state.srtPath.trim() && state.sceneManifestPath.trim()) && !state.running
}

export function reviewIsComplete(manifest: SourceBlockManifest | null): boolean {
  if (!manifest) return false
  return manifest.blocks.every((block) =>
    block.boundary.reviewState !== 'needs-review' &&
    !block.issues.some((issue) => issue === 'odd-unpaired-cue' || issue === 'grouping-review' || issue === 'srt-fallback')
  )
}

export function canImportContentLocale(
  state: ContentBlockViewState,
  locale: string,
  localizedSrtPath: string,
  voiceDir: string
): boolean {
  return Boolean(state.sourceManifestPath && reviewIsComplete(state.sourceManifest) && locale.trim() && localizedSrtPath.trim() && voiceDir.trim()) && !state.running
}

export function defaultVariantConstraints(manifest: SourceBlockManifest): VariantConstraints {
  return {
    lockedStartBlockIds: manifest.blocks.filter((block) => block.semantic.role === 'intro').map((block) => block.id),
    lockedEndBlockIds: manifest.blocks.filter((block) => block.semantic.role === 'outro' || block.semantic.role === 'cta').map((block) => block.id),
    preserveDependencyChains: true
  }
}

export function canCreateContentVariant(state: ContentBlockViewState, variantId: string, seed: string): boolean {
  return Boolean(state.sourceManifestPath && reviewIsComplete(state.sourceManifest) && variantId.trim() && seed.trim()) && !state.running
}

export function canBuildContentTimeline(state: ContentBlockViewState): boolean {
  return Boolean(state.sourceManifestPath && state.localeManifestPath && state.variantPath) && !state.running
}

export function canExportContentBlockCapCut(state: ContentBlockViewState): boolean {
  return Boolean(
    state.sourceManifestPath && state.localeManifestPath && state.timelinePath &&
    state.draftsDir.trim() && state.templateDir.trim() && state.projectName.trim() &&
    state.timeline && state.timeline.reviewBlockIds.length === 0
  ) && !state.running
}

export function makeBoundaryEdit(blockId: string, seconds: number, locked: boolean): ContentBlockEditOperation {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Boundary không âm và phải là số hữu hạn.')
  const selectedUs = Math.round(seconds * 1_000_000)
  if (!Number.isSafeInteger(selectedUs)) throw new Error('Boundary vượt giới hạn microseconds an toàn.')
  return { kind: 'set-boundary', blockId, selectedUs, locked }
}

export function contentBlockImportResultMessage(result: LocaleAssetImportResult | null): string {
  if (!result) return ''
  if (result.ok) return 'Đã nhập locale.'
  const details = [
    result.missingCueIds.length ? `thiếu ${result.missingCueIds.join(', ')}` : '',
    result.invalidCueIds.length ? `lỗi ${result.invalidCueIds.join(', ')}` : '',
    result.extraFiles.length ? `dư ${result.extraFiles.join(', ')}` : ''
  ].filter(Boolean)
  return details.length ? details.join('; ') : result.error ?? 'Nhập locale thất bại.'
}
