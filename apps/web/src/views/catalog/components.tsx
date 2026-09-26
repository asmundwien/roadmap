import type { TicketState, TicketType } from '@roadmap/contracts'
import type { ReactNode } from 'react'
import { Action, ActionGroup } from '@/components/action/action'
import { AutomationMark } from '@/components/automation-mark/automation-mark'
import { DestinationMark } from '@/components/destination-mark/destination-mark'
import { TicketMark, type TicketMarkSize } from '@/components/ticket-mark/ticket-mark'
import { CatalogSection, ComponentTokenList } from './section'
import './actions.css'
import './signals.css'
import './ticket.css'

const TICKET_STATES = [
  ['Blocked', 'blocked'],
  ['Takeable', 'frontier'],
  ['Claimed', 'claimed'],
  ['Decided', 'closed'],
] as const satisfies readonly (readonly [string, TicketState])[]
const TICKET_TYPES = [
  ['Untyped', 'untyped'],
  ['Research', 'research'],
  ['Prototype', 'prototype'],
  ['Grilling', 'grilling'],
  ['Task', 'task'],
] as const satisfies readonly (readonly [string, TicketType])[]
const TICKET_MARK_SIZES = ['large', 'medium', 'small'] as const satisfies readonly TicketMarkSize[]
const TICKET_MARK_COLOR_TOKENS = [
  '--comp-ticket-mark-surface-color',
  '--comp-ticket-mark-closed-color',
  '--comp-ticket-mark-frontier-color',
  '--comp-ticket-mark-claimed-color',
  '--comp-ticket-mark-blocked-color',
  '--comp-ticket-mark-research-color',
  '--comp-ticket-mark-prototype-color',
  '--comp-ticket-mark-grilling-color',
  '--comp-ticket-mark-task-color',
  '--comp-ticket-mark-untyped-color',
] as const
const ACTION_DEFAULT_COLOR_TOKENS = [
  '--comp-action-outline-color',
  '--comp-action-label-color',
  '--comp-action-hover-container-color',
  '--comp-action-hover-label-color',
] as const
const ACTION_STRONG_COLOR_TOKENS = [
  '--comp-action-outline-color',
  '--comp-action-strong-container-color',
  '--comp-action-strong-label-color',
  '--comp-action-hover-container-color',
  '--comp-action-hover-label-color',
] as const
const ACTION_DANGER_COLOR_TOKENS = [
  '--comp-action-outline-color',
  '--comp-action-danger-label-color',
  '--comp-action-danger-hover-container-color',
  '--comp-action-danger-hover-label-color',
] as const

export function TicketMarkCatalogSection() {
  return (
    <CatalogSection
      title="Ticket mark"
      description="One ticket state and type mark rendered at three supported sizes."
    >
      <div className="catalog-ticket-mark-examples">
        <div className="catalog-mark-matrix">
          <span />
          {TICKET_TYPES.map(([label, type]) => (
            <strong className="catalog-column-label" key={type}>
              {label}
            </strong>
          ))}
          {TICKET_STATES.map(([label, state]) => (
            <TicketMarkStateRow key={state} label={label} state={state} />
          ))}
        </div>
        <div className="catalog-ticket-mark-sizes">
          {TICKET_MARK_SIZES.map((size) => (
            <div className="catalog-ticket-mark-size" key={size}>
              <TicketMark size={size} state="claimed" type="prototype" />
              <code>{size}</code>
            </div>
          ))}
        </div>
        <ComponentTokenList tokens={TICKET_MARK_COLOR_TOKENS} />
      </div>
    </CatalogSection>
  )
}

export function RoadmapSignalsCatalogSection() {
  return (
    <CatalogSection
      title="Roadmap signals"
      description="Product state and Automation evidence remain separate visual facts."
    >
      <div className="catalog-signals">
        <Signal label="Destination">
          <DestinationMark variant="plot" x={24} y={24} />
        </Signal>
        <Signal label="Classification">
          <AutomationMark variant="plot" stage="classification" glyph="C" x={24} y={24} />
        </Signal>
        <Signal label="Wayfinder">
          <AutomationMark variant="plot" stage="wayfinder" glyph="W" x={24} y={24} />
        </Signal>
      </div>
    </CatalogSection>
  )
}

export function ActionsCatalogSection() {
  return (
    <CatalogSection
      title="Actions"
      description="Native buttons trigger commands; links navigate. Variants set emphasis and intent."
    >
      <div className="catalog-action-examples">
        <section className="catalog-action-example">
          <header>
            <h3>Default</h3>
            <p>
              Use for routine commands and navigation. Hover and keyboard focus change both the
              container and label roles.
            </p>
          </header>
          <ActionGroup>
            <Action type="button">Button</Action>
            <Action element="link" href="#/components">
              Link
            </Action>
          </ActionGroup>
          <ComponentTokenList tokens={ACTION_DEFAULT_COLOR_TOKENS} />
        </section>

        <section className="catalog-action-example">
          <header>
            <h3>Strong</h3>
            <p>
              Use for the preferred action in a group. The resting container has higher emphasis;
              hover and keyboard focus use the shared interaction roles.
            </p>
          </header>
          <Action variant="strong" type="button">
            Continue
          </Action>
          <ComponentTokenList tokens={ACTION_STRONG_COLOR_TOKENS} />
        </section>

        <section className="catalog-action-example">
          <header>
            <h3>Danger</h3>
            <p>
              Use only for destructive commands. Resting and hover colors use the error role and its
              paired container content role.
            </p>
          </header>
          <Action variant="danger" type="button">
            Remove
          </Action>
          <ComponentTokenList tokens={ACTION_DANGER_COLOR_TOKENS} />
        </section>

        <section className="catalog-action-example">
          <header>
            <h3>Unavailable</h3>
            <p>
              Only buttons support this state. The native disabled attribute blocks activation; the
              component keeps its base colors at 40% opacity.
            </p>
          </header>
          <Action type="button" disabled>
            Unavailable
          </Action>
        </section>

        <section className="catalog-action-example">
          <header>
            <h3>Field size</h3>
            <p>Use the taller size when an action sits beside a form field.</p>
          </header>
          <Action size="field" type="button">
            Choose directory
          </Action>
        </section>
      </div>
    </CatalogSection>
  )
}

type TicketMarkStateRowProps = {
  label: string
  state: TicketState
}

function TicketMarkStateRow({ label, state }: TicketMarkStateRowProps) {
  return (
    <>
      <strong className="catalog-row-label">{label}</strong>
      {TICKET_TYPES.map(([typeLabel, type]) => (
        <div className="catalog-ticket-mark-example" key={type} title={`${label} ${typeLabel}`}>
          <TicketMark size="large" state={state} type={type} />
        </div>
      ))}
    </>
  )
}

type SignalProps = { label: string; children: ReactNode }

function Signal({ label, children }: SignalProps) {
  return (
    <div className="catalog-signal">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {children}
      </svg>
      <span>{label}</span>
    </div>
  )
}
