import { assertRendererFeatureRegistry, type RendererFeature } from './contracts'

// feature-scaffold:imports
import { capcutFactoryRendererFeature } from './capcut-factory'
import { sceneSplitterRendererFeature } from './scene-splitter'
import { mediaInspectorRendererFeature } from './media-inspector'

const registeredRendererFeatures = [
  // feature-scaffold:modules
  capcutFactoryRendererFeature,
  sceneSplitterRendererFeature,
  mediaInspectorRendererFeature,
] as const satisfies readonly RendererFeature[]

assertRendererFeatureRegistry(registeredRendererFeatures)

/** Danh sach rong giu nguyen UI; generator se them feature vao day. */
export const rendererFeatures: readonly RendererFeature[] = registeredRendererFeatures
type RegisteredRendererFeature = (typeof registeredRendererFeatures)[number]
export type RendererFeatureId = [RegisteredRendererFeature] extends [never]
  ? string
  : RegisteredRendererFeature['id']
