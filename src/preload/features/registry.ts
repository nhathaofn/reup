import { mergeFeatureApis } from './contracts'

// feature-scaffold:imports
import { sceneSplitterPreloadFeature } from './scene-splitter'
import { mediaInspectorPreloadFeature } from './media-inspector'

const registeredPreloadFeatures = [
  // feature-scaffold:modules
  sceneSplitterPreloadFeature,
  mediaInspectorPreloadFeature,
] as const

export const featureApi = mergeFeatureApis(registeredPreloadFeatures)
