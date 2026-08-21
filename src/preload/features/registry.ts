import { mergeFeatureApis } from './contracts'

// feature-scaffold:imports
import { contentBlocksPreloadFeature } from './content-blocks'
import { subtitlePipelinePreloadFeature } from './subtitle-pipeline'
import { capcutFactoryPreloadFeature } from './capcut-factory'
import { sceneSplitterPreloadFeature } from './scene-splitter'
import { mediaInspectorPreloadFeature } from './media-inspector'
import { srtTranslatorPreloadFeature } from './srt-translator'

const registeredPreloadFeatures = [
  // feature-scaffold:modules
  contentBlocksPreloadFeature,
  subtitlePipelinePreloadFeature,
  capcutFactoryPreloadFeature,
  sceneSplitterPreloadFeature,
  mediaInspectorPreloadFeature,
  srtTranslatorPreloadFeature,
] as const

export const featureApi = mergeFeatureApis(registeredPreloadFeatures)
