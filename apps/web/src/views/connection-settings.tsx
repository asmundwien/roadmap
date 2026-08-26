import type {
  AuthorizationOperation,
  Command,
  CommandOutcome,
  Connection,
  RegisteredProject,
  SafeError,
  SupportedIntegration,
} from '@roadmap/contracts'
import { type FormEvent, useState } from 'react'
import { projectHash } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import {
  ErrorText,
  IntegrationBadge,
  locatorLabel,
  observedLabel,
  projectIdentity,
  SettingsAlert,
  SettingsPane,
} from './settings-shared.tsx'
import './settings.css'

type ConnectionPane =
  | { kind: 'add' }
  | { kind: 'edit'; connectionId: string }
  | { kind: 'authorization'; operationId: string }

interface ConnectionOperation {
  execute(command: Command): Promise<CommandOutcome>
}

export function ConnectionSettings() {
  const {
    connections,
    projects,
    supportedIntegrations,
    authorizationOperations,
    configuration,
    configurationVersion,
    command,
    execute,
  } = useRoadmap()
  const [pane, setPane] = useState<ConnectionPane | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<SafeError | string | null>(null)
  const github = supportedIntegrations.find(
    (integration): integration is Extract<SupportedIntegration, { integration: 'github' }> =>
      integration.integration === 'github',
  )
  const blocked = command.inFlight || !configuration.valid
  const operation: ConnectionOperation = { execute }
  const looseOperations = authorizationOperations.filter(
    (authorization) =>
      !authorization.connectionId &&
      authorization.status !== 'granted' &&
      authorization.status !== 'cancelled',
  )

  return (
    <main className="shell settings-shell">
      <header className="settings-head">
        <div>
          <p className="settings-eyebrow">Settings</p>
          <h1>Connections</h1>
          <p className="muted">{connections.length} configured</p>
        </div>
        <button
          className="settings-action is-strong"
          type="button"
          disabled={blocked || !github}
          onClick={() => setPane({ kind: 'add' })}
        >
          Add connection
        </button>
      </header>

      {!github && (
        <SettingsAlert>
          <strong>GitHub Connections are unavailable.</strong>
          <span>Configure the Roadmap GitHub App to authorize GitHub accounts.</span>
        </SettingsAlert>
      )}
      {!configuration.valid && (
        <SettingsAlert>
          <strong>Configuration needs repair.</strong>
          <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
        </SettingsAlert>
      )}
      {configuration.notices.map((message) => (
        <SettingsAlert tone="info" key={message}>
          {message}
        </SettingsAlert>
      ))}
      {notice && <SettingsAlert tone="info">{notice}</SettingsAlert>}
      <ErrorText error={operationError} />

      {looseOperations.map((authorization) => (
        <button
          className="settings-operation"
          type="button"
          key={authorization.id}
          onClick={() => setPane({ kind: 'authorization', operationId: authorization.id })}
        >
          <span>
            <strong>GitHub authorization · {authorizationStatus(authorization)}</strong>
            <small>{authorization.cause ?? 'Open the device authorization progress.'}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      ))}

      <div className="connection-road">
        {connections.map((connection) => {
          const dependents = projects.filter((project) => project.connectionId === connection.id)
          const authorization = connectionAuthorization(authorizationOperations, connection.id)
          return (
            <ConnectionStride
              key={connection.id}
              connection={connection}
              dependents={dependents}
              authorization={authorization}
              github={github}
              blocked={blocked}
              onAuthorize={() => {
                if (authorization) {
                  setPane({ kind: 'authorization', operationId: authorization.id })
                } else {
                  void beginAuthorization({
                    connection,
                    configurationVersion,
                    operation,
                    setError: setOperationError,
                    onStarted: (operationId) => setPane({ kind: 'authorization', operationId }),
                  })
                }
              }}
              onEdit={() => setPane({ kind: 'edit', connectionId: connection.id })}
            />
          )
        })}

        <button
          className="connection-add"
          type="button"
          disabled={blocked || !github}
          onClick={() => setPane({ kind: 'add' })}
        >
          <span className="settings-node is-open" aria-hidden="true">
            +
          </span>
          <span className="settings-copy">
            <strong>Add GitHub Connection</strong>
            <span>Authorize repositories selected for the Roadmap GitHub App.</span>
          </span>
        </button>
      </div>

      {github && (
        <div className="connection-resource-band">
          <p className="settings-eyebrow">GitHub access</p>
          <a href={github.newInstallationUrl} target="_blank" rel="noreferrer">
            Install Roadmap on repositories ↗
          </a>
          <a href={github.installationsUrl} target="_blank" rel="noreferrer">
            Manage repository access ↗
          </a>
          <a href={github.authorizationsUrl} target="_blank" rel="noreferrer">
            Manage GitHub authorizations ↗
          </a>
        </div>
      )}

      {pane?.kind === 'add' && github && (
        <AddConnectionPane
          operation={operation}
          configurationVersion={configurationVersion}
          onClose={() => setPane(null)}
          onStarted={(operationId) => setPane({ kind: 'authorization', operationId })}
        />
      )}
      {pane?.kind === 'authorization' &&
        (() => {
          const authorization = authorizationOperations.find(
            (candidate) => candidate.id === pane.operationId,
          )
          if (!authorization) return null
          return (
            <AuthorizationPane
              authorization={authorization}
              operation={operation}
              configurationVersion={configurationVersion}
              onClose={() => setPane(null)}
              onFinished={(message) => {
                setPane(null)
                setNotice(message)
              }}
            />
          )
        })()}
      {pane?.kind === 'edit' &&
        (() => {
          const connection = connections.find((candidate) => candidate.id === pane.connectionId)
          if (!connection) return null
          return (
            <EditConnectionPane
              connection={connection}
              dependents={projects.filter((project) => project.connectionId === connection.id)}
              operation={operation}
              configurationVersion={configurationVersion}
              onClose={() => setPane(null)}
              onChanged={(message) => {
                setPane(null)
                setNotice(message)
              }}
            />
          )
        })()}
    </main>
  )
}

function ConnectionStride({
  connection,
  dependents,
  authorization,
  github,
  blocked,
  onAuthorize,
  onEdit,
}: {
  connection: Connection
  dependents: RegisteredProject[]
  authorization: AuthorizationOperation | undefined
  github: Extract<SupportedIntegration, { integration: 'github' }> | undefined
  blocked: boolean
  onAuthorize: () => void
  onEdit: () => void
}) {
  const healthy = connection.availability.status === 'available'
  const reauthenticationAvailable =
    connection.availability.status !== 'available' || authorization?.status === 'waiting'
  return (
    <section className="connection-stride">
      <div className="connection-main">
        <span
          className={`settings-node ${healthy ? 'is-active' : 'is-blocked'}`}
          aria-hidden="true"
        >
          {connection.integration === 'github' ? 'G' : 'L'}
        </span>
        <span className="settings-copy">
          <span className="settings-kicker">
            {connection.githubIdentity
              ? `@${connection.githubIdentity.login}`
              : connection.builtIn
                ? 'Built in'
                : 'GitHub'}
          </span>
          <strong>{connection.name}</strong>
          <span>
            {connectionAvailability(connection)} · {dependents.length} registered{' '}
            {dependents.length === 1 ? 'Project' : 'Projects'}
          </span>
        </span>
        <span className="connection-actions">
          {connection.integration === 'github' && reauthenticationAvailable && (
            <button
              className="settings-action is-strong"
              type="button"
              disabled={blocked}
              onClick={onAuthorize}
            >
              {authorization?.status === 'waiting' ? 'Authorization progress' : 'Reauthenticate'}
            </button>
          )}
          {connection.builtIn ? (
            <span className="settings-badge is-local">Built in</span>
          ) : (
            <button className="settings-action" type="button" disabled={blocked} onClick={onEdit}>
              Manage
            </button>
          )}
        </span>
      </div>

      {connection.availability.status !== 'available' && (
        <SettingsAlert>
          <strong>{connectionAvailability(connection)}</strong>
          <span>{connection.availability.cause}</span>
        </SettingsAlert>
      )}

      {dependents.map((project) => (
        <a
          className="connection-dependent"
          href={projectHash(project.key)}
          key={projectIdentity(project)}
        >
          <span className="connection-branch" aria-hidden="true" />
          <span>
            <strong>{project.name}</strong>
            <small>{locatorLabel(project)}</small>
          </span>
          <span>{project.availability.status === 'available' ? 'Project ›' : 'Unavailable ›'}</span>
        </a>
      ))}
      {dependents.length === 0 && (
        <p className="connection-empty">No registered Projects use this Connection.</p>
      )}
      {connection.integration === 'github' && github && (
        <div className="connection-inline-links">
          <a href={github.installationsUrl} target="_blank" rel="noreferrer">
            Repository access ↗
          </a>
        </div>
      )}
    </section>
  )
}

function AddConnectionPane({
  operation,
  configurationVersion,
  onClose,
  onStarted,
}: {
  operation: ConnectionOperation
  configurationVersion: number
  onClose: () => void
  onStarted: (operationId: string) => void
}) {
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
        <SettingsAlert tone="info">
          Credentials are saved in macOS Keychain. They never enter roadmap.config.json or the
          browser.
        </SettingsAlert>
        <ErrorText error={error} />
        <div className="settings-form-actions">
          <button className="settings-action" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="settings-action is-strong" type="submit" disabled={busy}>
            {busy ? 'Starting…' : 'Start authorization'}
          </button>
        </div>
      </form>
    </SettingsPane>
  )
}

function AuthorizationPane({
  authorization,
  operation,
  configurationVersion,
  onClose,
  onFinished,
}: {
  authorization: AuthorizationOperation
  operation: ConnectionOperation
  configurationVersion: number
  onClose: () => void
  onFinished: (message: string) => void
}) {
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
          <div className="settings-action-band">
            {authorization.verificationUri && (
              <a
                className="settings-action is-strong"
                href={authorization.verificationUri}
                target="_blank"
                rel="noreferrer"
              >
                Open GitHub
              </a>
            )}
            <button
              className="settings-action"
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
            </button>
            <button
              className="settings-action is-danger"
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
            </button>
          </div>
        </>
      )}

      {authorization.status === 'granted' && (
        <SettingsAlert tone="info">
          <strong>GitHub authorized.</strong>
          <span>The Connection is saved and reconciliation has started.</span>
        </SettingsAlert>
      )}
      {authorization.status !== 'waiting' && authorization.status !== 'granted' && (
        <SettingsAlert>
          <strong>{authorizationStatus(authorization)}</strong>
          <span>{authorization.cause}</span>
        </SettingsAlert>
      )}
      <ErrorText error={error} />

      {authorization.status !== 'waiting' && (
        <div className="settings-form-actions">
          <button
            className="settings-action"
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
          </button>
          {authorization.status !== 'granted' && (
            <button
              className="settings-action is-strong"
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
            </button>
          )}
        </div>
      )}
    </SettingsPane>
  )
}

function EditConnectionPane({
  connection,
  dependents,
  operation,
  configurationVersion,
  onClose,
  onChanged,
}: {
  connection: Connection
  dependents: RegisteredProject[]
  operation: ConnectionOperation
  configurationVersion: number
  onClose: () => void
  onChanged: (message: string) => void
}) {
  const [error, setError] = useState<SafeError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)

  const execute = async (command: Command, success: string) => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await operation.execute(command)
      if (!outcome.ok) {
        setError(outcome.error)
        return
      }
      onChanged(success)
    } catch {
      setError('The server did not confirm the change. Wait for live state before retrying.')
    } finally {
      setBusy(false)
    }
  }

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) {
      setError('Enter a Connection name.')
      return
    }
    void execute(
      {
        type: 'rename-connection',
        expectedConfigurationVersion: configurationVersion,
        connectionId: connection.id,
        name,
      },
      `${connection.name} renamed.`,
    )
  }

  return (
    <SettingsPane label={`Manage ${connection.name}`} onClose={onClose}>
      <header className="settings-flow-head">
        <p className="settings-eyebrow">Connection</p>
        <h2>Manage {connection.name}</h2>
        <p>{connectionAvailability(connection)}</p>
      </header>
      <dl className="settings-facts">
        <dt>Integration</dt>
        <dd>
          <IntegrationBadge connection={connection} />
        </dd>
        <dt>GitHub user</dt>
        <dd>
          {connection.githubIdentity ? `@${connection.githubIdentity.login}` : 'Not available'}
        </dd>
        <dt>Observed</dt>
        <dd>{observedLabel(connection.availability.observedAt)}</dd>
        <dt>Dependent Projects</dt>
        <dd>{dependents.length}</dd>
      </dl>
      <form className="settings-form" onSubmit={rename}>
        <label>
          Connection name
          <input name="name" defaultValue={connection.name} />
        </label>
        <div className="settings-form-actions">
          <button className="settings-action is-strong" type="submit" disabled={busy}>
            Save name
          </button>
        </div>
      </form>
      <ErrorText error={error} />

      <section className="settings-danger">
        <p className="settings-eyebrow">Remove Connection</p>
        {dependents.length > 0 ? (
          <>
            <p>
              Remove every dependent Project registration first. Reassignment and cascade removal
              are unavailable.
            </p>
            <div className="settings-dependent-list">
              {dependents.map((project) => (
                <a href={projectHash(project.key)} key={projectIdentity(project)}>
                  <span>
                    <strong>{project.name}</strong>
                    <small>{locatorLabel(project)}</small>
                  </span>
                  <span>Project ›</span>
                </a>
              ))}
            </div>
            <button className="settings-action is-danger" type="button" disabled>
              Remove connection
            </button>
          </>
        ) : confirmingRemoval ? (
          <>
            <p>External GitHub authorization and repositories remain unchanged.</p>
            <div className="settings-action-band">
              <button
                className="settings-action"
                type="button"
                onClick={() => setConfirmingRemoval(false)}
              >
                Keep connection
              </button>
              <button
                className="settings-action is-danger"
                type="button"
                disabled={busy}
                onClick={() =>
                  void execute(
                    {
                      type: 'remove-connection',
                      expectedConfigurationVersion: configurationVersion,
                      connectionId: connection.id,
                    },
                    `${connection.name} removed. External repositories were not changed.`,
                  )
                }
              >
                Confirm removal
              </button>
            </div>
          </>
        ) : (
          <button
            className="settings-action is-danger"
            type="button"
            onClick={() => setConfirmingRemoval(true)}
          >
            Remove connection
          </button>
        )}
      </section>
    </SettingsPane>
  )
}

async function beginAuthorization({
  connection,
  configurationVersion,
  operation,
  setError,
  onStarted,
}: {
  connection: Connection
  configurationVersion: number
  operation: ConnectionOperation
  setError: (error: SafeError | string | null) => void
  onStarted: (operationId: string) => void
}) {
  setError(null)
  try {
    const outcome = await operation.execute({
      type: 'begin-github-authorization',
      expectedConfigurationVersion: configurationVersion,
      connectionId: connection.id,
      name: connection.name,
    })
    if (!outcome.ok) {
      setError(outcome.error)
      return
    }
    if (outcome.result.type === 'authorization-started') onStarted(outcome.result.operationId)
  } catch {
    setError('The server did not confirm authorization. Wait for live state before retrying.')
  }
}

function connectionAuthorization(
  operations: AuthorizationOperation[],
  connectionId: string,
): AuthorizationOperation | undefined {
  const related = operations.filter((operation) => operation.connectionId === connectionId)
  return related.findLast((operation) => operation.status === 'waiting') ?? related.at(-1)
}

function connectionAvailability(connection: Connection): string {
  switch (connection.availability.status) {
    case 'available':
      return 'Available'
    case 'degraded':
      return 'Observation degraded'
    case 'authorization-required':
      return 'Authorization required'
    case 'unavailable':
      return 'Unavailable'
  }
}

function authorizationStatus(authorization: AuthorizationOperation): string {
  switch (authorization.status) {
    case 'waiting':
      return 'Waiting for GitHub'
    case 'granted':
      return 'Authorized'
    case 'denied':
      return 'Authorization denied'
    case 'expired':
      return 'Authorization expired'
    case 'cancelled':
      return 'Authorization cancelled'
    case 'failed':
      return 'Authorization failed'
  }
}
