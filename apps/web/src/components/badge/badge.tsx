import type { Connection, TicketState } from '@roadmap/contracts'
import type { ReactNode } from 'react'
import './badge.css'

export type StatusBadgeVariant = 'blocked' | 'takeable' | 'claimed' | 'decided'
export type BadgeVariant = 'neutral' | 'github' | 'local' | StatusBadgeVariant

type BadgeProps =
  | { children: ReactNode; variant?: 'neutral' | 'github' | 'local' }
  | { children?: never; variant: StatusBadgeVariant }

const STATUS_LABELS = {
  blocked: 'Blocked',
  takeable: 'Takeable',
  claimed: 'Claimed',
  decided: 'Decided',
} as const satisfies Record<StatusBadgeVariant, string>

export function Badge(props: BadgeProps) {
  const variant = props.variant ?? 'neutral'
  const children = isStatusBadgeVariant(variant) ? STATUS_LABELS[variant] : props.children

  return <span className={`badge badge-${variant}`}>{children}</span>
}

export function IntegrationBadge({ connection }: { connection: Connection | undefined }) {
  if (!connection) return <Badge>Unknown</Badge>
  return (
    <Badge variant={connection.integration}>
      {connection.integration === 'github' ? 'GitHub' : 'Local'}
    </Badge>
  )
}

export function badgeForTicketState(state: TicketState): StatusBadgeVariant {
  switch (state) {
    case 'blocked':
      return 'blocked'
    case 'frontier':
      return 'takeable'
    case 'claimed':
      return 'claimed'
    case 'closed':
      return 'decided'
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

export function badgeLabel(variant: StatusBadgeVariant): string {
  return STATUS_LABELS[variant]
}

function isStatusBadgeVariant(variant: BadgeVariant): variant is StatusBadgeVariant {
  return variant in STATUS_LABELS
}
