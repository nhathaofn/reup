import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export type FeatureInvokeHandler<Args extends unknown[] = unknown[], Result = unknown> = (
  event: IpcMainInvokeEvent,
  ...args: Args
) => Result | Promise<Result>

export interface FeatureMainContext {
  featureId: string
  getMainWindow: () => BrowserWindow | null
  /** Dang ky request/response IPC. Channel bat buoc bat dau bang `<featureId>:`. */
  handle: <Args extends unknown[], Result>(
    channel: string,
    listener: FeatureInvokeHandler<Args, Result>
  ) => void
  /** Day su kien mot chieu ve renderer trong namespace cua feature. */
  emit: <Payload>(channel: string, payload: Payload) => void
}

export interface MainFeatureModule {
  id: string
  register: (context: FeatureMainContext) => void
}
