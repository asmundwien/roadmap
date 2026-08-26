import type { Command, ProjectKey, RegisteredProject, SafeError } from '@roadmap/contracts'
import { useState } from 'react'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import { ErrorText, projectIdentity, SettingsAlert, sameProject } from './settings-shared.tsx'
import './settings.css'

type AutomationSelection = { kind: 'global' } | { kind: 'project'; project: ProjectKey }

export function AutomationSettings() {
  const { automation, command, configuration, configurationVersion, execute, projects } =
    useRoadmap()
  const [selection, setSelection] = useState<AutomationSelection>({ kind: 'global' })
  const [notice, setNotice] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<SafeError | string | null>(null)
  const selectedProject =
    selection.kind === 'project'
      ? projects.find((project) => sameProject(project.key, selection.project))
      : undefined
  const blocked = command.inFlight || !configuration.valid
  const ready = automation.availability.status === 'ready'

  const run = async (next: Command, success: string) => {
    setNotice(null)
    setOperationError(null)
    try {
      const outcome = await execute(next)
      if (!outcome.ok) {
        setOperationError(outcome.error)
        return
      }
      setNotice(success)
    } catch {
      setOperationError(
        'The server did not confirm the change. Wait for live state before retrying.',
      )
    }
  }

  return (
    <main className="shell settings-shell">
      <header className="settings-head automation-head">
        <div>
          <p className="settings-eyebrow">Settings</p>
          <h1>Automation</h1>
          <p className="muted">One chance to hand an eligible frontier task to Wayfinder.</p>
        </div>
      </header>

      {!configuration.valid && (
        <SettingsAlert>
          <strong>Configuration needs repair.</strong>
          <span>Automation changes stay blocked until roadmap.config.json is valid.</span>
        </SettingsAlert>
      )}
      {configuration.issues.map((issue) => (
        <SettingsAlert key={`${issue.path}:${issue.message}`}>
          <strong>{issue.path}</strong>
          <span>{issue.message}</span>
        </SettingsAlert>
      ))}
      {automation.availability.status === 'unavailable' && (
        <SettingsAlert>
          <strong>Automation unavailable.</strong>
          <span>{automation.availability.cause}</span>
        </SettingsAlert>
      )}
      {notice && <SettingsAlert tone="info">{notice}</SettingsAlert>}
      <ErrorText error={operationError} />

      <div className="settings-layout automation-layout">
        <section className="automation-road" aria-label="Automation enablement">
          <div className="automation-row is-global">
            <button
              className={`automation-select${selection.kind === 'global' ? ' is-selected' : ''}`}
              type="button"
              onClick={() => setSelection({ kind: 'global' })}
            >
              <span
                className={`automation-node${automation.enabled && ready ? ' is-enabled' : ''}`}
                aria-hidden="true"
              >
                A
              </span>
              <span className="settings-copy">
                <strong>Automation</strong>
                <span>
                  {ready ? 'Harness Commands configured' : 'Harness Commands unavailable'}
                </span>
              </span>
              <StateLabel enabled={automation.enabled && ready} />
            </button>
            <SwitchControl
              label="Enable Automation globally"
              checked={automation.enabled}
              disabled={blocked || (!automation.enabled && !ready)}
              onChange={(enabled) =>
                run(
                  {
                    type: 'set-automation-enabled',
                    enabled,
                    expectedConfigurationVersion: configurationVersion,
                  },
                  enabled ? 'Automation enabled globally.' : 'Automation disabled globally.',
                )
              }
            />
          </div>

          {projects.map((project) => {
            const preferred = automation.enabledProjects.some((key) =>
              sameProject(key, project.key),
            )
            const effective = ready && automation.enabled && preferred
            const selected = selectedProject && sameProject(selectedProject.key, project.key)
            return (
              <div className="automation-row" key={projectIdentity(project)}>
                <button
                  className={`automation-select${selected ? ' is-selected' : ''}`}
                  type="button"
                  onClick={() => setSelection({ kind: 'project', project: project.key })}
                >
                  <span
                    className={`automation-node${effective ? ' is-enabled' : ''}`}
                    aria-hidden="true"
                  >
                    {project.key.integration === 'github' ? 'G' : 'L'}
                  </span>
                  <span className="settings-copy">
                    <strong>{project.name}</strong>
                    <span>{preferred ? 'Project preference on' : 'Project preference off'}</span>
                  </span>
                  <StateLabel enabled={effective} />
                </button>
                <SwitchControl
                  label={`Enable Automation for ${project.name}`}
                  checked={preferred}
                  disabled={blocked}
                  onChange={(enabled) =>
                    run(
                      {
                        type: 'set-project-automation-enabled',
                        project: project.key,
                        enabled,
                        expectedConfigurationVersion: configurationVersion,
                      },
                      enabled
                        ? `${project.name} enabled for Automation.`
                        : `${project.name} disabled for Automation.`,
                    )
                  }
                />
              </div>
            )
          })}

          {projects.length === 0 && (
            <div className="settings-empty automation-empty">
              <strong>No Projects registered.</strong>
              <span>Register a Project before enabling one for Automation.</span>
            </div>
          )}
        </section>

        <AutomationDetail
          automation={automation}
          project={selectedProject}
          preferred={
            selectedProject
              ? automation.enabledProjects.some((key) => sameProject(key, selectedProject.key))
              : false
          }
        />
      </div>
    </main>
  )
}

function SwitchControl({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="automation-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span aria-hidden="true" />
    </label>
  )
}

function StateLabel({ enabled }: { enabled: boolean }) {
  return (
    <span className={`automation-state${enabled ? ' is-enabled' : ''}`}>
      {enabled ? 'On' : 'Off'}
    </span>
  )
}

function AutomationDetail({
  automation,
  preferred,
  project,
}: {
  automation: ReturnType<typeof useRoadmap>['automation']
  preferred: boolean
  project: RegisteredProject | undefined
}) {
  return project ? (
    <ProjectAutomationDetail automation={automation} preferred={preferred} project={project} />
  ) : (
    <GlobalAutomationDetail automation={automation} />
  )
}

function ProjectAutomationDetail({
  automation,
  preferred,
  project,
}: {
  automation: ReturnType<typeof useRoadmap>['automation']
  preferred: boolean
  project: RegisteredProject
}) {
  const ready = automation.availability.status === 'ready'
  const effective = ready && automation.enabled && preferred
  return (
    <aside className="settings-detail automation-detail">
      <p className="settings-eyebrow">Project enablement</p>
      <h2>{project.name}</h2>
      <p className="automation-verdict">
        <span className={`automation-node${effective ? ' is-enabled' : ''}`} aria-hidden="true">
          {effective ? '✓' : '–'}
        </span>
        <strong>{effective ? 'Effectively enabled' : 'Not effectively enabled'}</strong>
      </p>
      <dl className="settings-facts">
        <dt>Project preference</dt>
        <dd>{preferred ? 'On' : 'Off'}</dd>
        <dt>Global Automation</dt>
        <dd>{automation.enabled ? 'On' : 'Off'}</dd>
        <dt>Harness Commands</dt>
        <dd>{ready ? 'Ready' : 'Unavailable'}</dd>
        <dt>Workspace</dt>
        <dd>{project.workspace.path}</dd>
      </dl>
      <p className="automation-explanation">
        Both switches and valid Harness Commands are required. Turning global Automation off keeps
        this Project preference.
      </p>
    </aside>
  )
}

function GlobalAutomationDetail({
  automation,
}: {
  automation: ReturnType<typeof useRoadmap>['automation']
}) {
  const ready = automation.availability.status === 'ready'
  const effective = automation.enabled && ready
  return (
    <aside className="settings-detail automation-detail">
      <p className="settings-eyebrow">Global admission</p>
      <h2>One-shot dispatch</h2>
      <p className="automation-verdict">
        <span className={`automation-node${effective ? ' is-enabled' : ''}`} aria-hidden="true">
          {effective ? '✓' : '–'}
        </span>
        <strong>{effective ? 'Accepting new work' : 'Not accepting new work'}</strong>
      </p>
      <dl className="settings-facts">
        <dt>Global switch</dt>
        <dd>{automation.enabled ? 'On' : 'Off'}</dd>
        <dt>Harness Commands</dt>
        <dd>{ready ? 'Ready' : 'Unavailable'}</dd>
        <dt>Project preferences</dt>
        <dd>{automation.enabledProjects.length} on</dd>
      </dl>
      <p className="automation-explanation">
        Roadmap classifies each eligible frontier task once. An AFK result starts one detached
        Wayfinder session; Roadmap does not supervise it.
      </p>
    </aside>
  )
}
