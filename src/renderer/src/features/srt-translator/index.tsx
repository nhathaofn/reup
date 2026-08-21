import { useEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react'
import {
  FEATURE_ID,
  FEATURE_META,
  SRT_LOCALE_PRESETS,
  type SrtExportItem,
  type SrtLocalizationProgress,
  type SrtLocaleTargetInput,
  type SrtReleaseResult
} from '../../../../shared/features/srt-translator'
import GeminiHelp from '../../components/GeminiHelp'
import type { RendererFeature } from '../contracts'
import SourceStep from './components/SourceStep'
import GeminiConnection from './components/GeminiConnection'
import ReviewStep from './components/ReviewStep'
import ResultStep from './components/ResultStep'
import TargetStep from './components/TargetStep'
import {
  canAnalyze,
  canResolve,
  canTranslate,
  createInitialSrtTranslatorState,
  jobIdToReleaseBeforeReplacement,
  srtTranslatorReducer,
  visibleStep,
  type SrtTargetView
} from './model'
import './styles.css'

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function stepLabel(step: ReturnType<typeof visibleStep>): string {
  if (step === 'source') return 'Nguồn'
  if (step === 'restoration') return 'Phục hồi'
  if (step === 'review') return 'Duyệt'
  if (step === 'translation') return 'Bản địa hóa'
  return 'Xuất'
}

function asExportItem(view: SrtTargetView): SrtExportItem {
  return {
    target: {
      id: view.id,
      languageLabel: view.languageLabel,
      locale: view.locale,
      regionLabel: view.regionLabel,
      currencyCode: view.currencyCode
    },
    ok: view.status === 'done',
    srt: view.srt,
    count: view.count,
    unverified: view.unverified,
    rateStatus: view.rateStatus,
    error: view.error
  }
}

function SrtTranslatorPanel(): JSX.Element {
  const [state, dispatch] = useReducer(srtTranslatorReducer, undefined, createInitialSrtTranslatorState)
  const [loadingSource, setLoadingSource] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMessage, setKeyMessage] = useState('')
  const [keyMessageOk, setKeyMessageOk] = useState(false)
  const [showGeminiHelp, setShowGeminiHelp] = useState(false)
  const activeJobIdRef = useRef('')
  const operationEpochRef = useRef(0)

  useEffect(() => {
    activeJobIdRef.current = state.jobId
  }, [state.jobId])

  useEffect(() => {
    let active = true
    void window.api.geminiHasKey().then((ready) => {
      if (active) dispatch({ type: 'gemini-status', ready })
    })
    return () => { active = false }
  }, [])

  useEffect(() => window.api.onSrtTranslatorProgress((event: SrtLocalizationProgress) => {
    dispatch({ type: 'progress', event })
  }), [])

  useEffect(() => () => {
    const jobId = activeJobIdRef.current
    if (jobId) void window.api.releaseSrtTranslator({ jobId })
  }, [])

  async function releaseCurrentJob(): Promise<string> {
    const jobId = jobIdToReleaseBeforeReplacement(state) ?? activeJobIdRef.current
    if (!jobId) return ''
    const result = await window.api.releaseSrtTranslator({ jobId }).catch((): SrtReleaseResult => ({ ok: false, released: false, error: 'Không thể giải phóng tác vụ.' }))
    return result.cleanupWarning ?? ''
  }

  async function replaceSource(result: Awaited<ReturnType<typeof window.api.loadSrtTranslator>>): Promise<void> {
    operationEpochRef.current += 1
    const cleanupWarning = await releaseCurrentJob()
    dispatch(result.ok ? { type: 'source-loaded', result } : { type: 'source-loaded', result })
    if (cleanupWarning) dispatch({ type: 'cleanup-warning', warning: cleanupWarning })
  }

  async function chooseSrtSource(): Promise<void> {
    if (state.running || loadingSource) return
    const sourcePath = await window.api.chooseSrt()
    if (!sourcePath) return
    setLoadingSource(true)
    try {
      const result = await window.api.loadSrtTranslator({ sourcePath })
      await replaceSource(result)
    } catch {
      dispatch({ type: 'source-loaded', result: { ok: false, sourcePath, error: 'Không thể đọc file phụ đề.' } })
    } finally {
      setLoadingSource(false)
    }
  }

  async function analyze(): Promise<void> {
    if (!canAnalyze(state)) return
    const epoch = ++operationEpochRef.current
    dispatch({ type: 'analyze-started' })
    try {
      const result = await window.api.analyzeSrtTranslator({ sourcePath: state.sourcePath })
      if (epoch !== operationEpochRef.current) return
      dispatch(result.ok ? { type: 'analyze-succeeded', result } : { type: 'analyze-failed', error: result.error ?? 'Không thể phục hồi phụ đề.', errorCode: result.errorCode, cleanupWarning: result.cleanupWarning })
    } catch {
      if (epoch === operationEpochRef.current) dispatch({ type: 'analyze-failed', error: 'Không thể phục hồi phụ đề.' })
    }
  }

  async function resolveReview(): Promise<void> {
    if (!canResolve(state)) return
    const epoch = ++operationEpochRef.current
    const selections = state.unresolvedCueNumbers.map((cueNumber) => ({ cueNumber, candidateId: state.selections[cueNumber]! }))
    dispatch({ type: 'resolve-started' })
    try {
      const result = await window.api.resolveSrtTranslator({ jobId: state.jobId, selections })
      if (epoch !== operationEpochRef.current) return
      dispatch(result.ok ? { type: 'resolve-succeeded' } : { type: 'resolve-failed', error: result.error ?? 'Chưa thể chốt bản phục hồi.' })
    } catch {
      if (epoch === operationEpochRef.current) dispatch({ type: 'resolve-failed', error: 'Chưa thể chốt bản phục hồi.' })
    }
  }

  async function translateTargets(): Promise<void> {
    if (!canTranslate(state)) return
    const epoch = ++operationEpochRef.current
    const jobId = state.jobId
    const targets = state.targets
    dispatch({ type: 'translation-started' })
    try {
      const result = await window.api.runSrtTranslator({ jobId, targets })
      if (epoch === operationEpochRef.current) dispatch({ type: 'translation-finished', result })
    } catch {
      if (epoch === operationEpochRef.current) dispatch({ type: 'translation-failed', error: 'Không thể bản địa hóa phụ đề.' })
    }
  }

  async function cancelActive(): Promise<void> {
    const jobId = activeJobIdRef.current || state.jobId
    if (!jobId) return
    const batchTranslationRunning = state.targetViews.some((view) => view.status === 'running')
    if (!batchTranslationRunning) operationEpochRef.current += 1
    const result = await window.api.cancelSrtTranslator({ jobId }).catch(() => ({ ok: false, wasRunning: false, error: 'Không thể hủy tác vụ.' }))
    if (!batchTranslationRunning || !result.ok) dispatch({ type: 'cancelled', result })
  }

  async function checkGemini(): Promise<void> {
    if (keyBusy || (!keyInput.trim() && state.geminiReady !== true)) return
    setKeyBusy(true)
    setKeyMessage('')
    try {
      if (keyInput.trim()) await window.api.geminiSaveKey(keyInput.trim())
      const result = await window.api.geminiCheckKey(keyInput.trim())
      setKeyMessage(result.message)
      setKeyMessageOk(result.ok)
      dispatch({ type: 'gemini-status', ready: result.ok ? true : await window.api.geminiHasKey() })
      if (result.ok) setKeyInput('')
    } catch {
      setKeyMessage('Không thể kiểm tra kết nối Gemini.')
      setKeyMessageOk(false)
    } finally {
      setKeyBusy(false)
    }
  }

  async function disconnectGemini(): Promise<void> {
    if (keyBusy) return
    await window.api.geminiSaveKey('')
    dispatch({ type: 'gemini-status', ready: false })
    setKeyMessage('Đã ngắt kết nối Gemini.')
    setKeyMessageOk(false)
    setKeyInput('')
  }

  async function exportOne(view: SrtTargetView): Promise<void> {
    if (view.status !== 'done' || !view.srt) return
    const result = await window.api.exportSrtTranslatorOne({ sourceName: state.sourcePath, item: asExportItem(view) })
    if (result.ok && result.paths?.[0]) dispatch({ type: 'export-finished', targetId: view.id, paths: result.paths, message: `Đã xuất ${fileName(result.paths[0])}.` })
    else if (!result.cancelled) dispatch({ type: 'export-finished', paths: [], message: result.error ?? 'Xuất file thất bại.' })
  }

  async function exportAll(): Promise<void> {
    const items = state.targetViews.filter((view) => view.status === 'done' && view.srt).map(asExportItem)
    if (!items.length) return
    const result = await window.api.exportSrtTranslatorAll({ sourceName: state.sourcePath, items })
    if (result.ok && result.paths?.length) dispatch({ type: 'export-finished', paths: result.paths, message: `Đã xuất ${result.paths.length} file phụ đề.` })
    else if (!result.cancelled) dispatch({ type: 'export-finished', paths: [], message: result.error ?? 'Xuất file thất bại.' })
  }

  const activeStep = visibleStep(state)
  const stepIndex = ['source', 'restoration', 'review', 'translation', 'export'].indexOf(activeStep)
  const successfulCount = useMemo(() => state.targetViews.filter((view) => view.status === 'done' && view.srt).length, [state.targetViews])
  return (
    <div className="srt-translator-workspace">
      <div className="srt-translator-stepper" aria-label="Quy trình dịch SRT">
        {(['source', 'restoration', 'review', 'translation', 'export'] as const).map((step, index) => (
          <div className={`srt-translator-step ${index === stepIndex ? 'active' : ''} ${index < stepIndex ? 'complete' : ''}`} key={step}>
            <span>{index + 1}</span><strong>{stepLabel(step)}</strong>
          </div>
        ))}
      </div>

      <SourceStep
        state={state}
        geminiConnection={
          <GeminiConnection
            ready={state.geminiReady}
            keyInput={keyInput}
            busy={keyBusy}
            message={keyMessage}
            messageOk={keyMessageOk}
            onKeyInput={setKeyInput}
            onCheck={() => void checkGemini()}
            onDisconnect={() => void disconnectGemini()}
            onOpenHelp={() => setShowGeminiHelp(true)}
          />
        }
        canAnalyze={canAnalyze(state)}
        loadingSource={loadingSource}
        onChooseSrt={() => void chooseSrtSource()}
        onAnalyze={() => void analyze()}
        onCancel={() => void cancelActive()}
      />

      {state.topicVi && <div className="srt-translator-topic card"><b>Chủ đề:</b> {state.topicVi}</div>}
      {state.unresolvedCueNumbers.length > 0 && (
        <ReviewStep reviewCues={state.reviewCues} unresolvedCueNumbers={state.unresolvedCueNumbers} selections={state.selections} canContinue={canResolve(state)} onSelect={(cueNumber, candidateId) => dispatch({ type: 'review-selected', cueNumber, candidateId })} onResolve={() => void resolveReview()} />
      )}
      {state.jobId && state.unresolvedCueNumbers.length === 0 && !state.targetViews.some((view) => view.status === 'done' || view.status === 'error') && (
        <TargetStep presets={SRT_LOCALE_PRESETS} selected={state.targets} disabled={state.running} onChange={(targets: SrtLocaleTargetInput[]) => dispatch({ type: 'targets-changed', targets })} onTranslate={() => void translateTargets()} />
      )}
      {state.running && state.progress && ['fetching-rates', 'translating', 'cleaning-up'].includes(state.progress.phase) && (
        <div className="card srt-translator-progress-block" aria-live="polite"><strong>{state.progress.message}</strong><progress max={100} value={state.progress.percent ?? 0} /><span>{Math.round(state.progress.percent ?? 0)}%</span><button className="btn" type="button" onClick={() => void cancelActive()}>Hủy</button></div>
      )}
      {state.targetViews.some((view) => view.status === 'done' || view.status === 'error') && (
        <ResultStep sourceText={state.sourceText} targets={state.targetViews} selectedTargetId={state.selectedTargetId} sourceUpdatedAt={state.rateSourceUpdatedAt} rateAttributionUrl={state.rateAttributionUrl} cleanupWarning={state.cleanupWarning} onSelectTarget={(id) => dispatch({ type: 'target-selected', targetId: id })} onExportOne={(view) => void exportOne(view)} onExportAll={() => void exportAll()} onAnalyzeAgain={() => void analyze()} />
      )}

      {successfulCount > 0 && state.exportMessage && <div className="srt-translator-message ok">{state.exportMessage}</div>}
      {showGeminiHelp && <GeminiHelp onClose={() => setShowGeminiHelp(false)} />}
    </div>
  )
}

export const srtTranslatorRendererFeature = {
  ...FEATURE_META,
  component: SrtTranslatorPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
