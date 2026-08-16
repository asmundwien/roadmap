import type { Project, WayfinderMap } from '@roadmap/contracts'
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'
import {
  encodeSelection,
  mapHash,
  type PanelSelection,
  type Route,
  replaceHash,
  resolveSelection,
  selectionHash,
} from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import { activeMapOf } from './active-map.ts'
import { MapChild } from './map/map-child.tsx'
import { ledgerSequence } from './map/prototype-ledger.tsx'
// PROTOTYPE (throwaway): `?variant=` swaps the single-map representation — see prototype-map-child.tsx.
import {
  type DrawerSelection,
  PrototypeMapChild,
  PrototypePanel,
  prototypeMapKey,
  sameSelection,
} from './map/prototype-map-child.tsx'
import { PrototypeSwitcher, usePrototypeVariant } from './map/prototype-switcher.tsx'
import { LEGEND_ORDER, STATE_META } from './map/state-meta.ts'
import './views.css'

/**
 * The project screen: one single-open accordion of the project's maps with the ledger's rail
 * threaded through — the active map at the top, open by default, history descending to the
 * earliest map, nothing drawn past the head. The page-level header carries what belongs to the
 * project; everything map-specific lives inside each self-contained map child.
 */
export function ProjectScreen({ route }: { route: Extract<Route, { screen: 'project' }> }) {
  const { connection, projects, capturedAt } = useRoadmap()
  // PROTOTYPE (throwaway): variant C swaps the whole screen for the docked-panel layout.
  const variant = usePrototypeVariant()

  const project = projects.find(
    (candidate) => candidate.owner === route.owner && candidate.repo === route.repo,
  )

  if (variant === 'C' && project) {
    return (
      <PrototypeProjectScreen
        key={project.nameWithOwner}
        project={project}
        selected={route.selected}
        selection={route.selection}
        disconnected={connection === 'disconnected'}
      />
    )
  }

  return (
    <main className="shell map-shell">
      <p>
        <a href="#/">← All projects</a>
      </p>

      {connection === 'disconnected' && (
        <p className="banner" role="alert">
          Server unreachable — reconnecting.
          {project && ' Showing the last snapshot.'}
        </p>
      )}

      {!project && (
        <p className="muted">
          {capturedAt !== null
            ? `No project at ${route.owner}/${route.repo}.`
            : 'Waiting for the server…'}
        </p>
      )}

      {project && (
        <>
          <ProjectHead project={project} />
          <MapTrace project={project} selected={route.selected} />
        </>
      )}

      {/* PROTOTYPE (throwaway): dev-only variant bar. */}
      <PrototypeSwitcher />
    </main>
  )
}

/**
 * PROTOTYPE (throwaway): the docked-panel screen. The panel is not an overlay — it flexes in
 * beside the page and eats its width, so the map stays clickable and picks swap the panel's
 * content without a close in between.
 *
 * ALL state lives in the hash: `#/owner/repo/<map>` pins the open map and its selection segment
 * names the panel's item — one router owns it all, resolved against the live snapshot on every
 * render, no useState mirrors anywhere. The prev/next sequence spans the WHOLE trace in
 * on-screen order, so stepping past a map's edge walks into the neighbouring map: the pin
 * follows the pick, and the accordion unfolds with it.
 */
function PrototypeProjectScreen({
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
  const pick: { map: WayfinderMap; item: DrawerSelection } | null =
    pinnedMap && item ? { map: pinnedMap, item } : null

  // Not state — the URL is the only truth. Like the fold keeping its children mounted, the rail
  // needs content to move while collapsing, so the last pick lingers for the closing animation.
  const lastPickRef = useRef(pick)
  if (pick) lastPickRef.current = pick
  const shown = pick ?? lastPickRef.current

  // Every selectable thing on the screen, top to bottom, across every map in the trace.
  const flat: { map: WayfinderMap; item: DrawerSelection }[] = trace.flatMap((map) => [
    { map, item: { kind: 'map' } },
    ...ledgerSequence(map).map((item): { map: WayfinderMap; item: DrawerSelection } => ({
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
  // unfolds the map the panel is describing. Activating the item that is already selected
  // deselects it — the panel folds shut, the pin stays.
  const close = () => {
    if (selected !== null)
      replaceHash(mapHash({ owner: project.owner, repo: project.repo, number: selected }))
  }
  const select = (map: WayfinderMap, selectedItem: DrawerSelection) => {
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

  // Escape closes the panel, like its » button — keyed off the hash's selection segment, so it
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
  // is under it. ArrowRight enters the panel's buttons, ArrowLeft walks them back to the item
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
      const item = target.closest('[data-pfl-item]')
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
    const el = document.querySelector(`[data-pfl-nav="${index}"]`)
    if (el instanceof HTMLElement) el.focus()
  }
  const focusItem = () => {
    const el =
      document.querySelector('[data-pfl-item][data-selected="true"]') ??
      document.querySelector('[data-pfl-item]')
    if (el instanceof HTMLElement || el instanceof SVGElement) el.focus()
  }
  // The keyboard hover walks what is on screen: every item in DOM order (which the prototype
  // ledger keeps aligned with the visual order), skipping the insides of folded maps.
  const visibleItems = () =>
    [...document.querySelectorAll('[data-pfl-item]')].filter(
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
    if (target.hasAttribute('data-pfl-item')) {
      onItemArrow(event)
      return
    }
    const nav = target.closest('[data-pfl-nav]')
    if (nav) onButtonArrow(event, Number(nav.getAttribute('data-pfl-nav')))
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keydown routing for the roving-focus navbar; focus always sits on real buttons inside.
    <div className={`pfl-screen${kbNav ? ' is-kbnav' : ''}`} onKeyDown={onNavKey}>
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

        <PrototypeSwitcher />
      </main>

      {/* The rail is always mounted: opening and closing is the fold's 0fr→1fr, sideways. */}
      <aside
        className={`pfl-panel-rail${pick ? ' is-open' : ''}`}
        aria-hidden={!pick}
        inert={!pick}
      >
        <div className="pfl-rail-inner">
          {shown && (
            <div className="pfl-panel">
              <PrototypePanel
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
 * one, and every toggle re-pins so the selection survives a refresh. A resting project opens
 * nothing. Folding the open map is ephemeral — the pin stays, the fold does not.
 */
function MapTrace({
  project,
  selected,
  onPickItem,
  pick,
  kbNav = false,
}: {
  project: Project
  selected: number | null
  /** PROTOTYPE (throwaway): present only under the docked-panel screen — receives every click. */
  onPickItem?: (map: WayfinderMap, item: DrawerSelection) => void
  /** PROTOTYPE (throwaway): the panel's current pick, so its map can draw the active item. */
  pick?: { mapNumber: number; item: DrawerSelection } | null
  /** PROTOTYPE (throwaway): keyboard-was-last-mover — focused rows draw as hovered. */
  kbNav?: boolean
}) {
  const trace = [...project.openMaps, ...project.closedMaps]
  const active = activeMapOf(project)
  // PROTOTYPE (throwaway): 'current' keeps production rendering; C swaps the map child.
  const variant = usePrototypeVariant()

  // A pin that matches no map is a stale URL, not an error — fall back to the default.
  const pinned = selected !== null && trace.some((m) => m.number === selected) ? selected : null
  const defaultOpen = pinned ?? active?.number ?? null

  // The one map the user explicitly folded shut; navigation to any other map outgrows it.
  // PROTOTYPE (throwaway): under variant C the URL is the only state — the pin alone decides
  // what is open, folding-shut has no home in the URL, and this state never engages.
  const [folded, setFolded] = useState<number | null>(null)
  const openNumber = variant === 'current' && folded === defaultOpen ? null : defaultOpen

  const toggle = (mapNumber: number) => {
    if (openNumber === mapNumber) {
      if (variant === 'current') setFolded(mapNumber)
      return
    }
    setFolded(null)
    replaceHash(mapHash({ owner: project.owner, repo: project.repo, number: mapNumber }))
  }

  return (
    <div className="fl-trace">
      {trace.map((map, i) =>
        variant === 'current' ? (
          <MapChild
            key={map.number}
            map={map}
            open={openNumber === map.number}
            solo={trace.length === 1}
            last={i === trace.length - 1}
            onToggle={toggle}
          />
        ) : (
          <PrototypeMapChild
            key={prototypeMapKey(map)}
            map={map}
            open={openNumber === map.number}
            solo={trace.length === 1}
            last={i === trace.length - 1}
            onSelect={(item) => onPickItem?.(map, item)}
            onUnfold={() => toggle(map.number)}
            panelOpen={Boolean(pick)}
            selected={pick && pick.mapNumber === map.number ? pick.item : null}
            entry={!pick && i === 0}
            kbNav={kbNav}
          />
        ),
      )}
    </div>
  )
}

function maps(count: number): string {
  return count === 1 ? '1 map' : `${count} maps`
}
