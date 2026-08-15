import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  FEATURE_ID,
  FEATURE_META,
  type CapCutFactoryEnvironment,
  type CapCutFactoryInputSet,
  type CapCutFactoryPreflightResult,
  type CapCutFactoryProgress,
  type CapCutFactoryRequest,
  type CapCutFactoryResult
} from '../../../../shared/features/capcut-factory'
import { usePersistedState } from '../../lib/persist'
import type { RendererFeature } from '../contracts'
import './styles.css'

function newInputSet(index: number): CapCutFactoryInputSet {
  return {
    id: crypto.randomUUID(),
    label: `Ngôn ngữ ${index}`,
    srtPath: '',
    voiceDir: ''
  }
}

function shortPath(path: string): string {
  if (!path) return 'Chưa chọn'
  const parts = path.split(/[\\/]/)
  return parts.length <= 3 ? path : `…${path.slice(-58)}`
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds - minutes * 60
  return minutes ? `${minutes}:${remainder.toFixed(1).padStart(4, '0')}` : `${seconds.toFixed(1)}s`
}

function CapCutFactoryPanel(): JSX.Element {
  const [videoPath, setVideoPath] = usePersistedState('tblao.capcut-factory.video', '')
  const [sceneDir, setSceneDir] = usePersistedState('tblao.capcut-factory.scene-dir', '')
  const [draftsDir, setDraftsDir] = usePersistedState('tblao.capcut-factory.drafts-dir', '')
  const [templateDir, setTemplateDir] = usePersistedState('tblao.capcut-factory.template-dir', '')
  const [projectPrefix, setProjectPrefix] = usePersistedState('tblao.capcut-factory.prefix', '')
  const [muteOriginalVideo, setMuteOriginalVideo] = usePersistedState(
    'tblao.capcut-factory.mute-video',
    true
  )
  const [inputSets, setInputSets] = usePersistedState<CapCutFactoryInputSet[]>(
    'tblao.capcut-factory.sets',
    [newInputSet(1)]
  )
  const [environment, setEnvironment] = useState<CapCutFactoryEnvironment | null>(null)
  const [preflight, setPreflight] = useState<CapCutFactoryPreflightResult | null>(null)
  const [progress, setProgress] = useState<CapCutFactoryProgress | null>(null)
  const [result, setResult] = useState<CapCutFactoryResult | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => window.api.onCapCutFactoryProgress(setProgress), [])
  useEffect(() => {
    void window.api
      .capCutFactoryDetectEnvironment()
      .then((detected) => {
        setEnvironment(detected)
        if (!draftsDir.trim() && detected.detectedDraftsDir) setDraftsDir(detected.detectedDraftsDir)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])

  const request = useMemo<CapCutFactoryRequest>(
    () => ({
      videoPath,
      sceneDir: sceneDir.trim() || null,
      draftsDir,
      templateDir: templateDir.trim() || null,
      projectPrefix: projectPrefix.trim() || null,
      muteOriginalVideo,
      sets: inputSets
    }),
    [videoPath, sceneDir, draftsDir, templateDir, projectPrefix, muteOriginalVideo, inputSets]
  )

  const invalidate = (): void => {
    setPreflight(null)
    setResult(null)
    setError('')
  }

  const updateSet = (id: string, patch: Partial<CapCutFactoryInputSet>): void => {
    setInputSets((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    invalidate()
  }

  const pickVideo = async (): Promise<void> => {
    const selected = await window.api.capCutFactoryPickPath('video')
    if (selected) {
      setVideoPath(selected)
      invalidate()
    }
  }

  const pickDirectory = async (apply: (path: string) => void): Promise<void> => {
    const selected = await window.api.capCutFactoryPickPath('directory')
    if (selected) {
      apply(selected)
      invalidate()
    }
  }

  const inspect = async (): Promise<void> => {
    setInspecting(true)
    setError('')
    setResult(null)
    try {
      setPreflight(await window.api.inspectCapCutFactory(request))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setInspecting(false)
    }
  }

  const run = async (): Promise<void> => {
    setRunning(true)
    setCancelling(false)
    setError('')
    setResult(null)
    try {
      const checked = await window.api.inspectCapCutFactory(request)
      setPreflight(checked)
      if (!checked.ok) return
      const generated = await window.api.runCapCutFactory(request)
      setResult(generated)
      if (!generated.ok && !generated.cancelled && generated.error) setError(generated.error)
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
      await window.api.cancelCapCutFactory()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setCancelling(false)
    }
  }

  const canInspect = Boolean(videoPath.trim() && draftsDir.trim() && inputSets.length)
  const successfulProjects = result?.projects.filter((project) => project.ok).length ?? 0

  return (
    <div className="capcut-factory-workspace capcut-factory-scroll">
      <section className="card capcut-factory-card">
        <div className="capcut-factory-section-head">
          <div>
            <strong>1. Video dùng chung</strong>
            <span className="muted small">Chọn đầu ra sau bước cắt/làm mờ hiện tại.</span>
          </div>
          <button className="btn" type="button" disabled={running} onClick={pickVideo}>
            Chọn video
          </button>
        </div>
        <div className={`capcut-factory-path ${videoPath ? 'selected' : ''}`} title={videoPath}>
          {shortPath(videoPath)}
        </div>
        <label>
          <span>Thư mục scene đã tách (tùy chọn)</span>
          <div className="capcut-factory-input-row">
            <input
              value={sceneDir}
              disabled={running}
              onChange={(event) => {
                setSceneDir(event.target.value)
                invalidate()
              }}
              placeholder="Thư mục có scene-splitter.json"
            />
            <button className="btn" type="button" disabled={running} onClick={() => pickDirectory(setSceneDir)}>
              Chọn
            </button>
          </div>
          <small className="muted">
            Chọn output của tab Tách cảnh để timeline CapCut hiển thị từng scene riêng. Cue đi qua nhiều scene sẽ được liên kết logic; voice không bị cắt.
          </small>
        </label>
        <label className="check capcut-factory-check">
          <input
            type="checkbox"
            checked={muteOriginalVideo}
            disabled={running}
            onChange={(event) => {
              setMuteOriginalVideo(event.target.checked)
              invalidate()
            }}
          />
          Tắt tiếng gốc của video trong project CapCut
        </label>
      </section>

      <section className="card capcut-factory-card">
        <div className="capcut-factory-section-head">
          <div>
            <strong>2. Cấu hình CapCut</strong>
            <span className="muted small">Không lưu username/ổ đĩa trong mã nguồn; có thể cấu hình lại trên máy khác.</span>
          </div>
          {environment?.capCutVersion && <span className="capcut-factory-badge">CapCut {environment.capCutVersion}</span>}
        </div>
        <div className="capcut-factory-config-grid">
          <label>
            <span>Thư mục chứa project</span>
            <div className="capcut-factory-input-row">
              <input
                value={draftsDir}
                disabled={running}
                onChange={(event) => {
                  setDraftsDir(event.target.value)
                  invalidate()
                }}
                placeholder="…/Projects/com.lveditor.draft"
              />
              <button className="btn" type="button" disabled={running} onClick={() => pickDirectory(setDraftsDir)}>
                Chọn
              </button>
            </div>
            {environment?.detectedDraftsDir && environment.detectedDraftsDir === draftsDir && (
              <small className="ok-text">Đã tự phát hiện trên máy này</small>
            )}
          </label>
          <label>
            <span>Template CapCut của máy này (bắt buộc)</span>
            <div className="capcut-factory-input-row">
              <input
                value={templateDir}
                disabled={running}
                onChange={(event) => {
                  setTemplateDir(event.target.value)
                  invalidate()
                }}
                placeholder="Chọn thư mục một project mẫu CapCut"
              />
              <button className="btn" type="button" disabled={running} onClick={() => pickDirectory(setTemplateDir)}>
                Chọn
              </button>
            </div>
            <small className="muted">Tạo project mẫu trên chính CapCut máy này, có ít nhất một video, một voice và một subtitle. Hệ thống chỉ lấy schema native và style subtitle; project mới sẽ dùng toàn bộ media, voice, scene và SRT được chọn.</small>
          </label>
          <label>
            <span>Tiền tố tên project</span>
            <input
              value={projectPrefix}
              disabled={running}
              onChange={(event) => {
                setProjectPrefix(event.target.value)
                invalidate()
              }}
              placeholder="Mặc định: tên video"
            />
          </label>
        </div>
      </section>

      <section className="card capcut-factory-card">
        <div className="capcut-factory-section-head">
          <div>
            <strong>3. Các bộ ngôn ngữ</strong>
            <span className="muted small">Mỗi bộ tạo một project độc lập; không giới hạn cố định ở 5 bộ.</span>
          </div>
          <button
            className="btn"
            type="button"
            disabled={running}
            onClick={() => {
              setInputSets((current) => [...current, newInputSet(current.length + 1)])
              invalidate()
            }}
          >
            + Thêm bộ
          </button>
        </div>
        <div className="capcut-factory-set-list">
          {inputSets.map((input, index) => {
            const checked = preflight?.sets.find((item) => item.id === input.id)
            return (
              <article className={`capcut-factory-set ${checked?.error ? 'invalid' : checked ? 'valid' : ''}`} key={input.id}>
                <div className="capcut-factory-set-head">
                  <label>
                    <span>Tên quốc gia / ngôn ngữ</span>
                    <input
                      value={input.label}
                      disabled={running}
                      onChange={(event) => updateSet(input.id, { label: event.target.value })}
                      placeholder={`Ngôn ngữ ${index + 1}`}
                    />
                  </label>
                  <button
                    className="capcut-factory-remove"
                    type="button"
                    disabled={running}
                    title="Xóa bộ này"
                    onClick={() => {
                      setInputSets((current) => current.filter((item) => item.id !== input.id))
                      invalidate()
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="capcut-factory-set-grid">
                  <div>
                    <span className="capcut-factory-label">File SRT</span>
                    <button
                      className="capcut-factory-picker"
                      type="button"
                      disabled={running}
                      title={input.srtPath}
                      onClick={async () => {
                        const selected = await window.api.capCutFactoryPickPath('srt')
                        if (selected) updateSet(input.id, { srtPath: selected })
                      }}
                    >
                      <span>{shortPath(input.srtPath)}</span>
                      <b>Chọn</b>
                    </button>
                  </div>
                  <div>
                    <span className="capcut-factory-label">Voice Folder</span>
                    <button
                      className="capcut-factory-picker"
                      type="button"
                      disabled={running}
                      title={input.voiceDir}
                      onClick={() => pickDirectory((path) => updateSet(input.id, { voiceDir: path }))}
                    >
                      <span>{shortPath(input.voiceDir)}</span>
                      <b>Chọn</b>
                    </button>
                  </div>
                </div>
                {checked && (
                  <div className={`capcut-factory-set-status ${checked.error ? 'error' : 'ok'}`}>
                    {checked.error
                      ? checked.error
                      : `${checked.matchedCount}/${checked.cueCount} voice khớp · ${checked.projectName}`}
                    {!checked.error && checked.sceneGroupCount !== undefined && (
                      <small>{checked.sceneGroupCount} nhóm scene logic · giữ nguyên voice, chỉ liên kết theo timeline</small>
                    )}
                    {checked.warnings.map((warning) => <small key={warning}>{warning}</small>)}
                  </div>
                )}
              </article>
            )
          })}
          {inputSets.length === 0 && <div className="muted capcut-factory-empty">Bấm “+ Thêm bộ” để bắt đầu.</div>}
        </div>
      </section>

      <section className="card capcut-factory-run-card">
        <div className="capcut-factory-run-actions">
          <button className="btn" type="button" disabled={!canInspect || inspecting || running} onClick={inspect}>
            {inspecting ? 'Đang kiểm tra…' : 'Kiểm tra đầu vào'}
          </button>
          <button className="btn primary" type="button" disabled={!canInspect || inspecting || running} onClick={run}>
            {running ? 'Đang tạo project…' : `Tạo ${inputSets.length || 0} project CapCut`}
          </button>
          {running && (
            <button className="btn danger" type="button" disabled={cancelling} onClick={cancel}>
              {cancelling ? 'Đang dừng…' : 'Dừng'}
            </button>
          )}
        </div>
        <p className="muted small capcut-factory-note">
          Đóng CapCut trước khi tạo. Video và voice được copy vào từng draft để tránh mất liên kết khi di chuyển file gốc.
        </p>
      </section>

      {preflight && (
        <section className={`card capcut-factory-summary ${preflight.ok ? 'ready' : 'blocked'}`}>
          <strong>{preflight.ok ? 'Đầu vào sẵn sàng' : 'Cần sửa đầu vào'}</strong>
          {preflight.video && (
            <span className="muted small">
              {preflight.video.width}×{preflight.video.height} · {preflight.video.fps.toFixed(2)} fps · {formatDuration(preflight.video.durationSeconds)}
            </span>
          )}
          {preflight.sceneCount && <span className="muted small">{preflight.sceneCount} scene video trên timeline</span>}
          {preflight.sceneGroupCount && (
            <span className="muted small">{preflight.sceneGroupCount} nhóm scene logic, không cắt voice</span>
          )}
          {preflight.crossSceneCueCount && (
            <span className="muted small">{preflight.crossSceneCueCount} cue đi qua ranh giới scene</span>
          )}
          {[...preflight.errors, ...preflight.warnings].map((message) => <p key={message}>{message}</p>)}
        </section>
      )}

      {progress && (
        <section className="card capcut-factory-progress">
          <div>
            <strong>{progress.message}</strong>
            <span className="muted small">{progress.completedProjects}/{progress.totalProjects} project hoàn tất</span>
          </div>
          <div className="progress-track"><div style={{ width: `${progress.percent}%` }} /></div>
        </section>
      )}

      {result && (
        <section className="card capcut-factory-results">
          <div className="capcut-factory-section-head">
            <div>
              <strong>{result.ok ? 'Đã tạo xong' : result.cancelled ? 'Batch đã dừng' : 'Kết quả chưa hoàn tất'}</strong>
              <span className="muted small">{successfulProjects}/{result.projects.length} project đạt kiểm tra</span>
            </div>
            {result.draftsDir && (
              <button className="btn" type="button" onClick={() => window.api.openPath(result.draftsDir!)}>
                Mở thư mục CapCut
              </button>
            )}
          </div>
          <div className="capcut-factory-result-list">
            {result.projects.map((project) => (
              <div className={`capcut-factory-result ${project.ok ? 'ok' : 'error'}`} key={project.inputSetId}>
                <span>{project.ok ? '✓' : '!'}</span>
                <div>
                  <strong>{project.projectName}</strong>
                  {project.error && <small>{project.error}</small>}
                  {project.warnings.map((warning) => <small key={warning}>{warning}</small>)}
                </div>
                {project.projectPath && (
                  <button type="button" onClick={() => window.api.openPath(project.projectPath!)}>Mở</button>
                )}
                {project.sceneLinkManifestPath && (
                  <button type="button" onClick={() => window.api.openPath(project.sceneLinkManifestPath!)}>Map scene</button>
                )}
                {project.portableManifestPath && (
                  <button type="button" onClick={() => window.api.openPath(project.portableManifestPath!)}>Portable</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <div className="error-box">{error}</div>}
    </div>
  )
}

export const capcutFactoryRendererFeature = {
  ...FEATURE_META,
  component: CapCutFactoryPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
