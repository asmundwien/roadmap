import { projectHash } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import { activeMapOf } from '../wayfinder/from-github.ts'
import type { Project, WayfinderMap } from '../wayfinder/types.ts'
import { stripInlineMarkdown } from './gist.ts'
import { formatMonth, formatRecency } from './recency.ts'
import { SignalMeter } from './signal-meter.tsx'
import './views.css'

/**
 * The front page: every discovered project as a journey-at-a-glance card — the project screen at
 * a second density, everything collapsed. The active map leads with its destination gist and
 * meter, the maps behind it follow as flag-led lines with date tails, and a resting project
 * shows its whole trace at rest. Selecting a card opens the project on its active map.
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

      <div className="fl-cards">
        {projects.map((project) => (
          <ProjectCard key={project.nameWithOwner} project={project} />
        ))}
      </div>

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

/**
 * One project, collapsed to a card. The head is the active map — its line bold, its meter under
 * it; a resting project says so where the head would be. Every other map is one collapsed stride:
 * flag, destination gist, date tail — newest first, exactly the order the project screen unfolds.
 */
function ProjectCard({ project }: { project: Project }) {
  const active = activeMapOf(project)
  const rest = [...project.openMaps, ...project.closedMaps].filter((map) => map !== active)

  return (
    <a className="fl-card" href={projectHash(project)}>
      <span className="fl-card-name">
        {project.nameWithOwner}
        {project.isPrivate && <span className="badge">private</span>}
      </span>

      <span className="fl-card-trace">
        {active ? (
          <>
            <CardLine map={active} active />
            <span className="fl-card-meter">
              <SignalMeter map={active} />
            </span>
          </>
        ) : (
          <span className="fl-card-rest muted small">
            resting · all {rest.length === 1 ? '1 map' : `${rest.length} maps`} closed
          </span>
        )}
        {rest.map((map) => (
          <CardLine key={map.number} map={map} />
        ))}
      </span>
    </a>
  )
}

function CardLine({ map, active = false }: { map: WayfinderMap; active?: boolean }) {
  const gist = stripInlineMarkdown(map.body.destination)
  return (
    <span className="fl-card-line">
      <span className="fl-card-flag" aria-hidden="true">
        ⚑
      </span>
      <span className={`fl-card-dest${active ? ' is-active' : ''}`}>
        {gist !== '' ? gist : map.title}
      </span>
      <span className="fl-card-tail muted">
        {map.isOpen
          ? formatRecency(map.updatedAt, Date.now())
          : formatMonth(map.closedAt ?? map.updatedAt)}
      </span>
    </span>
  )
}

function formatTime(at: number | null): string {
  return at === null ? 'never' : new Date(at).toLocaleTimeString()
}
