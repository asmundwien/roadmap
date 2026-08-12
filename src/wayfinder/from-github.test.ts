import { describe, expect, it } from 'vitest'
import type { FetchedMap, RawSubIssue } from '../github/map-query.ts'
import { activeMapOf, toProjects, toWayfinderMap } from './from-github.ts'

function subIssue(overrides: Partial<RawSubIssue> & { number: number }): RawSubIssue {
  return {
    title: `Ticket ${overrides.number}`,
    url: `https://github.com/a/r/issues/${overrides.number}`,
    state: 'OPEN',
    stateReason: null,
    body: '',
    labels: { nodes: [{ name: 'wayfinder:task', color: '0052CC' }] },
    assignees: { nodes: [] },
    blockedBy: { totalCount: 0, nodes: [] },
    ...overrides,
  }
}

function fetchedMap(children: RawSubIssue[], overrides: Partial<FetchedMap> = {}): FetchedMap {
  return {
    ref: { owner: 'a', repo: 'r', nameWithOwner: 'a/r', number: 1 },
    repository: { nameWithOwner: 'a/r', isPrivate: true, issue: null },
    issue: {
      number: 1,
      title: 'A map',
      url: 'https://github.com/a/r/issues/1',
      state: 'OPEN',
      updatedAt: '2026-08-01T12:00:00Z',
      closedAt: null,
      body: '## Destination\n\nSomewhere.\n',
      subIssuesSummary: { total: children.length, completed: 0, percentCompleted: 0 },
      subIssues: {
        totalCount: children.length,
        pageInfo: { hasNextPage: false },
        nodes: children,
      },
    },
    ...overrides,
  }
}

describe('toWayfinderMap', () => {
  it('derives each ticket state from its assignees and blockers', () => {
    const map = toWayfinderMap(
      fetchedMap([
        subIssue({ number: 2, state: 'CLOSED' }),
        subIssue({
          number: 3,
          assignees: { nodes: [{ login: 'asmundwien', avatarUrl: 'a', url: 'u' }] },
        }),
        subIssue({ number: 4 }),
        subIssue({
          number: 5,
          blockedBy: {
            totalCount: 1,
            nodes: [
              {
                number: 4,
                title: 'Ticket 4',
                url: 'https://github.com/a/r/issues/4',
                state: 'OPEN',
                repository: { nameWithOwner: 'a/r' },
              },
            ],
          },
        }),
      ]),
    )

    expect(map.tickets.map((ticket) => ticket.state)).toEqual([
      'closed',
      'claimed',
      'frontier',
      'blocked',
    ])
    expect(map.frontier.map((ticket) => ticket.number)).toEqual([4])
  })

  it('treats a ticket whose blockers are all closed as unblocked', () => {
    const map = toWayfinderMap(
      fetchedMap([
        subIssue({
          number: 5,
          blockedBy: {
            totalCount: 2,
            nodes: [
              {
                number: 2,
                title: 'Ticket 2',
                url: 'u',
                state: 'CLOSED',
                repository: { nameWithOwner: 'a/r' },
              },
              {
                number: 4,
                title: 'Ticket 4',
                url: 'u',
                state: 'CLOSED',
                repository: { nameWithOwner: 'a/r' },
              },
            ],
          },
        }),
      ]),
    )

    expect(map.tickets[0]?.state).toBe('frontier')
    expect(map.tickets[0]?.isBlocked).toBe(false)
  })

  it('keeps blocked and claimed visible independently of the collapsed state', () => {
    const map = toWayfinderMap(
      fetchedMap([
        subIssue({
          number: 5,
          assignees: { nodes: [{ login: 'asmundwien', avatarUrl: 'a', url: 'u' }] },
          blockedBy: {
            totalCount: 1,
            nodes: [
              {
                number: 4,
                title: 'Ticket 4',
                url: 'u',
                state: 'OPEN',
                repository: { nameWithOwner: 'a/r' },
              },
            ],
          },
        }),
      ]),
    )

    expect(map.tickets[0]).toMatchObject({ state: 'blocked', isBlocked: true, isClaimed: true })
  })

  it('carries the repo on a cross-repo blocker', () => {
    const map = toWayfinderMap(
      fetchedMap([
        subIssue({
          number: 5,
          blockedBy: {
            totalCount: 1,
            nodes: [
              {
                number: 9,
                title: 'Elsewhere',
                url: 'u',
                state: 'OPEN',
                repository: { nameWithOwner: 'a/other' },
              },
            ],
          },
        }),
      ]),
    )

    expect(map.tickets[0]?.blockedBy[0]?.nameWithOwner).toBe('a/other')
  })

  it('flags truncation rather than presenting a partial graph as whole', () => {
    const base = fetchedMap([subIssue({ number: 2, blockedBy: { totalCount: 60, nodes: [] } })])
    const truncated = {
      ...base,
      issue: {
        ...base.issue,
        subIssues: {
          totalCount: 140,
          pageInfo: { hasNextPage: true },
          nodes: [subIssue({ number: 2, blockedBy: { totalCount: 60, nodes: [] } })],
        },
      },
    }

    const map = toWayfinderMap(truncated)
    expect(map.ticketsTruncated).toBe(true)
    expect(map.tickets[0]?.blockersTruncated).toBe(true)
  })

  it('handles a map with no children at all', () => {
    const empty = fetchedMap([])
    const map = toWayfinderMap({
      ...empty,
      issue: { ...empty.issue, subIssues: null, subIssuesSummary: null },
    })

    expect(map.tickets).toEqual([])
    expect(map.frontier).toEqual([])
    expect(map.progress).toEqual({ total: 0, completed: 0, percentCompleted: 0 })
  })

  it('parses the map body', () => {
    expect(toWayfinderMap(fetchedMap([])).body.destination).toBe('Somewhere.')
  })
})

describe('toProjects', () => {
  it('groups maps by repo and splits open from closed', () => {
    const open = fetchedMap([])
    const closed: FetchedMap = {
      ...open,
      ref: { ...open.ref, number: 7 },
      issue: { ...open.issue, number: 7, state: 'CLOSED', title: 'An old map' },
    }
    const elsewhere: FetchedMap = {
      ...open,
      ref: { owner: 'a', repo: 'other', nameWithOwner: 'a/other', number: 1 },
      repository: { nameWithOwner: 'a/other', isPrivate: false, issue: null },
    }

    const projects = toProjects([closed, open, elsewhere])

    expect(projects.map((project) => project.nameWithOwner)).toEqual(['a/other', 'a/r'])
    const repo = projects.find((project) => project.nameWithOwner === 'a/r')
    expect(repo?.openMaps.map((map) => map.number)).toEqual([1])
    expect(repo?.closedMaps.map((map) => map.number)).toEqual([7])
    expect(repo?.isPrivate).toBe(true)
  })

  it('orders open maps most recently updated first, so the head is the active map', () => {
    const stale = fetchedMap([])
    const active: FetchedMap = {
      ...stale,
      ref: { ...stale.ref, number: 11 },
      issue: { ...stale.issue, number: 11, updatedAt: '2026-08-10T12:00:00Z' },
    }

    const projects = toProjects([stale, active])

    expect(projects[0]?.openMaps.map((map) => map.number)).toEqual([11, 1])
    expect(projects[0] && activeMapOf(projects[0])?.number).toBe(11)
  })

  it('orders closed maps most recently closed first', () => {
    const open = fetchedMap([])
    const earlier: FetchedMap = {
      ...open,
      ref: { ...open.ref, number: 2 },
      issue: { ...open.issue, number: 2, state: 'CLOSED', closedAt: '2026-06-01T12:00:00Z' },
    }
    const later: FetchedMap = {
      ...open,
      ref: { ...open.ref, number: 3 },
      issue: { ...open.issue, number: 3, state: 'CLOSED', closedAt: '2026-07-01T12:00:00Z' },
    }

    const projects = toProjects([earlier, later, open])

    expect(projects[0]?.closedMaps.map((map) => map.number)).toEqual([3, 2])
  })

  it('reports a resting project as having no active map', () => {
    const closed = fetchedMap([])
    const projects = toProjects([
      { ...closed, issue: { ...closed.issue, state: 'CLOSED', closedAt: '2026-07-01T12:00:00Z' } },
    ])

    expect(projects[0] && activeMapOf(projects[0])).toBeNull()
  })

  it('sorts projects with live efforts ahead of pure history', () => {
    const live = fetchedMap([])
    const history: FetchedMap = {
      ...live,
      ref: { owner: 'a', repo: 'aaa-archive', nameWithOwner: 'a/aaa-archive', number: 1 },
      repository: { nameWithOwner: 'a/aaa-archive', isPrivate: false, issue: null },
      issue: { ...live.issue, state: 'CLOSED' },
    }

    expect(toProjects([history, live]).map((project) => project.nameWithOwner)).toEqual([
      'a/r',
      'a/aaa-archive',
    ])
  })
})
