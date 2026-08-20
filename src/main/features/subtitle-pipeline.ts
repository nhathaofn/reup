import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type SubtitlePipelineCancelRequest,
  type SubtitlePipelineCancelResult,
  type SubtitlePipelineProgress,
  type SubtitlePipelineRequest,
  type SubtitlePipelineResult
} from '../../shared/features/subtitle-pipeline'
import { runSubtitlePipeline } from '../services/subtitle-pipeline'
import type { MainFeatureModule } from './contracts'

interface ActivePipeline {
  jobId: string
  controller: AbortController
}

export const subtitlePipelineMainFeature = {
  id: FEATURE_ID,
  register({ handle, emit }) {
    let active: ActivePipeline | null = null

    app.once('before-quit', () => active?.controller.abort())

    handle<[request: SubtitlePipelineRequest], SubtitlePipelineResult>(
      FEATURE_CHANNELS.run,
      async (_event, request) => {
        if (active) {
          return {
            ok: false,
            jobId: active.jobId,
            outputs: {},
            cueCount: 0,
            conflictCount: 0,
            warnings: [],
            error: 'Một pipeline phụ đề khác đang chạy.'
          }
        }
        const jobId = randomUUID()
        const controller = new AbortController()
        active = { jobId, controller }
        try {
          return await runSubtitlePipeline(request, {
            jobId,
            signal: controller.signal,
            emit: (progress: SubtitlePipelineProgress) => emit(FEATURE_CHANNELS.progress, progress)
          })
        } finally {
          if (active?.jobId === jobId) active = null
        }
      }
    )

    handle<[request: SubtitlePipelineCancelRequest], SubtitlePipelineCancelResult>(
      FEATURE_CHANNELS.cancel,
      async (_event, request) => {
        if (!active) return { ok: true, wasRunning: false }
        if (request?.jobId && request.jobId !== active.jobId) {
          return { ok: false, wasRunning: true, error: 'Job pipeline không còn hoạt động.' }
        }
        active.controller.abort()
        return { ok: true, wasRunning: true }
      }
    )
  }
} satisfies MainFeatureModule
