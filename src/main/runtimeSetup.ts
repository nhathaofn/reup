import { checkDependencies, runSetup as runCoreSetup } from './deps'
import { dyEngineStatus, installDyEngine } from './douyin'
import { detectGpu } from './gpu'
import { installOcrEngine, ocrEngineStatus } from './ocr'
import {
  installCudaPack,
  installWhisperEngine,
  whisperCudaStatus,
  whisperEngineStatus
} from './whisper'
import { installVideo2xEngine, video2xEngineStatus } from './video2x'
import type { DepStatus, SetupPhase, SetupProgress } from '../shared/types'

type ProgressCb = (progress: SetupProgress) => void
type BasicStatus = { has: boolean; needsUpdate?: boolean }

interface RuntimeStep {
  phase: SetupPhase
  message: string
  status: () => Promise<BasicStatus>
  install: (onProgress: (percent: number) => void) => Promise<void>
}

async function runtimeSteps(): Promise<RuntimeStep[]> {
  const steps: RuntimeStep[] = [
    {
      phase: 'downloading-douyin',
      message: 'Đang tải công cụ Douyin…',
      status: dyEngineStatus,
      install: installDyEngine
    },
    {
      phase: 'downloading-whisper',
      message: 'Đang tải công cụ tạo phụ đề…',
      status: whisperEngineStatus,
      install: installWhisperEngine
    },
    {
      phase: 'downloading-ocr',
      message: 'Đang tải công cụ đọc chữ trong video…',
      status: ocrEngineStatus,
      install: installOcrEngine
    }
  ]

  const video2x = await video2xEngineStatus()
  if (video2x.supported) {
    steps.push({
      phase: 'downloading-video2x',
      message: 'Đang tải công cụ nâng cấp video…',
      status: video2xEngineStatus,
      install: installVideo2xEngine
    })
  }

  if (process.platform === 'win32') {
    const gpu = await detectGpu()
    if (gpu.canAccelerate) {
      steps.push({
        phase: 'downloading-cuda',
        message: 'Đang tải gói tăng tốc NVIDIA…',
        status: whisperCudaStatus,
        install: installCudaPack
      })
    }
  }

  return steps
}

async function enginesReady(steps: RuntimeStep[]): Promise<boolean> {
  const statuses = await Promise.all(steps.map((step) => step.status()))
  return statuses.every((status) => status.has && !status.needsUpdate)
}

/**
 * Trang khoi dong chi vao app khi core tools va moi engine phu hop voi may da
 * nam trong userData/bin. Installer khong dong goi bat ky binary runtime nao.
 */
export async function checkRuntimeDependencies(): Promise<DepStatus> {
  const [core, steps] = await Promise.all([checkDependencies(), runtimeSteps()])
  return { ...core, engines: await enginesReady(steps) }
}

export async function runRuntimeSetup(onProgress: ProgressCb): Promise<void> {
  try {
    await runCoreSetup((progress) => {
      if (progress.phase !== 'done') onProgress(progress)
    })

    const steps = await runtimeSteps()
    for (const step of steps) {
      const status = await step.status()
      if (status.has && !status.needsUpdate) continue
      onProgress({ phase: step.phase, message: step.message, percent: 0 })
      await step.install((percent) =>
        onProgress({ phase: step.phase, message: step.message, percent })
      )
    }

    const [core, finalSteps] = await Promise.all([checkDependencies(), runtimeSteps()])
    if (!core.ytdlp || !core.ffmpeg || !(await enginesReady(finalSteps))) {
      throw new Error('Một hoặc nhiều thành phần chưa được cài đặt đầy đủ. Vui lòng thử lại.')
    }

    onProgress({ phase: 'done', message: 'Hoàn tất! T-blao đã sẵn sàng.', percent: 100 })
  } catch (error) {
    onProgress({
      phase: 'error',
      message: error instanceof Error ? error.message : String(error),
      percent: -1
    })
    throw error
  }
}
