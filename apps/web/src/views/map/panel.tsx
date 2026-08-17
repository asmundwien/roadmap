import type { Blocker, Ticket, WayfinderMap } from '@roadmap/contracts'
import type { ResolvedSelection } from '../../router.ts'
import { stripInlineMarkdown } from '../gist.ts'
import './map.css'
import { Prose } from './prose.tsx'
import { STATE_META } from './state-meta.ts'

/**
 * The docked Panel — the one detail layer of the map view. NOT an overlay: it docks beside the
 * page and eats its width, so the map stays clickable and item after item opens without closing
 * anything in between. One Panel per screen, fed by every map; what it shows is the hash's
 * selection, resolved by the router (`ResolvedSelection`).
 *
 * Its whole content: the navbar riding its top — two equal prev/next buttons walking the trace's
 * items in on-screen order, then a square » dismiss — and below it whatever the pick resolves to.
 */
export function Panel({
  map,
  item,
  onClose,
  onStep,
  onSelect,
  hasPrev,
  hasNext,
}: {
  map: WayfinderMap
  item: ResolvedSelection
  onClose: () => void
  /** Move the pick by ±1 through the on-screen sequence. */
  onStep: (delta: number) => void
  /** Select another item on this map — how the Panel's own item links navigate. */
  onSelect: (item: ResolvedSelection) => void
  hasPrev: boolean
  hasNext: boolean
}) {
  return (
    <>
      {/* Part of the screen's single-tab-stop navbar: reached with ArrowRight from the item
          list, never with Tab. Native buttons — Space and Enter both activate, per standard.
          The square » dismiss sits at the far right, past the two equal prev/next buttons. */}
      <div className="panel-nav">
        <button
          type="button"
          data-panel-nav="0"
          tabIndex={-1}
          aria-label="previous item on the map"
          disabled={!hasPrev}
          onClick={() => onStep(-1)}
        >
          <Chevron up />
        </button>
        <button
          type="button"
          data-panel-nav="1"
          tabIndex={-1}
          aria-label="next item on the map"
          disabled={!hasNext}
          onClick={() => onStep(1)}
        >
          <Chevron />
        </button>
        <button
          type="button"
          className="panel-dismiss"
          data-panel-nav="2"
          tabIndex={-1}
          aria-label="close the panel"
          onClick={onClose}
        >
          <ChevronsRight />
        </button>
      </div>
      <div className="panel-body">
        <PanelBody map={map} selection={item} onSelect={onSelect} />
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

/** The dismiss glyph: the Panel slides away to the right. */
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

function PanelBody({
  map,
  selection,
  onSelect,
}: {
  map: WayfinderMap
  selection: ResolvedSelection
  onSelect: (item: ResolvedSelection) => void
}) {
  switch (selection.kind) {
    case 'map':
      return <MapContent map={map} />
    case 'ticket':
      return <TicketContent map={map} number={selection.number} onSelect={onSelect} />
    case 'fog':
      return (
        <ListItemContent
          map={map}
          caption="fog · not yet specified"
          markdown={rawListItem(map.body.notYetSpecified, selection.text)}
        />
      )
    case 'scope':
      return (
        <ListItemContent
          map={map}
          caption="left out of scope"
          markdown={rawListItem(map.body.outOfScope, selection.text)}
        />
      )
    case 'scope-all':
      return <ScopeAllContent map={map} />
  }
}

/** The map's own prose — the cartouche: destination, notes, scope, and the honesty detail. */
function MapContent({ map }: { map: WayfinderMap }) {
  const partial = map.ticketsTruncated || map.tickets.some((ticket) => ticket.blockersTruncated)

  return (
    <div className="cartouche">
      <p className="cart-caption">
        {map.title} · #{map.number}
      </p>
      <GithubButton url={map.url} label="View map in GitHub" />
      <Prose markdown={map.body.destination} />
      {map.body.notes.length > 0 && (
        <>
          <p className="cart-head">notes</p>
          <ul>
            {map.body.notes.map((note) => (
              <li key={note}>
                <Prose markdown={note} />
              </li>
            ))}
          </ul>
        </>
      )}
      {map.body.outOfScope.length > 0 && (
        <>
          <p className="cart-head">out of scope</p>
          <ul>
            {map.body.outOfScope.map((item) => (
              <li key={item}>
                <Prose markdown={item} />
              </li>
            ))}
          </ul>
        </>
      )}
      {partial && (
        <p className="cart-warn">
          Partial view — GitHub returned only the first page of{' '}
          {map.ticketsTruncated ? 'tickets' : 'some tickets’ blockers'}.
        </p>
      )}
      {map.body.missingSections.length > 0 && (
        <p className="cart-warn">
          Map body is missing sections: {map.body.missingSections.join(', ')}.
        </p>
      )}
    </div>
  )
}

/** One ticket, everything the snapshot knows about it: the issue body, the decision's gist when
 * the map records one, the state, and the dependency edges. */
function TicketContent({
  map,
  number,
  onSelect,
}: {
  map: WayfinderMap
  number: number
  onSelect: (item: ResolvedSelection) => void
}) {
  const ticket = map.tickets.find((t) => t.number === number)
  if (!ticket) return null
  const meta = STATE_META[ticket.state]
  const gist = map.body.decisions.find((d) => d.title === ticket.title)
  const login = ticket.assignees[0]?.login
  const body = ticket.body.trim()

  return (
    <div className="cartouche">
      <p className="cart-caption">
        #{ticket.number}
        {ticket.type !== 'untyped' ? ` · ${ticket.type}` : ''}
      </p>
      <GithubButton url={ticket.url} label="View item in GitHub" />
      <p className="panel-item-title">{ticket.title}</p>
      <p className="panel-item-state" style={{ color: meta.color }}>
        {meta.glyph} {meta.word}
        {login !== undefined ? ` · ${login}` : ''}
        {ticket.closedAt !== null ? ` · ${shortDate(ticket.closedAt)}` : ''}
      </p>
      {body !== '' && <Prose markdown={body} />}
      {gist !== undefined && (
        <>
          <p className="cart-head">the decision</p>
          <Prose markdown={gist.gist} />
        </>
      )}
      <BlockerList map={map} ticket={ticket} onSelect={onSelect} />
      {ticket.blockersTruncated && (
        <p className="cart-warn">GitHub returned only the first page of blockers.</p>
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
  onSelect: (item: ResolvedSelection) => void
}) {
  if (ticket.blockedBy.length === 0) return null
  return (
    <>
      <hr className="panel-rule" />
      <p className="cart-head">blocked by</p>
      <div className="item-links">
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
 * THE one presentation of a referenced item, wherever the Panel mentions one: the title over the
 * item's state — glyph and word in the map's colors, exactly as the ledger's rows say it. A
 * reference to a ticket on this map is a button that selects it (the URL moves, the Panel
 * follows); anything beyond the map links out to GitHub with what little is known of it.
 */
export function ItemLink({
  map,
  itemRef,
  onSelect,
}: {
  map: WayfinderMap
  itemRef: Blocker
  onSelect: (item: ResolvedSelection) => void
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
        className="item-link"
        onClick={() => onSelect({ kind: 'ticket', number: local.number })}
      >
        <span className="item-link-title">{local.title}</span>
        <span className="item-link-state" style={{ color: meta.color }}>
          {meta.glyph} {meta.word}
        </span>
      </button>
    )
  }

  return (
    <a className="item-link" href={itemRef.url} target="_blank" rel="noreferrer">
      <span className="item-link-title">{itemRef.title} ↗</span>
      <span className="item-link-state">{itemRef.isOpen ? 'open' : 'closed'} · github</span>
    </a>
  )
}

/**
 * Selections carry the ledger's stripped text — it doubles as the pick's identity — so the raw
 * markdown it names is looked back up for rendering. A miss (a snapshot replace racing the pick)
 * falls back to the stripped text itself: plain, but never wrong.
 */
function rawListItem(items: string[], stripped: string): string {
  return items.find((item) => stripInlineMarkdown(item) === stripped) ?? stripped
}

/** A fog patch or scope entry in full — these live on the map issue itself, title-less. */
function ListItemContent({
  map,
  caption,
  markdown,
}: {
  map: WayfinderMap
  caption: string
  markdown: string
}) {
  return (
    <div className="cartouche">
      <p className="cart-caption">{caption}</p>
      <GithubButton url={map.url} label="View map in GitHub" />
      <Prose markdown={markdown} />
    </div>
  )
}

/** The aggregate ⊘ stop's payload: the whole out-of-scope list, off the map's back. */
function ScopeAllContent({ map }: { map: WayfinderMap }) {
  return (
    <div className="cartouche">
      <p className="cart-caption">left out of scope · {map.body.outOfScope.length} things</p>
      <GithubButton url={map.url} label="View map in GitHub" />
      <ul>
        {map.body.outOfScope.map((item) => (
          <li key={item}>
            <Prose markdown={item} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function GithubButton({ url, label }: { url: string; label: string }) {
  return (
    <p className="gh-row">
      <a className="gh-link" href={url} target="_blank" rel="noreferrer">
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
