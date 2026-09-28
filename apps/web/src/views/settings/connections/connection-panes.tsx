import type { AuthorizationOperation, Command, SafeError } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { type FormEvent, useState } from 'react'
import { ErrorText, SettingsPane } from '@/views/shared/settings-shared'
import { authorizationStatus, type ConnectionOperation } from './connection-details'

type AddConnectionPaneProps = {
  operation: ConnectionOperation
  configurationVersion: number
  onClose: () => void
  onStarted: (operationId: string) => void
}

export function AddConnectionPane({
  operation,
  configurationVersion,
  onClose,
  onStarted,
}: AddConnectionPaneProps) {
  const [error, setError] = useState<SafeError | string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) {
      setError('Enter a name that distinguishes this GitHub Connection.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const outcome = await operation.execute({
        type: 'begin-github-authorization',
        expectedConfigurationVersion: configurationVersion,
        name,
      })
      if (!outcome.ok) {
        setError(outcome.error)
        return
      }
      if (outcome.result.type !== 'authorization-started') {
        setError('The server returned an unexpected authorization result.')
        return
      }
      onStarted(outcome.result.operationId)
    } catch {
      setError('The server did not confirm authorization. Wait for live state before retrying.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPane label="Add GitHub Connection" onClose={onClose}>
      <header className="settings-flow-head">
        <p className="settings-eyebrow">GitHub Connection</p>
        <h2>Authorize GitHub</h2>
        <p>Use a name that distinguishes this account from other GitHub Connections.</p>
      </header>
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <label>
          Connection name
          <input name="name" placeholder="Personal GitHub" />
        </label>
        <Alert variant="info">
          Credentials are saved in macOS Keychain. They never enter roadmap.config.json or the
          browser.
        </Alert>
        <ErrorText error={error} />
        <ControlGroup className="settings-form-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Starting…' : 'Start authorization'}
          </Button>
        </ControlGroup>
      </form>
    </SettingsPane>
  )
}
type AuthorizationPaneProps = {
  authorization: AuthorizationOperation
  operation: ConnectionOperation
  configurationVersion: number
  onClose: () => void
  onFinished: (message: string) => void
}

export function AuthorizationPane({
  authorization,
  operation,
  configurationVersion,
  onClose,
  onFinished,
}: AuthorizationPaneProps) {
  const [error, setError] = useState<SafeError | string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const execute = async (command: Command) => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await operation.execute(command)
      if (!outcome.ok) setError(outcome.error)
    } catch {
      setError('The server did not confirm the authorization operation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPane label="GitHub authorization" onClose={onClose}>
      <header className="settings-flow-head">
        <p className="settings-eyebrow">Device authorization</p>
        <h2>{authorizationStatus(authorization)}</h2>
        <p>
          GitHub authorization progress is live server state. Closing this pane does not cancel it.
        </p>
      </header>

      {authorization.status === 'waiting' && (
        <>
          <div className="device-code">
            <small>{authorization.verificationUri}</small>
            <strong>{authorization.userCode}</strong>
            <span>
              {authorization.expiresAt
                ? `Expires ${new Date(authorization.expiresAt).toLocaleTimeString()}`
                : 'Waiting for GitHub'}
            </span>
          </div>
          <div className="authorization-controls">
            {authorization.verificationUri && (
              <Link href={authorization.verificationUri} external>
                Open GitHub
              </Link>
            )}
            <ControlGroup>
              <Button
                type="button"
                disabled={!authorization.userCode}
                onClick={() => {
                  if (!authorization.userCode) return
                  void navigator.clipboard
                    .writeText(authorization.userCode)
                    .then(() => setCopied(true))
                }}
              >
                {copied ? 'Code copied' : 'Copy code'}
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void execute({
                    type: 'cancel-github-authorization',
                    expectedConfigurationVersion: configurationVersion,
                    operationId: authorization.id,
                  })
                }
              >
                Cancel authorization
              </Button>
            </ControlGroup>
          </div>
        </>
      )}

      {authorization.status === 'granted' && (
        <Alert variant="info">
          <strong>GitHub authorized.</strong>
          <span>The Connection is saved and reconciliation has started.</span>
        </Alert>
      )}
      {authorization.status !== 'waiting' && authorization.status !== 'granted' && (
        <Alert>
          <strong>{authorizationStatus(authorization)}</strong>
          <span>{authorization.cause}</span>
        </Alert>
      )}
      <ErrorText error={error} />

      {authorization.status !== 'waiting' && (
        <ControlGroup className="settings-form-actions">
          <Button
            type="button"
            onClick={() =>
              onFinished(
                authorization.status === 'granted'
                  ? 'GitHub Connection authorized and queued for reconciliation.'
                  : 'Authorization progress closed.',
              )
            }
          >
            Close
          </Button>
          {authorization.status !== 'granted' && (
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void execute({
                  type: 'retry-github-authorization',
                  expectedConfigurationVersion: configurationVersion,
                  operationId: authorization.id,
                })
              }
            >
              Retry authorization
            </Button>
          )}
        </ControlGroup>
      )}
    </SettingsPane>
  )
}
