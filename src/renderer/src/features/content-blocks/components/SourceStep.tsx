import type { JSX } from 'react'

type SourceField = 'projectDir' | 'videoPath' | 'srtPath' | 'sceneManifestPath'

export interface SourceStepProps {
  projectDir: string
  videoPath: string
  srtPath: string
  sceneManifestPath: string
  running: boolean
  canAnalyze: boolean
  onChange(field: SourceField, value: string): void
  onPick(field: SourceField): void
  onAnalyze(): void
}

function pathRow(
  label: string,
  value: string,
  field: SourceField,
  onChange: SourceStepProps['onChange'],
  onPick: SourceStepProps['onPick'],
  running: boolean
): JSX.Element {
  return (
    <label className="content-blocks-field">
      <span>{label}</span>
      <div className="content-blocks-path-row">
        <input value={value} disabled={running} onChange={(event) => onChange(field, event.target.value)} />
        <button className="btn" type="button" disabled={running} onClick={() => onPick(field)}>Chọn</button>
      </div>
    </label>
  )
}

export default function SourceStep(props: SourceStepProps): JSX.Element {
  return (
    <section className="card content-blocks-card">
      <div className="content-blocks-section-head">
        <div>
          <strong>1. Phân tích source</strong>
          <span className="muted small">Tạo manifest block mà không cắt hoặc encode lại video.</span>
        </div>
        <button className="btn primary" type="button" disabled={!props.canAnalyze} onClick={props.onAnalyze}>Phân tích</button>
      </div>
      <div className="content-blocks-fields-grid">
        {pathRow('Thư mục project Content Block', props.projectDir, 'projectDir', props.onChange, props.onPick, props.running)}
        {pathRow('Video source', props.videoPath, 'videoPath', props.onChange, props.onPick, props.running)}
        {pathRow('Source SRT', props.srtPath, 'srtPath', props.onChange, props.onPick, props.running)}
        {pathRow('scene-splitter.json', props.sceneManifestPath, 'sceneManifestPath', props.onChange, props.onPick, props.running)}
      </div>
      <p className="content-blocks-notice">
        Shuffle chỉ là thao tác biên tập. Bạn vẫn phải có quyền sử dụng source và tự chịu trách nhiệm với chính sách reused-content của nền tảng.
      </p>
    </section>
  )
}
