import type { JSX } from 'react'
import type { SourceBlockManifest, VariantPlan } from '../../../../../shared/features/content-blocks.ts'
import { defaultVariantConstraints } from '../model.ts'

export interface VariantStepProps {
  manifest: SourceBlockManifest
  variantId: string
  seed: string
  variant: VariantPlan | null
  running: boolean
  canCreate: boolean
  onVariantId(value: string): void
  onSeed(value: string): void
  onCreate(): void
}

export default function VariantStep(props: VariantStepProps): JSX.Element {
  const constraints = defaultVariantConstraints(props.manifest)
  const order = props.variant?.blockOrder ?? props.manifest.blocks.map((block) => block.id)
  return (
    <section className="card content-blocks-card">
      <div className="content-blocks-section-head">
        <div>
          <strong>4. Tạo variant deterministic</strong>
          <span className="muted small">Cùng seed và manifest sẽ cho cùng thứ tự block.</span>
        </div>
        <button className="btn primary" type="button" disabled={!props.canCreate} onClick={props.onCreate}>Tạo variant</button>
      </div>
      <div className="content-blocks-variant-form">
        <label className="content-blocks-field">
          <span>Variant ID</span>
          <input value={props.variantId} disabled={props.running} onChange={(event) => props.onVariantId(event.target.value)} />
        </label>
        <label className="content-blocks-field">
          <span>Seed</span>
          <input value={props.seed} disabled={props.running} onChange={(event) => props.onSeed(event.target.value)} />
        </label>
      </div>
      <div className="content-blocks-lock-summary">
        <span>Khóa đầu: <strong>{constraints.lockedStartBlockIds.join(', ') || 'không có'}</strong></span>
        <span>Khóa cuối: <strong>{constraints.lockedEndBlockIds.join(', ') || 'không có'}</strong></span>
        <span>Giữ dependency chain: <strong>Có</strong></span>
      </div>
      <div className="content-blocks-order-list">
        <div className="content-blocks-subhead">Thứ tự block</div>
        {order.map((blockId, index) => (
          <div className="content-blocks-order-row" key={blockId}>
            <span>{index + 1}</span>
            <strong>{blockId}</strong>
            <span className="muted">{props.manifest.blocks.find((block) => block.id === blockId)?.semantic.role ?? 'unknown'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
