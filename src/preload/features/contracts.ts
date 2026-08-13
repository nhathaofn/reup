type PreloadMethod = (...args: any[]) => unknown
export type PreloadFeatureApi = Record<string, PreloadMethod>

export interface PreloadFeatureModule<Api extends PreloadFeatureApi = PreloadFeatureApi> {
  id: string
  api: Api
}

type ModuleApi<T> = T extends PreloadFeatureModule<infer Api> ? Api : never
type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never

type CombinedFeatureApi<T extends readonly PreloadFeatureModule[]> = [T[number]] extends [never]
  ? Record<never, never>
  : UnionToIntersection<ModuleApi<T[number]>>

/** Gop API cua feature va chan trung method ngay luc preload khoi dong. */
export function mergeFeatureApis<const T extends readonly PreloadFeatureModule[]>(
  modules: T
): CombinedFeatureApi<T> {
  const ids = new Set<string>()
  const methodNames = new Set<string>()
  const merged: PreloadFeatureApi = {}

  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`Preload feature ID bi trung: ${module.id}`)
    ids.add(module.id)
    for (const [name, method] of Object.entries(module.api)) {
      if (methodNames.has(name)) throw new Error(`Preload API bi trung: ${name}`)
      methodNames.add(name)
      merged[name] = method
    }
  }

  return merged as CombinedFeatureApi<T>
}

/** Chan feature ghi de API core khi hai object duoc spread vao contextBridge. */
export function assertNoPreloadApiCollisions(
  coreApi: Record<string, unknown>,
  featureApi: Record<string, unknown>
): void {
  const collisions = Object.keys(featureApi).filter((name) => name in coreApi)
  if (collisions.length) {
    throw new Error(`Feature ghi de preload API core: ${collisions.join(', ')}`)
  }
}
