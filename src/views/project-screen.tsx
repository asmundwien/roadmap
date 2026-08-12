import type { Route } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import { activeMapOf } from '../wayfinder/from-github.ts'
import type { Project, WayfinderMap } from '../wayfinder/types.ts'
import { MapChild } from './map/map-child.tsx'
import './views.css'

/**
 * The project screen: the page-level shell owns what belongs to the project — name, ownership,
 * liveness — and everything map-specific lives inside the self-contained map child. Today it
 * renders one map bare; the accordion of strides mounts in this same slot.
 */
export function ProjectScreen({ route }: { route: Extract<Route, { screen: 'project' }> }) {
  const { status, projects, error } = useRoadmap()

  const project = projects.find(
    (candidate) => candidate.owner === route.owner && candidate.repo === route.repo,
  )

  return (
    <main className="shell map-shell">
      <p>
        <a href="#/">← All projects</a>
      </p>

      {error !== null && (
        <p className="banner" role="alert">
          {error}
          {project && ' — showing the last good snapshot.'}
        </p>
      )}

      {!project && (
        <p className="muted">
          {status === 'ready' ? `No project at ${route.owner}/${route.repo}.` : 'Loading…'}
        </p>
      )}

      {project && (
        <>
          <ProjectHead project={project} />
          <SelectedMap project={project} selected={route.selected} />
        </>
      )}
    </main>
  )
}

function ProjectHead({ project }: { project: Project }) {
  const open = project.openMaps.length
  const closed = project.closedMaps.length

  return (
    <header className="project-head">
      <h1>{project.repo}</h1>
      <p className="muted small">
        {project.owner}
        {project.isPrivate && <span className="badge">private</span>}
        {' · '}
        {open > 0
          ? `${maps(open)} open · ${closed} closed`
          : `resting · all ${maps(closed)} closed`}
      </p>
    </header>
  )
}

/** Bare `#/owner/repo` means the active map; a number in the hash pins that map instead. */
function SelectedMap({ project, selected }: { project: Project; selected: number | null }) {
  const map: WayfinderMap | null =
    selected === null
      ? activeMapOf(project)
      : ([...project.openMaps, ...project.closedMaps].find(
          (candidate) => candidate.number === selected,
        ) ?? null)

  if (!map) {
    return (
      <p className="muted">
        {selected === null
          ? 'At rest — every map on this project is closed.'
          : `No map #${selected} on this project.`}
      </p>
    )
  }

  return <MapChild map={map} />
}

function maps(count: number): string {
  return count === 1 ? '1 map' : `${count} maps`
}
