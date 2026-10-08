import { describe, expect, it } from 'vitest'
import { ticketTypeEvidenceFromLabels } from './tickets.ts'

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

  it.each(['research', 'prototype', 'grilling', 'task'])('recognizes the %s type', (value) => {
    expect(ticketTypeEvidenceFromLabels([`wayfinder:${value}`])).toEqual({
      kind: 'recognized',
      value,
      labels: [value],
    })
  })

  it('normalizes repeated type labels without inventing a conflict', () => {
    expect(ticketTypeEvidenceFromLabels([' Wayfinder:Task ', 'wayfinder:task', 'bug'])).toEqual({
      kind: 'recognized',
      value: 'task',
      labels: ['task'],
    })
  })

  it('retains unsupported evidence alongside a recognized type as a conflict', () => {
    expect(ticketTypeEvidenceFromLabels(['wayfinder:task', 'wayfinder:custom'])).toEqual({
      kind: 'conflicting',
      labels: ['custom', 'task'],
    })
  })

  it('retains an empty type label as unknown rather than missing', () => {
    expect(ticketTypeEvidenceFromLabels(['wayfinder:'])).toEqual({
      kind: 'unknown',
      labels: [''],
    })
  })
})
