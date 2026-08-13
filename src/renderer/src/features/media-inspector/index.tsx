import { useEffect, useState, type FormEvent, type JSX } from 'react'
import {
  FEATURE_ID,
  FEATURE_META,
  type MediaInspectorProgress,
  type MediaInspectorResult
} from '../../../../shared/features/media-inspector'
import type { RendererFeature } from '../contracts'

function MediaInspectorPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [progress, setProgress] = useState<MediaInspectorProgress | null>(null)
  const [result, setResult] = useState<MediaInspectorResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => window.api.onMediaInspectorProgress(setProgress), [])

  const run = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setRunning(true)
    setError('')
    setResult(null)
    try {
      setResult(await window.api.runMediaInspector({ input }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="panel">
      <form className="card" onSubmit={run}>
        <label className="field">
          <span>Dữ liệu đầu vào</span>
          <input value={input} onChange={(event) => setInput(event.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={running || !input.trim()}>
          {running ? 'Đang chạy…' : 'Chạy'}
        </button>
      </form>
      {progress && <p className="muted">{progress.percent}% — {progress.message}</p>}
      {result && <pre>{result.output}</pre>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export const mediaInspectorRendererFeature = {
  ...FEATURE_META,
  component: MediaInspectorPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
