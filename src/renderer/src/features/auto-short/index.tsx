import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  FEATURE_ID,
  FEATURE_META,
  type AutoShortLayout,
  type AutoShortProgress,
  type AutoShortResult
} from '../../../../shared/features/auto-short'
import { usePersistedState } from '../../lib/persist'
import { useTabOutputDir } from '../../lib/outputDir'
import type { RendererFeature } from '../contracts'
import './styles.css'

const VIDEO_PATTERN = /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v)$/i

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds - minutes * 60)
  return minutes ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder}s`
}

function AutoShortPanel(): JSX.Element {
  const [videos, setVideos] = useState<string[]>([])
  const [outputDir, setOutputDir] = useTabOutputDir('tediapros.outputDir.auto-short')
  const [clipSeconds, setClipSeconds] = usePersistedState<15 | 30 | 60>('tediapros.auto-short.clip-seconds', 30)
  const [layout, setLayout] = usePersistedState<AutoShortLayout>('tediapros.auto-short.layout', 'vertical')
  const [progress, setProgress] = useState<AutoShortProgress | null>(null)
  const [result, setResult] = useState<AutoShortResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => window.api.onAutoShortProgress(setProgress), [])

  const totalOutputEstimate = useMemo(() => {
    if (!videos.length) return 0
    return `Mỗi video sẽ được chia thành các đoạn tối đa ${clipSeconds} giây.`
  }, [clipSeconds, videos.length])

  const chooseVideos = async (): Promise<void> => {
    const selected = (await window.api.chooseFiles()) as string[]
    const valid = selected.filter((path) => VIDEO_PATTERN.test(path))
    if (valid.length) {
      setVideos((current) => [...new Set([...current, ...valid])])
      setResult(null)
      setError('')
    }
  }

  const chooseOutput = async (): Promise<void> => {
    const selected = await window.api.chooseFolder()
    if (selected) setOutputDir(selected)
  }

  const run = async (): Promise<void> => {
    setRunning(true)
    setCancelling(false)
    setError('')
    setResult(null)
    setProgress({ phase: 'preparing', percent: 0, message: 'Đang chuẩn bị…', totalClips: 0, completedClips: 0 })
    try {
      const generated = await window.api.runAutoShort({ videos, outputDir, clipSeconds, layout })
      setResult(generated)
      if (!generated.ok && !generated.cancelled) setError(generated.error || 'Không tạo được short.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
      setCancelling(false)
    }
  }

  const cancel = async (): Promise<void> => {
    setCancelling(true)
    try {
      await window.api.cancelAutoShort()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setCancelling(false)
    }
  }

  const canRun = videos.length > 0 && Boolean(outputDir.trim()) && !running

  return (
    <div className="lam-viec auto-short-workspace">
      <div className="cot-cauhinh">
        <section className="card auto-short-card">
          <div className="auto-short-card-head">
            <div>
              <strong>🎞️ Video nguồn</strong>
              <span className="muted small">Chọn một hoặc nhiều video để xử lý lần lượt.</span>
            </div>
            <div className="auto-short-actions">
              <button className="btn primary small-btn" type="button" onClick={chooseVideos} disabled={running}>
                Thêm video
              </button>
              {videos.length > 0 && (
                <button className="btn small-btn" type="button" onClick={() => setVideos([])} disabled={running}>
                  Xóa hết
                </button>
              )}
            </div>
          </div>
          {videos.length ? (
            <div className="auto-short-files">
              {videos.map((video) => (
                <div className="auto-short-file" key={video} title={video}>
                  <span>{fileName(video)}</span>
                  <button
                    className="auto-short-remove"
                    type="button"
                    aria-label={`Xóa ${fileName(video)}`}
                    onClick={() => setVideos((current) => current.filter((item) => item !== video))}
                    disabled={running}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">Chưa chọn video nào.</p>
          )}
        </section>

        <section className="card auto-short-card">
          <strong>⚙️ Cấu hình Auto Short</strong>
          <div className="auto-short-options">
            <label>
              <span>Độ dài mỗi short</span>
              <select value={clipSeconds} onChange={(event) => setClipSeconds(Number(event.target.value) as 15 | 30 | 60)} disabled={running}>
                <option value={15}>15 giây</option>
                <option value={30}>30 giây</option>
                <option value={60}>60 giây</option>
              </select>
            </label>
            <label>
              <span>Khung hình đầu ra</span>
              <select value={layout} onChange={(event) => setLayout(event.target.value as AutoShortLayout)} disabled={running}>
                <option value="vertical">Dọc 9:16 (1080 × 1920)</option>
                <option value="source">Giữ khung gốc</option>
              </select>
            </label>
          </div>
          <p className="muted small auto-short-note">
            Auto Short hiện tự chia tuần tự theo thời lượng đã chọn; video được mã hóa H.264/AAC để dễ đăng Shorts, Reels và TikTok.
          </p>
        </section>

        <section className="card auto-short-card">
          <strong>📁 Thư mục đầu ra</strong>
          <div className="auto-short-folder-row">
            <input className="folder-input" value={outputDir} readOnly placeholder="Chọn thư mục lưu…" />
            <button className="btn small-btn" type="button" onClick={chooseOutput} disabled={running}>
              Duyệt
            </button>
          </div>
          <p className="muted small auto-short-note">{totalOutputEstimate || 'Các file sẽ được đặt trong thư mục này.'}</p>
        </section>

        <section className="card auto-short-run-card">
          <div className="auto-short-engine-line">
            <span className="auto-short-engine-dot" />
            <span>FFmpeg · chia đoạn cục bộ trên máy</span>
          </div>
          <div className="auto-short-run-actions">
            <button className="btn primary" type="button" disabled={!canRun} onClick={run}>
              {running ? 'Đang tạo short…' : '🚀 Bắt đầu'}
            </button>
            {running && (
              <button className="btn danger" type="button" disabled={cancelling} onClick={cancel}>
                {cancelling ? 'Đang dừng…' : '■ Dừng'}
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="cot-ketqua auto-short-results">
        <div className="cot-tieude">Tiến trình &amp; kết quả</div>
        {(running || progress) && (
          <div className={`card auto-short-progress ${progress?.phase ?? ''}`}>
            <div className="auto-short-progress-head">
              <strong>{progress?.phase === 'done' ? '✓ Hoàn tất' : progress?.phase === 'cancelled' ? 'Đã dừng' : 'Đang xử lý'}</strong>
              <span>{progress?.percent ?? 0}%</span>
            </div>
            <div className="bar"><div className="bar-fill" style={{ width: `${progress?.percent ?? 0}%` }} /></div>
            <p className="muted small">{progress?.message}</p>
            {progress && progress.totalClips > 0 && (
              <p className="muted small auto-short-count">{progress.completedClips}/{progress.totalClips} short</p>
            )}
          </div>
        )}

        {error && <div className="error-box"><b>Lỗi:</b> {error}</div>}

        {result?.clips.length ? (
          <div className="card auto-short-result-card">
            <div className="auto-short-result-head">
              <div>
                <strong>📋 Đã tạo {result.clips.length} short</strong>
                <span className="muted small">Mở file hoặc mở thư mục đầu ra.</span>
              </div>
              <button className="btn small-btn" type="button" onClick={() => window.api.openPath(result.outputDir)}>
                Mở thư mục
              </button>
            </div>
            <div className="auto-short-table-wrap">
              <table className="auto-short-table">
                <thead><tr><th>File</th><th>Bắt đầu</th><th>Thời lượng</th><th /></tr></thead>
                <tbody>
                  {result.clips.map((clip) => (
                    <tr key={clip.output}>
                      <td title={clip.output}><b>{fileName(clip.output)}</b></td>
                      <td>{formatDuration(clip.startSeconds)}</td>
                      <td>{formatDuration(clip.durationSeconds)}</td>
                      <td><button className="auto-short-link" type="button" onClick={() => window.api.showItem(clip.output)}>Mở</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : !running && !error ? (
          <div className="empty auto-short-empty">
            <div className="empty-title">Chưa có kết quả</div>
            <div className="muted small">Chọn video, thư mục lưu rồi bấm <b>Bắt đầu</b>.</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const autoShortRendererFeature = {
  ...FEATURE_META,
  component: AutoShortPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
