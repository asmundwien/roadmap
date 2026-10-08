import type { ProjectRegistration } from '@roadmap/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfiguredConnection } from '../application/configuration.ts'
import type { AdapterSlice, SourceProjectKey } from '../observation/source.ts'
import { isRecord } from '../type-guards.ts'
import { createGitHubAdapter } from './adapter.ts'
import { type GitHubClient, GitHubError } from './client.ts'
import { GitHubConnectionError } from './connections.ts'
import type { RawMapIssue } from './map-query.ts'

interface FakeRepository {
  id: string
  nameWithOwner: string
  maps: Map<number, RawMapIssue | null>
  unavailable?: boolean
  failure?: GitHubError
  rateLimitRemaining?: number
  graphqlGate?: Promise<void>
}

function rawMap(number: number, title: string): RawMapIssue {
  return {
    number,
    title,
    url: `https://github.com/a/roadmap/issues/${number}`,
    state: 'OPEN',
    updatedAt: '2026-08-01T00:00:00Z',
    closedAt: null,
    body: '## Destination\n\nSomewhere.\n',
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
  }
}

function connection(id: string): ConfiguredConnection {
  return {
    id,
    integration: 'github',
    name: id,
    builtIn: false,
    githubIdentity: { id: `user-${id}`, login: id },
  }
}

function registration(
  connectionId: string,
  repository: FakeRepository,
  key = repository.nameWithOwner,
): ProjectRegistration {
  return {
    key: { integration: 'github', id: key },
    connectionId,
    locator: {
      integration: 'github',
      repositoryId: repository.id,
      nameWithOwner: repository.nameWithOwner,
    },
    workspace: { path: `/work/${repository.id}`, gitIdentity: repository.id },
  }
}

function fakeClient(repositories: FakeRepository[], remaining = 200) {
  const restPaths: string[] = []
  const graphqlCalls: Record<string, unknown>[] = []
  const client: GitHubClient = {
    async graphql(_query, variables = {}) {
      graphqlCalls.push(variables)
      const firstRepository = repositories.find(
        (candidate) => candidate.nameWithOwner === `${variables.o0}/${variables.n0}`,
      )
      await firstRepository?.graphqlGate
      const data: Record<string, unknown> = {
        rateLimit: {
          cost: 1,
          remaining: firstRepository?.rateLimitRemaining ?? remaining,
          limit: 5000,
          resetAt: '2026-08-22T12:00:00Z',
        },
      }
      for (let index = 0; `o${index}` in variables; index += 1) {
        const nameWithOwner = `${variables[`o${index}`]}/${variables[`n${index}`]}`
        const repository = repositories.find(
          (candidate) => candidate.nameWithOwner === nameWithOwner,
        )
        const issue = repository?.maps.get(Number(variables[`i${index}`]))
        data[`m${index}`] = repository
          ? {
              databaseId: repository.id,
              nameWithOwner,
              issue: issue
                ? { ...issue, url: `https://github.com/${nameWithOwner}/issues/${issue.number}` }
                : null,
            }
          : null
      }
      return { data, errors: [] }
    },
    async restGet(path) {
      restPaths.push(path)
      const byId = /^\/repositories\/([^/?]+)$/.exec(path)
      if (byId) {
        const repository = repositories.find((candidate) => candidate.id === byId[1])
        if (repository?.failure) throw repository.failure
        if (!repository || repository.unavailable)
          throw new GitHubError({ kind: 'access-ambiguous', evidence: 'http-404' }, 404)
        return { id: Number(repository.id), full_name: repository.nameWithOwner }
      }
      const issues = /^\/repos\/([^/]+)\/([^/]+)\/issues\?/.exec(path)
      if (issues) {
        const nameWithOwner = `${decodeURIComponent(issues[1] ?? '')}/${decodeURIComponent(issues[2] ?? '')}`
        const repository = repositories.find(
          (candidate) => candidate.nameWithOwner === nameWithOwner,
        )
        if (!repository)
          throw new GitHubError({ kind: 'access-ambiguous', evidence: 'http-404' }, 404)
        return [...repository.maps.keys()].map((number) => ({ number }))
      }
      throw new Error(`Unexpected REST path ${path}`)
    },
  }
  return { client, restPaths, graphqlCalls }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createGitHubAdapter', () => {
  it('observes admitted stable scopes across isolated Connection clients including complete empty membership', async () => {
    const first = {
      id: '1',
      nameWithOwner: 'acme/renamed',
      maps: new Map([[16, rawMap(16, 'Current map')]]),
    }
    const empty = { id: '2', nameWithOwner: 'acme/empty', maps: new Map<number, RawMapIssue>() }
    const second = {
      id: '3',
      nameWithOwner: 'other/roadmap',
      maps: new Map([[7, rawMap(7, 'Other map')]]),
    }
    const clients = new Map([
      ['token-one', fakeClient([first, empty])],
      ['token-two', fakeClient([second])],
    ])
    const updates: AdapterSlice[] = []
    const adapter = createGitHubAdapter({
      connections: [connection('one'), connection('two')],
      registrations: [
        registration('one', first, 'acme/original'),
        registration('one', empty),
        registration('two', second),
      ],
      accessToken: async (id) => `token-${id}`,
      createClient: (token) => {
        const found = clients.get(token)
        if (!found) throw new Error('Unexpected token.')
        return found.client
      },
    })
    await adapter.start({ update: (slice) => updates.push(slice) })
    expect(updates.at(-1)?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'project', project: { integration: 'github', id: 'acme/original' } },
          value: expect.objectContaining({
            name: 'acme/renamed',
            source: expect.objectContaining({
              repositoryId: '1',
              url: 'https://github.com/acme/renamed',
            }),
          }),
        }),
        expect.objectContaining({
          kind: 'observed',
          scope: {
            kind: 'map',
            map: { project: { integration: 'github', id: 'acme/original' }, mapId: '16' },
          },
          value: expect.objectContaining({ title: 'Current map' }),
        }),
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'maps-membership', project: { integration: 'github', id: 'acme/empty' } },
          completeness: { kind: 'complete' },
          value: { members: [] },
        }),
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'project', project: { integration: 'github', id: 'other/roadmap' } },
        }),
      ]),
    )
    await adapter.stop()
  })

  it('contains rejected credentials to one Connection without serializing credential details', async () => {
    const healthy = {
      id: '2',
      nameWithOwner: 'other/roadmap',
      maps: new Map<number, RawMapIssue>(),
    }
    const updates: AdapterSlice[] = []
    const availability = vi.fn()
    const warn = vi.fn()
    const adapter = createGitHubAdapter({
      connections: [connection('broken'), connection('healthy')],
      registrations: [
        registration('broken', { id: '1', nameWithOwner: 'acme/private', maps: new Map() }),
        registration('healthy', healthy),
      ],
      accessToken: async (id) => {
        if (id === 'broken')
          throw new GitHubConnectionError('bad-refresh-token', 'private credential detail')
        return 'healthy-token'
      },
      createClient: () => fakeClient([healthy]).client,
      onConnectionAvailability: availability,
      logger: { warn },
    })
    await adapter.start({ update: (slice) => updates.push(slice) })
    expect(updates.at(-1)?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'failed',
          scope: { kind: 'project', project: { integration: 'github', id: 'acme/private' } },
          provenance: expect.objectContaining({ stage: 'credentials' }),
          failure: { kind: 'authorization', proof: 'rejected-credential' },
        }),
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'project', project: { integration: 'github', id: 'other/roadmap' } },
        }),
      ]),
    )
    expect(availability).toHaveBeenCalledWith(
      'broken',
      expect.objectContaining({ status: 'authorization-required' }),
    )
    expect(JSON.stringify(updates)).not.toContain('private credential detail')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private credential detail')
    await adapter.stop()
  })

  it('degrades after repeated transient failures while independently successful scopes commit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const first = {
      id: '1',
      nameWithOwner: 'acme/first',
      maps: new Map([[1, rawMap(1, 'First map')]]),
    }
    const second: FakeRepository = {
      id: '2',
      nameWithOwner: 'acme/second',
      maps: new Map([[2, rawMap(2, 'Second map')]]),
    }
    const updates: AdapterSlice[] = []
    const availability = vi.fn()
    const adapter = createGitHubAdapter({
      connections: [connection('one')],
      registrations: [registration('one', first), registration('one', second)],
      accessToken: async () => 'token',
      createClient: () => fakeClient([first, second], 4_000).client,
      onConnectionAvailability: availability,
      logger: { warn() {} },
      reconcileMs: 10,
    })
    await adapter.start({ update: (slice) => updates.push(slice) })
    second.failure = new GitHubError({ kind: 'transient', cause: 'server' }, 503)
    first.maps.set(1, rawMap(1, 'Changed sibling'))
    await vi.advanceTimersByTimeAsync(10)
    expect(availability).toHaveBeenLastCalledWith('one', { status: 'available', observedAt: 1_000 })
    expect(updates.at(-1)?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'observed',
          scope: {
            kind: 'map',
            map: { project: { integration: 'github', id: 'acme/first' }, mapId: '1' },
          },
          observedAt: 1_010,
          value: expect.objectContaining({ title: 'Changed sibling' }),
        }),
        expect.objectContaining({
          kind: 'failed',
          scope: { kind: 'project', project: { integration: 'github', id: 'acme/second' } },
          attemptedAt: 1_010,
        }),
        expect.objectContaining({
          kind: 'observed',
          scope: {
            kind: 'map',
            map: { project: { integration: 'github', id: 'acme/second' }, mapId: '2' },
          },
          observedAt: 1_000,
        }),
      ]),
    )
    await vi.advanceTimersByTimeAsync(10)
    expect(availability).toHaveBeenLastCalledWith(
      'one',
      expect.objectContaining({ status: 'degraded', observedAt: 1_000 }),
    )
    second.failure = undefined
    await vi.advanceTimersByTimeAsync(20)
    expect(availability).toHaveBeenLastCalledWith('one', { status: 'available', observedAt: 1_040 })
    await adapter.stop()
  })

  it('paces each Connection using its own rate budget', async () => {
    vi.useFakeTimers()
    const slowRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Map')]]),
    }
    const fastRepository = {
      id: '2',
      nameWithOwner: 'other/roadmap',
      maps: new Map([[2, rawMap(2, 'Map')]]),
    }
    const slow = fakeClient([slowRepository], 200)
    const fast = fakeClient([fastRepository], 4000)
    const updates: AdapterSlice[] = []
    const adapter = createGitHubAdapter({
      connections: [connection('slow'), connection('fast')],
      registrations: [registration('slow', slowRepository), registration('fast', fastRepository)],
      accessToken: async (id) => id,
      createClient: (token) => (token === 'slow' ? slow.client : fast.client),
      reconcileMs: 10,
    })
    await adapter.start({ update: (slice) => updates.push(slice) })
    await vi.advanceTimersByTimeAsync(10)
    expect(updates.at(-1)?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'observed',
          scope: {
            kind: 'map',
            map: { project: { integration: 'github', id: 'acme/roadmap' }, mapId: '1' },
          },
          observedAt: expect.any(Number),
        }),
      ]),
    )
    expect(slow.graphqlCalls).toHaveLength(1)
    expect(fast.graphqlCalls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(70)
    expect(slow.graphqlCalls).toHaveLength(2)
    await adapter.stop()
  })

  it('keeps the most conservative concurrent rate-limit observation', async () => {
    let open: () => void = () => {
      throw new Error('Gate not initialized.')
    }
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const older: FakeRepository = {
      id: '1',
      nameWithOwner: 'acme/older',
      maps: new Map([[1, rawMap(1, 'Older response')]]),
      rateLimitRemaining: 4_000,
      graphqlGate: gate,
    }
    const newer: FakeRepository = {
      id: '2',
      nameWithOwner: 'acme/newer',
      maps: new Map([[2, rawMap(2, 'Newer response')]]),
      rateLimitRemaining: 100,
    }
    const { client, graphqlCalls } = fakeClient([older, newer])
    const adapter = createGitHubAdapter({
      connections: [connection('one')],
      registrations: [registration('one', older), registration('one', newer)],
      accessToken: async () => 'token',
      createClient: () => client,
    })
    const start = adapter.start({ update() {} })
    await vi.waitFor(() => expect(graphqlCalls).toHaveLength(2))
    open()
    await start
    expect(adapter.diagnostics().rateLimit?.remaining).toBe(100)
    await adapter.stop()
  })
})

interface HttpRepository {
  id: string
  metadataId?: string
  nameWithOwner: string
  maps: Map<number, RawMapIssue>
  metadataStatus?: number
  listing?: unknown
  secondPage?: unknown
  secondPageStatus?: number
  aliases?: Map<number, unknown>
  graphqlResponse?: () => Response
  laterBatchStatus?: number
}

function providerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function stubProvider(repositories: readonly HttpRepository[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const byId = /^\/repositories\/([^/]+)$/.exec(url.pathname)
      if (byId) {
        const repository = repositories.find((candidate) => candidate.id === byId[1])
        if (!repository) return providerResponse({ message: 'Not Found' }, 404)
        if (repository.metadataStatus) {
          return providerResponse(
            { message: 'private provider detail fixture-token' },
            repository.metadataStatus,
          )
        }
        return providerResponse({
          id: Number(repository.metadataId ?? repository.id),
          full_name: repository.nameWithOwner,
        })
      }
      const list = /^\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(url.pathname)
      if (list) {
        const repository = repositories.find(
          (candidate) => candidate.nameWithOwner === `${list[1]}/${list[2]}`,
        )
        if (!repository) return providerResponse({ message: 'Not Found' }, 404)
        const page = Number(url.searchParams.get('page') ?? 1)
        if (page > 1 && repository.secondPage !== undefined)
          return providerResponse(repository.secondPage, repository.secondPageStatus)
        if (repository.listing !== undefined) return providerResponse(repository.listing)
        const issues = [...repository.maps.keys()].map((number) => ({ number }))
        return providerResponse(issues.slice((page - 1) * 100, page * 100))
      }
      if (url.pathname === '/graphql') {
        const body: unknown = JSON.parse(String(init?.body))
        if (!isRecord(body) || !isRecord(body.variables)) throw new Error('Invalid fixture query.')
        const variables = body.variables
        const first = repositories.find(
          (candidate) => candidate.nameWithOwner === `${variables.o0}/${variables.n0}`,
        )
        if (first?.graphqlResponse) return first.graphqlResponse()
        if (first?.laterBatchStatus && Number(variables.i0) > 10) {
          return providerResponse({ message: 'private later batch detail' }, first.laterBatchStatus)
        }
        const data: Record<string, unknown> = {
          rateLimit: { cost: 1, remaining: 4_000, limit: 5_000, resetAt: '2026-10-08T16:00:00Z' },
        }
        for (let index = 0; `o${index}` in variables; index += 1) {
          const repository = repositories.find(
            (candidate) =>
              candidate.nameWithOwner === `${variables[`o${index}`]}/${variables[`n${index}`]}`,
          )
          const number = Number(variables[`i${index}`])
          if (repository?.aliases?.has(number)) {
            const alias = repository.aliases.get(number)
            if (alias !== undefined) data[`m${index}`] = alias
          } else {
            data[`m${index}`] = repository
              ? {
                  id: `R_${repository.id}`,
                  databaseId: Number(repository.id),
                  nameWithOwner: repository.nameWithOwner,
                  issue: repository.maps.has(number)
                    ? {
                        ...repository.maps.get(number),
                        url: `https://github.com/${repository.nameWithOwner}/issues/${number}`,
                      }
                    : null,
                }
              : null
          }
        }
        return providerResponse({ data })
      }
      throw new Error(`Unexpected fixture URL ${url.href}`)
    }),
  )
}

async function observedAdapter(
  repositories: HttpRepository[],
  registrations?: ProjectRegistration[],
) {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  stubProvider(repositories)
  const updates: unknown[] = []
  const availability = vi.fn()
  const warn = vi.fn()
  const admitted =
    registrations ?? repositories.map((repository) => registration('one', repository))
  const adapter = createGitHubAdapter({
    connections: [...new Set(admitted.map((entry) => entry.connectionId))].map(connection),
    registrations: admitted,
    accessToken: async () => 'fixture-token',
    onConnectionAvailability: availability,
    logger: { warn },
    reconcileMs: 10,
  })
  await adapter.start({ update: (slice) => updates.push(slice) })
  return { adapter, updates, availability, warn }
}

describe('GitHub scoped source evidence through the real client', () => {
  const project = { integration: 'github', id: 'acme/roadmap' } satisfies SourceProjectKey
  const mapScope = { kind: 'map', map: { project, mapId: '1' } }

  it('rejects a mismatched stable metadata identity before reading maps under the admitted key', async () => {
    const repository: HttpRepository = {
      id: '1',
      metadataId: '999',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Wrong identity')]]),
    }
    const { adapter, updates } = await observedAdapter([repository])
    try {
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project },
            failure: { kind: 'identity-mismatch' },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'observed', scope: mapScope })]),
      )
    } finally {
      await adapter.stop()
    }
  })

  it('recovers the admitted opaque key after access ambiguity and a repository rename without changing Workspace proof', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const admitted = registration('one', repository, 'opaque stable/%2F')
    const originalWorkspace = admitted.workspace
    const { adapter, updates } = await observedAdapter([repository], [admitted])
    try {
      repository.metadataStatus = 404
      vi.setSystemTime(2_000)
      await adapter.refresh(admitted.key)
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project: admitted.key },
            failure: { kind: 'access-ambiguous', evidence: 'http-404' },
          }),
        ]),
      )
      repository.metadataStatus = undefined
      repository.nameWithOwner = 'acme/renamed'
      vi.setSystemTime(3_000)
      await adapter.refresh(admitted.key)
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'project', project: admitted.key },
            observedAt: 3_000,
            value: expect.objectContaining({ name: 'acme/renamed' }),
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'map', map: { project: admitted.key, mapId: '1' } },
            observedAt: 3_000,
          }),
        ]),
      )
      expect(admitted.workspace).toBe(originalWorkspace)
      expect(admitted.locator).toMatchObject({ repositoryId: '1', nameWithOwner: 'acme/roadmap' })
    } finally {
      await adapter.stop()
    }
  })

  it.each([
    [
      'HTTP-200 execution errors',
      () => providerResponse({ errors: [{ message: 'private provider detail fixture-token' }] }),
      { kind: 'execution', cause: 'provider' },
    ],
    [
      'malformed payload',
      () =>
        providerResponse({
          data: { m0: { databaseId: 1, nameWithOwner: 'acme/roadmap', issue: { number: 1 } } },
        }),
      { kind: 'read', cause: 'malformed-response' },
    ],
    [
      'invalid JSON',
      () => new Response('private provider detail fixture-token {'),
      { kind: 'read', cause: 'malformed-response' },
    ],
    [
      'body-read rejection',
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('private provider detail fixture-token'))
            },
          }),
        ),
      { kind: 'read', cause: 'response-read' },
    ],
  ])(
    'publishes a failed map scope after %s without inventing successful time',
    async (_name, failureResponse, failure) => {
      const repository: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/roadmap',
        maps: new Map([[1, rawMap(1, 'Known map')]]),
      }
      const { adapter, updates, warn } = await observedAdapter([repository])
      try {
        expect(updates[0]).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: mapScope,
              observedAt: 1_000,
              value: expect.objectContaining({ title: 'Known map' }),
            }),
          ]),
        )
        repository.graphqlResponse = failureResponse
        vi.setSystemTime(2_000)
        await adapter.refresh(project)

        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'failed',
              scope: mapScope,
              attemptedAt: 2_000,
              failure,
            }),
          ]),
        )
        expect(updates.at(-1)).not.toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({ kind: 'observed', scope: mapScope, observedAt: 2_000 }),
          ]),
        )
        expect(JSON.stringify(updates)).not.toContain('private provider detail')
        expect(JSON.stringify(warn.mock.calls)).not.toContain('fixture-token')

        repository.graphqlResponse = undefined
        repository.maps.set(1, rawMap(1, 'Recovered map'))
        vi.setSystemTime(3_000)
        await adapter.refresh(project)

        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: mapScope,
              observedAt: 3_000,
              value: expect.objectContaining({ title: 'Recovered map' }),
            }),
          ]),
        )
      } finally {
        await adapter.stop()
      }
    },
  )

  it('commits a healthy Project scope beside repeated transient failure in another Project', async () => {
    const healthy: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/healthy',
      maps: new Map([[1, rawMap(1, 'Old healthy map')]]),
    }
    const failing: HttpRepository = {
      id: '2',
      nameWithOwner: 'acme/failing',
      maps: new Map([[2, rawMap(2, 'Known failing map')]]),
    }
    const { adapter, updates, availability } = await observedAdapter([healthy, failing])
    try {
      failing.metadataStatus = 503
      healthy.maps.set(1, rawMap(1, 'New healthy map'))
      vi.setSystemTime(2_000)
      await adapter.refresh({ integration: 'github', id: 'acme/healthy' })
      vi.setSystemTime(3_000)
      await adapter.refresh({ integration: 'github', id: 'acme/healthy' })

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'map',
              map: { project: { integration: 'github', id: 'acme/healthy' }, mapId: '1' },
            },
            observedAt: 3_000,
            value: expect.objectContaining({ title: 'New healthy map' }),
          }),
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project: { integration: 'github', id: 'acme/failing' } },
            attemptedAt: 3_000,
            failure: { kind: 'transient', cause: 'server' },
          }),
        ]),
      )
      expect(availability.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'degraded' })
      expect(
        availability.mock.calls.some(([, value]) => value.status === 'authorization-required'),
      ).toBe(false)
    } finally {
      await adapter.stop()
    }
  })

  it.each([403, 404])(
    'records generic HTTP-%s as access ambiguity, not authorization or deletion',
    async (status) => {
      const repository: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/roadmap',
        maps: new Map([[1, rawMap(1, 'Known map')]]),
      }
      const { adapter, updates, availability } = await observedAdapter([repository])
      try {
        repository.metadataStatus = status
        vi.setSystemTime(2_000)
        await adapter.refresh(project)

        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'failed',
              scope: { kind: 'project', project },
              attemptedAt: 2_000,
              failure: { kind: 'access-ambiguous', evidence: `http-${status}` },
            }),
          ]),
        )
        expect(updates.at(-1)).not.toHaveProperty(
          'attempts',
          expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
        )
        expect(availability.mock.calls.at(-1)?.[1]).not.toMatchObject({
          status: 'authorization-required',
        })
        expect(JSON.stringify(updates)).not.toContain('fixture-token')
      } finally {
        await adapter.stop()
      }
    },
  )

  it('records proven HTTP-401 authorization loss as failed evidence rather than absence', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const { adapter, updates, availability } = await observedAdapter([repository])
    try {
      repository.metadataStatus = 401
      vi.setSystemTime(2_000)
      await adapter.refresh(project)

      expect(availability.mock.calls.at(-1)?.[1]).toMatchObject({
        status: 'authorization-required',
      })
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project },
            attemptedAt: 2_000,
            failure: { kind: 'authorization', proof: 'http-401' },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
      )
      expect(JSON.stringify(updates)).not.toContain('fixture-token')
    } finally {
      await adapter.stop()
    }
  })

  it.each([
    ['missing alias', undefined, { kind: 'access-ambiguous', evidence: 'missing-alias' }],
    ['null repository', null, { kind: 'access-ambiguous', evidence: 'null-resource' }],
    [
      'null issue',
      { databaseId: 1, nameWithOwner: 'acme/roadmap', issue: null },
      { kind: 'access-ambiguous', evidence: 'null-resource' },
    ],
    [
      'invalid issue',
      { databaseId: 1, nameWithOwner: 'acme/roadmap', issue: { number: 2, title: 99 } },
      { kind: 'read', cause: 'malformed-response' },
    ],
  ])(
    'commits the validated sibling while a %s names only its failed scope',
    async (_name, alias, failure) => {
      const repository: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/roadmap',
        maps: new Map([
          [1, rawMap(1, 'Old first map')],
          [2, rawMap(2, 'Known second map')],
        ]),
      }
      const { adapter, updates } = await observedAdapter([repository])
      try {
        repository.aliases = new Map([[2, alias]])
        repository.maps.set(1, rawMap(1, 'Validated first map'))
        vi.setSystemTime(2_000)
        await adapter.refresh(project)

        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: mapScope,
              observedAt: 2_000,
              value: expect.objectContaining({ title: 'Validated first map' }),
            }),
            expect.objectContaining({
              kind: 'failed',
              scope: { kind: 'map', map: { project, mapId: '2' } },
              attemptedAt: 2_000,
              failure,
            }),
          ]),
        )
        expect(updates.at(-1)).not.toHaveProperty(
          'attempts',
          expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
        )
      } finally {
        await adapter.stop()
      }
    },
  )

  it('commits validated maps in an earlier batch while the later batch names its transient failure', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map(
        Array.from({ length: 11 }, (_, index) => [
          index + 1,
          rawMap(index + 1, `Known map ${index + 1}`),
        ]),
      ),
    }
    const { adapter, updates } = await observedAdapter([repository])
    try {
      repository.laterBatchStatus = 503
      repository.maps.set(1, rawMap(1, 'Validated earlier batch'))
      vi.setSystemTime(2_000)
      await adapter.refresh(project)

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: mapScope,
            observedAt: 2_000,
            value: expect.objectContaining({ title: 'Validated earlier batch' }),
          }),
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'map', map: { project, mapId: '11' } },
            attemptedAt: 2_000,
            failure: { kind: 'transient', cause: 'server' },
          }),
        ]),
      )
    } finally {
      await adapter.stop()
    }
  })

  it.each([
    ['invalid item', [{}]],
    ['invalid list shape', { items: [] }],
    ['malformed later page', Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))],
  ])('does not let a %s prove empty map membership', async (_name, listing) => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const { adapter, updates } = await observedAdapter([repository])
    try {
      repository.listing = listing
      repository.secondPage = [{}]
      vi.setSystemTime(2_000)
      await adapter.refresh(project)

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'maps-membership', project },
            attemptedAt: 2_000,
            failure: { kind: 'read', cause: 'malformed-response' },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
      )
    } finally {
      await adapter.stop()
    }
  })

  it('limits proven absence to maps omitted by a validated complete membership list', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const { adapter, updates } = await observedAdapter([repository])
    try {
      repository.listing = []
      vi.setSystemTime(2_000)
      await adapter.refresh(project)

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'maps-membership', project },
            observedAt: 2_000,
            completeness: { kind: 'complete' },
            value: { members: [] },
          }),
          expect.objectContaining({
            kind: 'proven-absent',
            scope: mapScope,
            observedAt: 2_000,
            proof: { kind: 'complete-membership', parent: { kind: 'maps-membership', project } },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({ kind: 'proven-absent', scope: { kind: 'project', project } }),
        ]),
      )
    } finally {
      await adapter.stop()
    }
  })

  it.each([true, false])(
    'keeps an admitted opaque blocker key after cross-Connection rename with stable blocker id=%s',
    async (includeBlockerDatabaseId) => {
      const parent: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/parent',
        maps: new Map([[1, rawMap(1, 'Parent map')]]),
      }
      const dependency: HttpRepository = {
        id: '2',
        nameWithOwner: 'acme/original',
        maps: new Map(),
      }
      const admitted = [
        registration('one', parent, 'parent opaque/%2F'),
        registration('two', dependency, 'dependency opaque/%2F'),
      ]
      dependency.nameWithOwner = 'acme/renamed'
      parent.aliases = new Map([
        [1, mapWithBlocker('acme/parent', '2', 'acme/renamed', includeBlockerDatabaseId)],
      ])
      const originalWorkspace = admitted[1]?.workspace
      const { adapter, updates } = await observedAdapter([parent, dependency], admitted)
      try {
        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: {
                kind: 'ticket',
                ticket: {
                  map: { project: { integration: 'github', id: 'parent opaque/%2F' }, mapId: '1' },
                  ticketId: '10',
                },
              },
              value: expect.objectContaining({
                blockedBy: [
                  expect.objectContaining({
                    reference: {
                      kind: 'registered',
                      project: { integration: 'github', id: 'dependency opaque/%2F' },
                      ticketId: '20',
                    },
                    state: 'open',
                  }),
                ],
              }),
            }),
          ]),
        )
        expect(admitted[1]).toMatchObject({
          locator: { repositoryId: '2', nameWithOwner: 'acme/original' },
          workspace: originalWorkspace,
        })
      } finally {
        await adapter.stop()
      }
    },
  )

  it('does not let an unregistered blocker name impersonate an admitted opaque Project key', async () => {
    const parent: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/parent',
      maps: new Map([[1, rawMap(1, 'Parent map')]]),
    }
    const registered: HttpRepository = {
      id: '2',
      nameWithOwner: 'acme/registered',
      maps: new Map(),
    }
    parent.aliases = new Map([
      [1, mapWithBlocker('acme/parent', '999', 'external/looks-registered')],
    ])
    const admitted = [
      registration('one', parent, 'parent-key'),
      registration('one', registered, 'external/looks-registered'),
    ]
    const { adapter, updates } = await observedAdapter([parent, registered], admitted)
    try {
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'ticket',
              ticket: {
                map: { project: { integration: 'github', id: 'parent-key' }, mapId: '1' },
                ticketId: '10',
              },
            },
            value: expect.objectContaining({
              blockedBy: [
                expect.objectContaining({
                  reference: {
                    kind: 'external',
                    integration: 'github',
                    repositoryId: '999',
                    nameWithOwner: 'external/looks-registered',
                    ticketId: '20',
                  },
                  state: 'open',
                  url: 'https://github.com/external/looks-registered/issues/20',
                }),
              ],
            }),
          }),
        ]),
      )
    } finally {
      await adapter.stop()
    }
  })

  it('publishes incomplete ticket membership without inventing an empty complete graph', async () => {
    const parent: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/parent',
      maps: new Map([[1, rawMap(1, 'Parent map')]]),
    }
    const payload = mapWithBlocker('acme/parent', '999', 'external/dependency')
    payload.issue.subIssues.pageInfo.hasNextPage = true
    payload.issue.subIssues.totalCount = 2
    payload.issue.subIssuesSummary.total = 2
    parent.aliases = new Map([[1, payload]])
    const { adapter, updates } = await observedAdapter([parent])
    try {
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'tickets-membership',
              map: { project: { integration: 'github', id: 'acme/parent' }, mapId: '1' },
            },
            completeness: { kind: 'incomplete', reason: 'pagination' },
            value: {
              members: [
                {
                  map: { project: { integration: 'github', id: 'acme/parent' }, mapId: '1' },
                  ticketId: '10',
                },
              ],
            },
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'map',
              map: { project: { integration: 'github', id: 'acme/parent' }, mapId: '1' },
            },
            value: expect.objectContaining({ progress: { total: 2, completed: 0 } }),
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
      )
    } finally {
      await adapter.stop()
    }
  })

  it('does not let a failed later pagination request prove empty or complete membership', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const { adapter, updates } = await observedAdapter([repository])
    try {
      repository.listing = Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))
      repository.secondPage = { message: 'private pagination detail fixture-token' }
      repository.secondPageStatus = 503
      vi.setSystemTime(2_000)
      await adapter.refresh(project)

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'maps-membership', project },
            attemptedAt: 2_000,
            failure: { kind: 'transient', cause: 'server' },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'maps-membership', project },
            observedAt: 2_000,
            completeness: { kind: 'complete' },
          }),
        ]),
      )
      expect(JSON.stringify(updates)).not.toContain('private pagination detail')
    } finally {
      await adapter.stop()
    }
  })
})

function mapWithBlocker(
  nameWithOwner: string,
  blockerRepositoryId: string,
  blockerName: string,
  includeDatabaseId = true,
) {
  return {
    id: 'R_1',
    databaseId: 1,
    nameWithOwner,
    issue: {
      ...rawMap(1, 'Parent map'),
      url: `https://github.com/${nameWithOwner}/issues/1`,
      subIssuesSummary: { total: 1, completed: 0, percentCompleted: 0 },
      subIssues: {
        totalCount: 1,
        pageInfo: { hasNextPage: false },
        nodes: [
          {
            number: 10,
            title: 'Blocked ticket',
            url: `https://github.com/${nameWithOwner}/issues/10`,
            state: 'OPEN',
            stateReason: null,
            createdAt: '2026-08-01T00:00:00Z',
            closedAt: null,
            body: 'Keep this graph and prose.',
            labels: {
              totalCount: 1,
              pageInfo: { hasNextPage: false },
              nodes: [{ name: 'wayfinder:task', color: 'abcdef' }],
            },
            assignees: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
            blockedBy: {
              totalCount: 1,
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  number: 20,
                  title: 'External dependency',
                  url: `https://github.com/${blockerName}/issues/20`,
                  state: 'OPEN',
                  repository: {
                    id: `R_${blockerRepositoryId}`,
                    ...(includeDatabaseId ? { databaseId: Number(blockerRepositoryId) } : {}),
                    nameWithOwner: blockerName,
                  },
                },
              ],
            },
          },
        ],
      },
    },
  }
}
