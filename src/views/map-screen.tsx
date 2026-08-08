import type { Route } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import { stripInlineMarkdown } from './gist.ts'
import { SignalMeter } from './signal-meter.tsx'
import './views.css'

/**
 * STUB — the navigation target the project list needs to exist. The live map screen (the ticket
 * graph, decisions, and fog) lands with its own ticket; this placeholder proves the seam and
 * shows just enough to confirm you arrived at the right map.
 */
export function MapScreen({ route }: { route: Extract<Route, { screen: 'map' }> }) {
  const { status, projects } = useRoadmap()

  const map = projects
    .flatMap((project) => [...project.openMaps, ...project.closedMaps])
    .find(
      (candidate) =>
        candidate.owner === route.owner &&
        candidate.repo === route.repo &&
        candidate.number === route.number,
    )

  return (
    <main className="shell">
      <p>
        <a href="#/">← All projects</a>
      </p>

      {!map && (
        <p className="muted">
          {status === 'ready'
            ? `No map at ${route.owner}/${route.repo}#${route.number}.`
            : 'Loading…'}
        </p>
      )}

      {map && (
        <>
          <header className="list-header">
            <h1>{map.title}</h1>
            <p className="muted">
              <a href={map.url}>
                {map.nameWithOwner}#{map.number}
              </a>
              {!map.isOpen && ' · closed'}
            </p>
          </header>
          {map.body.destination !== '' && <p>{stripInlineMarkdown(map.body.destination)}</p>}
          <SignalMeter map={map} />
          <p className="muted small">The live map view is on its way — this is a placeholder.</p>
        </>
      )}
    </main>
  )
}
