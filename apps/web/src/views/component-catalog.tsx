import type { TicketState, TicketType } from '@roadmap/contracts'
import type { ReactNode } from 'react'
import { Action, ActionGroup } from '../components/action/action.tsx'
import { Alert } from '../components/alert/alert.tsx'
import { AutomationMark } from '../components/automation-mark/automation-mark.tsx'
import { Badge } from '../components/badge/badge.tsx'
import { DestinationMark } from '../components/destination-mark/destination-mark.tsx'
import { TicketMark } from '../components/ticket-mark/ticket-mark.tsx'
import { STATE_META } from './map/state-meta.ts'
import './component-catalog.css'

const TICKET_TYPES = [
  'research',
  'prototype',
  'grilling',
  'task',
] as const satisfies readonly TicketType[]
const TICKET_STATES = [
  'frontier',
  'claimed',
  'blocked',
  'closed',
] as const satisfies readonly TicketState[]

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
          {TICKET_STATES.map((state) => (
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
        title="Minor marks"
        description="Compact variants repeat tracker state and Automation evidence beside text."
      >
        <div className="catalog-minor-marks">
          {TICKET_STATES.map((state) => {
            const meta = STATE_META[state]
            return (
              <Badge variant={meta.badgeVariant} key={state}>
                <TicketMark state={state} type="task" variant="inline" />
                {meta.word.slice(0, 1).toUpperCase()}
                {meta.word.slice(1)}
              </Badge>
            )
          })}
          <Badge variant="violet">
            <AutomationMark variant="inline" stage="classification" />
            Classification
          </Badge>
          <Badge variant="teal">
            <AutomationMark variant="inline" stage="wayfinder" />
            Wayfinder
          </Badge>
        </div>
      </CatalogSection>

      <CatalogSection
        title="Badges"
        description="Short labels and inline content use a shared shape with semantic color variants."
      >
        <div className="catalog-badges">
          <Badge>Neutral</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="muted">Muted</Badge>
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

type CatalogSectionProps = {
  title: string
  description: string
  children: ReactNode
}

function CatalogSection({ title, description, children }: CatalogSectionProps) {
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

type TicketMarkRowProps = { type: TicketType }

function TicketMarkRow({ type }: TicketMarkRowProps) {
  return (
    <>
      <strong className="catalog-row-label">{type}</strong>
      {TICKET_STATES.map((state) => (
        <svg
          className="catalog-ticket-mark"
          viewBox="-24 -24 48 48"
          aria-label={`${type} ${state}`}
          key={state}
        >
          <TicketMark state={state} type={type} variant="major" x={0} y={0} />
        </svg>
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
