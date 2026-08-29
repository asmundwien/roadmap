import type {
  AutomationEvidence,
  ClassificationAttempt,
  Command,
  ProjectKey,
  RegisteredProject,
  SafeError,
  WayfinderSession,
} from '@roadmap/contracts'
import { useMemo, useState } from 'react'
import { selectionHash } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import {
  type AutomationPresentation,
  type AutomationSummary,
  type AutomationTicketPresentation,
  presentAutomation,
} from './project-presentation.ts'
import { ErrorText, projectIdentity, SettingsAlert, sameProject } from './settings-shared.tsx'
import './settings.css'

type AutomationSelection = { kind: 'global' } | { kind: 'project'; project: ProjectKey }

function summaryForSelection(
  selection: AutomationSelection,
  presentation: AutomationPresentation,
): AutomationSummary {
  if (selection.kind === 'global') return presentation.global
  return (
    presentation.projects.find((entry) => sameProject(entry.project.key, selection.project))
      ?.summary ?? presentation.global
  )
}

function hasUnacknowledgedInterruption(
  project: ProjectKey,
  evidence: readonly AutomationEvidence[],
): boolean {
  return evidence.some(
    (entry) =>
      sameProject(entry.target.project, project) &&
      entry.wayfinder?.status === 'outcome-unknown' &&
      !entry.wayfinder.acknowledged,
  )
}

function projectPreferenceSummary(enabled: boolean, interrupted: boolean): string {
  if (interrupted) return 'Interrupted · acknowledgement required'
  return enabled ? 'Project preference on' : 'Project preference off'
}

function projectSwitchLabel(name: string, interrupted: boolean): string {
  return interrupted
    ? `Acknowledge interruption and enable Automation for ${name}`
    : `Enable Automation for ${name}`
}

function projectAutomationNotice(name: string, enabled: boolean, interrupted: boolean): string {
  if (!enabled) return `${name} disabled for Automation.`
  if (interrupted) return `${name} interruption acknowledged and Automation enabled.`
  return `${name} enabled for Automation.`
}

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
  const evidencePresentation = useMemo(
    () => presentAutomation({ projects, automation }),
    [automation, projects],
  )
  const selectedEvidence = summaryForSelection(selection, evidencePresentation)

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
                <AutomationRowSummary summary={evidencePresentation.global} />
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

          {projects.map((project, index) => {
            const preferred = automation.enabledProjects.some((key) =>
              sameProject(key, project.key),
            )
            const interrupted = hasUnacknowledgedInterruption(project.key, automation.evidence)
            const projectEnabled = preferred && !interrupted
            const effective = ready && automation.enabled && projectEnabled
            const selected = selectedProject && sameProject(selectedProject.key, project.key)
            const projectEvidence = evidencePresentation.projects[index]?.summary
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
                    <span>{projectPreferenceSummary(projectEnabled, interrupted)}</span>
                    {projectEvidence && <AutomationRowSummary summary={projectEvidence} />}
                  </span>
                  <StateLabel enabled={effective} />
                </button>
                <SwitchControl
                  label={projectSwitchLabel(project.name, interrupted)}
                  checked={projectEnabled}
                  disabled={blocked}
                  onChange={(enabled) =>
                    run(
                      {
                        type: 'set-project-automation-enabled',
                        project: project.key,
                        enabled,
                        expectedConfigurationVersion: configurationVersion,
                      },
                      projectAutomationNotice(project.name, enabled, interrupted),
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
          summary={selectedEvidence ?? evidencePresentation.global}
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
  summary,
}: {
  automation: ReturnType<typeof useRoadmap>['automation']
  preferred: boolean
  project: RegisteredProject | undefined
  summary: AutomationSummary
}) {
  return project ? (
    <ProjectAutomationDetail
      automation={automation}
      preferred={preferred}
      project={project}
      summary={summary}
    />
  ) : (
    <GlobalAutomationDetail automation={automation} summary={summary} />
  )
}

function ProjectAutomationDetail({
  automation,
  preferred,
  project,
  summary,
}: {
  automation: ReturnType<typeof useRoadmap>['automation']
  preferred: boolean
  project: RegisteredProject
  summary: AutomationSummary
}) {
  const ready = automation.availability.status === 'ready'
  const interrupted = hasUnacknowledgedInterruption(project.key, automation.evidence)
  const effective = ready && automation.enabled && preferred && !interrupted
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
        <dd>{preferred && !interrupted ? 'On' : 'Off'}</dd>
        {interrupted && (
          <>
            <dt>Session interruption</dt>
            <dd>Acknowledgement required</dd>
          </>
        )}
        <dt>Global Automation</dt>
        <dd>{automation.enabled ? 'On' : 'Off'}</dd>
        <dt>Harness Commands</dt>
        <dd>{ready ? 'Ready' : 'Unavailable'}</dd>
        <dt>Workspace</dt>
        <dd>{project.workspace.path}</dd>
      </dl>
      <AutomationEvidenceSummary summary={summary} />
      <p className="automation-explanation">
        {interrupted
          ? 'Turning this Project on acknowledges its interrupted Session before enabling queued work.'
          : 'Both switches and valid Harness Commands are required. Turning global Automation off keeps this Project preference.'}
      </p>
    </aside>
  )
}

function GlobalAutomationDetail({
  automation,
  summary,
}: {
  automation: ReturnType<typeof useRoadmap>['automation']
  summary: AutomationSummary
}) {
  const ready = automation.availability.status === 'ready'
  const effective = automation.enabled && ready
  return (
    <aside className="settings-detail automation-detail">
      <p className="settings-eyebrow">Global admission</p>
      <h2>Queued dispatch</h2>
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
      <AutomationEvidenceSummary summary={summary} />
      <p className="automation-explanation">
        Roadmap classifies each eligible frontier task once. An AFK result queues one Wayfinder
        Session; Roadmap launches at most one per Project without exposing queue position or order.
      </p>
    </aside>
  )
}

function AutomationRowSummary({ summary }: { summary: AutomationSummary }) {
  if (summary.tickets.length === 0) return null
  return (
    <span className="automation-row-summary">
      Classification {summary.classification.active} active / {summary.classification.terminal}{' '}
      terminal · Wayfinder {summary.wayfinder.queued} queued / {summary.wayfinder.active} active /{' '}
      {summary.wayfinder.terminal} terminal
    </span>
  )
}

function AutomationEvidenceSummary({ summary }: { summary: AutomationSummary }) {
  const ticketCount = summary.tickets.length
  return (
    <section className="automation-evidence" aria-label="Recorded Automation evidence">
      <div className="automation-evidence-head">
        <h3>Recorded evidence</h3>
        <span>{ticketCount === 1 ? '1 ticket' : `${ticketCount} tickets`}</span>
      </div>
      <div className="automation-stage-totals">
        <AutomationStageTotal label="Classification" summary={summary.classification} />
        <AutomationStageTotal label="Wayfinder" summary={summary.wayfinder} />
      </div>
      <p>
        Queued Wayfinder Sessions await admission. Active means Classification is running or
        Wayfinder is launching or running. Every other recorded stage is terminal. These counts do
        not interpret tracker state.
      </p>
      {ticketCount > 0 && (
        <details className="automation-evidence-tickets">
          <summary>Affected map tickets</summary>
          <div>
            {summary.tickets.map((entry) => (
              <AutomationEvidenceTicket
                entry={entry}
                key={`${entry.evidence.target.project.integration}:${entry.evidence.target.project.id}:${entry.evidence.target.mapId}:${entry.evidence.target.ticketId}`}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

function AutomationStageTotal({
  label,
  summary,
}: {
  label: string
  summary: AutomationSummary['classification'] | AutomationSummary['wayfinder']
}) {
  return (
    <div className="automation-stage-total">
      <span>{label}</span>
      {'queued' in summary && <strong>{summary.queued} queued</strong>}
      <strong className="is-active">{summary.active} active</strong>
      <strong>{summary.terminal} terminal</strong>
    </div>
  )
}

function AutomationEvidenceTicket({ entry }: { entry: AutomationTicketPresentation }) {
  const title =
    entry.ticket?.title ?? entry.ticket?.displayId ?? `Ticket ${entry.evidence.target.ticketId}`
  const project = entry.project?.name ?? entry.evidence.target.project.id
  const detail = `${project} · ${classificationEvidenceSummary(entry.evidence.classification)}${
    entry.evidence.wayfinder ? ` · ${wayfinderEvidenceSummary(entry.evidence.wayfinder)}` : ''
  }`
  const content = (
    <>
      <strong>{title}</strong>
      <small>{detail}</small>
    </>
  )

  return entry.map && entry.ticket ? (
    <a href={selectionHash(entry.map, { kind: 'ticket', id: entry.ticket.id })}>{content}</a>
  ) : (
    <span className="is-unlinked">{content}</span>
  )
}

function classificationEvidenceSummary(attempt: ClassificationAttempt): string {
  const state =
    attempt.status === 'completed'
      ? `${readableStatus(attempt.status)} (${attempt.verdict.value.toUpperCase()})`
      : readableStatus(attempt.status)
  return `Classification ${state} · ${attempt.admission} admission`
}

function wayfinderEvidenceSummary(session: WayfinderSession): string {
  if (session.status === 'queued') return 'Wayfinder queued · admission pending'
  const acknowledgement =
    session.status === 'outcome-unknown'
      ? ` · ${session.acknowledged ? 'acknowledged' : 'acknowledgement required'}`
      : ''
  return `Wayfinder ${readableStatus(session.status)} · ${session.admission} admission${acknowledgement}`
}

function readableStatus(status: string): string {
  return status.replaceAll('-', ' ')
}
