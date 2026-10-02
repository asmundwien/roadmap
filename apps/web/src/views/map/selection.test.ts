import type { MapBody, Ticket, WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import type { PanelSelection } from '@/router'
import { encodeSelection, resolveSelection } from './selection'

function ticket(id: string): Ticket {
  return {
    id,
    displayId: `#${id}`,
    title: `Ticket ${id}`,
    url: `https://example.test/me/repo/${id}`,
    body: '',
    typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
    state: 'frontier',
    isClaimed: false,
    isBlocked: false,
    createdAt: 0,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
  }
}

function makeMap(overrides: Partial<MapBody> = {}, tickets: Ticket[] = []): WayfinderMap {
  const body: MapBody = {
    raw: '',
    destination: 'The destination.',
    notes: [],
    decisions: [],
    notYetSpecified: [],
    notYetSpecifiedNote: '',
    outOfScope: [],
    sections: [],
    missingSections: [],
    ...overrides,
  }
  return {
    project: { integration: 'github', id: 'me/repo' },
    id: '1',
    displayId: '#1',
    title: 'Test map',
    url: 'https://example.test/me/repo/1',
    isOpen: true,
    updatedAt: 0,
    body,
    tickets,
    frontier: tickets,
    progress: { total: tickets.length, completed: 0 },
    ticketsComplete: true,
    warnings: [],
  }
}

describe('resolveSelection', () => {
  const map = makeMap(
    { notYetSpecified: ['first fog', 'the *second* patch'], outOfScope: ['[ruled](x) out'] },
    [ticket('7')],
  )

  it('passes the map and scope-all picks through', () => {
    expect(resolveSelection(map, { kind: 'map' })).toEqual({ kind: 'map' })
    expect(resolveSelection(map, { kind: 'scope-all' })).toEqual({ kind: 'scope-all' })
  })

  it('resolves a ticket that is on the map, and drops one that is not', () => {
    expect(resolveSelection(map, { kind: 'ticket', id: '7' })).toEqual({
      kind: 'ticket',
      id: '7',
    })
    expect(resolveSelection(map, { kind: 'ticket', id: '99' })).toBeNull()
  })

  it('resolves fog and scope indices to their stripped text', () => {
    expect(resolveSelection(map, { kind: 'fog', index: 1 })).toEqual({
      kind: 'fog',
      text: 'the second patch',
    })
    expect(resolveSelection(map, { kind: 'scope', index: 0 })).toEqual({
      kind: 'scope',
      text: 'ruled out',
    })
  })

  it('treats an index past the list as no selection, not an error', () => {
    expect(resolveSelection(map, { kind: 'fog', index: 2 })).toBeNull()
    expect(resolveSelection(map, { kind: 'scope', index: 1 })).toBeNull()
  })
})

describe('encodeSelection', () => {
  const map = makeMap(
    { notYetSpecified: ['first fog', 'the *second* patch'], outOfScope: ['[ruled](x) out'] },
    [ticket('7')],
  )

  it('inverts resolveSelection for every kind', () => {
    const picks: PanelSelection[] = [
      { kind: 'map' },
      { kind: 'scope-all' },
      { kind: 'ticket', id: '7' },
      { kind: 'fog', index: 1 },
      { kind: 'scope', index: 0 },
    ]
    for (const pick of picks) {
      const resolved = resolveSelection(map, pick)
      expect(resolved).not.toBeNull()
      if (resolved) expect(encodeSelection(map, resolved)).toEqual(pick)
    }
  })

  it('refuses to name text that is no longer on the map', () => {
    expect(encodeSelection(map, { kind: 'fog', text: 'vanished' })).toBeNull()
    expect(encodeSelection(map, { kind: 'scope', text: 'vanished' })).toBeNull()
  })
})
