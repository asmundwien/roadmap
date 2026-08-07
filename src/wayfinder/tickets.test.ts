import { describe, expect, it } from 'vitest'
import { deriveTicketState, ticketTypeFromLabels } from './tickets.ts'

describe('ticketTypeFromLabels', () => {
  it('reads the wayfinder type label', () => {
    expect(ticketTypeFromLabels(['wayfinder:research'])).toBe('research')
    expect(ticketTypeFromLabels(['wayfinder:prototype'])).toBe('prototype')
    expect(ticketTypeFromLabels(['wayfinder:grilling'])).toBe('grilling')
    expect(ticketTypeFromLabels(['wayfinder:task'])).toBe('task')
  })

  it('ignores labels that are not wayfinder types', () => {
    expect(ticketTypeFromLabels(['bug', 'wayfinder:map', 'p1'])).toBe('untyped')
  })

  it('finds the type label among others, whatever its case', () => {
    expect(ticketTypeFromLabels(['bug', 'Wayfinder:Task'])).toBe('task')
  })

  it('falls back to untyped when a ticket carries no labels', () => {
    expect(ticketTypeFromLabels([])).toBe('untyped')
  })
})

describe('deriveTicketState', () => {
  it('calls an open, unblocked, unassigned ticket the frontier', () => {
    expect(deriveTicketState({ isOpen: true, isClaimed: false, hasOpenBlockers: false })).toBe(
      'frontier',
    )
  })

  it('calls an assigned open ticket claimed', () => {
    expect(deriveTicketState({ isOpen: true, isClaimed: true, hasOpenBlockers: false })).toBe(
      'claimed',
    )
  })

  it('calls a ticket with an open blocker blocked', () => {
    expect(deriveTicketState({ isOpen: true, isClaimed: false, hasOpenBlockers: true })).toBe(
      'blocked',
    )
  })

  it('reports blocked over claimed, because the state answers "can this be taken?"', () => {
    expect(deriveTicketState({ isOpen: true, isClaimed: true, hasOpenBlockers: true })).toBe(
      'blocked',
    )
  })

  it('calls any closed ticket closed, whatever else is true of it', () => {
    expect(deriveTicketState({ isOpen: false, isClaimed: true, hasOpenBlockers: true })).toBe(
      'closed',
    )
  })
})
