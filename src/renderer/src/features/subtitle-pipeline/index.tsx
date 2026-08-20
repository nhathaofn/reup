import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import {
  FEATURE_ID,
  FEATURE_META,
  type SubtitlePipelineOutputPaths,
  type SubtitlePipelinePhase,
  type SubtitlePipelineProgress,
  type SubtitlePipelineResult
} from '../../../../shared/features/subtitle-pipeline'
import { SRT_LOCALE_PRESETS, type SrtLocaleTargetInput } from '../../../../shared/features/srt-translator'
import type { GpuInfo } from '../../../../shared/types'
import { usePersistedState } from '../../lib/persist'
import { useTabOutputDir } from '../../lib/outputDir'
import type { RendererFeature } from '../contracts'
import TargetStep from '../srt-translator/components/TargetStep'
import './styles.css'
import '../srt-translator/styles.css'

const MODELS = [
  { value: 'small', label: 'Cân bằng', note: 'Khoảng 484 MB' },
  { value: 'medium', label: 'Chính xác cao', note: 'Khoảng 1,5 GB' },
  { value: 'large-v3-turbo', label: 'Rất chính xác (Turbo)', note: 'Khoảng 1,6 GB' }
] as const

const LANGUAGES = [
  { value: 'auto', label: 'Tự nhận diện' },
  { value: 'zh', label: 'Tiếng Trung' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'Tiếng Anh' },
  { value: 'ja', label: 'Tiếng Nhật' },
  { value: 'ko', label: 'Tiếng Hàn' }
] as const

const PHASE_LABELS: Record<SubtitlePipelinePhase, string> = {
  validating: 'Kiểm tra nguồn',
  ocr: 'Đọc chữ trên hình',
  asr: 'Nhận diện lời nói',
  fusing: 'Hợp nhất evidence',
  restoring: 'AI phục hồi',
  auditing: 'AI audit',
  translating: 'Dịch bản địa hóa',
  exporting: 'Xuất kết quả',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
  error: 'Lỗi'
}

const baseName = (path: string): string => path.split(/[\\/]/u).pop() || path

type OutputEntryKind = 'primarySrt' | 'translatedSrt' | 'batchDir' | 'draftDir'
interface OutputEntry {
  key: OutputEntryKind
  label: string
  path: string
}

function outputEntries(outputs: SubtitlePipelineOutputPaths): OutputEntry[] {
  const entries: OutputEntry[] = []
  const primary = outputs.primarySrt ?? outputs.translatedSrt ?? outputs.finalSrt
  if (primary) entries.push({ key: 'primarySrt', label: 'SRT nguồn tốt nhất', path: primary })
  for (const translated of outputs.translatedOutputs ?? []) {
    entries.push({ key: 'translatedSrt', label: `Bản dịch · ${translated.target.languageLabel}`, path: translated.path })
  }
  for (const batch of outputs.batchOutputs ?? []) {
    entries.push({ key: 'batchDir', label: `Thư mục Batch · ${baseName(batch.srtPath)}`, path: batch.splitDir })
  }
  if (outputs.draftDir) entries.push({ key: 'draftDir', label: 'Thư mục draft', path: outputs.draftDir })
  return entries
}

function SubtitlePipelinePanel(): JSX.Element {
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.subtitlePipeline')
  const [videoPath, setVideoPath] = useState('')
  const [sourceSrtPath, setSourceSrtPath] = useState('')
  const [runAsr, setRunAsr] = usePersistedState('tblao.pipeline.asr', true)
  const [runOcr, setRunOcr] = usePersistedState('tblao.pipeline.ocr', true)
  const [ocrMode, setOcrMode] = usePersistedState<'auto' | 'full'>('tblao.pipeline.ocrMode', 'auto')
  const [aiEnabled, setAiEnabled] = usePersistedState('tblao.pipeline.ai', true)
  const [keepIntermediates, setKeepIntermediates] = usePersistedState('tblao.pipeline.raw', true)
  const [model, setModel] = usePersistedState('tblao.pipeline.model', 'small')
  const [language, setLanguage] = usePersistedState('tblao.pipeline.language', 'zh')
  const [quality, setQuality] = usePersistedState<'balanced' | 'accurate'>('tblao.pipeline.quality', 'accurate')
  const [targetLocales, setTargetLocales] = usePersistedState<SrtLocaleTargetInput[]>('tblao.pipeline.targetLocales', [])
  const [useGpu, setUseGpu] = usePersistedState('tblao.pipeline.gpu', true)

  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [cudaReady, setCudaReady] = useState(false)
  const [asrEngineReady, setAsrEngineReady] = useState<boolean | null>(null)
  const [ocrEngineReady, setOcrEngineReady] = useState<boolean | null>(null)
  const [geminiReady, setGeminiReady] = useState<boolean | null>(null)
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiMessage, setGeminiMessage] = useState('')
  const [checkingGemini, setCheckingGemini] = useState(false)
  const [installing, setInstalling] = useState<'asr' | 'ocr' | 'cuda' | ''>('')
  const [installPercent, setInstallPercent] = useState(0)
  const [installError, setInstallError] = useState('')

  const [running, setRunning] = useState(false)
  const [activeJobId, setActiveJobId] = useState('')
  const [progress, setProgress] = useState<SubtitlePipelineProgress | null>(null)
  const [result, setResult] = useState<SubtitlePipelineResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    void window.api.whisperEngineStatus().then((status) => { if (!disposed) setAsrEngineReady(status.has) })
    void window.api.ocrEngineStatus().then((status) => { if (!disposed) setOcrEngineReady(status.has) })
    void window.api.whisperDetectGpu().then((value) => { if (!disposed) setGpu(value) })
    void window.api.whisperCudaStatus().then((status) => { if (!disposed) setCudaReady(status.has) })
    void window.api.geminiHasKey().then((ready) => { if (!disposed) setGeminiReady(ready) })
    const off = window.api.onSubtitlePipelineProgress((event) => {
      setProgress(event)
      setActiveJobId(event.jobId)
    })
    return () => {
      disposed = true
      off()
    }
  }, [])

  const chooseVideo = async (): Promise<void> => {
    const files = await window.api.chooseFiles()
    if (!files.length) return
    setVideoPath(files[0])
    setResult(null)
    setError('')
  }

  const chooseSrt = async (): Promise<void> => {
    const path = await window.api.chooseSrt(outputDir || null)
    if (path) setSourceSrtPath(path)
  }

  const chooseOutput = async (): Promise<void> => {
    const path = await window.api.chooseFolder()
    if (path) setOutputDir(path)
  }

  const installEngine = async (kind: 'asr' | 'ocr' | 'cuda'): Promise<void> => {
    setInstalling(kind)
    setInstallPercent(0)
    setInstallError('')
    let off = (): void => undefined
    try {
      if (kind === 'asr') {
        off = window.api.onWhisperInstallProgress(setInstallPercent)
        const response = await window.api.whisperInstallEngine()
        if (!response.ok) throw new Error(response.error ?? 'Không cài được ASR.')
        setAsrEngineReady(true)
      } else if (kind === 'ocr') {
        off = window.api.onOcrInstallProgress(setInstallPercent)
        const response = await window.api.ocrInstallEngine()
        if (!response.ok) throw new Error(response.error ?? 'Không cài được OCR.')
        setOcrEngineReady(true)
      } else {
        off = window.api.onWhisperCudaProgress(setInstallPercent)
        const response = await window.api.whisperInstallCuda()
        if (!response.ok) throw new Error(response.error ?? 'Không cài được gói GPU.')
        setCudaReady(true)
      }
    } catch (reason) {
      setInstallError(reason instanceof Error ? reason.message : 'Cài công cụ thất bại.')
    } finally {
      off()
      setInstalling('')
    }
  }

  const connectGemini = async (): Promise<void> => {
    setCheckingGemini(true)
    setGeminiMessage('')
    try {
      if (geminiKey.trim()) await window.api.geminiSaveKey(geminiKey.trim())
      const response = await window.api.geminiCheckKey(geminiKey.trim())
      setGeminiMessage(response.message)
      setGeminiReady(response.ok)
      if (response.ok) setGeminiKey('')
    } finally {
      setCheckingGemini(false)
    }
  }

  const hasUsableSubtitleSource = Boolean(sourceSrtPath) ||
    (runAsr && asrEngineReady === true) ||
    (runOcr && ocrEngineReady === true)
  const needsGemini = aiEnabled || targetLocales.length > 0
  const requiresGeminiForRun = targetLocales.length > 0
  const canRun = Boolean(videoPath && outputDir && (runAsr || runOcr || sourceSrtPath) && hasUsableSubtitleSource && !running && (!requiresGeminiForRun || geminiReady === true))
  const missingSelectedEngines = (runAsr && asrEngineReady === false) || (runOcr && ocrEngineReady === false)
  const gpuActive = Boolean(useGpu && gpu?.canAccelerate && cudaReady)

  const run = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canRun) return
    setRunning(true)
    setError('')
    setResult(null)
    setProgress(null)
    setActiveJobId('')
    try {
      const response = await window.api.runSubtitlePipeline({
        videoPath,
        outputDir,
        ...(sourceSrtPath ? { sourceSrtPath } : {}),
        runAsr,
        runOcr,
        ocrMode,
        asr: {
          model,
          language,
          device: gpuActive ? 'cuda' : 'cpu',
          quality
        },
        ai: {
          enabled: aiEnabled,
          targetLanguage: 'none',
          targetLocales
        },
        keepIntermediates
      })
      setResult(response)
      if (!response.ok) setError(response.error ?? 'Pipeline phụ đề thất bại.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pipeline phụ đề thất bại.')
    } finally {
      setRunning(false)
      setActiveJobId('')
    }
  }

  const cancel = async (): Promise<void> => {
    await window.api.cancelSubtitlePipeline(activeJobId ? { jobId: activeJobId } : {})
  }

  const entries = useMemo(() => outputEntries(result?.outputs ?? {}), [result])

  return (
    <section className="sp-shell">
      <form className="sp-config" onSubmit={run}>
        <div className="card sp-card">
          <div className="sp-card-title"><span className="sp-step">1</span>Nguồn video</div>
          <button type="button" className="btn primary" onClick={chooseVideo}>Chọn video</button>
          <div className={`sp-path ${videoPath ? '' : 'muted'}`}>{videoPath ? baseName(videoPath) : 'Chưa chọn video'}</div>
          <div className="sp-row">
            <button type="button" className="btn" onClick={chooseSrt}>SRT tham chiếu</button>
            {sourceSrtPath && <button type="button" className="link-btn" onClick={() => setSourceSrtPath('')}>Bỏ SRT</button>}
          </div>
          <div className={`sp-path ${sourceSrtPath ? '' : 'muted'}`}>
            {sourceSrtPath ? baseName(sourceSrtPath) : 'Tùy chọn — dùng khi đã có một bản SRT khác'}
          </div>
          <label className="field">
            <span className="muted small">Thư mục xuất</span>
            <div className="sp-folder-row">
              <input value={outputDir} readOnly />
              <button type="button" className="btn" onClick={chooseOutput}>Chọn</button>
            </div>
          </label>
        </div>

        <div className="card sp-card">
          <div className="sp-card-title"><span className="sp-step">2</span>Thu thập evidence</div>
          <label className="sp-toggle">
            <input type="checkbox" checked={runOcr} onChange={(event) => setRunOcr(event.target.checked)} />
            <span><b>OCR — chữ trên hình</b><small>Mặc định đọc vùng phụ đề phía dưới video.</small></span>
            <span className={`sp-status ${ocrEngineReady ? 'ok' : ''}`}>{ocrEngineReady ? 'Sẵn sàng' : 'Chưa cài'}</span>
          </label>
          {runOcr && ocrEngineReady === false && (
            <button type="button" className="btn" disabled={Boolean(installing)} onClick={() => void installEngine('ocr')}>
              {installing === 'ocr' ? `Đang cài OCR ${installPercent}%` : 'Cài OCR'}
            </button>
          )}
          {runOcr && (
            <label className="field">
              <span className="muted small">Vùng quét OCR</span>
              <select value={ocrMode} onChange={(event) => setOcrMode(event.target.value as 'auto' | 'full')}>
                <option value="auto">Tự động — ưu tiên 25% phía dưới</option>
                <option value="full">Toàn khung — bắt chữ ở mọi vị trí (chậm hơn)</option>
              </select>
            </label>
          )}

          <label className="sp-toggle">
            <input type="checkbox" checked={runAsr} onChange={(event) => setRunAsr(event.target.checked)} />
            <span><b>ASR — lời nói</b><small>Whisper tạo một track độc lập theo timeline.</small></span>
            <span className={`sp-status ${asrEngineReady ? 'ok' : ''}`}>{asrEngineReady ? 'Sẵn sàng' : 'Chưa cài'}</span>
          </label>
          {runAsr && asrEngineReady === false && (
            <button type="button" className="btn" disabled={Boolean(installing)} onClick={() => void installEngine('asr')}>
              {installing === 'asr' ? `Đang cài ASR ${installPercent}%` : 'Cài ASR'}
            </button>
          )}

          {runAsr && (
            <div className="sp-grid-2">
              <label className="field">
                <span className="muted small">Mức nhận diện</span>
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  {MODELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <small className="muted">{MODELS.find((item) => item.value === model)?.note}</small>
              </label>
              <label className="field">
                <span className="muted small">Ngôn ngữ nói</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="sp-check"><input type="checkbox" checked={quality === 'accurate'} onChange={(event) => setQuality(event.target.checked ? 'accurate' : 'balanced')} />Ưu tiên không bỏ sót câu ngắn</label>
              <label className="sp-check"><input type="checkbox" checked={useGpu} onChange={(event) => setUseGpu(event.target.checked)} />Dùng GPU khi sẵn sàng</label>
            </div>
          )}

          {runAsr && useGpu && gpu?.canAccelerate && !cudaReady && (
            <button type="button" className="btn" disabled={Boolean(installing)} onClick={() => void installEngine('cuda')}>
              {installing === 'cuda' ? `Đang cài GPU ${installPercent}%` : 'Cài gói tăng tốc GPU'}
            </button>
          )}
          {installError && <div className="sp-alert error">{installError}</div>}
        </div>

        <div className="card sp-card">
          <div className="sp-card-title"><span className="sp-step">3</span>AI phục hồi · dịch</div>
          <label className="sp-toggle">
            <input type="checkbox" checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} />
            <span><b>Gemini phục hồi + audit</b><small>Nhận cả provenance ASR/OCR/SRT, không chỉ một file đã trộn.</small></span>
            <span className={`sp-status ${geminiReady ? 'ok' : ''}`}>{geminiReady ? 'Đã kết nối' : 'Chưa kết nối'}</span>
          </label>
          {needsGemini && !geminiReady && (
            <div className="sp-key-row">
              <input type="password" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} placeholder="Dán Gemini API key" />
              <button type="button" className="btn" disabled={checkingGemini || !geminiKey.trim()} onClick={() => void connectGemini()}>
                {checkingGemini ? 'Đang kiểm tra…' : 'Kết nối'}
              </button>
            </div>
          )}
          {geminiMessage && <div className={`sp-alert ${geminiReady ? 'ok' : 'error'}`}>{geminiMessage}</div>}
          <div className="sp-translation-heading">
            <strong>Phase dịch sau khi chọn bản canonical tốt nhất</strong>
            <small className="muted">Chọn một hoặc nhiều ngôn ngữ giống tab Dịch SRT. Phục hồi và duyệt đã hoàn tất trong pipeline này.</small>
          </div>
          <TargetStep
            presets={SRT_LOCALE_PRESETS}
            selected={targetLocales}
            disabled={running}
            onChange={setTargetLocales}
            onTranslate={() => undefined}
            showAction={false}
          />
          <label className="sp-check"><input type="checkbox" checked={keepIntermediates} onChange={(event) => setKeepIntermediates(event.target.checked)} />Giữ SRT ASR và OCR để đối chiếu</label>
        </div>

        {missingSelectedEngines && sourceSrtPath && (
          <div className="sp-alert warn">Engine còn thiếu; pipeline vẫn có thể tiếp tục bằng SRT tham chiếu và các nguồn chạy thành công.</div>
        )}
        {!sourceSrtPath && !hasUsableSubtitleSource && asrEngineReady !== null && ocrEngineReady !== null && (
          <div className="sp-alert warn">Hãy cài ít nhất một engine (ASR hoặc OCR), hoặc chọn SRT tham chiếu trước khi chạy.</div>
        )}
        <div className="sp-run-row">
          {!running ? (
            <button className="btn primary sp-run" type="submit" disabled={!canRun}>Chạy toàn bộ pipeline</button>
          ) : (
            <button className="btn danger sp-run" type="button" onClick={() => void cancel()}>Hủy pipeline</button>
          )}
        </div>
      </form>

      <div className="sp-main">
        <div className="card sp-overview">
          <div>
            <div className="sp-eyebrow">Một job · ba nguồn evidence</div>
            <h2>{progress ? PHASE_LABELS[progress.phase] : 'Sẵn sàng xử lý'}</h2>
            <p className="muted">{progress?.message ?? 'OCR và ASR được giữ thành hai track riêng, sau đó mới hợp nhất và gửi qua AI.'}</p>
          </div>
          <div className="sp-percent">{Math.round(progress?.percent ?? 0)}%</div>
          <div className="bar sp-progress"><div className="bar-fill" style={{ width: `${progress?.percent ?? 0}%` }} /></div>
          {progress?.elapsedMs !== undefined && <div className="muted small">Đã chạy {(progress.elapsedMs / 1000).toFixed(1)} giây · Job {progress.jobId.slice(0, 8)}</div>}
        </div>

        <div className="sp-flow">
          {(['ocr', 'asr', 'fusing', 'restoring', 'auditing', 'translating', 'exporting'] as SubtitlePipelinePhase[]).map((phase, index) => {
            const currentIndex = progress ? ['validating', 'ocr', 'asr', 'fusing', 'restoring', 'auditing', 'translating', 'exporting', 'completed'].indexOf(progress.phase) : -1
            const phaseIndex = ['validating', 'ocr', 'asr', 'fusing', 'restoring', 'auditing', 'translating', 'exporting', 'completed'].indexOf(phase)
            return (
              <div key={phase} className={`sp-flow-item ${progress?.phase === phase ? 'active' : ''} ${currentIndex > phaseIndex ? 'done' : ''}`}>
                <span>{index + 1}</span><b>{PHASE_LABELS[phase]}</b>
              </div>
            )
          })}
        </div>

        {result?.ok && (
          <div className="card sp-result">
            <div className="sp-result-head">
              <div><div className="sp-eyebrow">Kết quả</div><h2>{result.cueCount} cue · {result.conflictCount} xung đột</h2></div>
              <span className="sp-result-ok">Hoàn tất</span>
            </div>
            <div className="sp-output-list">
              {entries.map((entry) => (
                <button key={`${entry.key}:${entry.path}`} type="button" className="sp-output" onClick={() => void (entry.key === 'draftDir' ? window.api.openPath(entry.path) : window.api.showItem(entry.path))}>
                  <span><b>{entry.label}</b><small>{baseName(entry.path)}</small></span><span>{entry.key === 'draftDir' ? 'Mở thư mục →' : 'Hiện file →'}</span>
                </button>
              ))}
            </div>
            <div className="muted small sp-output-note">Thư mục gốc giữ SRT nguồn tốt nhất và một bản tốt nhất cho mỗi ngôn ngữ đích; các bản trung gian nằm trong `draft`.</div>
            {result.warnings.length > 0 && (
              <div className="sp-alert warn"><b>Cần lưu ý</b><ul>{result.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul></div>
            )}
          </div>
        )}

        {error && <div className="sp-alert error"><b>Pipeline chưa hoàn tất</b><div>{error}</div></div>}

        {!result && !error && (
          <div className="card sp-empty">
            <div className="sp-empty-icon">◎</div>
            <h3>Evidence không bị trộn mù</h3>
            <p className="muted">Khi lời nói và chữ trên hình khác nhau, app giữ cả hai trong báo cáo và chỉ yêu cầu AI quyết định khi có đủ căn cứ.</p>
          </div>
        )}
      </div>
    </section>
  )
}

export const subtitlePipelineRendererFeature = {
  ...FEATURE_META,
  component: SubtitlePipelinePanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
