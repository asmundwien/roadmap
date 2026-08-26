import type { MapBody, Ticket, WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import {
  automationSettingsHash,
  connectionSettingsHash,
  encodeSelection,
  mapHash,
  type PanelSelection,
  parseHash,
  projectHash,
  projectSettingsHash,
  resolveSelection,
  selectionHash,
} from './router.ts'

const PROJECT = { integration: 'github' as const, id: 'asmundwien/roadmap' }

describe('parseHash', () => {
  it.each([
    [automationSettingsHash, { screen: 'automation-settings' }],
    [projectSettingsHash, { screen: 'project-settings' }],
    [connectionSettingsHash, { screen: 'connection-settings' }],
  ])('reads the management route %s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route)
  })
  it('reads a bare project route as the active map', () => {
    expect(parseHash('#/projects/github/asmundwien%2Froadmap')).toEqual({
      screen: 'project',
      project: PROJECT,
      selected: null,
      selection: null,
    })
  })

  it('reads a pinned map selection', () => {
    expect(parseHash('#/projects/github/asmundwien%2Froadmap/maps/11')).toEqual({
      screen: 'project',
      project: PROJECT,
      selected: '11',
      selection: null,
    })
  })

  it.each([
    ['#/projects/github/me%2Frepo/maps/11/map', { kind: 'map' }],
    ['#/projects/github/me%2Frepo/maps/11/scope-all', { kind: 'scope-all' }],
    ['#/projects/github/me%2Frepo/maps/11/ticket/42', { kind: 'ticket', id: '42' }],
    ['#/projects/github/me%2Frepo/maps/11/fog/0', { kind: 'fog', index: 0 }],
    ['#/projects/github/me%2Frepo/maps/11/scope/3', { kind: 'scope', index: 3 }],
    [
      '#/projects/local/microsoft-risiko/maps/.wayfinder%2Fmap.md/ticket/T-17',
      { kind: 'ticket', id: 'T-17' },
    ],
  ])('reads the panel selection segment %s', (hash, selection) => {
    expect(parseHash(hash)).toEqual({
      screen: 'project',
      project:
        hash.indexOf('/local/') === -1
          ? { integration: 'github', id: 'me/repo' }
          : { integration: 'local', id: 'microsoft-risiko' },
      selected: hash.indexOf('/local/') === -1 ? '11' : '.wayfinder/map.md',
      selection,
    })
  })

  it.each([
    '',
    '#',
    '#/',
    '#/owner',
    '#/projects',
    '#/projects/github',
    '#/projects/github/owner%2Frepo/not-a-map',
    '#/map/owner/repo/1',
    // A selection segment needs a pinned map in front of it.
    '#/projects/github/owner%2Frepo/map',
    '#/projects/github/owner%2Frepo/ticket/4',
    // Garbled selection segments are bad URLs, not partial ones.
    '#/projects/github/owner%2Frepo/maps/11/bogus',
    '#/projects/github/owner%2Frepo/maps/11/ticket',
    '#/projects/github/owner%2Frepo/maps/11/fog/-1',
    '#/projects/nope/owner%2Frepo',
    '#/projects/github/%E0%A4%A/maps/1',
  ])('falls back to the project list for %j', (hash) => {
    expect(parseHash(hash)).toEqual({ screen: 'projects' })
  })

  it('round-trips what projectHash builds', () => {
    const ref = { integration: 'github' as const, id: 'someone/a-repo' }
    expect(parseHash(projectHash(ref))).toEqual({
      screen: 'project',
      project: ref,
      selected: null,
      selection: null,
    })
  })

  it('builds a clean stable-id route for local projects', () => {
    const ref = { integration: 'local' as const, id: 'microsoft-risiko' }
    expect(projectHash(ref)).toBe('#/projects/local/microsoft-risiko')
    expect(parseHash(projectHash(ref))).toEqual({
      screen: 'project',
      project: ref,
      selected: null,
      selection: null,
    })
  })

  it('round-trips what mapHash builds', () => {
    const ref = { project: { integration: 'github' as const, id: 'someone/a-repo' }, id: '42' }
    expect(parseHash(mapHash(ref))).toEqual({
      screen: 'project',
      project: ref.project,
      selected: '42',
      selection: null,
    })
  })

  it.each<PanelSelection>([
    { kind: 'map' },
    { kind: 'scope-all' },
    { kind: 'ticket', id: '7' },
    { kind: 'fog', index: 2 },
    { kind: 'scope', index: 0 },
  ])('round-trips what selectionHash builds for %o', (selection) => {
    const ref = { project: { integration: 'github' as const, id: 'someone/a-repo' }, id: '42' }
    expect(parseHash(selectionHash(ref, selection))).toEqual({
      screen: 'project',
      project: ref.project,
      selected: '42',
      selection,
    })
  })
})

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
