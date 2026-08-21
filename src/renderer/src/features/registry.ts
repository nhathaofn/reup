import { assertRendererFeatureRegistry, type RendererFeature } from './contracts'

// feature-scaffold:imports
import { contentBlocksRendererFeature } from './content-blocks'
import { subtitlePipelineRendererFeature } from './subtitle-pipeline'
import { capcutFactoryRendererFeature } from './capcut-factory'
import { sceneSplitterRendererFeature } from './scene-splitter'
import { mediaInspectorRendererFeature } from './media-inspector'
import { srtTranslatorRendererFeature } from './srt-translator'

const registeredRendererFeatures = [
  // feature-scaffold:modules
  contentBlocksRendererFeature,
  subtitlePipelineRendererFeature,
  capcutFactoryRendererFeature,
  sceneSplitterRendererFeature,
  mediaInspectorRendererFeature,
  srtTranslatorRendererFeature,
] as const satisfies readonly RendererFeature[]

assertRendererFeatureRegistry(registeredRendererFeatures)

/** Danh sach rong giu nguyen UI; generator se them feature vao day. */
export const rendererFeatures: readonly RendererFeature[] = registeredRendererFeatures
type RegisteredRendererFeature = (typeof registeredRendererFeatures)[number]
export type RendererFeatureId = [RegisteredRendererFeature] extends [never]
  ? string
  : RegisteredRendererFeature['id']
