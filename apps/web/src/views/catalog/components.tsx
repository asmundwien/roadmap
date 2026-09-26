import type { ReactNode } from 'react'
import { Action, ActionGroup } from '@/components/action/action'
import { AutomationMark } from '@/components/automation-mark/automation-mark'
import { Badge } from '@/components/badge/badge'
import { DestinationMark } from '@/components/destination-mark/destination-mark'
import {
  TicketMark,
  type TicketMarkCornerCount,
  type TicketMarkFill,
} from '@/components/ticket-mark/ticket-mark'
import type { Variant } from '@/components/variant'
import { CatalogSection, ComponentTokenList } from './section'
import './actions.css'
import './signals.css'
import './ticket.css'
import './tiny.css'

const TICKET_MARK_FILLS = ['none', 'half', 'fill'] as const satisfies readonly TicketMarkFill[]
const TICKET_MARK_CORNERS = [0, 1, 2, 3, 4] as const satisfies readonly TicketMarkCornerCount[]
const TICKET_MARK_VARIANT_BY_FILL = {
  none: 'neutral',
  half: 'info',
  fill: 'success',
} as const satisfies Record<TicketMarkFill, Variant>
const TINY_MARK_VARIANTS = [
  'neutral',
  'accent',
  'warning',
  'danger',
  'success',
] as const satisfies readonly Variant[]
const TINY_MARK_GLYPH = {
  neutral: 'n',
  accent: 'a',
  warning: 'w',
  danger: 'd',
  success: 's',
} as const satisfies Record<(typeof TINY_MARK_VARIANTS)[number], string>
const TICKET_MARK_CORNER_GLYPHS = ['0', '1', '2', '3', '4'] as const
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
      description="A diamond mark with independent color, accent, fill, corner, content, and size controls. Rows show fill; columns show corner count."
    >
      <div className="catalog-mark-matrix">
        <span />
        {TICKET_MARK_CORNERS.map((cornerCount) => (
          <strong className="catalog-column-label" key={cornerCount}>
            {cornerCount} {cornerCount === 1 ? 'corner' : 'corners'}
          </strong>
        ))}
        {TICKET_MARK_FILLS.map((fill) => (
          <TicketMarkRow fill={fill} key={fill} />
        ))}
      </div>
    </CatalogSection>
  )
}

export function TinyTicketMarksCatalogSection() {
  return (
    <CatalogSection
      title="Tiny ticket marks"
      description="The tiny size fits inline text and omits content."
    >
      <div className="catalog-tiny-marks">
        {TINY_MARK_VARIANTS.map((variant) => (
          <Badge variant={variant} key={variant}>
            <TicketMark accent={variant} cornerCount={0} fill="fill" size="tiny" variant={variant}>
              {TINY_MARK_GLYPH[variant]}
            </TicketMark>
            {TINY_MARK_GLYPH[variant].toUpperCase()}
            {variant.slice(1)}
          </Badge>
        ))}
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

type TicketMarkRowProps = { fill: TicketMarkFill }

function TicketMarkRow({ fill }: TicketMarkRowProps) {
  const variant = TICKET_MARK_VARIANT_BY_FILL[fill]

  return (
    <>
      <strong className="catalog-row-label">{fill}</strong>
      {TICKET_MARK_CORNERS.map((cornerCount) => (
        <svg
          className="catalog-ticket-mark"
          viewBox="-24 -24 48 48"
          aria-label={`${fill} fill with ${cornerCount} ${cornerCount === 1 ? 'corner' : 'corners'}`}
          key={cornerCount}
        >
          <TicketMark
            accent="warning"
            cornerCount={cornerCount}
            fill={fill}
            size="major"
            variant={variant}
            x={0}
            y={0}
          >
            {TICKET_MARK_CORNER_GLYPHS[cornerCount]}
          </TicketMark>
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
