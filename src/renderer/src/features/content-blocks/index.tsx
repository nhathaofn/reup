import { useEffect, useState, type JSX } from 'react'
import {
  FEATURE_ID,
  FEATURE_META,
  type ContentBlockEditOperation,
  type LocaleAssetImportResult
} from '../../../../shared/features/content-blocks'
import type { RendererFeature } from '../contracts'
import ExportStep from './components/ExportStep'
import LocaleStep from './components/LocaleStep'
import ReviewStep from './components/ReviewStep'
import SourceStep from './components/SourceStep'
import VariantStep from './components/VariantStep'
import {
  canAnalyzeContentBlocks,
  canBuildContentTimeline,
  canCreateContentVariant,
  canExportContentBlockCapCut,
  canImportContentLocale,
  createInitialContentBlockState,
  defaultVariantConstraints,
  upsertImportedLocale,
  visibleContentBlockStep
} from './model.ts'
import './styles.css'

const STEP_LABELS = {
  source: 'Source',
  review: 'Review block',
  locale: 'Locale voice',
  variant: 'Variant',
  export: 'Timeline / CapCut'
} as const

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function ContentBlocksProgress({
  progress,
  running,
  onCancel
}: {
  progress: ReturnType<typeof createInitialContentBlockState>['progress']
  running: boolean
  onCancel(): void
}): JSX.Element | null {
  if (!progress && !running) return null
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0))
  return (
    <section className="card content-blocks-progress-card">
      <div className="content-blocks-section-head">
        <div>
          <strong>{progress?.message ?? 'Đang xử lý…'}</strong>
          <span className="muted small">{progress?.phase ?? 'starting'}{progress?.currentId ? ` · ${progress.currentId}` : ''}</span>
        </div>
        {running && <button className="btn" type="button" onClick={onCancel}>Hủy</button>}
      </div>
      <div className="content-blocks-progress-bar"><span style={{ width: `${percent}%` }} /></div>
    </section>
  )
}

function ContentBlocksPanel(): JSX.Element {
  const [state, setState] = useState(createInitialContentBlockState)
  const [locale, setLocale] = useState('vi-VN')
  const [localizedSrtPath, setLocalizedSrtPath] = useState('')
  const [voiceDir, setVoiceDir] = useState('')
  const [voiceMapPath, setVoiceMapPath] = useState('')
  const [localeResult, setLocaleResult] = useState<LocaleAssetImportResult | null>(null)
  const [variantId, setVariantId] = useState('variant-001')
  const [seed, setSeed] = useState('392831')

  useEffect(() => window.api.onContentBlockProgress((event) => {
    setState((current) => ({ ...current, progress: event }))
  }), [])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setState((current) => ({ ...current, running: true, error: '' }))
    try {
      await operation()
    } catch (reason) {
      setState((current) => ({ ...current, error: errorMessage(reason) }))
    } finally {
      setState((current) => ({ ...current, running: false }))
    }
  }

  const changeSource = (field: 'projectDir' | 'videoPath' | 'srtPath' | 'sceneManifestPath', value: string): void => {
    setState((current) => ({
      ...current,
      [field]: value,
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
      exportResult: null,
      error: ''
    }))
    setLocaleResult(null)
  }

  const pickSource = async (field: 'projectDir' | 'videoPath' | 'srtPath' | 'sceneManifestPath'): Promise<void> => {
    const kind = field === 'projectDir' ? 'directory' : field === 'videoPath' ? 'video' : field === 'srtPath' ? 'srt' : 'json'
    try {
      const selected = await window.api.contentBlockPickPath(kind)
      if (selected) changeSource(field, selected)
    } catch (reason) {
      setState((current) => ({ ...current, error: errorMessage(reason) }))
    }
  }

  const analyze = async (): Promise<void> => {
    await run(async () => {
      const result = await window.api.analyzeContentBlocks({
        projectDir: state.projectDir,
        videoPath: state.videoPath,
        srtPath: state.srtPath,
        sceneManifestPath: state.sceneManifestPath,
        existingManifestPath: state.sourceManifestPath || null
      })
      if (!result.ok || !result.manifest || !result.manifestPath) throw new Error(result.error ?? 'Analyze thất bại.')
      setLocaleResult(null)
      setState((current) => ({
        ...current,
        sourceManifest: result.manifest!,
        sourceManifestPath: result.manifestPath!,
        importedLocales: [],
        localeManifest: null,
        localeManifestPath: '',
        variant: null,
        variantPath: '',
        timeline: null,
        timelinePath: '',
        subtitlePath: '',
        exportResult: null
      }))
    })
  }

  const editManifest = async (operation: ContentBlockEditOperation): Promise<void> => {
    if (!state.sourceManifestPath) return
    await run(async () => {
      const result = await window.api.editContentBlockManifest({ manifestPath: state.sourceManifestPath, operations: [operation] })
      if (!result.ok || !result.manifest || !result.manifestPath) throw new Error(result.error ?? 'Cập nhật manifest thất bại.')
      setLocaleResult(null)
      setState((current) => ({
        ...current,
        sourceManifest: result.manifest!,
        sourceManifestPath: result.manifestPath!,
        importedLocales: [],
        localeManifest: null,
        localeManifestPath: '',
        variant: null,
        variantPath: '',
        timeline: null,
        timelinePath: '',
        subtitlePath: '',
        exportResult: null
      }))
    })
  }

  const changeLocale = (field: 'locale' | 'localizedSrtPath' | 'voiceDir' | 'voiceMapPath', value: string): void => {
    if (field === 'locale') setLocale(value)
    if (field === 'localizedSrtPath') setLocalizedSrtPath(value)
    if (field === 'voiceDir') setVoiceDir(value)
    if (field === 'voiceMapPath') setVoiceMapPath(value)
    setLocaleResult(null)
  }

  const pickLocale = async (field: 'localizedSrtPath' | 'voiceDir' | 'voiceMapPath'): Promise<void> => {
    const kind = field === 'voiceDir' ? 'directory' : field === 'localizedSrtPath' ? 'srt' : 'json'
    try {
      const selected = await window.api.contentBlockPickPath(kind)
      if (selected) changeLocale(field, selected)
    } catch (reason) {
      setState((current) => ({ ...current, error: errorMessage(reason) }))
    }
  }

  const importLocale = async (): Promise<void> => {
    if (!state.sourceManifestPath) return
    await run(async () => {
      const result = await window.api.importContentBlockLocale({
        projectDir: state.projectDir,
        sourceManifestPath: state.sourceManifestPath,
        locale,
        localizedSrtPath,
        voiceDir,
        voiceMapPath: voiceMapPath.trim() || null
      })
      setLocaleResult(result)
      if (!result.ok || !result.manifest || !result.manifestPath) return
      setState((current) => ({
        ...current,
        importedLocales: upsertImportedLocale(current.importedLocales, {
          locale,
          manifestPath: result.manifestPath!,
          manifest: result.manifest!
        }),
        localeManifestPath: result.manifestPath!,
        localeManifest: result.manifest!,
        timelinePath: '',
        subtitlePath: '',
        timeline: null,
        exportResult: null,
        error: ''
      }))
    })
  }

  const selectLocale = (manifestPath: string): void => {
    const selected = state.importedLocales.find((item) => item.manifestPath === manifestPath)
    if (!selected) return
    setLocale(selected.locale)
    setState((current) => ({
      ...current,
      localeManifestPath: selected.manifestPath,
      localeManifest: selected.manifest,
      timelinePath: '',
      subtitlePath: '',
      timeline: null,
      exportResult: null,
      error: ''
    }))
  }

  const createVariant = async (): Promise<void> => {
    if (!state.sourceManifest || !state.sourceManifestPath) return
    await run(async () => {
      const result = await window.api.createContentBlockVariant({
        projectDir: state.projectDir,
        sourceManifestPath: state.sourceManifestPath,
        variantId,
        seed,
        constraints: defaultVariantConstraints(state.sourceManifest!)
      })
      if (!result.ok || !result.variant || !result.variantPath) throw new Error(result.error ?? 'Tạo variant thất bại.')
      setState((current) => ({
        ...current,
        variantPath: result.variantPath!,
        variant: result.variant!,
        timelinePath: '',
        subtitlePath: '',
        timeline: null,
        exportResult: null
      }))
    })
  }

  const buildTimeline = async (): Promise<void> => {
    if (!state.sourceManifestPath || !state.localeManifestPath || !state.variantPath) return
    await run(async () => {
      const result = await window.api.buildContentBlockTimeline({
        projectDir: state.projectDir,
        sourceManifestPath: state.sourceManifestPath,
        localeManifestPath: state.localeManifestPath,
        variantPath: state.variantPath
      })
      if (!result.ok || !result.timeline || !result.timelinePath || !result.subtitlePath) throw new Error(result.error ?? 'Build timeline thất bại.')
      setState((current) => ({
        ...current,
        timelinePath: result.timelinePath!,
        subtitlePath: result.subtitlePath!,
        timeline: result.timeline!,
        exportResult: null
      }))
    })
  }

  const pickExportDirectory = async (field: 'draftsDir' | 'templateDir'): Promise<void> => {
    try {
      const selected = await window.api.contentBlockPickPath('directory')
      if (selected) setState((current) => ({ ...current, [field]: selected, exportResult: null, error: '' }))
    } catch (reason) {
      setState((current) => ({ ...current, error: errorMessage(reason) }))
    }
  }

  const changeExport = (field: 'draftsDir' | 'templateDir' | 'projectName', value: string): void => {
    setState((current) => ({ ...current, [field]: value, exportResult: null, error: '' }))
  }

  const exportCapCut = async (): Promise<void> => {
    if (!state.sourceManifestPath || !state.localeManifestPath || !state.timelinePath) return
    await run(async () => {
      const result = await window.api.exportContentBlockCapCut({
        sourceManifestPath: state.sourceManifestPath,
        localeManifestPath: state.localeManifestPath,
        timelinePath: state.timelinePath,
        draftsDir: state.draftsDir,
        templateDir: state.templateDir,
        projectName: state.projectName,
        muteOriginalVideo: true
      })
      setState((current) => ({ ...current, exportResult: result }))
      if (!result.ok && !result.cancelled) throw new Error(result.error ?? 'Xuất CapCut thất bại.')
    })
  }

  const cancel = async (): Promise<void> => {
    try {
      await window.api.cancelContentBlocks()
    } catch (reason) {
      setState((current) => ({ ...current, error: errorMessage(reason) }))
    }
  }

  const step = visibleContentBlockStep(state)
  const stepKeys = Object.keys(STEP_LABELS) as Array<keyof typeof STEP_LABELS>

  return (
    <div className="content-blocks-workspace">
      <section className="card content-blocks-card">
        <div className="content-blocks-section-head">
          <div>
            <strong>Khối nội dung · Manifest-first</strong>
            <span className="muted small">Source → review boundary → locale voice → variant → timeline CapCut</span>
          </div>
          <span className="content-blocks-badge">V1 · {state.sourceManifest?.blocks.length ?? 0} block</span>
        </div>
        <div className="content-blocks-stepper" aria-label="Tiến trình Content Block">
          {stepKeys.map((key) => (
            <span className={`content-blocks-step ${key === step ? 'active' : ''}`} key={key}>{STEP_LABELS[key]}</span>
          ))}
        </div>
      </section>

      <div className="content-blocks-grid">
        <div className="content-blocks-flow">
          <SourceStep
            projectDir={state.projectDir}
            videoPath={state.videoPath}
            srtPath={state.srtPath}
            sceneManifestPath={state.sceneManifestPath}
            running={state.running}
            canAnalyze={canAnalyzeContentBlocks(state)}
            onChange={changeSource}
            onPick={(field) => void pickSource(field)}
            onAnalyze={() => void analyze()}
          />
          {state.sourceManifest && (
            <ReviewStep manifest={state.sourceManifest} running={state.running} onEdit={(operation) => void editManifest(operation)} />
          )}
          {state.sourceManifest && (
            <LocaleStep
              locale={locale}
              localizedSrtPath={localizedSrtPath}
              voiceDir={voiceDir}
              voiceMapPath={voiceMapPath}
              importedLocales={state.importedLocales}
              selectedLocaleManifestPath={state.localeManifestPath}
              result={localeResult}
              running={state.running}
              canImport={canImportContentLocale(state, locale, localizedSrtPath, voiceDir)}
              onChange={changeLocale}
              onPick={(field) => void pickLocale(field)}
              onSelectLocale={selectLocale}
              onImport={() => void importLocale()}
            />
          )}
          {state.sourceManifest && state.localeManifest && (
            <VariantStep
              manifest={state.sourceManifest}
              variantId={variantId}
              seed={seed}
              variant={state.variant}
              running={state.running}
              canCreate={canCreateContentVariant(state, variantId, seed)}
              onVariantId={setVariantId}
              onSeed={setSeed}
              onCreate={() => void createVariant()}
            />
          )}
          {state.variant && (
            <ExportStep
              timeline={state.timeline}
              subtitlePath={state.subtitlePath}
              draftsDir={state.draftsDir}
              templateDir={state.templateDir}
              projectName={state.projectName}
              result={state.exportResult}
              running={state.running}
              canBuild={canBuildContentTimeline(state)}
              canExport={canExportContentBlockCapCut(state)}
              onBuildTimeline={() => void buildTimeline()}
              onPickDirectory={(field) => void pickExportDirectory(field)}
              onChange={changeExport}
              onExport={() => void exportCapCut()}
              onOpenPath={(path) => void window.api.openPath(path)}
            />
          )}
        </div>
        <aside className="content-blocks-side">
          <ContentBlocksProgress progress={state.progress} running={state.running} onCancel={() => void cancel()} />
          {state.error && <section className="card content-blocks-card content-blocks-result error-text"><strong>Lỗi</strong><span>{state.error}</span></section>}
          <section className="card content-blocks-card">
            <strong>Artifact hiện tại</strong>
            <div className="content-blocks-artifacts">
              <span>Source manifest: {state.sourceManifestPath || '—'}</span>
              <span>Locale: {state.localeManifestPath || '—'}</span>
              <span>Variant: {state.variantPath || '—'}</span>
              <span>Timeline: {state.timelinePath || '—'}</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

export const contentBlocksRendererFeature = {
  ...FEATURE_META,
  component: ContentBlocksPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
