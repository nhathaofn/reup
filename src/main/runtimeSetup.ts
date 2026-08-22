import { checkDependencies, runSetup as runCoreSetup } from './deps'
import type { DepStatus, SetupProgress } from '../shared/types'

type ProgressCb = (progress: SetupProgress) => void

// Optional feature engines are installed from their own feature tabs. Keeping
// them out of the first-boot gate makes the core app usable on a fresh PC even
// when an optional engine asset is unavailable or the PC has no GPU.
const devRuntimeBypass = process.env.TEDIAPROS_DEV_ALLOW_MISSING_RUNTIME === '1'

export async function checkRuntimeDependencies(): Promise<DepStatus> {
  const core = await checkDependencies()
  if (devRuntimeBypass) {
    return { ...core, engines: false, devRuntimeBypass: true }
  }
  return { ...core, engines: core.ytdlp && core.ffmpeg }
}

export async function runRuntimeSetup(onProgress: ProgressCb): Promise<void> {
  try {
    await runCoreSetup((progress) => {
      if (progress.phase !== 'done') onProgress(progress)
    })

    const core = await checkDependencies()
    if (!core.ytdlp || !core.ffmpeg) {
      throw new Error('Core downloader or FFmpeg is still missing. Please retry setup.')
    }

    onProgress({ phase: 'done', message: 'Core runtime is ready. Feature engines install on demand.', percent: 100 })
  } catch (error) {
    onProgress({
      phase: 'error',
      message: error instanceof Error ? error.message : String(error),
      percent: -1
    })
    throw error
  }
}
