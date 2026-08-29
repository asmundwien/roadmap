import type { AutomationEvidence, Project, ProjectKey, WayfinderMap } from '@roadmap/contracts'
import { useEffect, useRef, useState } from 'react'
import {
  encodeSelection,
  mapHash,
  type PanelSelection,
  type ResolvedSelection,
  type Route,
  replaceHash,
  resolveSelection,
  selectionHash,
} from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import { activeMapOf } from './active-map.ts'
import { MapChild, sameSelection } from './map/map-child.tsx'
import { Panel, type PanelAutomation } from './map/panel.tsx'
import { ledgerSequence } from './map/sequence.ts'
import { LEGEND_ORDER, STATE_META } from './map/state-meta.ts'
import { integrationLabel } from './project-meta.ts'
import './views.css'

/**
 * The project screen: one single-open accordion of the project's maps with the ledger's rail
 * threaded through — the active map at the top, open by default, history descending to the
 * earliest map, nothing drawn past the head — and the docked Panel beside it, the one detail
 * layer every map feeds.
 */
export function ProjectScreen({ route }: { route: Extract<Route, { screen: 'project' }> }) {
  const {
    transport,
    projects,
    roadmapProjects,
    capturedAt,
    automation,
    configurationVersion,
    command,
    execute,
  } = useRoadmap()

  const registration = projects.find((candidate) => sameProject(candidate.key, route.project))
  const source = roadmapProjects.find((candidate) => sameProject(candidate.key, route.project))
  const project = registration
    ? {
        ...registration,
        ...(source?.visibility === undefined ? {} : { visibility: source.visibility }),
        ...(source?.sourcePath === undefined ? {} : { sourcePath: source.sourcePath }),
      }
    : source

  if (!project) {
    return (
      <main className="shell map-shell">
        <p>
          <a href="#/">← All projects</a>
        </p>
        {transport === 'disconnected' && (
          <p className="banner" role="alert">
            Server unreachable — reconnecting.
          </p>
        )}
        <p className="muted">
          {capturedAt !== null ? `No project at ${route.project.id}.` : 'Waiting for the server…'}
        </p>
      </main>
    )
  }

  return (
    <PanelScreen
      key={`${project.key.integration}:${project.key.id}`}
      project={project}
      selected={route.selected}
      selection={route.selection}
      disconnected={transport === 'disconnected'}
      unavailable={
        registration?.availability.status === 'unavailable' ? registration.availability.cause : null
      }
      automation={{
        state: automation,
        configurationVersion,
        commandInFlight: command.inFlight,
        execute,
      }}
    />
  )
}

/**
 * The docked-panel screen. The Panel is not an overlay — it flexes in beside the page and eats
 * its width, so the map stays clickable and picks swap the Panel's content without a close in
 * between.
 *
 * ALL state lives in the hash: `#/projects/<integration>/<project-id>/maps/<map-id>` pins the
 * open map and its selection segment names the Panel's item — one router owns it all, resolved
 * against the live snapshot on every render, no useState mirrors anywhere. The prev/next sequence
 * spans the WHOLE trace in on-screen order, so stepping past a map's edge walks into the
 * neighbouring map: the pin follows the pick, and the accordion unfolds with it.
 */
function PanelScreen({
  project,
  selected,
  selection,
  disconnected,
  unavailable,
  automation,
}: {
  project: Project
  selected: string | null
  selection: PanelSelection | null
  disconnected: boolean
  unavailable: string | null
  automation: PanelAutomation
}) {
  const trace = [...project.openMaps, ...project.closedMaps]
  const pinnedMap = selected !== null ? trace.find((m) => m.id === selected) : undefined
  const item = pinnedMap && selection ? resolveSelection(pinnedMap, selection) : null
  const pick: { map: WayfinderMap; item: ResolvedSelection } | null =
    pinnedMap && item ? { map: pinnedMap, item } : null

  const lastPickRef = useRef(pick)
  if (pick) lastPickRef.current = pick
  const shown = pick ?? lastPickRef.current

  const flat: { map: WayfinderMap; item: ResolvedSelection }[] = trace.flatMap((map) => [
    { map, item: { kind: 'map' } },
    ...ledgerSequence(map).map((item): { map: WayfinderMap; item: ResolvedSelection } => ({
      map,
      item,
    })),
  ])
  const at = pick
    ? flat.findIndex(
        (entry) => entry.map.id === pick.map.id && sameSelection(entry.item, pick.item),
      )
    : -1

  const close = () => {
    if (selected !== null) replaceHash(mapHash({ project: project.key, id: selected }))
  }
  const select = (map: WayfinderMap, selectedItem: ResolvedSelection) => {
    if (pick && pick.map.id === map.id && sameSelection(pick.item, selectedItem)) {
      close()
      return
    }
    const encoded = encodeSelection(map, selectedItem)
    if (encoded) replaceHash(selectionHash(map, encoded))
  }
  const step = (delta: number) => {
    const target = flat[at + delta]
    if (target) select(target.map, target.item)
  }

  useEffect(() => {
    if (selection === null || selected === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') replaceHash(mapHash({ project: project.key, id: selected }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, selected, project.key])

  const [kbNav, setKbNav] = useState(false)
  const lastHoverRef = useRef<Element | null>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onMove = () => setKbNav((now) => (now ? false : now))
    const onOver = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const item = target.closest('[data-nav-item]')
      if (item) lastHoverRef.current = item
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') setKbNav((now) => (now ? now : true))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerover', onOver)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerover', onOver)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const focusNav = (index: number) => {
    const el = document.querySelector(`[data-panel-nav="${index}"]`)
    if (el instanceof HTMLElement) el.focus()
  }
  const focusItem = () => {
    const el =
      document.querySelector('[data-nav-item][data-selected="true"]') ??
      document.querySelector('[data-nav-item]')
    if (el instanceof HTMLElement || el instanceof SVGElement) el.focus()
  }
  const visibleItems = () =>
    [...document.querySelectorAll('[data-nav-item]')].filter(
      (el): el is HTMLElement | SVGElement =>
        (el instanceof HTMLElement || el instanceof SVGElement) &&
        el.closest('.fold[aria-hidden="true"]') === null,
    )
  const moveFocus = (delta: number) => {
    const items = visibleItems()
    const active = document.activeElement
    const kbAt =
      active instanceof HTMLElement || active instanceof SVGElement ? items.indexOf(active) : -1
    const pointerAt =
      lastHoverRef.current instanceof HTMLElement || lastHoverRef.current instanceof SVGElement
        ? items.indexOf(lastHoverRef.current)
        : -1
    const at = kbNav ? kbAt : pointerAt !== -1 ? pointerAt : kbAt
    const target = at === -1 ? items[0] : items[at + delta]
    target?.focus()
  }
  const onItemArrow = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setKbNav(true)
      moveFocus(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setKbNav(true)
      moveFocus(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusNav(0)
    }
  }
  const onButtonArrow = (event: KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusNav(index + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (index === 0) focusItem()
      else focusNav(index - 1)
    }
  }
  const onNavKey = (event: KeyboardEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.hasAttribute('data-nav-item')) {
      onItemArrow(event)
      return
    }
    const nav = target.closest('[data-panel-nav]')
    if (nav) onButtonArrow(event, Number(nav.getAttribute('data-panel-nav')))
  }
  useEffect(() => {
    const screen = screenRef.current
    if (!screen) return
    screen.addEventListener('keydown', onNavKey)
    return () => screen.removeEventListener('keydown', onNavKey)
  })

  return (
    <div ref={screenRef} className={`panel-screen${kbNav ? ' is-kbnav' : ''}`}>
      <main className="shell map-shell">
        <p>
          <a href="#/">← All projects</a>
        </p>

        <ProjectStateNotices
          disconnected={disconnected}
          unavailable={unavailable}
          hasMaps={trace.length > 0}
        />

        <ProjectHead project={project} automationEvidence={automation.state.evidence} />
        <MapTrace
          automationEvidence={automation.state.evidence}
          project={project}
          selected={selected}
          onPickItem={select}
          pick={pick ? { mapId: pick.map.id, item: pick.item } : null}
          kbNav={kbNav}
        />
      </main>

      <aside
        className={`panel-rail${pick ? ' is-open' : ''}`}
        aria-label="the panel"
        aria-hidden={!pick}
        inert={!pick}
      >
        <div className="panel-rail-inner">
          {shown && (
            <div className="panel">
              <Panel
                map={shown.map}
                item={shown.item}
                onClose={close}
                onStep={step}
                onSelect={(item) => select(shown.map, item)}
                hasPrev={at > 0}
                hasNext={at !== -1 && at < flat.length - 1}
                automation={automation}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function ProjectStateNotices({
  disconnected,
  unavailable,
  hasMaps,
}: {
  disconnected: boolean
  unavailable: string | null
  hasMaps: boolean
}) {
  return (
    <>
      {disconnected && (
        <p className="banner" role="alert">
          Server unreachable — reconnecting. Showing the last snapshot.
        </p>
      )}
      {unavailable !== null && (
        <p className="banner" role="alert">
          Project unavailable — {unavailable} Showing the last observed roadmap trace.
        </p>
      )}
      {!hasMaps && <p className="project-empty muted">No Wayfinder maps yet.</p>}
    </>
  )
}

function ProjectHead({
  project,
  automationEvidence,
}: {
  project: Project
  automationEvidence: readonly AutomationEvidence[]
}) {
  const open = project.openMaps.length
  const closed = project.closedMaps.length
  const tickets = [...project.openMaps, ...project.closedMaps].flatMap((map) => map.tickets)
  const title = githubRepoName(project) ?? project.name
  const hasAutomationEvidence = automationEvidence.some(
    (evidence) =>
      evidence.target.project.integration === project.key.integration &&
      evidence.target.project.id === project.key.id,
  )
  const subtitle = githubOwnerName(project)

  return (
    <header className="project-head">
      <h1>
        {title}
        <span className="badge">{integrationLabel(project.key.integration)}</span>
        {project.visibility === 'private' && <span className="badge">private</span>}
      </h1>
      <p className="muted small">
        {subtitle ? `${subtitle} · ` : ''}
        {open > 0
          ? `${maps(open)} open · ${closed} closed`
          : closed > 0
            ? `resting · all ${maps(closed)} closed`
            : 'registered · no Wayfinder maps yet'}
      </p>
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
      <p className="project-node-legend muted small">
        <span>R + 1 corner research</span>
        <span>P + 2 corners prototype</span>
        <span>G + 3 corners grilling</span>
        <span>T + 4 corners task</span>
        {hasAutomationEvidence && (
          <>
            <span className="automation-legend is-classification">◆ Classification</span>
            <span className="automation-legend is-wayfinder">◆ Wayfinder and Session</span>
          </>
        )}
      </p>
    </header>
  )
}

/**
 * The trace, newest first: open maps by recency (the active map leads), then closed history down
 * to the earliest. Bare `#/projects/<integration>/<project-id>` unfolds the active map; a map id
 * in the hash pins another one. The URL is the only state — the pin alone decides what is open,
 * so folding-shut has no home here: clicking the open map's trigger selects it instead.
 */
function MapTrace({
  project,
  automationEvidence,
  selected,
  onPickItem,
  pick,
  kbNav,
}: {
  project: Project
  automationEvidence: readonly AutomationEvidence[]
  selected: string | null
  onPickItem: (map: WayfinderMap, item: ResolvedSelection) => void
  pick: { mapId: string; item: ResolvedSelection } | null
  kbNav: boolean
}) {
  const trace = [...project.openMaps, ...project.closedMaps]
  const active = activeMapOf(project)

  const pinned = selected !== null && trace.some((m) => m.id === selected) ? selected : null
  const openId = pinned ?? active?.id ?? null

  const unfold = (mapId: string) => {
    if (openId === mapId) return
    replaceHash(mapHash({ project: project.key, id: mapId }))
  }

  return (
    <div className="fl-trace">
      {trace.map((map, i) => (
        <MapChild
          key={map.id}
          automationEvidence={automationEvidence}
          map={map}
          open={openId === map.id}
          solo={trace.length === 1}
          last={i === trace.length - 1}
          onSelect={(item) => onPickItem(map, item)}
          onUnfold={() => unfold(map.id)}
          panelOpen={Boolean(pick)}
          selected={pick && pick.mapId === map.id ? pick.item : null}
          entry={!pick && i === 0}
          kbNav={kbNav}
        />
      ))}
    </div>
  )
}

function maps(count: number): string {
  return count === 1 ? '1 map' : `${count} maps`
}

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}

function githubRepoName(project: Project): string | null {
  if (project.key.integration !== 'github') return null
  const parts = project.name.split('/')
  return parts.length >= 2 ? (parts.at(-1) ?? project.name) : project.name
}

function githubOwnerName(project: Project): string | null {
  if (project.key.integration !== 'github') return null
  const parts = project.name.split('/')
  return parts.length >= 2 ? parts.slice(0, -1).join('/') : null
}
