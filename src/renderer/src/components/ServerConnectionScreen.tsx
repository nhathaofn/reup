import type { FormEvent, JSX } from 'react'
import { useEffect, useState } from 'react'
import type {
  ServerConnectionErrorCode,
  ServerConnectionStatus
} from '../../../shared/server-contract'
import { t, type AppMessageKey } from '../i18n'

type UnavailableServerStatus = Extract<ServerConnectionStatus, { state: 'unavailable' }>

interface Props {
  status: UnavailableServerStatus
  busy: boolean
  onConnect: (endpoint: string) => Promise<void>
}

const ERROR_KEYS: Record<ServerConnectionErrorCode, AppMessageKey> = {
  'invalid-url': 'server.error.invalid-url',
  unreachable: 'server.error.unreachable',
  incompatible: 'server.error.incompatible',
  'invalid-response': 'server.error.invalid-response',
  'storage-error': 'server.error.storage-error'
}

export default function ServerConnectionScreen({ status, busy, onConnect }: Props): JSX.Element {
  const [endpoint, setEndpoint] = useState(status.endpoint)

  useEffect(() => {
    setEndpoint(status.endpoint)
  }, [status.endpoint])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!busy) void onConnect(endpoint)
  }

  return (
    <main className="server-gate">
      <section className="server-gate-card" aria-labelledby="server-gate-title">
        <div className="server-brand" aria-label="TediaPros">
          TediaPros
        </div>
        <div className="server-eyebrow">{t('server.eyebrow')}</div>
        <h1 id="server-gate-title">{t('server.title')}</h1>
        <p className="server-description">{t('server.description')}</p>

        <form className="server-form" onSubmit={submit}>
          <label htmlFor="server-endpoint">{t('server.endpointLabel')}</label>
          <input
            id="server-endpoint"
            name="server-endpoint"
            type="url"
            value={endpoint}
            placeholder={t('server.endpointPlaceholder')}
            disabled={busy || status.managed}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <p className="server-field-hint">
            {t(status.managed ? 'server.managedHint' : 'server.endpointHint')}
          </p>

          <div className="server-error" role="alert">
            <span className="server-error-dot" aria-hidden="true" />
            <span>{t(ERROR_KEYS[status.errorCode])}</span>
          </div>

          <button className="server-submit" type="submit" disabled={busy}>
            {busy
              ? t('server.connecting')
              : t(status.managed ? 'server.retry' : 'server.connect')}
          </button>
        </form>

        <div className="server-security-note">
          <span className="server-security-icon" aria-hidden="true">◇</span>
          <div>
            <strong>{t('server.securityTitle')}</strong>
            <p>{t('server.securityDescription')}</p>
          </div>
        </div>
      </section>
    </main>
  )
}
