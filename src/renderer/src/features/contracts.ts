import type { ComponentType } from 'react'
import {
  isReservedFeatureId,
  type FeatureMetadata
} from '../../../shared/features/contracts'

export interface RendererFeature<Id extends string = string> extends FeatureMetadata<Id> {
  component: ComponentType
}

/** Kiem tra som de app khong khoi dong voi hai tab cung ID. */
export function assertRendererFeatureRegistry(features: readonly RendererFeature[]): void {
  const ids = new Set<string>()
  for (const feature of features) {
    if (isReservedFeatureId(feature.id)) {
      throw new Error(`Renderer feature ID "${feature.id}" trung core.`)
    }
    if (ids.has(feature.id)) throw new Error(`Renderer feature ID bi trung: ${feature.id}`)
    ids.add(feature.id)
  }
}
