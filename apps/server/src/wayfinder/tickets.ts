import type {
  RecognizedTicketType,
  Ticket,
  TicketState,
  TicketTypeEvidence,
} from '@roadmap/contracts'

const TICKET_TYPES: RecognizedTicketType[] = ['research', 'prototype', 'grilling', 'task']
const TYPE_LABEL_PREFIX = 'wayfinder:'

/** Retains every normalized `wayfinder:*` label so malformed evidence stays classifiable. */
export function ticketTypeEvidenceFromLabels(labels: readonly string[]): TicketTypeEvidence {
  const typeLabels = [
    ...new Set(
      labels
        .map((label) => label.trim().toLowerCase())
        .filter((label) => label.startsWith(TYPE_LABEL_PREFIX))
        .map((label) => label.slice(TYPE_LABEL_PREFIX.length)),
    ),
  ].sort()
  if (typeLabels.length === 0) return { kind: 'missing', labels: [] }
  if (typeLabels.length > 1) return { kind: 'conflicting', labels: typeLabels }
  const value = typeLabels[0]
  const recognized = TICKET_TYPES.find((type) => type === value)
  return recognized
    ? { kind: 'recognized', value: recognized, labels: typeLabels }
    : { kind: 'unknown', labels: typeLabels }
}

export interface TicketSignals {
  isOpen: boolean
  /** An assignee *is* the claim: an open, unassigned ticket is unclaimed. */
  isClaimed: boolean
  /** A ticket is unblocked when every ticket blocking it is closed. */
  hasOpenBlockers: boolean
}

/**
 * Collapses the three signals into one state.
 *
 * Blocked outranks claimed because the state answers "can this be taken?", and an open blocker is
 * the stronger answer. A ticket that is both still reports `isBlocked` and `isClaimed` separately,
 * so nothing is lost.
 */
export function deriveTicketState(signals: TicketSignals): TicketState {
  if (!signals.isOpen) return 'closed'
  if (signals.hasOpenBlockers) return 'blocked'
  if (signals.isClaimed) return 'claimed'
  return 'frontier'
}

/** The takeable tickets, in map order — the edge of the known. */
export function frontierOf(tickets: readonly Ticket[]): Ticket[] {
  return tickets.filter((ticket) => ticket.state === 'frontier')
}
