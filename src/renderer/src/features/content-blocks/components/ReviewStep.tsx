import { useState, type JSX } from 'react'
import type {
  ContentBlockEditOperation,
  SourceBlockManifest
} from '../../../../../shared/features/content-blocks.ts'

export interface ReviewStepProps {
  manifest: SourceBlockManifest
  running: boolean
  onEdit(operation: ContentBlockEditOperation): void
}

function seconds(valueUs: number): number {
  return Number((valueUs / 1_000_000).toFixed(3))
}

function BoundaryEditor({ blockId, selectedUs, locked, running, onEdit }: {
  blockId: string
  selectedUs: number
  locked: boolean
  running: boolean
  onEdit: (operation: ContentBlockEditOperation) => void
}): JSX.Element {
  const [value, setValue] = useState(seconds(selectedUs))
  return (
    <div className="content-blocks-boundary-editor">
      <label>
        <span>Boundary (giây)</span>
        <input
          type="number"
          min="0"
          step="0.001"
          value={value}
          disabled={running}
          onChange={(event) => setValue(Number(event.target.value))}
          onBlur={() => onEdit({ kind: 'set-boundary', blockId, selectedUs: Math.round(value * 1_000_000), locked })}
        />
      </label>
      <label className="content-blocks-checkbox">
        <input
          type="checkbox"
          checked={locked}
          disabled={running}
          onChange={(event) => onEdit({ kind: 'set-boundary', blockId, selectedUs: Math.round(value * 1_000_000), locked: event.target.checked })}
        />
        Khóa boundary
      </label>
    </div>
  )
}

export default function ReviewStep({ manifest, running, onEdit }: ReviewStepProps): JSX.Element {
  return (
    <section className="content-blocks-review-list">
      {manifest.blocks.map((block, index) => (
        <article className={`card content-blocks-review-card ${block.boundary.reviewState}`} key={block.id}>
          <div className="content-blocks-review-head">
            <div>
              <strong>{block.id}</strong>
              <span className={`content-blocks-status ${block.boundary.reviewState}`}>{block.boundary.reviewState}</span>
            </div>
            {index < manifest.blocks.length - 1 && (
              <button className="btn small-btn" type="button" disabled={running} onClick={() => onEdit({ kind: 'merge', leftBlockId: block.id, rightBlockId: manifest.blocks[index + 1].id })}>
                Gộp block kế
              </button>
            )}
          </div>
          <div className="content-blocks-source-range">
            Source {seconds(block.sourceRange.startUs)}s → {seconds(block.sourceRange.endUs)}s · boundary {block.boundary.reason}
          </div>
          <div className="content-blocks-cues">
            {block.dialogue.map((cue, cueIndex) => (
              <div className="content-blocks-cue" key={cue.cueId}>
                <span className="content-blocks-cue-id">{cue.cueId} · {cue.role}</span>
                <span>{cue.text}</span>
                <small>{seconds(cue.sourceStartUs)}s → {seconds(cue.sourceEndUs)}s</small>
                {cueIndex < block.dialogue.length - 1 && (
                  <button className="btn tiny-btn" type="button" disabled={running} onClick={() => onEdit({ kind: 'split', blockId: block.id, afterCueId: cue.cueId })}>
                    Tách sau cue
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="content-blocks-review-controls">
            <BoundaryEditor blockId={block.id} selectedUs={block.boundary.selectedUs} locked={block.boundary.reviewState === 'locked'} running={running} onEdit={onEdit} />
            <label>
              <span>Vai trò</span>
              <select
                value={block.semantic.role}
                disabled={running}
                onChange={(event) => onEdit({ kind: 'set-semantic', blockId: block.id, role: event.target.value as typeof block.semantic.role, shuffleEligible: block.semantic.shuffleEligible, requiresPreviousBlockId: block.semantic.requiresPreviousBlockId })}
              >
                <option value="normal">normal</option>
                <option value="intro">intro</option>
                <option value="outro">outro</option>
                <option value="cta">cta</option>
              </select>
            </label>
            <label className="content-blocks-checkbox">
              <input
                type="checkbox"
                checked={block.semantic.shuffleEligible}
                disabled={running || block.semantic.role === 'intro'}
                onChange={(event) => onEdit({ kind: 'set-semantic', blockId: block.id, role: block.semantic.role, shuffleEligible: event.target.checked, requiresPreviousBlockId: block.semantic.requiresPreviousBlockId })}
              />
              Cho phép shuffle
            </label>
            <label>
              <span>Phụ thuộc block trước</span>
              <select
                value={block.semantic.requiresPreviousBlockId ?? ''}
                disabled={running || block.semantic.role !== 'normal'}
                onChange={(event) => onEdit({ kind: 'set-semantic', blockId: block.id, role: block.semantic.role, shuffleEligible: block.semantic.shuffleEligible, requiresPreviousBlockId: event.target.value || null })}
              >
                <option value="">Không</option>
                {manifest.blocks.slice(0, index).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.id}</option>)}
              </select>
            </label>
          </div>
          {block.issues.length > 0 && <div className="content-blocks-issues">{block.issues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
        </article>
      ))}
    </section>
  )
}
