import { mergeFeatureApis } from './contracts'

// feature-scaffold:imports
import { capcutFactoryPreloadFeature } from './capcut-factory'
import { sceneSplitterPreloadFeature } from './scene-splitter'
import { mediaInspectorPreloadFeature } from './media-inspector'

const registeredPreloadFeatures = [
  // feature-scaffold:modules
  capcutFactoryPreloadFeature,
  sceneSplitterPreloadFeature,
  mediaInspectorPreloadFeature,
] as const

export const featureApi = mergeFeatureApis(registeredPreloadFeatures)
