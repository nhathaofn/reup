import type { JSX } from 'react'
import { FEATURE_ID, FEATURE_META } from '../../../../shared/features/content-blocks'
import type { RendererFeature } from '../contracts'

function ContentBlocksStatusPanel(): JSX.Element {
  return (
    <section className="panel">
      <div className="card">
        <strong>Content Block V1 đang được xây theo manifest-first.</strong>
        <p className="muted">Chưa có thao tác nào được bật trong phiên bản phát triển này.</p>
      </div>
    </section>
  )
}

export const contentBlocksRendererFeature = {
  ...FEATURE_META,
  component: ContentBlocksStatusPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
