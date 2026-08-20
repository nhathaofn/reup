import { assertRendererFeatureRegistry, type RendererFeature } from './contracts'

// feature-scaffold:imports
import { autoShortRendererFeature } from './auto-short'
import { capcutFactoryRendererFeature } from './capcut-factory'
import { sceneSplitterRendererFeature } from './scene-splitter'
import { mediaInspectorRendererFeature } from './media-inspector'
import { multiLangShortRendererFeature } from './multilang-short'

const registeredRendererFeatures = [
  // feature-scaffold:modules
  autoShortRendererFeature,
  capcutFactoryRendererFeature,
  sceneSplitterRendererFeature,
  mediaInspectorRendererFeature,
  multiLangShortRendererFeature,
] as const satisfies readonly RendererFeature[]

assertRendererFeatureRegistry(registeredRendererFeatures)

/** Danh sach rong giu nguyen UI; generator se them feature vao day. */
export const rendererFeatures: readonly RendererFeature[] = registeredRendererFeatures
type RegisteredRendererFeature = (typeof registeredRendererFeatures)[number]
export type RendererFeatureId = [RegisteredRendererFeature] extends [never]
  ? string
  : RegisteredRendererFeature['id']
