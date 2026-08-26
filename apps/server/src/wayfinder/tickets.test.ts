import { describe, expect, it } from 'vitest'
import { deriveTicketState, ticketTypeEvidenceFromLabels } from './tickets.ts'

describe('ticketTypeEvidenceFromLabels', () => {
  it('retains recognized type evidence', () => {
    expect(ticketTypeEvidenceFromLabels(['wayfinder:research'])).toEqual({
      kind: 'recognized',
      value: 'research',
      labels: ['research'],
    })
    expect(ticketTypeEvidenceFromLabels(['bug', 'Wayfinder:Task'])).toEqual({
      kind: 'recognized',
      value: 'task',
      labels: ['task'],
    })
  })

  it('distinguishes missing, unknown, and conflicting evidence', () => {
    expect(ticketTypeEvidenceFromLabels(['bug'])).toEqual({ kind: 'missing', labels: [] })
    expect(ticketTypeEvidenceFromLabels(['wayfinder:map'])).toEqual({
      kind: 'unknown',
      labels: ['map'],
    })
    expect(ticketTypeEvidenceFromLabels(['wayfinder:task', 'wayfinder:research'])).toEqual({
      kind: 'conflicting',
      labels: ['research', 'task'],
    })
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
