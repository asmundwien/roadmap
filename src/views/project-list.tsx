import { mapHash } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import type { Project, WayfinderMap } from '../wayfinder/types.ts'
import { stripInlineMarkdown } from './gist.ts'
import { SignalMeter } from './signal-meter.tsx'
import './views.css'

/**
 * The entry point: every discovered wayfinder project, open maps front and center, closed maps
 * as history. Selecting a map navigates to the map screen.
 */
export function ProjectList() {
  const { status, projects, error, lastUpdatedAt, rateLimit, unreachable, refresh } = useRoadmap()

  return (
    <main className="shell">
      <header className="list-header">
        <h1>Roadmap</h1>
        <p className="muted">
          {status === 'loading' && 'Discovering wayfinder maps…'}
          {status === 'ready' && `Updated ${formatTime(lastUpdatedAt)}`}
          {status === 'error' && 'Live view interrupted'}
        </p>
      </header>

      {error !== null && (
        <p className="banner" role="alert">
          {error}
          {projects.length > 0 && ' — showing the last good snapshot.'}
        </p>
      )}

      {status === 'ready' && projects.length === 0 && (
        <p className="muted">
          No wayfinder maps found. A project joins this list when one of its issues carries the
          <code> wayfinder:map</code> label.
        </p>
      )}

      {projects.map((project) => (
        <ProjectSection key={project.nameWithOwner} project={project} />
      ))}

      {unreachable.length > 0 && (
        <p className="muted small">
          Unreachable: {unreachable.map((ref) => `${ref.nameWithOwner}#${ref.number}`).join(', ')}
        </p>
      )}

      <footer className="list-footer muted small">
        <button type="button" onClick={() => void refresh()}>
          Refresh now
        </button>
        {rateLimit && (
          <span>
            GraphQL budget {rateLimit.remaining}/{rateLimit.limit}
          </span>
        )}
      </footer>
    </main>
  )
}

function ProjectSection({ project }: { project: Project }) {
  return (
    <section className="project">
      <h2 className="project-name">
        {project.nameWithOwner}
        {project.isPrivate && <span className="badge">private</span>}
      </h2>

      {project.openMaps.map((map) => (
        <MapCard key={map.number} map={map} />
      ))}
      {project.openMaps.length === 0 && <p className="muted small">No open maps — history only.</p>}

      {project.closedMaps.length > 0 && (
        <div className="history">
          <h3 className="history-title muted">History</h3>
          <ul className="history-list">
            {project.closedMaps.map((map) => (
              <li key={map.number}>
                <a href={mapHash(map)}>{map.title}</a>{' '}
                <span className="muted small">
                  {map.progress.completed}/{map.progress.total} decided
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function MapCard({ map }: { map: WayfinderMap }) {
  return (
    <a className="map-card" href={mapHash(map)}>
      <span className="map-card-title">{map.title}</span>
      {map.body.destination !== '' && (
        <span className="map-card-destination">{stripInlineMarkdown(map.body.destination)}</span>
      )}
      <SignalMeter map={map} />
      {map.frontier.length > 0 && (
        <span className="map-card-frontier">
          Frontier: {map.frontier.map((ticket) => ticket.title).join(' · ')}
        </span>
      )}
    </a>
  )
}

function formatTime(at: number | null): string {
  return at === null ? 'never' : new Date(at).toLocaleTimeString()
}
