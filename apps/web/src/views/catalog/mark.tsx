import type { TicketState, TicketType } from '@roadmap/contracts'
import { Section, SectionDescription, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import classNames from 'classnames/bind'
import { TicketMark } from '@/views/shared/ticket-mark'
import styles from './mark.module.css'

const cx = classNames.bind(styles)

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

      <div className={cx('catalog-mark-matrix')}>
        <span />
        {TICKET_TYPES.map(([label, type]) => (
          <strong className={cx('catalog-column-label')} key={type}>
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

type TicketMarkStateRowProps = { label: string; state: TicketState }

function TicketMarkStateRow({ label, state }: TicketMarkStateRowProps) {
  return (
    <>
      <strong className={cx('catalog-row-label')}>{label}</strong>
      {TICKET_TYPES.map(([typeLabel, type]) => (
        <div className={cx('catalog-mark-example')} key={type} title={`${label} ${typeLabel}`}>
          <TicketMark size="large" state={state} type={type} />
        </div>
      ))}
    </>
  )
}
