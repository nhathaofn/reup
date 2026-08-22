import type { JSX } from 'react'
import type { SrtRateStatus } from '../../../../../shared/features/srt-translator.ts'
import type { SrtTargetView } from '../model'

export interface ResultStepProps {
  sourceText: string
  targets: SrtTargetView[]
  selectedTargetId: string
  sourceUpdatedAt?: string
  rateAttributionUrl?: string
  cleanupWarning?: string
  onSelectTarget(id: string): void
  onExportOne(view: SrtTargetView): void
  onExportAll(): void
  onAnalyzeAgain(): void
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function statusLabel(status: SrtTargetView['status']): string {
  if (status === 'done') return 'Đã dịch'
  if (status === 'error') return 'Lỗi'
  if (status === 'running') return 'Đang dịch'
  return 'Đang chờ'
}

function rateMessage(status: SrtRateStatus | undefined): JSX.Element | null {
  if (status === 'unavailable') return <div className="srt-translator-message error">Không lấy được tỷ giá. Tiền nguồn chưa được đổi.</div>
  if (status === 'source-preserved') return <div className="srt-translator-message">Giữ nguyên tiền tệ nguồn vì không đủ điều kiện chuyển đổi.</div>
  return null
}

export default function ResultStep({ sourceText, targets, selectedTargetId, sourceUpdatedAt, rateAttributionUrl, cleanupWarning, onSelectTarget, onExportOne, onExportAll, onAnalyzeAgain }: ResultStepProps): JSX.Element {
  const selected = targets.find((target) => target.id === selectedTargetId) ?? targets[0]
  const successful = targets.filter((target) => target.status === 'done' && Boolean(target.srt))
  return (
    <section className="srt-translator-step-content">
      {cleanupWarning && <div className="srt-translator-warning" role="status">{cleanupWarning}</div>}
      <div className="srt-translator-result-toolbar">
        <button className="btn" type="button" onClick={onAnalyzeAgain}>Kiểm tra lại để dịch thêm</button>
        <button className="btn primary" type="button" onClick={onExportAll} disabled={!successful.length}>Xuất tất cả</button>
      </div>
      <div className="srt-translator-preview-grid">
        <div className="card srt-translator-preview-card srt-translator-preview-pane">
          <div className="srt-translator-pane-title">SRT tiếng Trung nguồn</div>
          <textarea readOnly value={sourceText} spellCheck={false} />
        </div>
        <div className="card srt-translator-preview-card srt-translator-preview-pane">
          <div className="srt-translator-pane-title">Bản dịch</div>
          <div className="srt-translator-view-tabs">
            {targets.map((target) => (
              <button className={`srt-translator-view-tab ${selected?.id === target.id ? 'active' : ''}`} type="button" key={target.id} onClick={() => onSelectTarget(target.id)}>
                <span>{target.languageLabel}</span><small className={target.status}>{statusLabel(target.status)}</small>
              </button>
            ))}
          </div>
          {selected && (
            <>
              <textarea readOnly value={selected.srt ?? ''} placeholder={selected.error ?? statusLabel(selected.status)} spellCheck={false} />
              {selected.unverified && <div className="srt-translator-message">Kết quả được suy ra chỉ từ SRT; không có audio/video để xác minh lời nói hoặc hình ảnh.</div>}
              {rateMessage(selected.rateStatus)}
              {selected.error && <div className="srt-translator-message error">{selected.error}</div>}
              {selected.status === 'done' && selected.srt && (
                <div className="srt-translator-result-row">
                  <span className="muted small">{selected.count ?? 0} cue · {selected.exportedPath ? fileName(selected.exportedPath) : 'Chưa xuất'}</span>
                  <button className="btn" type="button" onClick={() => onExportOne(selected)}>Xuất file này</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {sourceUpdatedAt && <div className="srt-translator-rate-attribution">Tỷ giá cập nhật: {sourceUpdatedAt} · <a href={rateAttributionUrl || 'https://www.exchangerate-api.com'} target="_blank" rel="noreferrer">Rates By ExchangeRate-API</a></div>}
    </section>
  )
}
