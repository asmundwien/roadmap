import type { Ticket, TicketState, TicketType } from './types.ts'

const TICKET_TYPES: TicketType[] = ['research', 'prototype', 'grilling', 'task']
const TYPE_LABEL_PREFIX = 'wayfinder:'

/** Reads the `wayfinder:<type>` label off a ticket's labels, ignoring every other label. */
export function ticketTypeFromLabels(labels: readonly string[]): TicketType {
  for (const label of labels) {
    const normalised = label.trim().toLowerCase()
    if (!normalised.startsWith(TYPE_LABEL_PREFIX)) continue
    const suffix = normalised.slice(TYPE_LABEL_PREFIX.length)
    const match = TICKET_TYPES.find((type) => type === suffix)
    if (match) return match
  }
  return 'untyped'
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
