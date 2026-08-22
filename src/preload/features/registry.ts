import { mergeFeatureApis } from './contracts'

// feature-scaffold:imports
import { autoShortPreloadFeature } from './auto-short'
import { capcutFactoryPreloadFeature } from './capcut-factory'
import { contentBlocksPreloadFeature } from './content-blocks'
import { mediaInspectorPreloadFeature } from './media-inspector'
import { multiLangShortPreloadFeature } from './multilang-short'
import { sceneSplitterPreloadFeature } from './scene-splitter'
import { srtTranslatorPreloadFeature } from './srt-translator'
import { subtitlePipelinePreloadFeature } from './subtitle-pipeline'

const registeredPreloadFeatures = [
  // feature-scaffold:modules
  autoShortPreloadFeature,
  capcutFactoryPreloadFeature,
  contentBlocksPreloadFeature,
  mediaInspectorPreloadFeature,
  multiLangShortPreloadFeature,
  sceneSplitterPreloadFeature,
  srtTranslatorPreloadFeature,
  subtitlePipelinePreloadFeature
] as const

export const featureApi = mergeFeatureApis(registeredPreloadFeatures)
