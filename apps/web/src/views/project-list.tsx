import type { ReactNode } from 'react'
import { connectionSettingsHash, projectHash } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import { integrationLabel } from './project-meta.ts'
import type { AttentionItem } from './project-presentation.ts'
import { type ProjectPresentation, presentProjects } from './project-presentation.ts'
import { formatMonth, formatRecency } from './recency.ts'
import './views.css'

/** The registration-led whole-product view: attention, active routes, ground covered, then fog. */
export function ProjectList() {
  const { transport, projects, connections, configuration, capturedAt } = useRoadmap()
  const portfolio = presentProjects({ projects, connections, configuration })

  return (
    <main className="shell overview-shell">
      <header className="overview-head">
        <h1>Roadmap</h1>
        <p className="muted">
          The whole of things
          {capturedAt !== null && ` · updated ${formatClock(capturedAt)}`}
        </p>
        <div className="overview-legend">
          <OverviewCount tone="decided" count={portfolio.projects.length} label="projects" />
          <OverviewCount tone="active" count={portfolio.active.length} label="active" />
          <OverviewCount tone="resting" count={portfolio.resting.length} label="at rest" />
          <OverviewCount
            tone="attention"
            count={portfolio.attention.length}
            label="need attention"
          />
        </div>
      </header>

      {transport === 'disconnected' && (
        <p className="banner" role="alert">
          Server unreachable — reconnecting.
          {capturedAt !== null && ` Showing the snapshot from ${formatClock(capturedAt)}.`}
        </p>
      )}

      {transport === 'connecting' && capturedAt === null && (
        <p className="muted">Waiting for the server…</p>
      )}

      <div className="overview-road">
        {portfolio.attention.length > 0 && (
          <OverviewSection label="Needs attention">
            {portfolio.attention.map((item) => (
              <AttentionRow key={item.key} item={item} />
            ))}
          </OverviewSection>
        )}

        <OverviewSection label="Active work · priority">
          {portfolio.active.map((project) => (
            <ActiveProjectRow key={projectKey(project)} presentation={project} />
          ))}
          {portfolio.active.length === 0 && (
            <p className="overview-empty">No Projects have an open map.</p>
          )}
        </OverviewSection>

        <OverviewSection label="Projects at rest">
          {portfolio.resting.map((project) => (
            <RestingProjectRow key={projectKey(project)} presentation={project} />
          ))}
          {portfolio.resting.length === 0 && (
            <p className="overview-empty">No Projects are at rest.</p>
          )}
        </OverviewSection>

        <OverviewSection label="Waiting for a first map">
          {portfolio.waiting.map((project) => (
            <WaitingProjectRow key={projectKey(project)} presentation={project} />
          ))}
          {portfolio.waiting.length === 0 && (
            <p className="overview-empty">
              {portfolio.projects.length === 0
                ? 'No Projects registered yet.'
                : 'Every Project has a Wayfinder map.'}
            </p>
          )}
        </OverviewSection>
      </div>
    </main>
  )
}

function OverviewCount({
  tone,
  count,
  label,
}: {
  tone: 'decided' | 'active' | 'resting' | 'attention'
  count: number
  label: string
}) {
  return (
    <span>
      <i className={`overview-dot is-${tone}`} aria-hidden="true" />
      {count} {label}
    </span>
  )
}

function OverviewSection({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="overview-section">
      <h2 className="overview-section-label">{label}</h2>
      {children}
    </section>
  )
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const content = (
    <>
      <span className="overview-node is-attention" aria-hidden="true">
        ×
      </span>
      <span className="overview-copy">
        <strong>{item.title}</strong>
        <span className="overview-detail">{item.detail}</span>
      </span>
      <span className="overview-tail">
        {item.kind === 'project'
          ? 'Project ›'
          : item.kind === 'connection'
            ? 'Connection'
            : 'Configuration'}
      </span>
    </>
  )

  if (item.kind === 'project') {
    return (
      <a className="overview-row" href={projectHash(item.project)}>
        {content}
      </a>
    )
  }
  if (item.kind === 'connection') {
    return (
      <a className="overview-row" href={connectionSettingsHash}>
        {content}
      </a>
    )
  }
  return <div className="overview-row">{content}</div>
}

function ActiveProjectRow({ presentation }: { presentation: ProjectPresentation }) {
  const { project, connection, destination, decisions, openTickets, hasFog, priorities } =
    presentation
  const unavailable = project.availability.status === 'unavailable'
  return (
    <a className="overview-row is-map" href={projectHash(project.key)}>
      <span className="overview-node is-flag" aria-hidden="true">
        ⚑
      </span>
      <span className="overview-copy">
        <span className="overview-kicker">
          {project.name}
          <span className="badge">{integrationLabel(project.key.integration)}</span>
          {connection && <span className="overview-connection">{connection.name}</span>}
        </span>
        <strong>{destination}</strong>
        <span className="overview-detail">
          {decisions} decided · {openTickets} open{hasFog ? ' · fog ahead' : ''}
        </span>
        {priorities.length > 0 && (
          <span className="overview-priority">Priority · {priorities.join(' · ')}</span>
        )}
      </span>
      <span className={`overview-tail${unavailable ? ' is-unavailable' : ' is-active'}`}>
        {unavailable
          ? 'Unavailable'
          : `Active · ${formatRecency(presentation.activityAt ?? 0, Date.now())}`}
      </span>
    </a>
  )
}

function RestingProjectRow({ presentation }: { presentation: ProjectPresentation }) {
  const { project, mapCount, decisions, activityAt } = presentation
  return (
    <a className="overview-row" href={projectHash(project.key)}>
      <span className="overview-node is-closed" aria-hidden="true">
        ✓
      </span>
      <span className="overview-copy">
        <strong>
          {project.name}
          <span className="badge">{integrationLabel(project.key.integration)}</span>
        </strong>
        <span className="overview-detail">
          All {mapCount === 1 ? '1 map' : `${mapCount} maps`} closed · {decisions} decisions
          recorded
        </span>
      </span>
      <span className="overview-tail">
        At rest{activityAt === undefined ? '' : ` · ${formatMonth(activityAt)}`}
      </span>
    </a>
  )
}

function WaitingProjectRow({ presentation }: { presentation: ProjectPresentation }) {
  const { project, connection } = presentation
  const unavailableCause =
    project.availability.status === 'unavailable' ? project.availability.cause : null
  return (
    <a className="overview-row" href={projectHash(project.key)}>
      <span
        className={`overview-node ${unavailableCause !== null ? 'is-attention' : 'is-open'}`}
        aria-hidden="true"
      >
        {unavailableCause !== null ? '×' : '○'}
      </span>
      <span className="overview-copy">
        <strong>
          {project.name}
          <span className="badge">{integrationLabel(project.key.integration)}</span>
        </strong>
        <span className="overview-detail">
          {unavailableCause !== null
            ? unavailableCause
            : `Registered${connection ? ` through ${connection.name}` : ''} · no Wayfinder maps yet`}
        </span>
      </span>
      <span className={`overview-tail${unavailableCause !== null ? ' is-unavailable' : ''}`}>
        {unavailableCause !== null ? 'Unavailable' : 'Waiting'}
      </span>
    </a>
  )
}

function projectKey(presentation: ProjectPresentation): string {
  return `${presentation.project.key.integration}:${presentation.project.key.id}`
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString()
}
