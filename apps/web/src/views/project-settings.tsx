import type {
  Command,
  CommandOutcome,
  Connection,
  ProjectKey,
  ProjectRegistrationCandidate,
  Query,
  QueryResult,
  RegisteredProject,
  SafeError,
} from '@roadmap/contracts'
import { type FormEvent, useState } from 'react'
import { projectHash } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import {
  ErrorText,
  IntegrationBadge,
  locatorLabel,
  mapState,
  markerFor,
  observedLabel,
  projectIdentity,
  SettingsAlert,
  SettingsPane,
  sameProject,
} from './settings-shared.tsx'
import './settings.css'

interface ProjectSettingsOperation {
  query(query: Query): Promise<QueryResult>
  execute(command: Command): Promise<CommandOutcome>
}

type ProjectPane = { kind: 'add' } | { kind: 'edit'; project: ProjectKey }

export function ProjectSettings() {
  const {
    projects,
    connections,
    supportedIntegrations,
    configuration,
    configurationVersion,
    command,
    query,
    execute,
  } = useRoadmap()
  const [selectedKey, setSelectedKey] = useState<ProjectKey | null>(null)
  const [pane, setPane] = useState<ProjectPane | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<SafeError | string | null>(null)
  const selected =
    (selectedKey && projects.find((project) => sameProject(project.key, selectedKey))) ??
    projects[0]
  const selectedConnection = selected
    ? connections.find((connection) => connection.id === selected.connectionId)
    : undefined
  const githubInstallationUrl = supportedIntegrations.find(
    (integration) => integration.integration === 'github',
  )?.newInstallationUrl
  const operation: ProjectSettingsOperation = { query, execute }
  const blocked = command.inFlight || !configuration.valid

  const run = async (next: Command, success: string) => {
    setOperationError(null)
    try {
      const outcome = await execute(next)
      if (!outcome.ok) {
        setOperationError(outcome.error)
        return false
      }
      setNotice(success)
      return true
    } catch {
      setOperationError(
        'The server did not confirm the operation. Wait for live state before retrying.',
      )
      return false
    }
  }

  return (
    <main className="shell settings-shell">
      <header className="settings-head">
        <div>
          <p className="settings-eyebrow">Settings</p>
          <h1>Projects</h1>
          <p className="muted">{projects.length} registered</p>
        </div>
        <button
          className="settings-action is-strong"
          type="button"
          disabled={blocked || connections.length === 0}
          onClick={() => setPane({ kind: 'add' })}
        >
          Add project
        </button>
      </header>

      {!configuration.valid && (
        <SettingsAlert>
          <strong>Configuration needs repair.</strong>
          <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
        </SettingsAlert>
      )}
      {configuration.issues.map((issue) => (
        <SettingsAlert key={`${issue.path}:${issue.message}`}>
          <strong>{issue.path}</strong>
          <span>{issue.message}</span>
        </SettingsAlert>
      ))}
      {configuration.notices.map((message) => (
        <SettingsAlert tone="info" key={message}>
          {message}
        </SettingsAlert>
      ))}
      {notice && <SettingsAlert tone="info">{notice}</SettingsAlert>}
      <ErrorText error={operationError} />

      <div className="settings-layout">
        <section className="settings-road" aria-label="Registered projects">
          {projects.map((project) => {
            const connection = connections.find(
              (candidate) => candidate.id === project.connectionId,
            )
            const marker = markerFor(project)
            return (
              <button
                className={`settings-row${project === selected ? ' is-selected' : ''}`}
                type="button"
                key={projectIdentity(project)}
                onClick={() => setSelectedKey(project.key)}
              >
                <span className={`settings-node ${marker.className}`} aria-hidden="true">
                  {marker.glyph}
                </span>
                <span className="settings-copy">
                  <strong>{project.name}</strong>
                  <span>{locatorLabel(project)}</span>
                </span>
                <span className="settings-row-meta">
                  <span>
                    <IntegrationBadge connection={connection} />{' '}
                    {connection?.name ?? 'Unknown Connection'}
                  </span>
                  <span>
                    {project.availability.status === 'unavailable'
                      ? `Unavailable · ${project.availability.cause}`
                      : mapState(project)}
                  </span>
                </span>
              </button>
            )
          })}
          {projects.length === 0 && (
            <div className="settings-empty">
              <strong>No Projects registered.</strong>
              <span>Add a readable local Workspace to begin.</span>
            </div>
          )}
        </section>

        {selected && (
          <ProjectDetail
            project={selected}
            connection={selectedConnection}
            busy={blocked}
            executeAction={(commandValue, success) => run(commandValue, success)}
            configurationVersion={configurationVersion}
            onEdit={() => setPane({ kind: 'edit', project: selected.key })}
          />
        )}
      </div>

      {pane?.kind === 'add' && (
        <AddProjectPane
          connections={connections}
          githubInstallationUrl={githubInstallationUrl}
          operation={operation}
          configurationVersion={configurationVersion}
          onClose={() => setPane(null)}
          onSaved={(project) => {
            if (project) setSelectedKey(project)
            setPane(null)
            setNotice('Project validated, registered, and queued for reconciliation.')
          }}
        />
      )}
      {pane?.kind === 'edit' &&
        (() => {
          const project = projects.find((candidate) => sameProject(candidate.key, pane.project))
          if (!project) return null
          return (
            <EditProjectPane
              project={project}
              connection={connections.find((candidate) => candidate.id === project.connectionId)}
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

function ProjectDetail({
  project,
  connection,
  busy,
  configurationVersion,
  executeAction,
  onEdit,
}: {
  project: RegisteredProject
  connection: Connection | undefined
  busy: boolean
  configurationVersion: number
  executeAction: (command: Command, success: string) => Promise<boolean>
  onEdit: () => void
}) {
  const unavailableCause =
    project.availability.status === 'unavailable' ? project.availability.cause : null
  const connectionProblem = connection?.availability.status !== 'available'
  const mapCount = project.openMaps.length + project.closedMaps.length

  return (
    <aside className="settings-detail">
      <div className="settings-detail-kicker">
        <span className="settings-eyebrow">Project registration</span>
        <IntegrationBadge connection={connection} />
      </div>
      <h2>{project.name}</h2>
      {connectionProblem && connection && (
        <SettingsAlert>
          <strong>{connection.name} is not available.</strong>
          <span>
            {connection.availability.status === 'available' ? '' : connection.availability.cause}
          </span>
        </SettingsAlert>
      )}
      {unavailableCause && (
        <SettingsAlert>
          <strong>Project unavailable.</strong>
          <span>{unavailableCause}</span>
        </SettingsAlert>
      )}
      {project.warnings.map((warning) => (
        <SettingsAlert key={warning}>
          <span>{warning}</span>
        </SettingsAlert>
      ))}
      {mapCount === 0 && (
        <SettingsAlert tone="info">
          <strong>No Wayfinder maps yet.</strong>
          <span>The Project remains registered and will appear when its first map is created.</span>
        </SettingsAlert>
      )}

      <dl className="settings-facts">
        <dt>Display name</dt>
        <dd>{project.name}</dd>
        <dt>Connection</dt>
        <dd>{connection?.name ?? project.connectionId}</dd>
        <dt>Locator</dt>
        <dd>{locatorLabel(project)}</dd>
        <dt>Workspace</dt>
        <dd>{project.workspace.path}</dd>
        <dt>Route identity</dt>
        <dd>{projectIdentity(project)}</dd>
        <dt>Availability</dt>
        <dd>{unavailableCause ? 'Unavailable' : 'Available'}</dd>
        <dt>Observed</dt>
        <dd>{observedLabel(project.availability.observedAt)}</dd>
        <dt>Map state</dt>
        <dd>{mapState(project)}</dd>
      </dl>

      <div className="settings-links">
        <p className="settings-eyebrow">Open</p>
        {project.actions.map((action) =>
          action.kind === 'server-launch' ? (
            <button
              className="settings-link"
              type="button"
              key={action.id}
              disabled={busy}
              onClick={() =>
                void executeAction(
                  {
                    type: 'launch-action',
                    expectedConfigurationVersion: configurationVersion,
                    actionId: action.id,
                    project: project.key,
                  },
                  `${action.label} requested.`,
                )
              }
            >
              <span>
                <strong>{action.label}</strong>
                <small>{project.workspace.path}</small>
              </span>
              <span aria-hidden="true">↗</span>
            </button>
          ) : (
            <a
              className="settings-link"
              key={action.id}
              href={action.href ?? projectHash(project.key)}
              {...(action.kind === 'external-link' ? { target: '_blank', rel: 'noreferrer' } : {})}
            >
              <span>
                <strong>{action.label}</strong>
                <small>
                  {action.kind === 'roadmap'
                    ? 'Maps, decisions, and active work'
                    : locatorLabel(project)}
                </small>
              </span>
              <span aria-hidden="true">{action.kind === 'roadmap' ? '›' : '↗'}</span>
            </a>
          ),
        )}
      </div>

      <div className="settings-action-band">
        <button
          className="settings-action is-strong"
          type="button"
          disabled={busy}
          onClick={onEdit}
        >
          Edit registration
        </button>
        <button
          className="settings-action"
          type="button"
          disabled={busy}
          onClick={() =>
            void executeAction(
              {
                type: 'refresh-project',
                expectedConfigurationVersion: configurationVersion,
                project: project.key,
              },
              `${project.name} refreshed.`,
            )
          }
        >
          Refresh now
        </button>
      </div>
    </aside>
  )
}

function AddProjectPane({
  connections,
  githubInstallationUrl,
  operation,
  configurationVersion,
  onClose,
  onSaved,
}: {
  connections: Connection[]
  githubInstallationUrl: string | undefined
  operation: ProjectSettingsOperation
  configurationVersion: number
  onClose: () => void
  onSaved: (project: ProjectKey | undefined) => void
}) {
  const initialConnection = connections.find(
    (connection) => connection.availability.status === 'available',
  )
  const [connectionId, setConnectionId] = useState(
    initialConnection?.id ?? connections[0]?.id ?? '',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [workspacePath, setWorkspacePath] = useState('')
  const connection = connections.find((candidate) => candidate.id === connectionId)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const draft = projectRegistrationDraft(
      new FormData(event.currentTarget),
      connection,
      workspacePath,
    )
    setErrors(draft.errors)
    setGeneralError(null)
    if (!draft.candidate) return

    setSaving(true)
    try {
      const outcome = await operation.execute({
        type: 'register-project',
        expectedConfigurationVersion: configurationVersion,
        candidate: draft.candidate,
      })
      if (outcome.ok) {
        onSaved(admittedProjectKey(outcome.state.projects, draft.candidate))
        return
      }
      applyProjectError(outcome.error, setErrors, setGeneralError)
    } catch {
      setGeneralError(
        'The server did not confirm registration. Wait for live state before retrying.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPane label="Add project" onClose={onClose}>
      <header className="settings-flow-head">
        <p className="settings-eyebrow">Project registration</p>
        <h2>Add a project</h2>
        <p>Roadmap validates the whole registration before saving any part of it.</p>
      </header>
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <label>
          Connection
          <select
            name="connection"
            value={connectionId}
            onChange={(event) => {
              setConnectionId(event.target.value)
              setErrors({})
            }}
          >
            {connections.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.name} · {candidate.availability.status}
              </option>
            ))}
          </select>
          <FieldError message={errors.connection} />
        </label>

        {connection?.integration === 'github' ? (
          <>
            <WorkspaceFolderSelector
              label="Workspace"
              description="Roadmap derives and verifies the repository from this Git worktree's origin remote."
              path={workspacePath}
              error={errors.workspace}
              disabled={saving}
              operation={operation}
              onChange={(path) => {
                setWorkspacePath(path)
                setErrors({})
              }}
            />
            <SettingsAlert tone="info">
              <span>GitHub authorization and repository installation are separate grants.</span>
              {githubInstallationUrl && (
                <a
                  className="settings-action"
                  href={githubInstallationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Configure repository access ↗
                </a>
              )}
            </SettingsAlert>
          </>
        ) : (
          <WorkspaceFolderSelector
            label="Project folder and Workspace"
            description="Local uses this one readable folder as both locator and Workspace."
            path={workspacePath}
            error={errors.folder}
            disabled={saving}
            operation={operation}
            onChange={(path) => {
              setWorkspacePath(path)
              setErrors({})
            }}
          />
        )}

        <label>
          Display name
          <input name="displayName" placeholder="Optional" />
        </label>
        <ErrorText error={generalError} />
        <div className="settings-form-actions">
          <button className="settings-action" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="settings-action is-strong" type="submit" disabled={saving}>
            {saving ? 'Validating…' : 'Validate and save'}
          </button>
        </div>
      </form>
    </SettingsPane>
  )
}

function EditProjectPane({
  project,
  connection,
  operation,
  configurationVersion,
  onClose,
  onChanged,
}: {
  project: RegisteredProject
  connection: Connection | undefined
  operation: ProjectSettingsOperation
  configurationVersion: number
  onClose: () => void
  onChanged: (message: string) => void
}) {
  const [error, setError] = useState<SafeError | string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [busy, setBusy] = useState(false)
  const [workspacePath, setWorkspacePath] = useState('')

  const execute = async (command: Command, success: string, errorField?: string) => {
    setBusy(true)
    setError(null)
    setFieldError(null)
    try {
      const outcome = await operation.execute(command)
      if (!outcome.ok) {
        if (errorField && outcome.error.field?.includes(errorField))
          setFieldError(outcome.error.message)
        else setError(outcome.error)
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
      setFieldError('Enter a display name.')
      return
    }
    void execute(
      {
        type: 'rename-project',
        expectedConfigurationVersion: configurationVersion,
        project: project.key,
        name,
      },
      `${project.name} renamed.`,
      'name',
    )
  }

  const repair = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const path = workspacePath.trim()
    if (!path) {
      setFieldError('Choose the moved Workspace.')
      return
    }
    void execute(
      {
        type: 'repair-project-workspace',
        expectedConfigurationVersion: configurationVersion,
        project: project.key,
        workspace: { path },
      },
      `${project.name} Workspace repaired.`,
      'workspace',
    )
  }

  return (
    <SettingsPane label={`Edit ${project.name}`} onClose={onClose}>
      <header className="settings-flow-head">
        <p className="settings-eyebrow">Project registration</p>
        <h2>Edit {project.name}</h2>
        <p>Connection, locator, and Workspace binding stay immutable.</p>
      </header>
      <dl className="settings-facts">
        <dt>Connection</dt>
        <dd>{connection?.name ?? project.connectionId}</dd>
        <dt>Locator</dt>
        <dd>{locatorLabel(project)}</dd>
        <dt>Workspace</dt>
        <dd>{project.workspace.path}</dd>
      </dl>
      <form className="settings-form" onSubmit={rename}>
        <label>
          Display name
          <input name="name" defaultValue={project.name} />
          <FieldError message={fieldError ?? undefined} />
        </label>
        <div className="settings-form-actions">
          <button className="settings-action is-strong" type="submit" disabled={busy}>
            Save name
          </button>
        </div>
      </form>

      {project.availability.status === 'unavailable' && (
        <form className="settings-form settings-repair" onSubmit={repair}>
          <div>
            <p className="settings-eyebrow">Moved Workspace</p>
            <p>Repair requires proof of the same Project identity.</p>
          </div>
          <WorkspaceFolderSelector
            label="New Workspace"
            description="Choose the moved folder that contains the same Project."
            path={workspacePath}
            error={fieldError ?? undefined}
            disabled={busy}
            operation={operation}
            onChange={(path) => {
              setWorkspacePath(path)
              setFieldError(null)
            }}
          />
          <div className="settings-form-actions">
            <button className="settings-action is-strong" type="submit" disabled={busy}>
              Validate and repair
            </button>
          </div>
        </form>
      )}

      <ErrorText error={error} />
      <section className="settings-danger">
        <p className="settings-eyebrow">Remove from Roadmap</p>
        <p>The source repository, Wayfinder state, and Workspace remain unchanged.</p>
        {confirmingRemoval ? (
          <div className="settings-action-band">
            <button
              className="settings-action"
              type="button"
              onClick={() => setConfirmingRemoval(false)}
            >
              Keep project
            </button>
            <button
              className="settings-action is-danger"
              type="button"
              disabled={busy}
              onClick={() =>
                void execute(
                  {
                    type: 'remove-project',
                    expectedConfigurationVersion: configurationVersion,
                    project: project.key,
                  },
                  `${project.name} removed from Roadmap. Its source and Workspace were not changed.`,
                )
              }
            >
              Confirm removal
            </button>
          </div>
        ) : (
          <button
            className="settings-action is-danger"
            type="button"
            onClick={() => setConfirmingRemoval(true)}
          >
            Remove project registration
          </button>
        )}
      </section>
    </SettingsPane>
  )
}

function WorkspaceFolderSelector({
  label,
  description,
  path,
  error,
  disabled,
  operation,
  onChange,
}: {
  label: string
  description: string
  path: string
  error: string | undefined
  disabled: boolean
  operation: ProjectSettingsOperation
  onChange: (path: string) => void
}) {
  const [choosing, setChoosing] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)

  const choose = async () => {
    setChoosing(true)
    setSelectionError(null)
    try {
      const result = await operation.query({ type: 'select-workspace' })
      if (!result.ok) setSelectionError(result.error.message)
      else if (result.type !== 'workspace-selection')
        setSelectionError('The server returned an unexpected folder selection result.')
      else if (result.path) onChange(result.path)
    } catch {
      setSelectionError('The server did not return a folder selection.')
    } finally {
      setChoosing(false)
    }
  }

  return (
    <fieldset className="settings-folder-field">
      <legend>{label}</legend>
      <div className="settings-folder-control">
        <button
          className="settings-action is-strong"
          type="button"
          disabled={disabled || choosing}
          onClick={() => void choose()}
        >
          {choosing ? 'Choosing…' : path ? 'Choose another folder' : 'Choose folder'}
        </button>
        <output className={path ? '' : 'is-empty'} aria-live="polite">
          {path || 'No folder selected'}
        </output>
      </div>
      <small>{description}</small>
      <FieldError message={selectionError ?? error} />
    </fieldset>
  )
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="settings-field-error">{message}</span> : null
}

function applyProjectError(
  error: SafeError,
  setErrors: (value: Record<string, string>) => void,
  setGeneral: (value: string | null) => void,
) {
  const field = error.field ?? ''
  if (field === 'connectionId') setErrors({ connection: error.message })
  else if (field.startsWith('workspace'))
    setErrors({ workspace: error.message, folder: error.message })
  else setGeneral(error.message)
}
interface ProjectRegistrationDraft {
  candidate: ProjectRegistrationCandidate | null
  errors: Record<string, string>
}

function projectRegistrationDraft(
  data: FormData,
  connection: Connection | undefined,
  workspacePath: string,
): ProjectRegistrationDraft {
  if (!connection) return { candidate: null, errors: { connection: 'Choose a Connection.' } }
  const path = workspacePath.trim()
  if (!path) {
    const field = connection.integration === 'github' ? 'workspace' : 'folder'
    return { candidate: null, errors: { [field]: 'Choose a readable Workspace folder.' } }
  }
  const displayName = String(data.get('displayName') ?? '').trim()
  return {
    errors: {},
    candidate: {
      integration: connection.integration,
      connectionId: connection.id,
      workspace: { path },
      ...(displayName ? { displayName } : {}),
    },
  }
}

function admittedProjectKey(
  projects: RegisteredProject[],
  candidate: ProjectRegistrationCandidate,
): ProjectKey | undefined {
  return projects.find(
    (project) =>
      project.key.integration === candidate.integration &&
      project.connectionId === candidate.connectionId &&
      project.workspace.path === candidate.workspace.path,
  )?.key
}
