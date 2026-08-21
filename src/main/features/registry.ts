import { ipcMain, type BrowserWindow } from 'electron'
import { isReservedFeatureId } from '../../shared/features/contracts'
import type { FeatureInvokeHandler, MainFeatureModule } from './contracts'

// feature-scaffold:imports
import { contentBlocksMainFeature } from './content-blocks'
import { subtitlePipelineMainFeature } from './subtitle-pipeline'
import { capcutFactoryMainFeature } from './capcut-factory'
import { sceneSplitterMainFeature } from './scene-splitter'
import { mediaInspectorMainFeature } from './media-inspector'
import { srtTranslatorMainFeature } from './srt-translator'

const registeredMainFeatures = [
  // feature-scaffold:modules
  contentBlocksMainFeature,
  subtitlePipelineMainFeature,
  capcutFactoryMainFeature,
  sceneSplitterMainFeature,
  mediaInspectorMainFeature,
  srtTranslatorMainFeature,
] as const satisfies readonly MainFeatureModule[]

const mainFeatureModules: readonly MainFeatureModule[] = registeredMainFeatures
let registered = false

/**
 * Dang ky cac feature moi sau khi IPC core da san sang.
 * Registry rong khong thay doi hanh vi hien tai cua app.
 */
export function registerMainFeatures(getMainWindow: () => BrowserWindow | null): void {
  if (registered) throw new Error('Main feature registry da duoc dang ky hai lan.')
  registered = true

  const ids = new Set<string>()
  const channels = new Set<string>()

  for (const feature of mainFeatureModules) {
    if (isReservedFeatureId(feature.id)) {
      throw new Error(`Feature ID "${feature.id}" trung namespace core.`)
    }
    if (ids.has(feature.id)) throw new Error(`Feature ID bi trung: ${feature.id}`)
    ids.add(feature.id)

    const prefix = `${feature.id}:`
    feature.register({
      featureId: feature.id,
      getMainWindow,
      handle: <Args extends unknown[], Result>(
        channel: string,
        listener: FeatureInvokeHandler<Args, Result>
      ): void => {
        if (!channel.startsWith(prefix)) {
          throw new Error(`IPC "${channel}" phai nam trong namespace "${prefix}".`)
        }
        if (channels.has(channel)) throw new Error(`IPC feature bi trung: ${channel}`)
        channels.add(channel)
        ipcMain.handle(channel, listener)
      },
      emit: <Payload>(channel: string, payload: Payload): void => {
        if (!channel.startsWith(prefix)) {
          throw new Error(`Event "${channel}" phai nam trong namespace "${prefix}".`)
        }
        getMainWindow()?.webContents.send(channel, payload)
      }
    })
  }
}
