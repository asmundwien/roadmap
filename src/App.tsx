import { isPrototypeRequested, MapViewPrototype } from './prototypes/map-view/prototype.tsx'
import { useRoadmap } from './store/roadmap-provider.tsx'

/**
 * A plain readout of what the data layer is holding — enough to see the live poll working, and
 * deliberately not a design. The project list and the map screen land in their own tickets.
 *
 * PROTOTYPE (throwaway): `?variant=D` hands the page to the map-view prototype instead. Goes away
 * with the rest of `src/prototypes/` once issue #3 picks a direction.
 */
export function App() {
  const { status, projects, error, lastUpdatedAt, rateLimit, refresh } = useRoadmap()

  if (isPrototypeRequested()) return <MapViewPrototype />

  return (
    <main className="shell">
      <h1>Roadmap</h1>
      <p className="muted">
        {status === 'loading' && 'Discovering wayfinder maps…'}
        {status === 'ready' &&
          `${countMaps(projects)} map(s) across ${projects.length} project(s) · updated ${formatTime(lastUpdatedAt)}`}
        {status === 'error' && error}
      </p>

      {projects.map((project) => (
        <section key={project.nameWithOwner}>
          <h2>{project.nameWithOwner}</h2>
          {[...project.openMaps, ...project.closedMaps].map((map) => (
            <p key={map.number}>
              <a href={map.url}>
                #{map.number} {map.title}
              </a>
              <br />
              <span className="muted">
                {map.progress.completed}/{map.progress.total} closed · {map.frontier.length} on the
                frontier
                {map.frontier.length > 0 && `: ${map.frontier.map((t) => t.title).join(', ')}`}
              </span>
            </p>
          ))}
        </section>
      ))}

      <p className="muted">
        <button type="button" onClick={() => void refresh()}>
          Refresh now
        </button>{' '}
        {rateLimit && `GraphQL budget: ${rateLimit.remaining}/${rateLimit.limit}`}
      </p>
    </main>
  )
}

function countMaps(projects: { openMaps: unknown[]; closedMaps: unknown[] }[]): number {
  return projects.reduce((sum, p) => sum + p.openMaps.length + p.closedMaps.length, 0)
}

function formatTime(at: number | null): string {
  return at === null ? 'never' : new Date(at).toLocaleTimeString()
}
