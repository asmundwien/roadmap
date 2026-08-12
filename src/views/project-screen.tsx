import { useState } from 'react'
import { mapHash, type Route, replaceHash } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import { activeMapOf } from '../wayfinder/from-github.ts'
import type { Project } from '../wayfinder/types.ts'
import { MapChild } from './map/map-child.tsx'
import { LEGEND_ORDER, STATE_META } from './map/state-meta.ts'
import './views.css'

/**
 * The project screen: one single-open accordion of the project's maps with the ledger's rail
 * threaded through — the active map at the top, open by default, history descending to the
 * earliest map, nothing drawn past the head. The page-level header carries what belongs to the
 * project; everything map-specific lives inside each self-contained map child.
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
          <MapTrace project={project} selected={route.selected} />
        </>
      )}
    </main>
  )
}

function ProjectHead({ project }: { project: Project }) {
  const open = project.openMaps.length
  const closed = project.closedMaps.length
  const tickets = [...project.openMaps, ...project.closedMaps].flatMap((map) => map.tickets)

  return (
    <header className="project-head">
      <h1>
        {project.repo}
        {project.isPrivate && <span className="badge">private</span>}
      </h1>
      <p className="muted small">
        {project.owner}
        {' · '}
        {open > 0
          ? `${maps(open)} open · ${closed} closed`
          : `resting · all ${maps(closed)} closed`}
      </p>
      {/* The wayfinder states counted across the whole project — never a single map. */}
      <p className="project-legend muted small">
        {LEGEND_ORDER.map((state) => (
          <span key={state} className="legend-item">
            <i aria-hidden="true" style={{ color: STATE_META[state].color }}>
              {STATE_META[state].glyph}
            </i>{' '}
            {STATE_META[state].word} · {tickets.filter((t) => t.state === state).length}
          </span>
        ))}
      </p>
    </header>
  )
}

/**
 * The trace, newest first: open maps by recency (the active map leads), then closed history down
 * to the earliest. Bare `#/owner/repo` unfolds the active map; a number in the hash pins another
 * one, and every toggle re-pins so the selection survives a refresh. A resting project opens
 * nothing. Folding the open map is ephemeral — the pin stays, the fold does not.
 */
function MapTrace({ project, selected }: { project: Project; selected: number | null }) {
  const trace = [...project.openMaps, ...project.closedMaps]
  const active = activeMapOf(project)

  // A pin that matches no map is a stale URL, not an error — fall back to the default.
  const pinned = selected !== null && trace.some((m) => m.number === selected) ? selected : null
  const defaultOpen = pinned ?? active?.number ?? null

  // The one map the user explicitly folded shut; navigation to any other map outgrows it.
  const [folded, setFolded] = useState<number | null>(null)
  const openNumber = folded === defaultOpen ? null : defaultOpen

  const toggle = (mapNumber: number) => {
    if (openNumber === mapNumber) {
      setFolded(mapNumber)
      return
    }
    setFolded(null)
    replaceHash(mapHash({ owner: project.owner, repo: project.repo, number: mapNumber }))
  }

  return (
    <div className="fl-trace">
      {trace.map((map, i) => (
        <MapChild
          key={map.number}
          map={map}
          open={openNumber === map.number}
          solo={trace.length === 1}
          last={i === trace.length - 1}
          onToggle={toggle}
        />
      ))}
    </div>
  )
}

function maps(count: number): string {
  return count === 1 ? '1 map' : `${count} maps`
}
