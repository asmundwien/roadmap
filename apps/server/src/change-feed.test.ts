import type { ProjectKey, TicketState } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { type ChangeEvent, type ChangeFeedInput, createChangeFeed } from './change-feed.ts'
import {
  createSourceFixtureOwner,
  type FixtureMap,
  type FixtureSnapshot,
  type FixtureTicket,
} from './source-test-fixtures.ts'

function ticket(
  id: string,
  state: TicketState,
  overrides: Partial<FixtureTicket> = {},
): FixtureTicket {
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
    blockedBy:
      state === 'blocked'
        ? [
            {
              reference: { kind: 'external', integration: 'github', nameWithOwner: 'a/other' },
              ticketId: 'blocker',
              state: 'open',
            },
          ]
        : [],
    blockersComplete: true,
    warnings: [],
    ...overrides,
  }
}

function wayfinderMap(id: string, tickets: FixtureTicket[]): FixtureMap {
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

function snapshot(maps: FixtureMap[]): FixtureSnapshot {
  return {
    capturedAt: 1,
    projects: [
      {
        key: { integration: 'github', id: 'a/roadmap' },
        name: 'a/roadmap',
        openMaps: maps,
        closedMaps: [],
        warnings: [],
      },
    ],
    unreachable: [],
  }
}

function notificationInput(
  current: FixtureSnapshot,
  readForProject: (project: ProjectKey) => ReturnType<typeof createSourceFixtureOwner>,
  baselineProjects: readonly ProjectKey[] = [],
): ChangeFeedInput {
  const configuration = {
    projects: current.projects.flatMap((project) =>
      project.key.integration === 'github'
        ? [
            {
              ref: { integration: 'github' as const, projectId: project.key.id },
              connectionId: 'github',
              locator: { repositoryId: project.key.id, nameWithOwner: project.name },
            },
          ]
        : [],
    ),
  }
  return {
    attempts: current.projects.flatMap(
      (project) =>
        readForProject(project.key)([project], current.capturedAt, configuration).attempts,
    ),
    projects: current.projects.map((project) => ({ key: project.key, name: project.name })),
    baselineProjects,
    order: current.projects.flatMap((project) =>
      [...project.openMaps, ...project.closedMaps].map((map) => ({
        map: { project: map.project, mapId: map.id },
        tickets: map.tickets.map((ticket) => ticket.id),
      })),
    ),
  }
}

function fakeSource() {
  const readers = new Map<string, ReturnType<typeof createSourceFixtureOwner>>()
  function readForProject(project: ProjectKey) {
    const key = JSON.stringify([project.integration, project.id])
    let read = readers.get(key)
    if (!read) {
      read = createSourceFixtureOwner()
      readers.set(key, read)
    }
    return read
  }
  const listeners = new Set<(current: ChangeFeedInput) => void>()
  return {
    input(current: FixtureSnapshot, baselineProjects: readonly ProjectKey[] = []) {
      for (const project of baselineProjects)
        readers.set(JSON.stringify([project.integration, project.id]), createSourceFixtureOwner())
      return notificationInput(current, readForProject, baselineProjects)
    },
    onChange(listener: (current: ChangeFeedInput) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    push(current: FixtureSnapshot, baselineProjects: readonly ProjectKey[] = []) {
      this.pushInput(this.input(current, baselineProjects))
    },
    pushInput(current: ChangeFeedInput) {
      for (const listener of listeners) listener(current)
    },
  }
}

function compareObservations(previous: FixtureSnapshot, next: FixtureSnapshot): ChangeEvent[] {
  const source = fakeSource()
  const feed = createChangeFeed(source)
  const events: ChangeEvent[] = []
  feed.onEvent((batch) => events.push(...batch))
  source.push(previous)
  source.push(next)
  feed.stop()
  return events
}

describe('notification comparison', () => {
  it('emits nothing when nothing changed', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    expect(compareObservations(before, after)).toEqual([])
  })

  it('emits ticket-claimed when a takeable ticket is claimed', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'claimed')])])
    const events = compareObservations(before, after)
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
    const events = compareObservations(before, after)
    expect(events.map((event) => event.type)).toContain('ticket-closed')
  })

  it('emits closed, not claimed, when a claim and close land in one diff', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'closed', { isClaimed: true })])])
    const types = compareObservations(before, after).map((event) => event.type)
    expect(types).toContain('ticket-closed')
    expect(types).not.toContain('ticket-claimed')
  })

  it('emits frontier-changed with entered and left tickets', () => {
    const before = snapshot([wayfinderMap('1', [ticket('2', 'frontier'), ticket('3', 'blocked')])])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'claimed'), ticket('3', 'frontier')])])
    const events = compareObservations(before, after)
    const frontier = events.find((event) => event.type === 'frontier-changed')
    expect(frontier).toBeDefined()
    if (frontier?.type !== 'frontier-changed') return
    expect(frontier.entered.map((entry) => entry.id)).toEqual(['3'])
    expect(frontier.left.map((entry) => entry.id)).toEqual(['2'])
  })

  it('emits map-appeared for a new map, without ticket events for its tickets', () => {
    const before = snapshot([])
    const after = snapshot([wayfinderMap('1', [ticket('2', 'closed'), ticket('3', 'frontier')])])
    const events = compareObservations(before, after)
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
    expect(compareObservations(before, after)).toEqual([])
  })
})

describe('createChangeFeed', () => {
  it('treats the first committed observation as a quiet baseline', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const batches: unknown[] = []
    feed.onEvent((events) => batches.push(events))
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]))
    expect(batches).toEqual([])
  })

  it('compares each later committed observation with known notification evidence', () => {
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

  it('establishes a replacement baseline without losing unaffected project activity', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const batches: { type: string; projectId: string }[][] = []
    feed.onEvent((events) => {
      batches.push(
        events.map((event) => ({
          type: event.type,
          projectId: 'ticket' in event ? event.ticket.project.id : event.map.project.id,
        })),
      )
    })
    function withUnaffectedProject(current: FixtureSnapshot, state: TicketState): FixtureSnapshot {
      return {
        ...current,
        projects: [
          ...current.projects,
          {
            key: { integration: 'local', id: 'unaffected' },
            name: 'Unaffected Local project',
            openMaps: [
              {
                ...wayfinderMap('5', [
                  ticket('6', state, {
                    url: undefined,
                    sourcePath: '/tmp/unaffected/tickets/6.md',
                  }),
                ]),
                project: { integration: 'local', id: 'unaffected' },
                url: undefined,
                sourcePath: '/tmp/unaffected/5.md',
              },
            ],
            closedMaps: [],
            warnings: [],
          },
        ],
      }
    }
    source.push(
      withUnaffectedProject(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]), 'frontier'),
    )

    const replacement = withUnaffectedProject(
      snapshot([wayfinderMap('3', [ticket('4', 'frontier')])]),
      'claimed',
    )
    expect(batches).toEqual([])
    source.push(replacement, [{ integration: 'github', id: 'a/roadmap' }])
    source.push(
      withUnaffectedProject(snapshot([wayfinderMap('3', [ticket('4', 'claimed')])]), 'claimed'),
    )

    expect(batches).toEqual([
      [
        { type: 'ticket-claimed', projectId: 'unaffected' },
        { type: 'frontier-changed', projectId: 'unaffected' },
      ],
      [
        { type: 'ticket-claimed', projectId: 'a/roadmap' },
        { type: 'frontier-changed', projectId: 'a/roadmap' },
      ],
    ])
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

  it('establishes a quiet recovery baseline after the first source attempt failed', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const events: ChangeEvent[] = []
    feed.onEvent((batch) => events.push(...batch))
    const current = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    const recovered = source.input(current)
    source.pushInput({
      ...recovered,
      order: [],
      attempts: recovered.attempts.map((attempt) => ({
        kind: 'failed',
        readSequence: attempt.readSequence,
        scope: attempt.scope,
        attemptedAt: 2,
        provenance: attempt.provenance,
        failure: { kind: 'transient', cause: 'network' },
      })),
    })
    source.push(current)
    expect(events).toEqual([])
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'claimed')])]))
    expect(events.map((event) => event.type)).toEqual(['ticket-claimed', 'frontier-changed'])
  })

  it('keeps a failed affected-source replacement baseline unknown until readable recovery', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const events: ChangeEvent[] = []
    feed.onEvent((batch) => events.push(...batch))
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]))
    const replacement = snapshot([wayfinderMap('3', [ticket('4', 'frontier')])])
    const input = source.input(replacement, [{ integration: 'github', id: 'a/roadmap' }])
    source.pushInput({
      ...input,
      order: [],
      attempts: input.attempts.map((attempt) => ({
        kind: 'failed',
        readSequence: attempt.readSequence,
        scope: attempt.scope,
        attemptedAt: 2,
        provenance: attempt.provenance,
        failure: { kind: 'transient', cause: 'network' },
      })),
    })
    source.push(replacement)
    expect(events).toEqual([])
    source.push(snapshot([wayfinderMap('3', [ticket('4', 'claimed')])]))
    expect(events.map((event) => event.type)).toEqual(['ticket-claimed', 'frontier-changed'])
  })

  it('does not treat an incomplete initial map membership as a complete empty baseline', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const events: ChangeEvent[] = []
    feed.onEvent((batch) => events.push(...batch))
    const baseline = source.input(snapshot([]))
    source.pushInput({
      ...baseline,
      attempts: baseline.attempts.map((attempt) =>
        attempt.kind === 'observed' && attempt.scope.kind === 'maps-membership'
          ? { ...attempt, completeness: { kind: 'incomplete', reason: 'pagination' } }
          : attempt,
      ),
    })
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]))
    expect(events).toEqual([])
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')]), wayfinderMap('3', [])]))
    expect(events.map((event) => event.type)).toEqual(['map-appeared'])
  })

  it('keeps a known frontier through incomplete blocker evidence and identical recovery', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const events: ChangeEvent[] = []
    feed.onEvent((batch) => events.push(...batch))
    const current = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
    source.push(current)
    const incomplete = source.input(
      snapshot([
        wayfinderMap('1', [
          ticket('2', 'blocked', {
            blockedBy: [],
            blockersComplete: false,
          }),
        ]),
      ]),
    )
    source.pushInput({
      ...incomplete,
      attempts: incomplete.attempts.map((attempt) =>
        attempt.kind === 'observed' && attempt.scope.kind === 'ticket'
          ? { ...attempt, completeness: { kind: 'incomplete', reason: 'unreadable' } }
          : attempt,
      ),
    })
    source.push(current)
    expect(events).toEqual([])
  })

  it('uses positive closure evidence even when ticket blockers are incomplete', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const events: ChangeEvent[] = []
    feed.onEvent((batch) => events.push(...batch))
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]))
    const closed = source.input(
      snapshot([
        wayfinderMap('1', [
          ticket('2', 'closed', {
            blockersComplete: false,
            isClaimed: true,
          }),
        ]),
      ]),
    )
    source.pushInput({
      ...closed,
      attempts: closed.attempts.map((attempt) =>
        attempt.kind === 'observed' && attempt.scope.kind === 'ticket'
          ? { ...attempt, completeness: { kind: 'incomplete', reason: 'unreadable' } }
          : attempt,
      ),
    })
    expect(events.map((event) => event.type)).toEqual(['ticket-closed', 'frontier-changed'])
  })

  it.each(['failed', 'incomplete', 'complete'] as const)(
    'uses %s ticket membership omission without inventing absence',
    (kind) => {
      const source = fakeSource()
      const feed = createChangeFeed(source)
      const events: ChangeEvent[] = []
      feed.onEvent((batch) => events.push(...batch))
      const current = snapshot([wayfinderMap('1', [ticket('2', 'frontier')])])
      source.push(current)
      const omitted = source.input(snapshot([wayfinderMap('1', [])]))
      source.pushInput({
        ...omitted,
        attempts: omitted.attempts.map((attempt) => {
          if (attempt.kind !== 'observed' || attempt.scope.kind !== 'tickets-membership')
            return attempt
          if (kind === 'failed')
            return {
              kind: 'failed',
              readSequence: attempt.readSequence,
              scope: attempt.scope,
              attemptedAt: 2,
              provenance: attempt.provenance,
              failure: { kind: 'transient', cause: 'network' },
            }
          return {
            ...attempt,
            completeness:
              kind === 'complete'
                ? { kind: 'complete' }
                : { kind: 'incomplete', reason: 'pagination' },
          }
        }),
      })
      source.push(current)
      if (kind !== 'complete') {
        expect(events).toEqual([])
        return
      }
      expect(events.map((event) => event.type)).toEqual(['frontier-changed', 'frontier-changed'])
      const [removed, restored] = events
      if (removed?.type !== 'frontier-changed' || restored?.type !== 'frontier-changed')
        throw new Error('Expected scoped frontier changes')
      expect(removed.left.map((entry) => entry.id)).toEqual(['2'])
      expect(removed.entered).toEqual([])
      expect(restored.entered.map((entry) => entry.id)).toEqual(['2'])
      expect(restored.left).toEqual([])
    },
  )

  it('batches activity in presentation order, not source attempt order', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const batches: ChangeEvent[][] = []
    feed.onEvent((batch) => batches.push(batch))
    source.push(
      snapshot([
        wayfinderMap('1', [ticket('2', 'frontier')]),
        wayfinderMap('3', [ticket('4', 'frontier')]),
      ]),
    )
    const next = source.input(
      snapshot([
        wayfinderMap('5', []),
        wayfinderMap('3', [ticket('4', 'claimed')]),
        wayfinderMap('1', [ticket('2', 'claimed')]),
      ]),
    )
    source.pushInput({ ...next, attempts: [...next.attempts].reverse() })
    expect(batches).toHaveLength(1)
    expect(
      batches[0]?.map((event) => ({
        type: event.type,
        mapId: 'ticket' in event ? event.ticket.mapId : event.map.id,
      })),
    ).toEqual([
      { type: 'map-appeared', mapId: '5' },
      { type: 'ticket-claimed', mapId: '3' },
      { type: 'ticket-claimed', mapId: '1' },
      { type: 'frontier-changed', mapId: '3' },
      { type: 'frontier-changed', mapId: '1' },
    ])
  })

  it('unsubscribes individual listeners and stops consuming source callbacks', () => {
    const source = fakeSource()
    const feed = createChangeFeed(source)
    const removed: ChangeEvent[][] = []
    const active: ChangeEvent[][] = []
    const unsubscribe = feed.onEvent((batch) => removed.push(batch))
    feed.onEvent((batch) => active.push(batch))
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'frontier')])]))
    unsubscribe()
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'claimed')])]))
    feed.stop()
    source.push(snapshot([wayfinderMap('1', [ticket('2', 'closed')])]))
    expect(removed).toEqual([])
    expect(active).toHaveLength(1)
    expect(active[0]?.map((event) => event.type)).toEqual(['ticket-claimed', 'frontier-changed'])
  })
})
