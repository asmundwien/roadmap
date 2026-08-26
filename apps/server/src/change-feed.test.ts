import type { Snapshot, Ticket, TicketState, WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { createChangeFeed, diffSnapshots } from './change-feed.ts'

function ticket(id: string, state: TicketState, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    displayId: `#${id}`,
    title: `Ticket ${id}`,
    url: `https://github.com/a/roadmap/issues/${id}`,
    body: '',
    typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
    state,
    isClaimed: state === 'claimed',
    isBlocked: state === 'blocked',
    createdAt: 1,
    closedAt: state === 'closed' ? 2 : undefined,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
    ...overrides,
  }
}

function wayfinderMap(id: string, tickets: Ticket[]): WayfinderMap {
  return {
    project: { integration: 'github', id: 'a/roadmap' },
    id,
    displayId: `#${id}`,
    title: `Map ${id}`,
    url: `https://github.com/a/roadmap/issues/${id}`,
    isOpen: true,
    updatedAt: 1,
    body: {
      raw: '',
      destination: '',
      notes: [],
      decisions: [],
      notYetSpecified: [],
      notYetSpecifiedNote: '',
      outOfScope: [],
      sections: [],
      missingSections: [],
    },
    tickets,
    frontier: tickets.filter((candidate) => candidate.state === 'frontier'),
    progress: { total: tickets.length, completed: 0 },
    ticketsComplete: true,
    warnings: [],
  }
}

function snapshot(maps: WayfinderMap[]): Snapshot {
  return {
    capturedAt: 1,
    projects: [
      {
        key: { integration: 'github', id: 'a/roadmap' },
        name: 'a/roadmap',
        visibility: 'public',
        openMaps: maps,
        closedMaps: [],
        warnings: [],
      },
    ],
    unreachable: [],
  }
}

describe('diffSnapshots', () => {
  it('emits nothing when nothing changed', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    expect(diffSnapshots(before, after)).toEqual([])
  })

  it('emits ticket-claimed when a takeable ticket is claimed', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'claimed')])])
    const events = diffSnapshots(before, after)
    expect(events).toContainEqual({
      type: 'ticket-claimed',
      ticket: {
        project: { integration: 'github', id: 'a/roadmap' },
        projectName: 'a/roadmap',
        mapId: '1',
        mapDisplayId: '#1',
        mapTitle: 'Map 1',
        id: '2',
        displayId: '#2',
        title: 'Ticket 2',
        url: 'https://github.com/a/roadmap/issues/2',
      },
    })
  })

  it('emits ticket-closed when an open ticket closes', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'claimed')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'closed')])])
    const events = diffSnapshots(before, after)
    expect(events.map((event) => event.type)).toContain('ticket-closed')
  })

  it('emits closed, not claimed, when a claim and close land in one diff', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'closed', { isClaimed: true })])])
    const types = diffSnapshots(before, after).map((event) => event.type)
    expect(types).toContain('ticket-closed')
    expect(types).not.toContain('ticket-claimed')
  })

  it('emits frontier-changed with entered and left tickets', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier'), ticket('3', 'blocked')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'claimed'), ticket('3', 'frontier')])])
    const events = diffSnapshots(before, after)
    const frontier = events.find((event) => event.type === 'frontier-changed')
    expect(frontier).toBeDefined()
    if (frontier?.type !== 'frontier-changed') return
    expect(frontier.entered.map((entry) => entry.id)).toEqual(['3'])
    expect(frontier.left.map((entry) => entry.id)).toEqual(['2'])
  })

  it('emits map-appeared for a new map, without ticket events for its tickets', () => {
    const before = snapshot([])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'closed'), ticket('3', 'frontier')])])
    const events = diffSnapshots(before, after)
    expect(events).toEqual([
      {
        type: 'map-appeared',
        map: {
          project: { integration: 'github', id: 'a/roadmap' },
          projectName: 'a/roadmap',
          id: '1',
          displayId: '#1',
          title: 'Map 1',
          url: 'https://github.com/a/roadmap/issues/1',
        },
      },
    ])
  })

  it('stays silent about tickets on a map that vanished', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    const after = snapshot([])
    expect(diffSnapshots(before, after)).toEqual([])
  })
})

describe('createChangeFeed', () => {
  function fakeSource() {
    const listeners = new Set<(current: Snapshot) => void>()
    return {
      onChange(listener: (current: Snapshot) => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      push(current: Snapshot) {
        for (const listener of listeners) listener(current)
      },
    }
  }

  it('treats the first snapshot as the baseline — no events fire from it', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const batches: unknown[] = []
    feed.onEvent((events) => batches.push(events))
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]))
    expect(batches).toEqual([])
  })

  it('diffs each later snapshot against the previous one', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const types: string[] = []
    feed.onEvent((events) => {
      for (const event of events) types.push(event.type)
    })
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]))
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'claimed')])]))
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'closed')])]))
    expect(types).toEqual(['ticket-claimed', 'frontier-changed', 'ticket-closed'])
  })

  it('resets topology baselines without emitting false Wayfinder activity', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const types: string[] = []
    feed.onEvent((events) => {
      for (const event of events) types.push(event.type)
    })
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]))

    feed.reset(snapshot([wayfinderMap('3', [ticket('4', 'frontier')])]))
    source.push(snapshot([wayfinderMap('3', [ticket('4', 'claimed')])]))

    expect(types).toEqual(['ticket-claimed', 'frontier-changed'])
  })

  it('skips listeners entirely when a change produced no events', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    let calls = 0
    feed.onEvent(() => {
      calls += 1
    })
    const same = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    source.push(same)
    source.push(same)
    expect(calls).toBe(0)
  })
})
