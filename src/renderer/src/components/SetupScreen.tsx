import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { SetupPhase, SetupProgress } from '../../../shared/types'

const FRIENDLY_PROGRESS: Partial<Record<SetupPhase, string>> = {
  'downloading-ytdlp': 'Đang cài tính năng tải video…',
  'downloading-ffmpeg': 'Đang cài tính năng xử lý video…',
  'downloading-douyin': 'Đang cài công cụ tải Douyin…',
  'downloading-whisper': 'Đang cài công cụ tạo phụ đề…',
  'downloading-ocr': 'Đang cài công cụ đọc chữ trong video…',
  'downloading-video2x': 'Đang cài công cụ nâng cấp video…',
  'downloading-cuda': 'Đang cài gói tăng tốc NVIDIA…',
  extracting: 'Đang hoàn tất cài đặt…',
  done: 'Hoàn tất! T-blao đã sẵn sàng.'
}

interface Props {
  onDone: () => void
}

export default function SetupScreen({ onDone }: Props): JSX.Element {
  const [progress, setProgress] = useState<SetupProgress>({
    phase: 'checking',
    message: 'Thiếu thành phần cần thiết để tải và xử lý video.',
    percent: 0
  })
  const [running, setRunning] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const start = async (): Promise<void> => {
    setError(null)
    setRunning(true)
    const res = await window.api.runSetup()
    setRunning(false)
    if (res.ok) {
      onDone()
    } else if (res.error) {
      setError(res.error)
    }
  }

  useEffect(() => {
    const off = window.api.onSetupProgress((p) => {
      setProgress(p)
      if (p.phase === 'error') setError(p.message)
    })
    void start()
    return off
  }, [])

  const indeterminate = progress.percent < 0
  const friendlyProgress = FRIENDLY_PROGRESS[progress.phase] ?? progress.message

  return (
    <div className="center setup">
      <div className="card setup-card">
        <h2>Chuẩn bị T-blao</h2>
        <p className="muted">
          Ứng dụng sẽ tải các công cụ xử lý vào thư mục dữ liệu riêng trong lần chạy đầu tiên. Bản
          cài đặt không chứa engine hoặc FFmpeg; quá trình tải có thể lâu và không yêu cầu quyền
          quản trị.
        </p>

        {!running && !error && (
          <button className="btn primary" onClick={start}>
            Tiếp tục cài đặt
          </button>
        )}

        {(running || progress.phase === 'done') && (
          <div className="setup-progress">
            <div className="bar">
              <div
                className={`bar-fill ${indeterminate ? 'indeterminate' : ''}`}
                style={indeterminate ? undefined : { width: `${progress.percent}%` }}
              />
            </div>
            <p className="muted small">{friendlyProgress}</p>
          </div>
        )}

        {error && (
          <div className="error-box">
            <p>Không thể hoàn tất cài đặt. Hãy kiểm tra kết nối mạng rồi thử lại.</p>
            <details className="tech-details compact">
              <summary>Chi tiết kỹ thuật</summary>
              <div>{error}</div>
            </details>
            <button className="btn" onClick={start}>
              Thử lại
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
