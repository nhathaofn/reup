import type { ReactNode, JSX } from 'react'
import type { SrtTranslatorViewState } from '../model'

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

export interface SourceStepProps {
  state: SrtTranslatorViewState
  geminiConnectionCard: ReactNode
  canAnalyze: boolean
  loadingSource: boolean
  onChooseSrt(): void
  onAnalyze(): void
  onCancel(): void
}

export default function SourceStep({ state, geminiConnectionCard, canAnalyze, loadingSource, onChooseSrt, onAnalyze, onCancel }: SourceStepProps): JSX.Element {
  return (
    <section className="srt-translator-step-content">
      <div className="srt-translator-source-grid">
        <div className="card srt-translator-source-card">
          <strong>SRT tiếng Trung</strong>
          <span className={`srt-translator-path ${state.sourcePath ? 'selected' : ''}`}>
            {state.sourcePath ? fileName(state.sourcePath) : 'Chưa chọn file SRT'}
          </span>
          <button className="btn" type="button" onClick={onChooseSrt} disabled={state.running || loadingSource}>
            {state.sourcePath ? 'Đổi file' : 'Chọn file'}
          </button>
        </div>
        <div className="card srt-translator-source-card srt-translator-connection-card">{geminiConnectionCard}</div>
      </div>

      <div className="card srt-translator-card srt-translator-source-summary">
        <div className="srt-translator-source-meta">
          <span>{state.sourceCount ? `${state.sourceCount} cue` : 'Chưa đọc SRT'}</span>
          {state.lastCueEndSeconds > 0 && <span>Cuối SRT: {state.lastCueEndSeconds.toFixed(2)}s</span>}
        </div>
        <p className="srt-translator-hint">
          Chỉ dùng nội dung SRT. Hệ thống đọc toàn bộ file để suy luận ngữ cảnh, phục hồi lỗi ASR và đánh dấu các chỗ còn mơ hồ; không cần video hoặc audio gốc và không thể bảo đảm 100% lời nói/hình ảnh ban đầu.
        </p>
        <div className="srt-translator-actions">
          <button className="btn primary" type="button" onClick={onAnalyze} disabled={!canAnalyze || state.running}>
            Kiểm tra và phục hồi tiếng Trung
          </button>
          {state.running && <button className="btn" type="button" onClick={onCancel}>Hủy</button>}
        </div>
        {state.running && state.progress && (
          <div className="srt-translator-progress-block" aria-live="polite">
            <div className="srt-translator-progress-label">{state.progress.message} · {Math.round(state.progress.percent ?? 0)}%</div>
            <progress max={100} value={state.progress.percent ?? 0} />
          </div>
        )}
        {state.error && <div className="srt-translator-message error">{state.error}</div>}
        {state.cleanupWarning && <div className="srt-translator-warning" role="status">{state.cleanupWarning}</div>}
      </div>
    </section>
  )
}
