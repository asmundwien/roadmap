import type { Ticket, TicketType } from '@roadmap/contracts'
import type { ReactNode } from 'react'
import { Action, ActionGroup } from '../components/action/action.tsx'
import { Alert } from '../components/alert/alert.tsx'
import { AutomationMark } from '../components/automation-mark/automation-mark.tsx'
import { Badge } from '../components/badge/badge.tsx'
import { DestinationMark } from '../components/destination-mark/destination-mark.tsx'
import { TicketMark } from '../components/ticket-mark/ticket-mark.tsx'
import './component-catalog.css'

const TICKET_TYPES = [
  'research',
  'prototype',
  'grilling',
  'task',
] as const satisfies readonly TicketType[]
const TICKET_STATES = [
  { state: 'frontier', isBlocked: false, isClaimed: false },
  { state: 'claimed', isBlocked: false, isClaimed: true },
  { state: 'blocked', isBlocked: true, isClaimed: false },
  { state: 'closed', isBlocked: false, isClaimed: false },
] as const satisfies readonly Pick<Ticket, 'state' | 'isBlocked' | 'isClaimed'>[]

const PALETTE = [
  ['Background', '--bg'],
  ['Foreground', '--fg'],
  ['Muted', '--muted'],
  ['Decided', '--signal-decided'],
  ['Frontier', '--state-frontier'],
  ['Claimed', '--state-claimed'],
  ['Blocked', '--state-blocked'],
  ['Goal', '--goal'],
] as const

export function ComponentCatalog() {
  return (
    <main className="shell component-catalog">
      <header className="component-catalog-head">
        <p className="component-catalog-eyebrow">UI inventory</p>
        <h1>Components</h1>
        <p className="muted">
          Shared marks, controls, and tokens. Each example uses the same classes and renderers as
          the product.
        </p>
      </header>

      <CatalogSection
        title="Palette"
        description="Semantic colors adapt to the active color scheme."
      >
        <div className="catalog-palette">
          {PALETTE.map(([label, token]) => (
            <div className="catalog-swatch" key={token}>
              <span style={{ background: `var(${token})` }} aria-hidden="true" />
              <strong>{label}</strong>
              <code>{token}</code>
            </div>
          ))}
        </div>
      </CatalogSection>

      <CatalogSection
        title="Ticket marks"
        description="Rows are work types. Columns are tracker states."
      >
        <div className="catalog-mark-matrix">
          <span />
          {TICKET_STATES.map(({ state }) => (
            <strong className="catalog-column-label" key={state}>
              {state}
            </strong>
          ))}
          {TICKET_TYPES.map((type) => (
            <TicketMarkRow key={type} type={type} />
          ))}
        </div>
      </CatalogSection>

      <CatalogSection
        title="Badges"
        description="Short semantic labels use one shape for ticket states and integrations."
      >
        <div className="catalog-badges">
          <Badge>Unknown</Badge>
          <Badge variant="github">GitHub</Badge>
          <Badge variant="local">Local</Badge>
          <Badge variant="blocked" />
          <Badge variant="takeable" />
          <Badge variant="claimed" />
          <Badge variant="decided" />
        </div>
      </CatalogSection>

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

      <CatalogSection
        title="Controls"
        description="Default, emphasized, destructive, and unavailable states."
      >
        <div className="catalog-control-groups">
          <div className="catalog-control-group">
            <span className="catalog-control-label">Actions</span>
            <ActionGroup>
              <Action type="button">Default</Action>
              <Action variant="strong" type="button">
                Emphasized
              </Action>
              <Action variant="danger" type="button">
                Destructive
              </Action>
              <Action type="button" disabled>
                Unavailable
              </Action>
            </ActionGroup>
          </div>
          <div className="catalog-control-group">
            <span className="catalog-control-label">Messages</span>
            <Alert>
              <strong>Action required.</strong>
              <span>The operation stays blocked until the problem is fixed.</span>
            </Alert>
            <Alert variant="info">
              <strong>Change saved.</strong>
              <span>The new configuration is active.</span>
            </Alert>
          </div>
        </div>
      </CatalogSection>
    </main>
  )
}

function CatalogSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="catalog-section">
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  )
}

function TicketMarkRow({ type }: { type: TicketType }) {
  return (
    <>
      <strong className="catalog-row-label">{type}</strong>
      {TICKET_STATES.map((ticket) => (
        <svg
          className="catalog-ticket-mark"
          viewBox="-24 -24 48 48"
          aria-label={`${type} ${ticket.state}`}
          key={ticket.state}
        >
          <TicketMark ticket={ticket} type={type} variant="major" x={0} y={0} />
        </svg>
      ))}
    </>
  )
}

function Signal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="catalog-signal">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {children}
      </svg>
      <span>{label}</span>
    </div>
  )
}
