import type { JSX } from 'react'
import type { SrtReviewCue } from '../../../../../shared/features/srt-translator.ts'

export interface ReviewStepProps {
  reviewCues: SrtReviewCue[]
  unresolvedCueNumbers: number[]
  selections: Record<number, string>
  canContinue: boolean
  onSelect(cueNumber: number, candidateId: string): void
  onResolve(): void
}

function reviewCuesToShow(reviewCues: readonly SrtReviewCue[], unresolved: readonly number[]): SrtReviewCue[] {
  const numbers = new Set(unresolved)
  return reviewCues.filter((cue) => numbers.has(cue.n) || cue.needsReview)
}

export default function ReviewStep({ reviewCues, unresolvedCueNumbers, selections, canContinue, onSelect, onResolve }: ReviewStepProps): JSX.Element {
  const cues = reviewCuesToShow(reviewCues, unresolvedCueNumbers)

  return (
    <section className="srt-translator-step-content">
      <div className="srt-translator-review-counter card">
        Còn {unresolvedCueNumbers.length} cue cần bạn chọn cách phục hồi trước khi dịch.
      </div>
      <div className="srt-translator-review-note card">
        Các phương án dưới đây chỉ được suy ra từ SRT: ngữ pháp, cue trước–sau, chủ đề, âm gần/đồng âm và thuật ngữ. Nếu không đủ dữ kiện, hãy giữ phương án thận trọng nhất.
      </div>
      <div className="srt-translator-review-list">
        {cues.map((cue) => (
          <article className="card srt-translator-review-card" key={cue.n}>
            <div className="srt-translator-review-head">
              <strong>#{cue.n} · {cue.time}</strong>
            </div>
            <details open>
              <summary>Xem chi tiết tiếng Trung</summary>
              <div className="srt-translator-source-text"><b>Gốc:</b> {cue.originalZh}</div>
              <div className="srt-translator-source-text"><b>Phục hồi đề xuất:</b> {cue.correctedZh}</div>
            </details>
            <p><b>Nghĩa tiếng Việt:</b> {cue.meaningVi}</p>
            {cue.evidenceVi && <p className="muted small"><b>Căn cứ từ SRT:</b> {cue.evidenceVi}</p>}
            <div className="srt-translator-candidate-list">
              {cue.candidates.slice(0, 3).map((candidate) => (
                <label className="srt-translator-candidate" key={candidate.id}>
                  <input
                    type="radio"
                    name={`cue-${cue.n}`}
                    checked={selections[cue.n] === candidate.id}
                    onChange={() => onSelect(cue.n, candidate.id)}
                  />
                  <span><b>{candidate.meaningVi}</b><small>{candidate.evidenceVi}</small></span>
                </label>
              ))}
            </div>
            <span className={`srt-translator-confidence confidence-${cue.confidence}`}>Độ tin cậy: {cue.confidence}</span>
          </article>
        ))}
      </div>
      <div className="srt-translator-actions">
        <button className="btn primary" type="button" onClick={onResolve} disabled={!canContinue}>Tiếp tục</button>
      </div>
    </section>
  )
}
