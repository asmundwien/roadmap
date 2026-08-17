import type { Project, WayfinderMap } from '@roadmap/contracts'
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'
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
import { Panel } from './map/panel.tsx'
import { ledgerSequence } from './map/sequence.ts'
import { LEGEND_ORDER, STATE_META } from './map/state-meta.ts'
import './views.css'

/**
 * The project screen: one single-open accordion of the project's maps with the ledger's rail
 * threaded through — the active map at the top, open by default, history descending to the
 * earliest map, nothing drawn past the head — and the docked Panel beside it, the one detail
 * layer every map feeds.
 */
export function ProjectScreen({ route }: { route: Extract<Route, { screen: 'project' }> }) {
  const { connection, projects, capturedAt } = useRoadmap()

  const project = projects.find(
    (candidate) => candidate.owner === route.owner && candidate.repo === route.repo,
  )

  if (!project) {
    return (
      <main className="shell map-shell">
        <p>
          <a href="#/">← All projects</a>
        </p>
        {connection === 'disconnected' && (
          <p className="banner" role="alert">
            Server unreachable — reconnecting.
          </p>
        )}
        <p className="muted">
          {capturedAt !== null
            ? `No project at ${route.owner}/${route.repo}.`
            : 'Waiting for the server…'}
        </p>
      </main>
    )
  }

  return (
    <PanelScreen
      key={project.nameWithOwner}
      project={project}
      selected={route.selected}
      selection={route.selection}
      disconnected={connection === 'disconnected'}
    />
  )
}

/**
 * The docked-panel screen. The Panel is not an overlay — it flexes in beside the page and eats
 * its width, so the map stays clickable and picks swap the Panel's content without a close in
 * between.
 *
 * ALL state lives in the hash: `#/owner/repo/<map>` pins the open map and its selection segment
 * names the Panel's item — one router owns it all, resolved against the live snapshot on every
 * render, no useState mirrors anywhere. The prev/next sequence spans the WHOLE trace in
 * on-screen order, so stepping past a map's edge walks into the neighbouring map: the pin
 * follows the pick, and the accordion unfolds with it.
 */
function PanelScreen({
  project,
  selected,
  selection,
  disconnected,
}: {
  project: Project
  selected: number | null
  selection: PanelSelection | null
  disconnected: boolean
}) {
  const trace = [...project.openMaps, ...project.closedMaps]
  // The selection rides the pinned map: a stale pin or a vanished item is no selection.
  const pinnedMap = selected !== null ? trace.find((m) => m.number === selected) : undefined
  const item = pinnedMap && selection ? resolveSelection(pinnedMap, selection) : null
  const pick: { map: WayfinderMap; item: ResolvedSelection } | null =
    pinnedMap && item ? { map: pinnedMap, item } : null

  // Not state — the URL is the only truth. Like the fold keeping its children mounted, the rail
  // needs content to move while collapsing, so the last pick lingers for the closing animation.
  const lastPickRef = useRef(pick)
  if (pick) lastPickRef.current = pick
  const shown = pick ?? lastPickRef.current

  // Every selectable thing on the screen, top to bottom, across every map in the trace.
  const flat: { map: WayfinderMap; item: ResolvedSelection }[] = trace.flatMap((map) => [
    { map, item: { kind: 'map' } },
    ...ledgerSequence(map).map((item): { map: WayfinderMap; item: ResolvedSelection } => ({
      map,
      item,
    })),
  ])
  const at = pick
    ? flat.findIndex(
        (entry) => entry.map.number === pick.map.number && sameSelection(entry.item, pick.item),
      )
    : -1

  // Selecting names the item's map AND its selection in one hash write, so the accordion always
  // unfolds the map the Panel is describing. Activating the item that is already selected
  // deselects it — the Panel folds shut, the pin stays.
  const close = () => {
    if (selected !== null)
      replaceHash(mapHash({ owner: project.owner, repo: project.repo, number: selected }))
  }
  const select = (map: WayfinderMap, selectedItem: ResolvedSelection) => {
    if (pick && pick.map.number === map.number && sameSelection(pick.item, selectedItem)) {
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

  // Escape closes the Panel, like its » button — keyed off the hash's selection segment, so it
  // also cleans a segment that resolved to nothing.
  useEffect(() => {
    if (selection === null || selected === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        replaceHash(mapHash({ owner: project.owner, repo: project.repo, number: selected }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, selected, project.owner, project.repo])

  // The whole navigation is ONE tab stop: roving tabindex puts Tab on the selected item (or the
  // first destination). ArrowUp/Down move a keyboard HOVER — DOM focus roving over the visible
  // items, drawn like the pointer's hover, lineage included — and only Space/Enter select what
  // is under it. ArrowRight enters the Panel's buttons, ArrowLeft walks them back to the item
  // list. Any pointer movement hands the hover back to the mouse (kbNav below).
  const [kbNav, setKbNav] = useState(false)
  // The hover is ONE entity shared by both hands. The pointer's side of it is the item the mouse
  // last rested on (not state — presentation memory, like the fold's): an arrow press steps from
  // THERE when the mouse was the last mover, and any mouse movement snaps the hover back to it.
  const lastHoverRef = useRef<Element | null>(null)
  useEffect(() => {
    const onMove = () => setKbNav((now) => (now ? false : now))
    const onOver = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const item = target.closest('[data-nav-item]')
      if (item) lastHoverRef.current = item
    }
    // Tab is keyboard movement too — entering the unit with it must show the ring and band.
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
  // The keyboard hover walks what is on screen: every item in DOM order (which the ledger keeps
  // aligned with the visual order), skipping the insides of folded maps.
  const visibleItems = () =>
    [...document.querySelectorAll('[data-nav-item]')].filter(
      (el): el is HTMLElement | SVGElement =>
        (el instanceof HTMLElement || el instanceof SVGElement) &&
        el.closest('.fold[aria-hidden="true"]') === null,
    )
  // A step starts from wherever the hover entity currently sits: the pointer's last item while
  // the mouse was the last mover, the focused element once the keyboard has taken over.
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
  const onItemArrow = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
  const onButtonArrow = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusNav(index + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (index === 0) focusItem()
      else focusNav(index - 1)
    }
  }
  const onNavKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.hasAttribute('data-nav-item')) {
      onItemArrow(event)
      return
    }
    const nav = target.closest('[data-panel-nav]')
    if (nav) onButtonArrow(event, Number(nav.getAttribute('data-panel-nav')))
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keydown routing for the roving-focus navbar; focus always sits on real buttons inside.
    <div className={`panel-screen${kbNav ? ' is-kbnav' : ''}`} onKeyDown={onNavKey}>
      <main className="shell map-shell">
        <p>
          <a href="#/">← All projects</a>
        </p>

        {disconnected && (
          <p className="banner" role="alert">
            Server unreachable — reconnecting. Showing the last snapshot.
          </p>
        )}

        <ProjectHead project={project} />
        <MapTrace
          project={project}
          selected={selected}
          onPickItem={select}
          pick={pick ? { mapNumber: pick.map.number, item: pick.item } : null}
          kbNav={kbNav}
        />
      </main>

      {/* The rail is always mounted: opening and closing is the fold's 0fr→1fr, sideways. */}
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
              />
            </div>
          )}
        </div>
      </aside>
    </div>
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
 * one. The URL is the only state — the pin alone decides what is open, so folding-shut has no
 * home here: clicking the open map's trigger selects it instead.
 */
function MapTrace({
  project,
  selected,
  onPickItem,
  pick,
  kbNav,
}: {
  project: Project
  selected: number | null
  /** Receives every click on a map item — the screen turns it into the Panel's pick. */
  onPickItem: (map: WayfinderMap, item: ResolvedSelection) => void
  /** The Panel's current pick, so its map can draw the active item. */
  pick: { mapNumber: number; item: ResolvedSelection } | null
  /** Keyboard-was-last-mover — focused rows draw as hovered. */
  kbNav: boolean
}) {
  const trace = [...project.openMaps, ...project.closedMaps]
  const active = activeMapOf(project)

  // A pin that matches no map is a stale URL, not an error — fall back to the default.
  const pinned = selected !== null && trace.some((m) => m.number === selected) ? selected : null
  const openNumber = pinned ?? active?.number ?? null

  const unfold = (mapNumber: number) => {
    if (openNumber === mapNumber) return
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
          onSelect={(item) => onPickItem(map, item)}
          onUnfold={() => unfold(map.number)}
          panelOpen={Boolean(pick)}
          selected={pick && pick.mapNumber === map.number ? pick.item : null}
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
