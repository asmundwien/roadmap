import type { TicketState } from '@roadmap/contracts'
import './status-tag.css'

export type StatusTagVariant = 'blocked' | 'takeable' | 'claimed' | 'decided'

const STATUS_LABELS = {
  blocked: 'Blocked',
  takeable: 'Takeable',
  claimed: 'Claimed',
  decided: 'Decided',
} as const satisfies Record<StatusTagVariant, string>

export function StatusTag({ variant }: { variant: StatusTagVariant }) {
  return <span className={`status-tag status-tag-${variant}`}>{STATUS_LABELS[variant]}</span>
}

export function statusTagForTicketState(state: TicketState): StatusTagVariant {
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

export function statusTagLabel(variant: StatusTagVariant): string {
  return STATUS_LABELS[variant]
}
