import { assertRendererFeatureRegistry, type RendererFeature } from './contracts'
// feature-scaffold:imports
import { autoShortRendererFeature } from './auto-short'
import { capcutFactoryRendererFeature } from './capcut-factory'
import { contentBlocksRendererFeature } from './content-blocks'
import { mediaInspectorRendererFeature } from './media-inspector'
import { multiLangShortRendererFeature } from './multilang-short'
import { sceneSplitterRendererFeature } from './scene-splitter'
import { srtTranslatorRendererFeature } from './srt-translator'
import { subtitlePipelineRendererFeature } from './subtitle-pipeline'

const registeredRendererFeatures = [
  // feature-scaffold:modules
  autoShortRendererFeature,
  capcutFactoryRendererFeature,
  contentBlocksRendererFeature,
  mediaInspectorRendererFeature,
  multiLangShortRendererFeature,
  sceneSplitterRendererFeature,
  srtTranslatorRendererFeature,
  subtitlePipelineRendererFeature
] as const satisfies readonly RendererFeature[]

assertRendererFeatureRegistry(registeredRendererFeatures)

/** Danh sach rong giu nguyen UI; generator se them feature vao day. */
export const rendererFeatures: readonly RendererFeature[] = registeredRendererFeatures
type RegisteredRendererFeature = (typeof registeredRendererFeatures)[number]
export type RendererFeatureId = [RegisteredRendererFeature] extends [never]
  ? string
  : RegisteredRendererFeature['id']
