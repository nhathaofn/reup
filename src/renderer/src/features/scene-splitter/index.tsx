import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  FEATURE_ID,
  FEATURE_META,
  PYSCENEDETECT_VERSION,
  PYSCENEDETECT_WINDOWS_ASSET_SIZE,
  SCENE_SPLITTER_DEFAULTS,
  type SceneSplitterDetectorMode,
  type SceneSplitterEngineStatus,
  type SceneSplitterInstallProgress,
  type SceneSplitterProgress,
  type SceneSplitterResult
} from '../../../../shared/features/scene-splitter'
import { usePersistedState } from '../../lib/persist'
import { useTabOutputDir } from '../../lib/outputDir'
import type { RendererFeature } from '../contracts'
import './styles.css'

const ENGINE_SIZE_MB = Math.round(PYSCENEDETECT_WINDOWS_ASSET_SIZE / 1024 / 1024)

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds - minutes * 60
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`
}

function SceneSplitterPanel(): JSX.Element {
  const [sourceVideos, setSourceVideos] = useState<string[]>([])
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.scene-splitter')
  const [detectorMode, setDetectorMode] = usePersistedState<SceneSplitterDetectorMode>(
    'tblao.scene-splitter.detectorMode',
    SCENE_SPLITTER_DEFAULTS.detectorMode
  )
  const [thresholdValue, setThresholdValue] = usePersistedState<number>(
    'tblao.scene-splitter.thresholdValue',
    SCENE_SPLITTER_DEFAULTS.contentThreshold
  )
  const [minSceneDuration, setMinSceneDuration] = usePersistedState<number>(
    'tblao.scene-splitter.minSceneDuration',
    SCENE_SPLITTER_DEFAULTS.minSceneDuration
  )
  const [engineStatus, setEngineStatus] = useState<SceneSplitterEngineStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<SceneSplitterInstallProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<SceneSplitterProgress | null>(null)
  const [result, setResult] = useState<SceneSplitterResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => window.api.onSceneSplitterProgress(setProgress), [])
  useEffect(() => window.api.onSceneSplitterInstallProgress(setInstallProgress), [])

  const refreshEngine = async (): Promise<void> => {
    try {
      setEngineStatus(await window.api.sceneSplitterEngineStatus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setEngineStatus(null)
    }
  }

  useEffect(() => {
    void refreshEngine()
  }, [])

  const engineReady = Boolean(engineStatus?.has && !engineStatus.needsUpdate)
  const canRun =
    engineReady &&
    sourceVideos.length > 0 &&
    Boolean(outputDir.trim()) &&
    (detectorMode === 'content' || detectorMode === 'hybrid') &&
    Number.isFinite(thresholdValue) &&
    thresholdValue >= 1 &&
    thresholdValue <= 60 &&
    Number.isFinite(minSceneDuration) &&
    minSceneDuration >= 0.1 &&
    minSceneDuration <= 10 &&
    !running &&
    !installing

  const summary = useMemo(() => {
    const scenes = result?.scenes ?? []
    const totalDuration = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0)
    return { count: scenes.length, totalDuration }
  }, [result])

  const chooseVideos = async (): Promise<void> => {
    const files = (await window.api.chooseFiles()) as string[]
    const videos = files.filter((path) => /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v)$/i.test(path))
    if (videos.length) setSourceVideos((current) => [...new Set([...current, ...videos])])
  }

  const chooseOutput = async (): Promise<void> => {
    const directory = await window.api.chooseFolder()
    if (directory) setOutputDir(directory)
  }

  const install = async (): Promise<void> => {
    setInstalling(true)
    setInstallProgress({ phase: 'downloading', message: 'Đang chuẩn bị tải…', percent: 0 })
    setError('')
    try {
      const installResult = await window.api.sceneSplitterInstallEngine()
      if (!installResult.ok) throw new Error(installResult.error || 'Cài PySceneDetect thất bại.')
      await refreshEngine()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setInstalling(false)
    }
  }

  const run = async (): Promise<void> => {
    if (!canRun) return
    setRunning(true)
    setCancelling(false)
    setError('')
    setResult(null)
    setProgress({ phase: 'detecting', percent: 0, message: 'Đang khởi tạo…' })
    try {
      const runResult = await window.api.runSceneSplitter({
        sourceVideos,
        outputDir,
        detectorMode,
        thresholdValue,
        minSceneDuration
      })
      setResult(runResult)
      if (!runResult.ok && !runResult.cancelled) setError(runResult.error || 'Tách cảnh thất bại.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
      setCancelling(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (!running || cancelling) return
    setCancelling(true)
    setProgress((current) => ({
      phase: current?.phase ?? 'detecting',
      percent: current?.percent ?? 0,
      message: 'Đang dừng cả PySceneDetect và FFmpeg…'
    }))
    try {
      await window.api.cancelSceneSplitter()
    } catch {
      setCancelling(false)
    }
  }

  if (engineStatus && (!engineStatus.has || engineStatus.needsUpdate)) {
    return (
      <div className="scene-splitter-setup">
        <div className="card scene-splitter-install-card">
          <div className="scene-splitter-install-icon">✂️</div>
          <h2>{engineStatus.has ? 'Phiên bản PySceneDetect chưa tương thích' : 'Cần công cụ Tách cảnh'}</h2>
          <p className="muted">
            {engineStatus.has && <>Đang có phiên bản {engineStatus.version}; </>}
            cần PySceneDetect {PYSCENEDETECT_VERSION} portable ({ENGINE_SIZE_MB} MiB).
            Video chỉ được xử lý cục bộ trên máy và không gửi lên dịch vụ AI.
          </p>
          {engineStatus.installSupported ? (
            installing ? (
              <div className="scene-splitter-install-progress">
                <div className="bar">
                  <div
                    className={`bar-fill ${installProgress?.percent === -1 ? 'indeterminate' : ''}`}
                    style={installProgress?.percent !== -1 ? { width: `${installProgress?.percent ?? 0}%` } : undefined}
                  />
                </div>
                <p className="muted small">{installProgress?.message}</p>
              </div>
            ) : (
              <button className="btn primary" type="button" onClick={install}>
                {engineStatus.has ? 'Cài bản tương thích' : 'Tải'} PySceneDetect {PYSCENEDETECT_VERSION}
              </button>
            )
          ) : (
            <p className="error-box">
              Trên macOS/Linux, cài <code>scenedetect[opencv]=={PYSCENEDETECT_VERSION}</code> bằng Python rồi mở lại ứng dụng.
            </p>
          )}
          {error && <div className="error-box">{error}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="lam-viec scene-splitter-workspace">
      <div className="cot-cauhinh">
        <div className="card scene-splitter-card">
          <div className="scene-splitter-card-head">
            <div>
              <strong>🎬 Video nguồn</strong>
              <span className="muted small">{sourceVideos.length} file</span>
            </div>
            <div className="scene-splitter-actions">
              <button className="btn primary small-btn" type="button" onClick={chooseVideos} disabled={running}>
                Thêm file
              </button>
              {sourceVideos.length > 0 && (
                <button className="btn small-btn" type="button" onClick={() => setSourceVideos([])} disabled={running}>
                  Xóa hết
                </button>
              )}
            </div>
          </div>
          {sourceVideos.length ? (
            <div className="scene-splitter-files">
              {sourceVideos.map((path) => (
                <div className="scene-splitter-file" key={path} title={path}>
                  <span>{fileName(path)}</span>
                  <button
                    className="scene-splitter-remove"
                    type="button"
                    aria-label={`Xóa ${fileName(path)}`}
                    onClick={() => setSourceVideos((current) => current.filter((item) => item !== path))}
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
        </div>

        <div className="card scene-splitter-card">
          <strong>🎯 Thuật toán cắt cảnh</strong>
          <div className="scene-splitter-modes">
            <button
              className={`scene-splitter-mode ${detectorMode === 'content' ? 'active content' : ''}`}
              type="button"
              onClick={() => setDetectorMode('content')}
              disabled={running}
            >
              <span className="scene-splitter-mode-title">🌟 Content <em>Khuyên dùng</em></span>
              <small>Hard cut theo mức thay đổi khung hình. Phù hợp phần lớn video.</small>
            </button>
            <button
              className={`scene-splitter-mode ${detectorMode === 'hybrid' ? 'active hybrid' : ''}`}
              type="button"
              onClick={() => setDetectorMode('hybrid')}
              disabled={running}
            >
              <span className="scene-splitter-mode-title">⚡ Hybrid <em>Tối ưu nhất</em></span>
              <small>Kết hợp Content và Adaptive để bắt thêm chuyển cảnh khó.</small>
            </button>
          </div>
        </div>

        <div className="card scene-splitter-card">
          <label className="scene-splitter-label" htmlFor="scene-splitter-output">📁 Thư mục phân cảnh</label>
          <div className="scene-splitter-folder-row">
            <input id="scene-splitter-output" className="folder-input" value={outputDir} readOnly placeholder="Chọn thư mục lưu…" />
            <button className="btn small-btn" type="button" onClick={chooseOutput} disabled={running}>Duyệt</button>
          </div>
        </div>

        <div className="card scene-splitter-card">
          <div className="scene-splitter-parameters">
            <label>
              <span>🎚️ Ngưỡng nhạy</span>
              {detectorMode === 'content' ? (
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={thresholdValue}
                  onChange={(event) => setThresholdValue(Number(event.target.value))}
                  disabled={running}
                />
              ) : (
                <input type="text" value="content: 27.0 | adaptive: 3.0" readOnly />
              )}
              <small>{detectorMode === 'content' ? 'Mặc định: 27.0 · thường 20–30' : 'Giữ nguyên chuẩn MediaStudio'}</small>
            </label>
            <label>
              <span>⏱️ Cảnh tối thiểu</span>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={minSceneDuration}
                onChange={(event) => setMinSceneDuration(Number(event.target.value))}
                disabled={running}
              />
              <small>Mặc định: 0,6 giây</small>
            </label>
          </div>
        </div>

        <div className="card scene-splitter-run-card">
          <div className="scene-splitter-engine-line">
            <span className={`scene-splitter-engine-dot ${engineStatus?.needsUpdate ? 'warning' : ''}`} />
            <span>
              PySceneDetect {engineStatus?.version ?? 'đang kiểm tra'} · CRF 17 / preset slow
            </span>
            {engineStatus?.needsUpdate && engineStatus.installSupported && !installing && (
              <button className="btn small-btn" type="button" onClick={install}>
                Cập nhật {PYSCENEDETECT_VERSION}
              </button>
            )}
          </div>
          {installing && (
            <div className="scene-splitter-update-progress">
              <div className="bar mini">
                <div
                  className={`bar-fill ${installProgress?.percent === -1 ? 'indeterminate' : ''}`}
                  style={installProgress?.percent !== -1 ? { width: `${installProgress?.percent ?? 0}%` } : undefined}
                />
              </div>
              <span className="muted small">{installProgress?.message}</span>
            </div>
          )}
          <div className="scene-splitter-run-actions">
            <button className="btn primary" type="button" disabled={!canRun} onClick={run}>
              {running ? 'Đang tách cảnh…' : '🚀 Bắt đầu'}
            </button>
            {running && (
              <button className="btn danger" type="button" disabled={cancelling} onClick={cancel}>
                {cancelling ? 'Đang dừng…' : '■ Dừng'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="cot-ketqua scene-splitter-results">
        <div className="cot-tieude">Tiến trình &amp; kết quả</div>
        {(running || progress) && (
          <div className={`card scene-splitter-progress ${progress?.phase ?? ''}`}>
            <div className="scene-splitter-progress-head">
              <strong>{progress?.phase === 'done' ? '✓ Hoàn tất' : progress?.phase === 'cancelled' ? 'Đã dừng' : 'Đang xử lý'}</strong>
              <span>{progress?.percent ?? 0}%</span>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
            </div>
            <p className="muted small">{progress?.message}</p>
          </div>
        )}

        {error && <div className="error-box"><b>Lỗi:</b> {error}</div>}

        {summary.count > 0 ? (
          <div className="card scene-splitter-result-card">
            <div className="scene-splitter-result-head">
              <div>
                <strong>📋 Phân cảnh ({summary.count})</strong>
                <span className="muted small">Tổng thời lượng {formatDuration(summary.totalDuration)}</span>
              </div>
              <div className="scene-splitter-actions">
                {result?.manifestFile && (
                  <button className="btn small-btn" type="button" onClick={() => window.api.showItem(result.manifestFile!)}>
                    Danh sách JSON
                  </button>
                )}
                <button className="btn small-btn" type="button" onClick={() => window.api.openPath(result?.outputDir ?? outputDir)}>
                  Mở thư mục
                </button>
              </div>
            </div>
            <div className="scene-splitter-table-wrap">
              <table className="scene-splitter-table">
                <thead>
                  <tr><th>Tên cảnh</th><th>Nguồn</th><th>Bắt đầu</th><th>Thời lượng</th><th /></tr>
                </thead>
                <tbody>
                  {result?.scenes?.map((scene) => (
                    <tr key={scene.filePath}>
                      <td><b>{scene.fileName}</b></td>
                      <td title={scene.sourceVideo}>{fileName(scene.sourceVideo)}</td>
                      <td>{formatDuration(scene.startSeconds)}</td>
                      <td>{formatDuration(scene.durationSeconds)}</td>
                      <td><button className="scene-splitter-link" type="button" onClick={() => window.api.showItem(scene.filePath)}>Mở</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : !running && !error ? (
          <div className="empty scene-splitter-empty">
            <div className="empty-title">Chưa có kết quả</div>
            <div className="muted small">Chọn video, thuật toán và thư mục lưu rồi bấm <b>Bắt đầu</b>.</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const sceneSplitterRendererFeature = {
  ...FEATURE_META,
  component: SceneSplitterPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
