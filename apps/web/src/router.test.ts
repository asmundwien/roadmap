import type { MapBody, Ticket, WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import {
  encodeSelection,
  mapHash,
  type PanelSelection,
  parseHash,
  projectHash,
  resolveSelection,
  selectionHash,
} from './router.ts'

describe('parseHash', () => {
  it('reads a bare project route as the active map', () => {
    expect(parseHash('#/asmundwien/roadmap')).toEqual({
      screen: 'project',
      owner: 'asmundwien',
      repo: 'roadmap',
      selected: null,
      selection: null,
    })
  })

  it('reads a pinned map selection', () => {
    expect(parseHash('#/asmundwien/roadmap/11')).toEqual({
      screen: 'project',
      owner: 'asmundwien',
      repo: 'roadmap',
      selected: 11,
      selection: null,
    })
  })

  it.each([
    ['#/me/repo/11/map', { kind: 'map' }],
    ['#/me/repo/11/scope-all', { kind: 'scope-all' }],
    ['#/me/repo/11/ticket/42', { kind: 'ticket', number: 42 }],
    ['#/me/repo/11/fog/0', { kind: 'fog', index: 0 }],
    ['#/me/repo/11/scope/3', { kind: 'scope', index: 3 }],
  ])('reads the panel selection segment %s', (hash, selection) => {
    expect(parseHash(hash)).toEqual({
      screen: 'project',
      owner: 'me',
      repo: 'repo',
      selected: 11,
      selection,
    })
  })

  it.each([
    '',
    '#',
    '#/',
    '#/owner',
    '#/owner/repo/not-a-number',
    '#/map/owner/repo/1',
    // A selection segment needs a pinned map in front of it.
    '#/owner/repo/map',
    '#/owner/repo/ticket/4',
    // Garbled selection segments are bad URLs, not partial ones.
    '#/owner/repo/11/bogus',
    '#/owner/repo/11/ticket',
    '#/owner/repo/11/ticket/x',
    '#/owner/repo/11/fog/-1',
    '#/owner/repo/11/map/extra',
  ])('falls back to the project list for %j', (hash) => {
    expect(parseHash(hash)).toEqual({ screen: 'projects' })
  })

  it('round-trips what projectHash builds', () => {
    const ref = { owner: 'someone', repo: 'a-repo' }
    expect(parseHash(projectHash(ref))).toEqual({
      screen: 'project',
      ...ref,
      selected: null,
      selection: null,
    })
  })

  it('round-trips what mapHash builds', () => {
    const ref = { owner: 'someone', repo: 'a-repo', number: 42 }
    expect(parseHash(mapHash(ref))).toEqual({
      screen: 'project',
      owner: 'someone',
      repo: 'a-repo',
      selected: 42,
      selection: null,
    })
  })

  it.each<PanelSelection>([
    { kind: 'map' },
    { kind: 'scope-all' },
    { kind: 'ticket', number: 7 },
    { kind: 'fog', index: 2 },
    { kind: 'scope', index: 0 },
  ])('round-trips what selectionHash builds for %o', (selection) => {
    const ref = { owner: 'someone', repo: 'a-repo', number: 42 }
    expect(parseHash(selectionHash(ref, selection))).toEqual({
      screen: 'project',
      owner: 'someone',
      repo: 'a-repo',
      selected: 42,
      selection,
    })
  })
})

function ticket(number: number): Ticket {
  return {
    number,
    title: `Ticket ${number}`,
    url: `https://example.test/me/repo/${number}`,
    body: '',
    type: 'task',
    state: 'frontier',
    isClaimed: false,
    isBlocked: false,
    createdAt: 0,
    closedAt: null,
    assignees: [],
    blockedBy: [],
    blockersTruncated: false,
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
    owner: 'me',
    repo: 'repo',
    nameWithOwner: 'me/repo',
    number: 1,
    title: 'Test map',
    url: 'https://example.test/me/repo/1',
    isOpen: true,
    updatedAt: 0,
    closedAt: null,
    body,
    tickets,
    frontier: tickets,
    progress: { total: tickets.length, completed: 0, percentCompleted: 0 },
    ticketsTruncated: false,
  }
}

describe('resolveSelection', () => {
  const map = makeMap(
    { notYetSpecified: ['first fog', 'the *second* patch'], outOfScope: ['[ruled](x) out'] },
    [ticket(7)],
  )

  it('passes the map and scope-all picks through', () => {
    expect(resolveSelection(map, { kind: 'map' })).toEqual({ kind: 'map' })
    expect(resolveSelection(map, { kind: 'scope-all' })).toEqual({ kind: 'scope-all' })
  })

  it('resolves a ticket that is on the map, and drops one that is not', () => {
    expect(resolveSelection(map, { kind: 'ticket', number: 7 })).toEqual({
      kind: 'ticket',
      number: 7,
    })
    expect(resolveSelection(map, { kind: 'ticket', number: 99 })).toBeNull()
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
    [ticket(7)],
  )

  it('inverts resolveSelection for every kind', () => {
    const picks: PanelSelection[] = [
      { kind: 'map' },
      { kind: 'scope-all' },
      { kind: 'ticket', number: 7 },
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
