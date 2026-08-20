import { mergeFeatureApis } from './contracts'

// feature-scaffold:imports
import { autoShortPreloadFeature } from './auto-short'
import { capcutFactoryPreloadFeature } from './capcut-factory'
import { sceneSplitterPreloadFeature } from './scene-splitter'
import { mediaInspectorPreloadFeature } from './media-inspector'
import { multiLangShortPreloadFeature } from './multilang-short'

const registeredPreloadFeatures = [
  // feature-scaffold:modules
  autoShortPreloadFeature,
  capcutFactoryPreloadFeature,
  sceneSplitterPreloadFeature,
  mediaInspectorPreloadFeature,
  multiLangShortPreloadFeature,
] as const

export const featureApi = mergeFeatureApis(registeredPreloadFeatures)
