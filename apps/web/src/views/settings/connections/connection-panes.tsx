import type { ConfigurationVersion } from '@roadmap/contracts/identity'
import type { Command, SafeError } from '@roadmap/contracts/operations'
import type { AuthorizationOperation } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { Modal } from '@roadmap/ui/modal'
import { TextInput } from '@roadmap/ui/text-input'
import classNames from 'classnames/bind'
import { type FormEvent, useRef, useState } from 'react'
import { Link as InternalLink } from '@/navigation'
import type { AuthorizationResult } from '@/resources/results'
import { connectionPath } from '@/router'
import { AuthorizationControls, DeviceCode } from '@/views/shared/authorization-presentation'
import { SettingsForm } from '@/views/shared/settings-form'
import { SettingsFormActions } from '@/views/shared/settings-form-actions'
import { ErrorText } from '@/views/shared/settings-shared'
import {
  type AuthorizationPhaseResult,
  type AuthorizationResultFeedback,
  authorizationPhaseStatus,
  authorizationResultPending,
  type ConnectionOperation,
} from './connection-details'
import styles from './connection-panes.module.css'

const cx = classNames.bind(styles)

type AddConnectionPaneProps = {
  operation: ConnectionOperation
  configurationVersion: ConfigurationVersion
  onClose: () => void
  onResult: (result: AuthorizationPhaseResult) => void
}

export function AddConnectionPane({
  operation,
  configurationVersion,
  onClose,
  onResult,
}: AddConnectionPaneProps) {
  const [error, setError] = useState<SafeError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const [completionUnknown, setCompletionUnknown] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || completionUnknown) return
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
      onResult(outcome.result)
    } catch {
      setCompletionUnknown(true)
      setError(
        'Authorization may have started. Check its operation status before starting another attempt.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="Add GitHub Connection" onClose={onClose}>
      <header className={cx('settings-flow-head')}>
        <p className={cx('settings-eyebrow')}>GitHub Connection</p>
        <h2>Authorize GitHub</h2>
        <p>Use a name that distinguishes this account from other GitHub Connections.</p>
      </header>
      <SettingsForm onSubmit={(event) => void submit(event)}>
        <label htmlFor="connection-name">
          Connection name
          <TextInput id="connection-name" name="name" placeholder="Personal GitHub" />
        </label>
        <Alert variant="info">
          Credentials are saved in macOS Keychain. They never enter roadmap.config.json or the
          browser.
        </Alert>
        <ErrorText error={error} />
        <SettingsFormActions>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" type="submit" disabled={busy || completionUnknown}>
            {busy ? 'Starting…' : 'Start authorization'}
          </Button>
        </SettingsFormActions>
      </SettingsForm>
    </Modal>
  )
}
type AuthorizationPaneProps = {
  authorization: AuthorizationOperation | undefined
  presentation: AuthorizationResult | null
  feedback: AuthorizationResultFeedback | null
  operation: ConnectionOperation
  configurationVersion: ConfigurationVersion
  onClose: () => void
  onResult: (feedback: AuthorizationResultFeedback) => void
  onFinished: (message: string) => void
}

export function AuthorizationPane({
  authorization,
  presentation,
  feedback,
  operation,
  configurationVersion,
  onClose,
  onResult,
  onFinished,
}: AuthorizationPaneProps) {
  const [error, setError] = useState<SafeError | string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [completionUnknown, setCompletionUnknown] = useState(false)
  const currentAuthorization = useRef(authorization)
  currentAuthorization.current = authorization
  const pending = authorizationResultPending(authorization, feedback)
  const result = feedback?.result
  const phase =
    pending && result
      ? result.phase
      : presentation?.kind === 'terminal'
        ? presentation.outcome
        : presentation?.kind === 'granted-current' || presentation?.kind === 'granted-historical'
          ? 'granted'
          : presentation?.kind
  const waiting =
    pending && result?.phase === 'waiting'
      ? result
      : presentation?.kind === 'waiting' && phase === 'waiting'
        ? presentation
        : null
  const operationId = pending ? result?.operationId : authorization?.id
  const phaseError =
    pending && result && (result.phase === 'failed' || result.phase === 'denied')
      ? result.error
      : !pending && presentation?.kind === 'terminal'
        ? presentation.cause
        : null

  const execute = async (
    command: Extract<
      Command,
      { type: 'retry-github-authorization' | 'cancel-github-authorization' }
    >,
  ) => {
    if (busy || completionUnknown) return
    setBusy(true)
    setError(null)
    const previous = authorization
    try {
      const outcome = await operation.execute(command)
      if (!outcome.ok) {
        setError(outcome.error)
        return
      }
      onResult({
        result: outcome.result,
        previous,
        consumed: currentAuthorization.current !== previous,
      })
    } catch {
      setCompletionUnknown(true)
      setError('The server did not confirm the authorization operation. Do not repeat it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="GitHub authorization" onClose={onClose}>
      <header className={cx('settings-flow-head')}>
        <p className={cx('settings-eyebrow')}>Device authorization</p>
        <h2>{phase ? authorizationPhaseStatus(phase) : 'Waiting for authorization publication'}</h2>
        <p>
          GitHub authorization progress is live server state. Closing this pane does not cancel it.
        </p>
      </header>
      {pending && authorization && <p>{`Live authorization read: ${presentation?.label}.`}</p>}

      {pending && (
        <Alert variant="info">
          This operation returned the phase below. The live authorization read has not published its
          next phase yet. Connection availability still comes from live server state.
        </Alert>
      )}

      {waiting && operationId && (
        <>
          <DeviceCode>
            <small>{waiting.verificationUri}</small>
            <strong>{waiting.userCode}</strong>
            <span>{`Expires ${new Date(waiting.expiresAt).toLocaleTimeString()}`}</span>
          </DeviceCode>
          <AuthorizationControls>
            <Link href={waiting.verificationUri} external>
              Open GitHub
            </Link>
            <ControlGroup>
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(waiting.userCode)
                    .then(() => setCopiedCode(waiting.userCode))
                }}
              >
                {copiedCode === waiting.userCode ? 'Code copied' : 'Copy code'}
              </Button>
              <Button
                type="button"
                disabled={busy || completionUnknown}
                onClick={() =>
                  void execute({
                    type: 'cancel-github-authorization',
                    expectedConfigurationVersion: configurationVersion,
                    operationId,
                  })
                }
              >
                Cancel authorization
              </Button>
            </ControlGroup>
          </AuthorizationControls>
        </>
      )}

      {phase === 'granted' && (
        <Alert variant="info">
          <strong>GitHub authorized.</strong>
          {result?.phase === 'granted' && pending ? (
            <span>
              {`Connection ${result.connection.connectionId}, account ${result.connection.accountId}, configuration version ${result.configurationVersion}. `}
              <InternalLink href={connectionPath(result.connection.connectionId)}>
                View granted Connection
              </InternalLink>
            </span>
          ) : presentation?.kind === 'granted-current' ? (
            <span>
              {`Connection ${presentation.navigation.connection}, account ${presentation.accountId}. `}
              {result?.phase === 'granted' &&
                `Grant committed at configuration version ${result.configurationVersion}. `}
              <InternalLink href={connectionPath(presentation.navigation.connection)}>
                View granted Connection
              </InternalLink>
            </span>
          ) : null}
          <span>
            {presentation?.kind === 'granted-historical'
              ? presentation.message
              : 'This grant does not establish Project source availability.'}
          </span>
        </Alert>
      )}
      {(phase === 'cancelled' || phase === 'expired') && (
        <Alert variant="info">
          <strong>{authorizationPhaseStatus(phase)}</strong>
          <span>Closing or cancelling authorization does not revoke a completed grant.</span>
        </Alert>
      )}
      <ErrorText error={phaseError} />
      <ErrorText error={error} />

      {phase !== 'waiting' && (
        <SettingsFormActions>
          <Button
            type="button"
            onClick={() =>
              onFinished(
                phase === 'granted'
                  ? 'GitHub authorization grant recorded.'
                  : 'Authorization progress closed.',
              )
            }
          >
            Close
          </Button>
          {phase && phase !== 'granted' && operationId && (
            <Button
              type="button"
              disabled={busy || completionUnknown}
              onClick={() =>
                void execute({
                  type: 'retry-github-authorization',
                  expectedConfigurationVersion: configurationVersion,
                  operationId,
                })
              }
            >
              Retry authorization
            </Button>
          )}
        </SettingsFormActions>
      )}
    </Modal>
  )
}
