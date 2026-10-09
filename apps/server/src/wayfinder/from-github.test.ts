import { describe, expect, it } from 'vitest'
import type { FetchedMap, RawSubIssue } from '../github/map-query.ts'
import type {
  ObservationBatch,
  SourceMapContent,
  SourceTicketContent,
} from '../observation/source.ts'
import { observeGitHubMap } from './from-github.ts'

const project = {
  integration: 'github',
  id: 'admitted opaque/%2F',
} satisfies SourceMapContent['key']['project']
const context = {
  project,
  repositoryId: '1',
  connectionId: 'one',
  resolveProject: (nameWithOwner: string) => (nameWithOwner === 'a/r' ? project : undefined),
}

function subIssue(overrides: Partial<RawSubIssue> & { number: number }): RawSubIssue {
  return {
    title: `Ticket ${overrides.number}`,
    url: `https://github.com/a/r/issues/${overrides.number}`,
    state: 'OPEN',
    stateReason: null,
    createdAt: '2026-07-01T00:00:00Z',
    closedAt: null,
    body: '',
    labels: {
      totalCount: 1,
      pageInfo: { hasNextPage: false },
      nodes: [{ name: 'wayfinder:task', color: '0052CC' }],
    },
    assignees: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
    blockedBy: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
    ...overrides,
  }
}

function fetchedMap(children: RawSubIssue[], overrides: Partial<FetchedMap> = {}): FetchedMap {
  return {
    ref: { owner: 'a', repo: 'r', nameWithOwner: 'a/r', number: 1, repositoryId: '1' },
    repository: { databaseId: '1', nameWithOwner: 'a/r', issue: null },
    attemptedAt: 1_000,
    observedAt: 1_001,
    ticketsCompleteness: { kind: 'complete' },
    issue: {
      number: 1,
      title: 'A map',
      url: 'https://github.com/a/r/issues/1',
      state: 'OPEN',
      updatedAt: '2026-08-01T12:00:00Z',
      closedAt: null,
      body: '## Destination\n\nSomewhere.\n',
      subIssuesSummary: { total: children.length, completed: 0, percentCompleted: 0 },
      subIssues: { totalCount: children.length, pageInfo: { hasNextPage: false }, nodes: children },
    },
    ...overrides,
  }
}

function mapContent(slice: ObservationBatch): SourceMapContent {
  for (const attempt of slice.attempts)
    if (attempt.kind === 'observed' && 'progress' in attempt.value) return attempt.value
  throw new Error('Expected map evidence.')
}

function ticketContents(slice: ObservationBatch): SourceTicketContent[] {
  return slice.attempts.flatMap((attempt) =>
    attempt.kind === 'observed' && 'blockedBy' in attempt.value ? [attempt.value] : [],
  )
}

function blocker(state: 'OPEN' | 'CLOSED' = 'OPEN', nameWithOwner = 'a/r') {
  return {
    number: 4,
    title: 'Dependency',
    url: `https://github.com/${nameWithOwner}/issues/4`,
    state,
    repository: { nameWithOwner },
  }
}

describe('observeGitHubMap', () => {
  it('preserves admitted identities, source status and claimed evidence without deriving public ticket state', () => {
    const slice = observeGitHubMap(
      fetchedMap([
        subIssue({ number: 2, state: 'CLOSED', closedAt: '2026-07-30T09:00:00Z' }),
        subIssue({
          number: 3,
          assignees: {
            totalCount: 1,
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                login: 'asmundwien',
                avatarUrl: 'https://github.com/avatar',
                url: 'https://github.com/asmundwien',
              },
            ],
          },
        }),
        subIssue({ number: 4 }),
        subIssue({
          number: 5,
          blockedBy: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [blocker()] },
        }),
      ]),
      context,
    )
    expect(mapContent(slice).key).toEqual({ project, mapId: '1' })
    const tickets = ticketContents(slice)
    expect(tickets.map((ticket) => ticket.status)).toEqual(['closed', 'open', 'open', 'open'])
    expect(tickets.map((ticket) => ticket.isClaimed)).toEqual([false, true, false, false])
    expect(tickets[0]?.closedAt).toBe(Date.parse('2026-07-30T09:00:00Z'))
    expect(tickets[1]?.closedAt).toBeUndefined()
    expect(tickets[3]?.blockedBy[0]?.reference).toEqual({
      kind: 'registered',
      project,
      ticketId: '4',
    })
    expect(
      slice.attempts.every(
        (attempt) => attempt.kind === 'observed' && attempt.observedAt === 1_001,
      ),
    ).toBe(true)
  })

  it('retains closed external blocker state and source links without inventing an admitted key', () => {
    const tickets = ticketContents(
      observeGitHubMap(
        fetchedMap([
          subIssue({
            number: 5,
            blockedBy: {
              totalCount: 1,
              pageInfo: { hasNextPage: false },
              nodes: [blocker('CLOSED', 'external/dependency')],
            },
          }),
        ]),
        context,
      ),
    )
    expect(tickets[0]?.blockedBy).toEqual([
      expect.objectContaining({
        reference: {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'external/dependency',
          ticketId: '4',
        },
        state: 'closed',
        url: 'https://github.com/external/dependency/issues/4',
        provenance: {
          integration: 'github',
          connectionId: 'one',
          repositoryId: '1',
          stage: 'map-read',
        },
      }),
    ])
    expect(tickets[0]?.blockersComplete).toBe(true)
  })

  it('keeps blocking and claim evidence independently', () => {
    const ticket = ticketContents(
      observeGitHubMap(
        fetchedMap([
          subIssue({
            number: 5,
            assignees: {
              totalCount: 1,
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  login: 'asmundwien',
                  avatarUrl: 'https://github.com/avatar',
                  url: 'https://github.com/asmundwien',
                },
              ],
            },
            blockedBy: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [blocker()] },
          }),
        ]),
        context,
      ),
    )[0]
    expect(ticket).toMatchObject({
      status: 'open',
      isClaimed: true,
      blockedBy: [expect.objectContaining({ state: 'open' })],
    })
  })

  it('publishes incomplete ticket and blocker membership without losing readable prose', () => {
    const base = fetchedMap([
      subIssue({
        number: 2,
        body: 'Keep this ticket prose.',
        blockedBy: { totalCount: 60, pageInfo: { hasNextPage: true }, nodes: [] },
      }),
    ])
    const slice = observeGitHubMap(
      {
        ...base,
        ticketsCompleteness: { kind: 'incomplete', reason: 'pagination' },
        issue: {
          ...base.issue,
          subIssues: {
            totalCount: 140,
            pageInfo: { hasNextPage: true },
            nodes: base.issue.subIssues?.nodes ?? [],
          },
        },
      },
      context,
    )
    expect(slice.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'tickets-membership', map: { project, mapId: '1' } },
          completeness: { kind: 'incomplete', reason: 'pagination' },
        }),
      ]),
    )
    expect(ticketContents(slice)[0]).toMatchObject({
      body: 'Keep this ticket prose.',
      blockersComplete: false,
    })
  })

  it('does not certify null nested evidence as complete empty membership', () => {
    const base = fetchedMap([subIssue({ number: 2, blockedBy: null })])
    const ticket = ticketContents(observeGitHubMap(base, context))[0]
    expect(ticket?.blockersComplete).toBe(false)
    const slice = observeGitHubMap(
      {
        ...base,
        ticketsCompleteness: { kind: 'incomplete', reason: 'unreadable' },
        issue: { ...base.issue, subIssues: null, subIssuesSummary: null },
      },
      context,
    )
    expect(slice.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: { kind: 'tickets-membership', map: { project, mapId: '1' } },
          completeness: { kind: 'incomplete', reason: 'unreadable' },
          value: { members: [] },
        }),
      ]),
    )
  })

  it('keeps unknown progress and raw prose instead of deriving totals from partial children', () => {
    const base = fetchedMap([subIssue({ number: 2, state: 'CLOSED' })])
    const slice = observeGitHubMap(
      {
        ...base,
        ticketsCompleteness: { kind: 'incomplete', reason: 'pagination' },
        issue: {
          ...base.issue,
          subIssuesSummary: null,
          subIssues: {
            totalCount: 140,
            pageInfo: { hasNextPage: true },
            nodes: base.issue.subIssues?.nodes ?? [],
          },
        },
      },
      context,
    )
    expect(mapContent(slice)).toMatchObject({
      progress: null,
      body: { raw: '## Destination\n\nSomewhere.\n' },
    })
    expect(slice.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'map', map: { project, mapId: '1' } },
          completeness: { kind: 'incomplete', reason: 'unreadable' },
        }),
      ]),
    )
  })

  it('observes a complete empty ticket list and preserves map template drift', () => {
    const slice = observeGitHubMap(fetchedMap([]), context)
    expect(ticketContents(slice)).toEqual([])
    expect(mapContent(slice)).toMatchObject({
      progress: { total: 0, completed: 0 },
      body: { raw: '## Destination\n\nSomewhere.\n', destination: 'Somewhere.' },
    })
    expect(mapContent(slice).body.missingSections).toContain('Notes')
    expect(slice.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: { kind: 'tickets-membership', map: { project, mapId: '1' } },
          completeness: { kind: 'complete' },
          value: { members: [] },
        }),
      ]),
    )
  })
})
