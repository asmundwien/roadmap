import type {
  AutomationOverrideControl,
  AutomationOverrideStage,
  AutomationState,
  Blocker,
  Command,
  CommandOutcome,
  ProjectKey,
  Ticket,
  WayfinderMap,
} from '@roadmap/contracts'
import { ticketTypeOf } from '@roadmap/contracts'
import { useState } from 'react'
import type { ResolvedSelection } from '../../router.ts'
import { stripInlineMarkdown } from '../gist.ts'
import './map.css'
import { type ProseLinkTarget, resolveProseLink } from './link-targets.ts'
import { Prose } from './prose.tsx'
import { STATE_META } from './state-meta.ts'

/**
 * The docked Panel — the one detail layer of the map view. NOT an overlay: it docks beside the
 * page and eats its width, so the map stays clickable and item after item opens without closing
 * anything in between. One Panel per screen, fed by every map; what it shows is the hash's
 * selection, resolved by the router (`ResolvedSelection`).
 */
export interface PanelAutomation {
  state: AutomationState
  configurationVersion: number
  commandInFlight: boolean
  execute(command: Command): Promise<CommandOutcome>
}

export function Panel({
  map,
  item,
  onClose,
  onStep,
  onSelect,
  hasPrev,
  hasNext,
  automation,
}: {
  map: WayfinderMap
  item: ResolvedSelection
  onClose: () => void
  onStep: (delta: number) => void
  onSelect: (item: ResolvedSelection) => void
  hasPrev: boolean
  hasNext: boolean
  automation: PanelAutomation
}) {
  return (
    <>
      <div className="panel-nav" role="toolbar" aria-label="panel navigation">
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
        <PanelBody map={map} selection={item} onSelect={onSelect} automation={automation} />
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
  automation,
}: {
  map: WayfinderMap
  selection: ResolvedSelection
  onSelect: (item: ResolvedSelection) => void
  automation: PanelAutomation
}) {
  switch (selection.kind) {
    case 'map':
      return <MapContent map={map} onSelect={onSelect} />
    case 'ticket':
      return (
        <TicketContent map={map} id={selection.id} onSelect={onSelect} automation={automation} />
      )
    case 'fog':
      return (
        <ListItemContent
          map={map}
          caption="fog · not yet specified"
          markdown={rawListItem(map.body.notYetSpecified, selection.text)}
          onSelect={onSelect}
        />
      )
    case 'scope':
      return (
        <ListItemContent
          map={map}
          caption="left out of scope"
          markdown={rawListItem(map.body.outOfScope, selection.text)}
          onSelect={onSelect}
        />
      )
    case 'scope-all':
      return <ScopeAllContent map={map} onSelect={onSelect} />
  }
}

function MapContent({
  map,
  onSelect,
}: {
  map: WayfinderMap
  onSelect: (item: ResolvedSelection) => void
}) {
  const partial = !map.ticketsComplete || map.tickets.some((ticket) => !ticket.blockersComplete)
  const resolveLink = proseLinkResolver(map, map.sourcePath)

  return (
    <div className="cartouche">
      <p className="cart-caption">
        {map.title}
        {map.displayId ? ` · ${map.displayId}` : ''}
      </p>
      <SourceButton url={map.url} label="View map in source" />
      <Prose markdown={map.body.destination} resolveLink={resolveLink} onSelect={onSelect} />
      {map.body.notes.length > 0 && (
        <>
          <p className="cart-head">notes</p>
          <ul>
            {map.body.notes.map((note) => (
              <li key={note}>
                <Prose markdown={note} resolveLink={resolveLink} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </>
      )}
      {map.body.decisions.length > 0 && <DecisionList map={map} onSelect={onSelect} />}
      {map.body.outOfScope.length > 0 && (
        <>
          <p className="cart-head">out of scope</p>
          <ul>
            {map.body.outOfScope.map((item) => (
              <li key={item}>
                <Prose markdown={item} resolveLink={resolveLink} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </>
      )}
      {partial && <p className="cart-warn">Partial view — some tickets or blockers are missing.</p>}
      {map.body.missingSections.length > 0 && (
        <p className="cart-warn">
          Map body is missing sections: {map.body.missingSections.join(', ')}.
        </p>
      )}
    </div>
  )
}

function TicketContent({
  map,
  id,
  onSelect,
  automation,
}: {
  map: WayfinderMap
  id: string
  onSelect: (item: ResolvedSelection) => void
  automation: PanelAutomation
}) {
  const ticket = map.tickets.find((t) => t.id === id)
  if (!ticket) return null
  const meta = STATE_META[ticket.state]
  const gist = map.body.decisions.find((d) => d.title === ticket.title)
  const assignee = ticket.assignees[0]?.name
  const body = ticket.body.trim()
  const type = ticketTypeOf(ticket.typeEvidence)
  const resolveLink = proseLinkResolver(map, ticket.sourcePath)
  const overrideControl = automation.state.overrides.find(
    (control) =>
      control.target.project.integration === map.project.integration &&
      control.target.project.id === map.project.id &&
      control.target.mapId === map.id &&
      control.target.ticketId === ticket.id,
  )

  return (
    <div className="cartouche">
      <p className="cart-caption">
        {ticket.displayId ?? ticket.id}
        {type !== 'untyped' ? ` · ${type}` : ''}
      </p>
      <SourceButton url={ticket.url} label="View item in source" />
      <p className="panel-item-title">{ticket.title}</p>
      <p className="panel-item-state" style={{ color: meta.color }}>
        {meta.glyph} {meta.word}
        {assignee !== undefined ? ` · ${assignee}` : ''}
        {ticket.closedAt !== undefined ? ` · ${shortDate(ticket.closedAt)}` : ''}
      </p>
      {body !== '' && <Prose markdown={body} resolveLink={resolveLink} onSelect={onSelect} />}
      {gist !== undefined && (
        <>
          <p className="cart-head">the decision</p>
          <Prose markdown={gist.gist} resolveLink={resolveLink} onSelect={onSelect} />
        </>
      )}
      <BlockerList map={map} ticket={ticket} onSelect={onSelect} />
      <AutomationOverrides
        key={`${map.project.integration}:${map.project.id}:${map.id}:${ticket.id}`}
        automation={automation}
        control={overrideControl}
        map={map}
        ticket={ticket}
      />
      {!ticket.blockersComplete && (
        <p className="cart-warn">Some blockers could not be resolved.</p>
      )}
    </div>
  )
}

function AutomationOverrides({
  automation,
  control,
  map,
  ticket,
}: {
  automation: PanelAutomation
  control: AutomationOverrideControl | undefined
  map: WayfinderMap
  ticket: Ticket
}) {
  const [feedback, setFeedback] = useState<{ kind: 'notice' | 'error'; text: string } | null>(null)
  const fallbackReason =
    automation.state.availability.status === 'unavailable'
      ? automation.state.availability.cause
      : 'Automation overrides are unavailable for this ticket.'
  const target = { project: map.project, mapId: map.id, ticketId: ticket.id }

  const run = async (stage: AutomationOverrideStage) => {
    setFeedback(null)
    try {
      const outcome = await automation.execute({
        type: 'start-automation-override',
        expectedConfigurationVersion: automation.configurationVersion,
        target,
        stage,
      })
      setFeedback(
        outcome.ok
          ? {
              kind: 'notice',
              text:
                stage === 'classification'
                  ? 'Classification Run started.'
                  : 'Wayfinder Session started.',
            }
          : { kind: 'error', text: outcome.error.message },
      )
    } catch {
      setFeedback({
        kind: 'error',
        text: 'The server did not confirm the Automation override. Wait for live state before retrying.',
      })
    }
  }

  return (
    <>
      <hr className="panel-rule" />
      <p className="cart-head">Automation override</p>
      <p className="automation-override-intro">
        Start one eligible stage without changing global or Project Automation enablement.
      </p>
      <div className="automation-override-actions">
        <OverrideButton
          label="Run Classification"
          available={control?.classification}
          fallbackReason={fallbackReason}
          commandInFlight={automation.commandInFlight}
          eligibleHint="Classify this ticket once."
          onClick={() => void run('classification')}
        />
        <OverrideButton
          label="Start Wayfinder Session"
          available={control?.wayfinder}
          fallbackReason={fallbackReason}
          commandInFlight={automation.commandInFlight}
          eligibleHint="Start the AFK-approved ticket once."
          onClick={() => void run('wayfinder')}
        />
      </div>
      {feedback !== null && (
        <p
          className={
            feedback.kind === 'error' ? 'automation-override-error' : 'automation-override-notice'
          }
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      )}
    </>
  )
}

function OverrideButton({
  label,
  available,
  fallbackReason,
  commandInFlight,
  eligibleHint,
  onClick,
}: {
  label: string
  available: AutomationOverrideControl['classification'] | undefined
  fallbackReason: string
  commandInFlight: boolean
  eligibleHint: string
  onClick: () => void
}) {
  const reason = commandInFlight
    ? 'Another operation is in progress.'
    : available?.status === 'ineligible'
      ? available.reason
      : available === undefined
        ? fallbackReason
        : eligibleHint
  const disabled = commandInFlight || available?.status !== 'eligible'
  return (
    <div className="automation-override-action">
      <button type="button" disabled={disabled} title={reason} onClick={onClick}>
        {label}
      </button>
      <span>{reason}</span>
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
            key={`${blocker.project.integration}:${blocker.project.id}:${blocker.ticketId}`}
            map={map}
            itemRef={blocker}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  )
}

function DecisionList({
  map,
  onSelect,
}: {
  map: WayfinderMap
  onSelect: (item: ResolvedSelection) => void
}) {
  const resolveLink = proseLinkResolver(map, map.sourcePath)
  return (
    <>
      <p className="cart-head">decisions so far</p>
      <div className="item-links">
        {map.body.decisions.map((decision) => (
          <DecisionLink
            key={`${decision.title}:${decision.url ?? 'plain'}`}
            title={decision.title}
            gist={decision.gist}
            target={resolveLink(decision.url ?? undefined)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  )
}

function DecisionLink({
  title,
  gist,
  target,
  onSelect,
}: {
  title: string
  gist: string
  target: ProseLinkTarget | null
  onSelect: (item: ResolvedSelection) => void
}) {
  const gistNode = gist ? (
    <div className="item-link-state item-link-gist">
      <Prose markdown={gist} />
    </div>
  ) : null

  if (target?.kind === 'selection') {
    return (
      <button type="button" className="item-link" onClick={() => onSelect(target.selection)}>
        <span className="item-link-title">{title}</span>
        {gistNode}
      </button>
    )
  }

  if (target?.kind === 'href') {
    return (
      <a className="item-link" href={target.href} target="_blank" rel="noreferrer">
        <span className="item-link-title">{title} ↗</span>
        {gistNode}
      </a>
    )
  }

  return (
    <span className="item-link" aria-disabled="true" title={target?.reason}>
      <span className="item-link-title">{title}</span>
      {gistNode}
    </span>
  )
}

export function ItemLink({
  map,
  itemRef,
  onSelect,
}: {
  map: WayfinderMap
  itemRef: Blocker
  onSelect: (item: ResolvedSelection) => void
}) {
  const local = sameProject(itemRef.project, map.project)
    ? map.tickets.find((t) => t.id === itemRef.ticketId)
    : undefined

  if (local) {
    const meta = STATE_META[local.state]
    return (
      <button
        type="button"
        className="item-link"
        onClick={() => onSelect({ kind: 'ticket', id: local.id })}
      >
        <span className="item-link-title">{local.title}</span>
        <span className="item-link-state" style={{ color: meta.color }}>
          {meta.glyph} {meta.word}
        </span>
      </button>
    )
  }

  if (itemRef.url) {
    return (
      <a className="item-link" href={itemRef.url} target="_blank" rel="noreferrer">
        <span className="item-link-title">{itemRef.title} ↗</span>
        <span className="item-link-state">{itemRef.state} · source</span>
      </a>
    )
  }

  return (
    <span className="item-link" aria-disabled="true">
      <span className="item-link-title">
        {itemRef.title ?? itemRef.displayId ?? itemRef.ticketId}
      </span>
      <span className="item-link-state">{itemRef.state}</span>
    </span>
  )
}

function rawListItem(items: string[], stripped: string): string {
  return items.find((item) => stripInlineMarkdown(item) === stripped) ?? stripped
}

function ListItemContent({
  map,
  caption,
  markdown,
  onSelect,
}: {
  map: WayfinderMap
  caption: string
  markdown: string
  onSelect: (item: ResolvedSelection) => void
}) {
  return (
    <div className="cartouche">
      <p className="cart-caption">{caption}</p>
      <SourceButton url={map.url} label="View map in source" />
      <Prose
        markdown={markdown}
        resolveLink={proseLinkResolver(map, map.sourcePath)}
        onSelect={onSelect}
      />
    </div>
  )
}

function ScopeAllContent({
  map,
  onSelect,
}: {
  map: WayfinderMap
  onSelect: (item: ResolvedSelection) => void
}) {
  const resolveLink = proseLinkResolver(map, map.sourcePath)
  return (
    <div className="cartouche">
      <p className="cart-caption">left out of scope · {map.body.outOfScope.length} things</p>
      <SourceButton url={map.url} label="View map in source" />
      <ul>
        {map.body.outOfScope.map((item) => (
          <li key={item}>
            <Prose markdown={item} resolveLink={resolveLink} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function SourceButton({ url, label }: { url?: string; label: string }) {
  if (!url) return null
  return (
    <p className="gh-row">
      <a className="gh-link" href={url} target="_blank" rel="noreferrer">
        {label} ↗
      </a>
    </p>
  )
}

function proseLinkResolver(
  map: WayfinderMap,
  sourcePath: string | undefined,
): (href: string | undefined) => ProseLinkTarget | null {
  return (href) => resolveProseLink(map, sourcePath, href)
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
