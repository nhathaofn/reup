import {
  FEATURE_CHANNELS,
  FEATURE_ID,
  type MediaInspectorProgress,
  type MediaInspectorRequest,
  type MediaInspectorResult
} from '../../shared/features/media-inspector'
import type { MainFeatureModule } from './contracts'

export const mediaInspectorMainFeature = {
  id: FEATURE_ID,
  register({ handle, emit }) {
    handle<[request: MediaInspectorRequest], MediaInspectorResult>(
      FEATURE_CHANNELS.run,
      async (_event, request) => {
        const input = request?.input?.trim()
        if (!input) throw new Error('Vui lòng nhập dữ liệu trước khi chạy.')

        emit<MediaInspectorProgress>(FEATURE_CHANNELS.progress, {
          percent: 10,
          message: 'Đã nhận yêu cầu.'
        })

        // TODO: Đặt nghiệp vụ của feature tại đây hoặc gọi sang service riêng.
        const result: MediaInspectorResult = {
          output: input,
          completedAt: new Date().toISOString()
        }

        emit<MediaInspectorProgress>(FEATURE_CHANNELS.progress, {
          percent: 100,
          message: 'Hoàn tất.'
        })
        return result
      }
    )
  }
} satisfies MainFeatureModule
