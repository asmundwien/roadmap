import type { Blocker, Ticket, WayfinderMap } from '@roadmap/contracts'
import { type ReactNode, useMemo } from 'react'
import { stripInlineMarkdown } from '../gist.ts'
import { buildLedger, LEDGER_SCALE } from './prototype-geometry.ts'
import { type LedgerSelection, PrototypeMapLedger } from './prototype-ledger.tsx'
import './prototype-map.css'
import { STATE_META } from './state-meta.ts'

/**
 * PROTOTYPE — throwaway. The docked-panel design for the single-map representation, on the
 * existing `#/owner/repo` route behind `?variant=C` (prototype-switcher.tsx):
 *
 * - The trigger is inverted: the map title big, the destination prose a one-line gist.
 * - The map renders titles only; every descriptive text lives in the right-edge panel.
 * - The panel is NOT an overlay: it docks beside the page and eats its width, so the map stays
 *   clickable and item after item opens without closing anything in between. The selection state
 *   and the panel itself live on the project screen — one panel per screen, fed by every map.
 * - Clicking any item — ticket, fog patch, scope entry, or the trigger's cartouche chip — shows
 *   it in the panel, with "View in GitHub" replacing the per-row external links.
 * - A vast out-of-scope list collapses to one aggregate ⊘ stop; the panel holds the list.
 *
 * `current` (no param) renders the production MapChild untouched, as the baseline.
 */

/**
 * Everything the panel can show: the map's own prose, or one clicked item. Structurally the
 * router's `ResolvedSelection` — the hash carries the pick (fog/scope as list indices) and
 * router.ts owns the codec; this is the view's resolved, text-carrying side of it.
 */
export type DrawerSelection = LedgerSelection | { kind: 'map' }

export function prototypeMapKey(map: WayfinderMap): string {
  return `${map.nameWithOwner}#${map.number}`
}

export function PrototypeMapChild({
  map,
  open,
  solo,
  last,
  onSelect,
  onUnfold,
  panelOpen,
  selected,
  entry,
  kbNav,
}: {
  map: WayfinderMap
  open: boolean
  solo: boolean
  last: boolean
  onSelect: (item: DrawerSelection) => void
  /** Re-pin the hash to this map so its accordion unfolds — without touching the selection. */
  onUnfold: () => void
  /** Whether the panel is open at all (whatever it shows) — it decides what a trigger click
   * means on a folded map: unfold only while closed, unfold AND select while open. */
  panelOpen: boolean
  /** The panel's current pick when it belongs to this map — drawn as the active item. */
  selected: DrawerSelection | null
  /** True while the keyboard was the last mover — the ledger treats its focused row as hovered. */
  kbNav: boolean
  /** True when nothing is selected anywhere and this is the first map — the navbar's Tab entry
   * point. Every other element in the unit is reached with arrows, never Tab. */
  entry: boolean
}) {
  // Aligns the trigger's text with the embedded ledger's text column (exact at full render width).
  const textLeft = useMemo(() => buildLedger(map).textX * LEDGER_SCALE, [map])
  const partial = map.ticketsTruncated || map.tickets.some((ticket) => ticket.blockersTruncated)
  const ledgerSelected = selected !== null && selected.kind !== 'map' ? selected : null
  const isMapSelected = selected?.kind === 'map'

  const header = (
    <>
      <span className="fl-flag" aria-hidden="true">
        ⚑
      </span>
      <span className="fl-body" style={{ marginLeft: textLeft }}>
        <span className="fl-caption">the destination</span>
        <span className="pfl-title">{map.title}</span>
        <span className="pfl-gist">{stripInlineMarkdown(map.body.destination)}</span>
        {partial && (
          <span className="pfl-meta muted small">
            <span className="pfl-flaw">partial view</span>
          </span>
        )}
      </span>
    </>
  )

  const child = (
    <div className="fl-child">
      <CroppedLedger
        map={map}
        trunkToEdge={!last}
        onSelect={onSelect}
        selected={ledgerSelected}
        kbNav={kbNav}
      />
    </div>
  )

  const charted = map.isOpen ? ' is-charted' : ''

  // The destination is an item like any other, but its click reads the accordion and the panel:
  // a folded map with the panel closed unfolds first — click again to open the panel on it; with
  // the panel already open, one click unfolds AND selects; and activating the already-selected
  // destination deselects it (the screen's toggle), closing the panel. The GitHub link lives in
  // the panel.
  const expanded = solo || open
  const activate = () => {
    if (!expanded && !panelOpen) {
      onUnfold()
      return
    }
    onSelect({ kind: 'map' })
  }

  return (
    <article className={`fl-block${expanded ? ' is-open' : ''}${charted}`}>
      <div className={`fl-trigger${isMapSelected ? ' is-selected' : ''}`}>
        <button
          type="button"
          className="fl-hit"
          data-pfl-item="true"
          data-selected={isMapSelected ? 'true' : 'false'}
          tabIndex={isMapSelected || entry ? 0 : -1}
          aria-label={`${map.title} — the destination`}
          onClick={activate}
        />
        {header}
      </div>
      {solo ? child : <Fold open={open}>{child}</Fold>}
    </article>
  )
}

/** True when two picks point at the same thing — how the panel finds itself in the sequence. */
export function sameSelection(a: DrawerSelection, b: DrawerSelection): boolean {
  if (a.kind === 'ticket') return b.kind === 'ticket' && b.number === a.number
  if (a.kind === 'fog') return b.kind === 'fog' && b.text === a.text
  if (a.kind === 'scope') return b.kind === 'scope' && b.text === a.text
  return a.kind === b.kind
}

/**
 * The docked panel's whole content: the navbar riding its top — a square » dismiss button, then
 * two equal prev/next buttons filling the rest, walking the map's items in on-screen order —
 * and below it whatever the pick resolves to.
 */
export function PrototypePanel({
  map,
  item,
  onClose,
  onStep,
  onSelect,
  hasPrev,
  hasNext,
}: {
  map: WayfinderMap
  item: DrawerSelection
  onClose: () => void
  /** Move the pick by ±1 through the on-screen sequence. */
  onStep: (delta: number) => void
  /** Select another item on this map — how the panel's own item links navigate. */
  onSelect: (item: DrawerSelection) => void
  hasPrev: boolean
  hasNext: boolean
}) {
  return (
    <>
      {/* Part of the screen's single-tab-stop navbar: reached with ArrowRight from the item
          list, never with Tab. Native buttons — Space and Enter both activate, per standard.
          The square » dismiss sits at the far right, past the two equal prev/next buttons. */}
      <div className="pfl-panel-nav">
        <button
          type="button"
          data-pfl-nav="0"
          tabIndex={-1}
          aria-label="previous item on the map"
          disabled={!hasPrev}
          onClick={() => onStep(-1)}
        >
          <Chevron up />
        </button>
        <button
          type="button"
          data-pfl-nav="1"
          tabIndex={-1}
          aria-label="next item on the map"
          disabled={!hasNext}
          onClick={() => onStep(1)}
        >
          <Chevron />
        </button>
        <button
          type="button"
          className="pfl-panel-dismiss"
          data-pfl-nav="2"
          tabIndex={-1}
          aria-label="close the panel"
          onClick={onClose}
        >
          <ChevronsRight />
        </button>
      </div>
      <div className="pfl-panel-body">
        <DrawerBody map={map} selection={item} onSelect={onSelect} />
      </div>
    </>
  )
}

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={up ? 'M3 10l5-5 5 5' : 'M3 6l5 5 5-5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The dismiss glyph: the panel slides away to the right. */
function ChevronsRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 4l4 4-4 4M8.5 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DrawerBody({
  map,
  selection,
  onSelect,
}: {
  map: WayfinderMap
  selection: DrawerSelection
  onSelect: (item: DrawerSelection) => void
}) {
  switch (selection.kind) {
    case 'map':
      return <MapContent map={map} />
    case 'ticket':
      return <TicketContent map={map} number={selection.number} onSelect={onSelect} />
    case 'fog':
      return <ListItemContent map={map} caption="fog · not yet specified" text={selection.text} />
    case 'scope':
      return <ListItemContent map={map} caption="left out of scope" text={selection.text} />
    case 'scope-all':
      return <ScopeAllContent map={map} />
  }
}

/** The map's own prose — the cartouche: destination, notes, scope, and the honesty detail. */
function MapContent({ map }: { map: WayfinderMap }) {
  const partial = map.ticketsTruncated || map.tickets.some((ticket) => ticket.blockersTruncated)

  return (
    <div className="pfl-cartouche">
      <p className="pfl-cart-caption">
        {map.title} · #{map.number}
      </p>
      <GithubButton url={map.url} label="View map in GitHub" />
      <p className="pfl-cart-dest">{stripInlineMarkdown(map.body.destination)}</p>
      {map.body.notes.length > 0 && (
        <>
          <p className="pfl-cart-head">notes</p>
          <ul>
            {map.body.notes.map((note) => (
              <li key={note}>{stripInlineMarkdown(note)}</li>
            ))}
          </ul>
        </>
      )}
      {map.body.outOfScope.length > 0 && (
        <>
          <p className="pfl-cart-head">out of scope</p>
          <ul>
            {map.body.outOfScope.map((item) => (
              <li key={item}>{stripInlineMarkdown(item)}</li>
            ))}
          </ul>
        </>
      )}
      {partial && (
        <p className="pfl-cart-warn">
          Partial view — GitHub returned only the first page of{' '}
          {map.ticketsTruncated ? 'tickets' : 'some tickets’ blockers'}.
        </p>
      )}
      {map.body.missingSections.length > 0 && (
        <p className="pfl-cart-warn">
          Map body is missing sections: {map.body.missingSections.join(', ')}.
        </p>
      )}
    </div>
  )
}

/**
 * One ticket, everything the snapshot knows about it. NOTE: the wire carries no issue bodies —
 * the server's map query never fetches them — so "the rest of its content" is the decision gist
 * (for covered ground), the state, and the dependency edges. Fetching bodies is a server change
 * the real implementation would need.
 */
function TicketContent({
  map,
  number,
  onSelect,
}: {
  map: WayfinderMap
  number: number
  onSelect: (item: DrawerSelection) => void
}) {
  const ticket = map.tickets.find((t) => t.number === number)
  if (!ticket) return null
  const meta = STATE_META[ticket.state]
  const gist = map.body.decisions.find((d) => d.title === ticket.title)
  const login = ticket.assignees[0]?.login
  const body = ticket.body.trim()

  return (
    <div className="pfl-cartouche">
      <p className="pfl-cart-caption">
        #{ticket.number}
        {ticket.type !== 'untyped' ? ` · ${ticket.type}` : ''}
      </p>
      <GithubButton url={ticket.url} label="View item in GitHub" />
      <p className="pfl-item-title">{ticket.title}</p>
      <p className="pfl-item-state" style={{ color: meta.color }}>
        {meta.glyph} {meta.word}
        {login !== undefined ? ` · ${login}` : ''}
        {ticket.closedAt !== null ? ` · ${shortDate(ticket.closedAt)}` : ''}
      </p>
      {body !== '' && <p className="pfl-cart-dest">{body}</p>}
      {gist !== undefined && (
        <>
          <p className="pfl-cart-head">the decision</p>
          <p className="pfl-cart-dest">{stripInlineMarkdown(gist.gist)}</p>
        </>
      )}
      <BlockerList map={map} ticket={ticket} onSelect={onSelect} />
      {ticket.blockersTruncated && (
        <p className="pfl-cart-warn">GitHub returned only the first page of blockers.</p>
      )}
    </div>
  )
}

function BlockerList({
  map,
  ticket,
  onSelect,
}: {
  map: WayfinderMap
  ticket: Ticket
  onSelect: (item: DrawerSelection) => void
}) {
  if (ticket.blockedBy.length === 0) return null
  return (
    <>
      <hr className="pfl-rule" />
      <p className="pfl-cart-head">blocked by</p>
      <div className="pfl-item-links">
        {ticket.blockedBy.map((blocker) => (
          <ItemLink
            key={`${blocker.nameWithOwner}#${blocker.number}`}
            map={map}
            itemRef={blocker}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  )
}

/**
 * THE one presentation of a referenced item, wherever the panel mentions one: the title over the
 * item's state — glyph and word in the map's colors, exactly as the ledger's rows say it. A
 * reference to a ticket on this map is a button that selects it (the URL moves, the panel
 * follows); anything beyond the map links out to GitHub with what little is known of it.
 */
export function ItemLink({
  map,
  itemRef,
  onSelect,
}: {
  map: WayfinderMap
  itemRef: Blocker
  onSelect: (item: DrawerSelection) => void
}) {
  const local =
    itemRef.nameWithOwner === map.nameWithOwner
      ? map.tickets.find((t) => t.number === itemRef.number)
      : undefined

  if (local) {
    const meta = STATE_META[local.state]
    return (
      <button
        type="button"
        className="pfl-item-link"
        onClick={() => onSelect({ kind: 'ticket', number: local.number })}
      >
        <span className="pfl-item-link-title">{local.title}</span>
        <span className="pfl-item-link-state" style={{ color: meta.color }}>
          {meta.glyph} {meta.word}
        </span>
      </button>
    )
  }

  return (
    <a className="pfl-item-link" href={itemRef.url} target="_blank" rel="noreferrer">
      <span className="pfl-item-link-title">{itemRef.title} ↗</span>
      <span className="pfl-item-link-state">{itemRef.isOpen ? 'open' : 'closed'} · github</span>
    </a>
  )
}

/** A fog patch or scope entry in full — these live on the map issue itself, title-less. */
function ListItemContent({
  map,
  caption,
  text,
}: {
  map: WayfinderMap
  caption: string
  text: string
}) {
  return (
    <div className="pfl-cartouche">
      <p className="pfl-cart-caption">{caption}</p>
      <GithubButton url={map.url} label="View map in GitHub" />
      <p className="pfl-cart-dest">{text}</p>
    </div>
  )
}

/** The aggregate ⊘ stop's payload: the whole out-of-scope list, off the map's back. */
function ScopeAllContent({ map }: { map: WayfinderMap }) {
  return (
    <div className="pfl-cartouche">
      <p className="pfl-cart-caption">left out of scope · {map.body.outOfScope.length} things</p>
      <GithubButton url={map.url} label="View map in GitHub" />
      <ul>
        {map.body.outOfScope.map((item) => (
          <li key={item}>{stripInlineMarkdown(item)}</li>
        ))}
      </ul>
    </div>
  )
}

function GithubButton({ url, label }: { url: string; label: string }) {
  return (
    <p className="pfl-gh-row">
      <a className="pfl-gh" href={url} target="_blank" rel="noreferrer">
        {label} ↗
      </a>
    </p>
  )
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** ledger.tsx's crop, pointed at the prototype fork. */
function CroppedLedger({
  map,
  trunkToEdge,
  onSelect,
  selected,
  kbNav,
}: {
  map: WayfinderMap
  trunkToEdge: boolean
  onSelect: (selection: LedgerSelection) => void
  selected: LedgerSelection | null
  kbNav: boolean
}) {
  const cropPx = useMemo(() => buildLedger(map).sepFog * LEDGER_SCALE, [map])
  return (
    <div className="fl-crop">
      <div style={{ marginTop: -cropPx }}>
        <PrototypeMapLedger
          map={map}
          trunkToEdge={trunkToEdge}
          onSelect={onSelect}
          selected={selected}
          kbNav={kbNav}
        />
      </div>
    </div>
  )
}

/** map-child.tsx's fold, verbatim. */
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`fold${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="fold-inner">{children}</div>
    </div>
  )
}
