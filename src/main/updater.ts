import { app, BrowserWindow } from 'electron'
import updaterPkg from 'electron-updater'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import { UpdateStatus } from '../shared/types'
import { isLocalPortableBuild } from '../shared/build-variant'

const { autoUpdater } = updaterPkg

let started = false
let lastStatus: UpdateStatus = { state: 'none' }
let windowProvider: (() => BrowserWindow | null) | null = null
let checkTimer: NodeJS.Timeout | null = null

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

function publish(status: UpdateStatus): void {
  lastStatus = status
  windowProvider?.()?.webContents.send('update:status', status)
}

/** Khoi tao tu cap nhat app (chi chay tren ban da dong goi cai dat). */
export function initAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true
  // Giữ provider để trạng thái cuối có thể được gửi lại sau khi Renderer
  // đăng ký listener. Điều này tránh mất thông báo khi mạng trả kết quả quá sớm.
  windowProvider = getWindow

  if (!app.isPackaged || isLocalPortableBuild(process.env, app.isPackaged)) {
    // Chế độ dev: electron-updater không chạy, nhưng Renderer vẫn nhận trạng
    // thái ổn định qua IPC query.
    logInfo(
      isLocalPortableBuild(process.env, app.isPackaged)
        ? 'Tự cập nhật app: bỏ qua (bản local portable).'
        : 'Tự cập nhật app: bỏ qua (đang chạy chế độ phát triển).'
    )
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    logInfo(`Có bản cập nhật app: ${info.version}`)
    publish({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => publish({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    publish({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    logInfo(`Đã tải bản cập nhật ${info.version} — sẵn sàng cài khi khởi động lại.`)
    publish({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    debugRaw('updater', err)
    const nhan = errLabel(err)
    logError(`Lỗi tự cập nhật app: ${nhan}`)
    publish({ state: 'error', message: nhan })
  })

  void checkForUpdates()
  checkTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged || isLocalPortableBuild(process.env, app.isPackaged)) {
    publish({ state: 'none' })
    return
  }
  publish({ state: 'checking' })
  await autoUpdater.checkForUpdates().catch((e) => logError(`Kiểm tra cập nhật lỗi: ${e}`))
}

/** Trạng thái cuối để Renderer không bị phụ thuộc vào thời điểm đăng ký event. */
export function getUpdateStatus(): UpdateStatus {
  return lastStatus
}

export function quitAndInstall(): void {
  if (!app.isPackaged || isLocalPortableBuild(process.env, app.isPackaged)) return
  // Silent + force-run: tranh wizard NSIS (oneClick:false) gỡ app roi dung giua chung.
  autoUpdater.quitAndInstall(true, true)
}
