import type { FormEvent, JSX } from 'react'

export interface GeminiConnectionProps {
  ready: boolean | null
  keyInput: string
  busy: boolean
  message: string
  messageOk: boolean
  onKeyInput(value: string): void
  onCheck(): void
  onDisconnect(): void
  onOpenHelp(): void
}

export default function GeminiConnection({ ready, keyInput, busy, message, messageOk, onKeyInput, onCheck, onDisconnect, onOpenHelp }: GeminiConnectionProps): JSX.Element {
  return (
    <>
      <div className="srt-translator-card-head">
        <div><strong>Kết nối Gemini</strong><span className="muted small">Dùng API key của bạn</span></div>
        <span className={`srt-translator-connection ${ready ? 'ok' : ''}`}>{ready ? 'Đã kết nối' : 'Chưa kết nối'}</span>
      </div>
      <form className="srt-translator-key-row" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onCheck() }}>
        <input type="password" value={keyInput} onChange={(event) => onKeyInput(event.target.value)} placeholder={ready ? 'Dán key mới nếu cần' : 'Dán Gemini API key'} autoComplete="off" />
        <button className="btn" type="submit" disabled={busy || (!keyInput.trim() && ready !== true)}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra'}</button>
      </form>
      <div className="srt-translator-connection-actions">
        {ready && <button className="btn small-btn" type="button" onClick={onDisconnect} disabled={busy}>Ngắt kết nối</button>}
        <button className="srt-translator-help" type="button" onClick={onOpenHelp}>Cách lấy API key</button>
      </div>
      {message && <div className={`srt-translator-message ${messageOk ? 'ok' : 'error'}`}>{message}</div>}
    </>
  )
}
