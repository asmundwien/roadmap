import type { TicketState, TicketType } from '@roadmap/contracts'
import { Mark, type MarkCornerCount, type MarkFill, type MarkSize } from '@roadmap/ui/mark'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import type { Variant } from '@roadmap/ui/variant'
import type { ReactNode } from 'react'
import { TicketMark } from '@/views/shared/ticket-mark'
import './mark.css'

const MARK_FILLS = ['solid', 'half', 'outline'] as const satisfies readonly MarkFill[]
const MARK_CORNER_COUNTS = [0, 1, 2, 3, 4] as const satisfies readonly MarkCornerCount[]
const MARK_SIZES = ['large', 'medium', 'small'] as const satisfies readonly MarkSize[]
const MARK_VARIANTS = [
  ['neutral', '--comp-mark-neutral-color'],
  ['accent', '--comp-mark-accent-color'],
  ['highlight', '--comp-mark-highlight-color'],
  ['warning', '--comp-mark-warning-color'],
  ['danger', '--comp-mark-danger-color'],
  ['success', '--comp-mark-success-color'],
  ['info', '--comp-mark-info-color'],
  ['muted', '--comp-mark-muted-color'],
] as const satisfies readonly (readonly [Variant, string])[]

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

export function MarkCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Mark</SectionTitle>
        <SectionDescription>
          The diamond primitive. It holds no domain meaning: the caller picks fill, glyph, corner
          count, and color. A solid face knocks the glyph out in --comp-mark-surface-color; the
          other fills draw it in the variant color with a surface halo.
        </SectionDescription>
      </SectionHeader>

      <SectionBody>
        <MarkGroup label="Fill">
          {MARK_FILLS.map((fill) => (
            <MarkCell caption={fill} key={fill}>
              <Mark fill={fill} glyph="T" size="large" variant="info" />
            </MarkCell>
          ))}
        </MarkGroup>
        <MarkGroup label="Corners">
          {MARK_CORNER_COUNTS.map((corners) => (
            <MarkCell caption={String(corners)} key={corners}>
              <Mark accent="accent" corners={corners} fill="outline" size="large" variant="muted" />
            </MarkCell>
          ))}
        </MarkGroup>
        <MarkGroup label="Size">
          {MARK_SIZES.map((size) => (
            <MarkCell caption={size} key={size}>
              <Mark fill="solid" glyph="T" size={size} variant="info" />
            </MarkCell>
          ))}
        </MarkGroup>
        <MarkGroup label="Variant">
          {MARK_VARIANTS.map(([variant, token]) => (
            <MarkCell caption={token} key={variant}>
              <Mark fill="solid" size="large" variant={variant} />
            </MarkCell>
          ))}
        </MarkGroup>
      </SectionBody>
    </Section>
  )
}

export function TicketMarkCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Ticket mark</SectionTitle>
        <SectionDescription>
          The ticket encoding, owned by views/shared/ticket-presentation.ts. State picks the color
          and the fill. Type picks the glyph, the corner count, and the accent that colors the
          corners. A decided ticket swaps its glyph for a check and keeps its type corners.
        </SectionDescription>
      </SectionHeader>

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
    </Section>
  )
}

type MarkGroupProps = { label: string; children: ReactNode }

function MarkGroup({ label, children }: MarkGroupProps) {
  return (
    <SectionGroup>
      <strong className="catalog-row-label">{label}</strong>
      <div className="catalog-mark-row">{children}</div>
    </SectionGroup>
  )
}

type MarkCellProps = { caption: string; children: ReactNode }

function MarkCell({ caption, children }: MarkCellProps) {
  return (
    <div className="catalog-mark-cell">
      {children}
      <code>{caption}</code>
    </div>
  )
}

type TicketMarkStateRowProps = { label: string; state: TicketState }

function TicketMarkStateRow({ label, state }: TicketMarkStateRowProps) {
  return (
    <>
      <strong className="catalog-row-label">{label}</strong>
      {TICKET_TYPES.map(([typeLabel, type]) => (
        <div className="catalog-mark-example" key={type} title={`${label} ${typeLabel}`}>
          <TicketMark size="large" state={state} type={type} />
        </div>
      ))}
    </>
  )
}
