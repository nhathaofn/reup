import type { JSX } from 'react'
import type { ContentBlockCapCutExportResult, RenderTimeline } from '../../../../../shared/features/content-blocks.ts'

type ExportField = 'draftsDir' | 'templateDir' | 'projectName'

export interface ExportStepProps {
  timeline: RenderTimeline | null
  subtitlePath: string
  draftsDir: string
  templateDir: string
  projectName: string
  result: ContentBlockCapCutExportResult | null
  running: boolean
  canBuild: boolean
  canExport: boolean
  onBuildTimeline(): void
  onPickDirectory(field: 'draftsDir' | 'templateDir'): void
  onChange(field: ExportField, value: string): void
  onExport(): void
  onOpenPath?(path: string): void
}

function seconds(valueUs: number): string {
  return `${(valueUs / 1_000_000).toFixed(3)}s`
}

function outputButton(label: string, path: string | undefined, onOpenPath: ExportStepProps['onOpenPath']): JSX.Element | null {
  if (!path) return null
  return <button className="btn small-btn" type="button" onClick={() => onOpenPath?.(path)}>{label}</button>
}

export default function ExportStep(props: ExportStepProps): JSX.Element {
  return (
    <section className="card content-blocks-card">
      <div className="content-blocks-section-head">
        <div>
          <strong>5. Timeline và CapCut</strong>
          <span className="muted small">Timeline trung lập là nguồn duy nhất để adapter tạo draft.</span>
        </div>
        <div className="content-blocks-action-group">
          <button className="btn" type="button" disabled={!props.canBuild} onClick={props.onBuildTimeline}>Build timeline + SRT</button>
          <button className="btn primary" type="button" disabled={!props.canExport} onClick={props.onExport}>Xuất CapCut</button>
        </div>
      </div>
      <div className="content-blocks-export-grid">
        {(['draftsDir', 'templateDir'] as const).map((field) => {
          const label = field === 'draftsDir' ? 'Thư mục CapCut drafts' : 'Thư mục template CapCut'
          const value = props[field]
          return (
            <label className="content-blocks-field" key={field}>
              <span>{label}</span>
              <div className="content-blocks-path-row">
                <input value={value} disabled={props.running} onChange={(event) => props.onChange(field, event.target.value)} />
                <button className="btn" type="button" disabled={props.running} onClick={() => props.onPickDirectory(field)}>Chọn</button>
              </div>
            </label>
          )
        })}
        <label className="content-blocks-field">
          <span>Tên project</span>
          <input value={props.projectName} disabled={props.running} onChange={(event) => props.onChange('projectName', event.target.value)} />
        </label>
      </div>
      {props.subtitlePath && (
        <div className="content-blocks-output-row">
          <span>Generated SRT: <strong>{props.subtitlePath}</strong></span>
          {outputButton('Mở SRT', props.subtitlePath, props.onOpenPath)}
        </div>
      )}
      {!props.timeline ? (
        <p className="muted">Chưa có timeline. Hãy build sau khi đã có locale và variant.</p>
      ) : (
        <div className="content-blocks-timeline-list">
          <div className="content-blocks-subhead">Review timeline</div>
          {props.timeline.items.map((item) => (
            <div className={`content-blocks-timeline-row ${item.adaptation === 'needs-review' ? 'needs-review' : ''}`} key={item.blockId}>
              <strong>{item.blockId}</strong>
              <span>Source {seconds(item.sourceEndUs - item.sourceStartUs)}</span>
              <span>Target {seconds(item.timelineEndUs - item.timelineStartUs)}</span>
              <span>{item.mediaSpeed.toFixed(3)}× · {item.adaptation}</span>
              {item.warnings.length > 0 && <small>{item.warnings.join(' · ')}</small>}
            </div>
          ))}
          {props.timeline.reviewBlockIds.length > 0 && (
            <div className="content-blocks-result error-text">Cần review: {props.timeline.reviewBlockIds.join(', ')}</div>
          )}
        </div>
      )}
      {props.result?.ok && (
        <div className="content-blocks-result ok-text">
          Đã tạo {props.result.videoSegmentCount ?? 0} video segment, {props.result.audioSegmentCount ?? 0} voice segment và {props.result.textSegmentCount ?? 0} subtitle segment.
          <div className="content-blocks-action-group">
            {outputButton('Mở project', props.result.projectPath, props.onOpenPath)}
            {outputButton('Mở manifest', props.result.portableManifestPath, props.onOpenPath)}
          </div>
        </div>
      )}
      {props.result?.warnings && props.result.warnings.length > 0 && (
        <div className="content-blocks-result warning-text">{props.result.warnings.join(' · ')}</div>
      )}
    </section>
  )
}
