import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandSchema } from '@roadmap/contracts/operations'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { decodeStateEnvelope } from '@roadmap/contracts/wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialBundle } from '../authorization/contracts.ts'
import { type AutomationDatabase, appendAutomationDatabase } from '../automation/database.ts'
import type { AutomationLaunch, ClassificationProcessResult } from '../automation/engine.ts'
import type { AutomationTarget } from '../automation/model.ts'
import {
  type ConfigurationDocument,
  type ConfigurationRead,
  decodeConfigurationDocument,
} from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { GitHubError } from '../github/client.ts'
import { createGitHubConnectionPort } from '../github/connections.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import type { GitHubObservationInput } from '../observation/coordinator.ts'
import type { SourceProjectKey as ProjectKey, SourceContribution } from '../observation/source.ts'
import type {
  GitHubConnection,
  GitHubProviderRead,
  ProjectConfiguration,
} from '../projects/registry.ts'
import {
  fixtureResourceRef,
  fixtureTicketRef,
  readApplicationState,
} from '../public-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const PROJECT = { integration: 'github', id: 'same-key' } satisfies ProjectKey
const TARGET = { project: PROJECT, mapId: '7', ticketId: '8' } satisfies AutomationTarget
const BODY =
  '## Destination\n\nBinding-specific map prose.\n\n## Notes\n\nPortable observer proof.\n\n## Decisions so far\n\nNone.\n\n## Not yet specified\n\n- Fixture work\n\n## Out of scope\n\n- Real execution\n'
const OLD: GitHubConnection = {
  id: 'old-connection',
  integration: 'github',
  name: 'Old account',
  builtIn: false,
  githubIdentity: { id: '42', login: 'old-account' },
}
const NEW: GitHubConnection = {
  id: 'new-connection',
  integration: 'github',
  name: 'New account',
  builtIn: false,
  githubIdentity: { id: '77', login: 'new-account' },
}
type OldPoll = 'success' | 'complete absence' | 'repository failure'

function gate() {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  return {
    started: entered.promise,
    async wait() {
      entered.resolve()
      await released.promise
    },
    release() {
      released.resolve()
    },
  }
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-binding-continuity-')))
  const clock = { value: 1 }
  const baseline = gate()
  const oldWorkspace = join(root, 'old-workspace')
  const newWorkspace = join(root, 'new-workspace')
  await Promise.all([oldWorkspace, newWorkspace].map((path) => mkdir(path)))
  function credentials(token: string): CredentialBundle {
    return {
      accessToken: token,
      refreshToken: `${token}-refresh`,
      accessTokenExpiresAt: 9_000_000_000_000,
      refreshTokenExpiresAt: 9_000_000_000_000,
    }
  }
  const repositories = [
    {
      id: '101',
      name: 'fixture/old-owner',
      connection: OLD,
      workspace: oldWorkspace,
      credentials: credentials('harmless-old-binding-token'),
    },
    {
      id: '202',
      name: 'fixture/new-owner',
      connection: NEW,
      workspace: newWorkspace,
      credentials: credentials('harmless-new-binding-token'),
    },
  ]
  const old = repositories[0]
  const replacement = repositories[1]
  if (!old || !replacement) throw new Error('Both binding fixtures are required.')
  let oldPoll: OldPoll = 'success'
  let missingNewAlias = false
  let newRepositoryFailure = false
  const reads: Array<{ repositoryId: string; connectionId: string; path: string; at: number }> = []
  const sourceEvidence: Array<{ repositoryId: string; contribution: SourceContribution }> = []
  const inputs: GitHubObservationInput[] = []
  const states: ReadyApplicationState[] = []
  const launches: AutomationLaunch[] = []
  let database: AutomationDatabase = { schemaVersion: 3, opportunities: [], events: [] }
  const processes: Array<ReturnType<typeof Promise.withResolvers<ClassificationProcessResult>>> = []
  const listeners = new Set<(read: ConfigurationRead) => void>()
  function valid(configuration: ProjectConfiguration) {
    const decoded = decodeConfigurationDocument(configuration)
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.issues))
    return decoded.value
  }
  const initial = valid({
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }, OLD, NEW],
    projects: [
      {
        ref: { integration: 'github', projectId: PROJECT.id },
        connectionId: OLD.id,
        locator: { repositoryId: old.id, nameWithOwner: old.name },
        workspace: { path: old.workspace },
      },
    ],
    automation: {
      enabled: false,
      enabledProjects: [PROJECT],
      classificationCommand: {
        command: process.execPath,
        args: [],
        promptDelivery: 'stdin',
        promptTemplate: '{{roadmap.map}} {{roadmap.ticket}} {{roadmap.classificationResultSchema}}',
      },
      wayfinderCommand: {
        command: process.execPath,
        args: [],
        promptDelivery: 'stdin',
        promptTemplate: '{{roadmap.map}} {{roadmap.ticket}} {{roadmap.sessionReportSchema}}',
      },
    },
  })
  let configuration = initial
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: configuration }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write() {
      throw new Error('This fixture only replaces public configuration input.')
    },
    async stop() {},
  }
  const github = createGitHubConnectionPort({
    clientId: 'harmless-binding-client',
    appSlug: 'harmless-binding-app',
    now: () => clock.value,
    fetch: async (input, init) => {
      if (String(input) !== 'https://api.github.com/user')
        throw new Error('No authorization effects are permitted.')
      const token = new Headers(init?.headers).get('Authorization')
      const repository = repositories.find(
        (row) => token === `Bearer ${row.credentials.accessToken}`,
      )
      if (!repository) throw new Error('Unexpected account-validation credential.')
      return Response.json({
        id: Number(repository.connection.githubIdentity.id),
        login: repository.connection.githubIdentity.login,
      })
    },
  })
  function providerRead(accessToken: () => Promise<string>): GitHubProviderRead {
    async function authorized(path: string) {
      const token = await accessToken()
      const repository = repositories.find((row) => row.credentials.accessToken === token)
      if (!repository) throw new Error('Provider read lacks current Connection credentials.')
      reads.push({
        repositoryId: repository.id,
        connectionId: repository.connection.id,
        path,
        at: clock.value,
      })
      return repository
    }
    return {
      async restGet(path) {
        const repository = await authorized(path)
        if (path === `/repositories/${repository.id}`) {
          if (repository === old && oldPoll === 'repository failure')
            throw new GitHubError({ kind: 'transient', cause: 'network' })
          if (repository === replacement && newRepositoryFailure)
            throw new GitHubError({ kind: 'transient', cause: 'network' })
          return { id: Number(repository.id), full_name: repository.name }
        }
        if (path === `/repos/${repository.name}`)
          return { id: Number(repository.id), full_name: repository.name }
        if (
          path ===
          `/repos/${repository.name}/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1`
        )
          return repository === old && oldPoll === 'complete absence'
            ? []
            : [{ number: 7 }, { number: 9 }]
        throw new Error(`Unexpected Connection-bound request ${path}`)
      },
      async graphql(_query, variables = {}) {
        const repository = await authorized('map-read')
        const data: Record<string, unknown> = {
          rateLimit: { cost: 1, remaining: 5000, limit: 5000, resetAt: '2099-01-01T00:00:00Z' },
        }
        for (const [index, number] of [7, 9].entries()) {
          const [owner, name] = repository.name.split('/')
          if (
            variables[`o${index}`] !== owner ||
            variables[`n${index}`] !== name ||
            variables[`i${index}`] !== number
          )
            throw new Error('GraphQL aliases must match the authorized repository identity.')
          if (repository === replacement && number === 7 && missingNewAlias) continue
          const ticketNumber = number === 7 ? 8 : 10
          const ticket = {
            number: ticketNumber,
            title: `${repository.name} ticket`,
            url: `https://github.com/${repository.name}/issues/${ticketNumber}`,
            state: 'OPEN',
            stateReason: null,
            createdAt: '2026-10-01T00:00:00Z',
            closedAt: null,
            body: `${repository.name} actual ticket prose`,
            labels: {
              totalCount: 1,
              pageInfo: { hasNextPage: false },
              nodes: [{ name: 'wayfinder:task', color: 'ffffff' }],
            },
            assignees: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
            blockedBy: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
          }
          data[`m${index}`] = {
            databaseId: Number(repository.id),
            nameWithOwner: repository.name,
            issue: {
              number,
              title: `${repository.name} map ${number}`,
              url: `https://github.com/${repository.name}/issues/${number}`,
              state: 'OPEN',
              updatedAt: number === 7 ? '2026-10-02T00:00:00Z' : '2026-10-01T00:00:00Z',
              closedAt: null,
              body: `${BODY}\nActual ${repository.name} map ${number}.\n`,
              subIssuesSummary: { total: 1, completed: 0, percentCompleted: 0 },
              subIssues: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [ticket] },
            },
          }
        }
        if (repository === replacement) await baseline.wait()
        return { data, errors: [] }
      },
    }
  }
  const pool = createGitHubObserverPool({
    now: () => clock.value,
    reconcileMs: 30_000,
    logger: { warn() {} },
  })
  const application = createRoadmapApplication({
    configuration: document,
    github,
    providerRead,
    now: () => clock.value,
    serverEpoch: 'binding-continuity',
    credentialVault: {
      async read(id) {
        return repositories.find((row) => row.connection.id === id)?.credentials ?? null
      },
      async write() {
        throw new Error('No credential writes are permitted.')
      },
      async delete() {
        throw new Error('No credential deletion is permitted.')
      },
      async cleanupOrphans() {},
    },
    admissions: {
      github: createGitHubProjectAdmission({
        async inspectWorkspace(path) {
          const repository = repositories.find((row) => row.workspace === path)
          if (!repository) throw new Error('Unexpected fixture Workspace.')
          return { path, remotes: [{ name: 'origin', nameWithOwner: repository.name }] }
        },
      }),
    },
    operations: createApplicationOperations({
      host: {
        async execute() {
          throw new Error('No host effects or folder selector are permitted.')
        },
      },
    }),
    observers: {
      local() {
        throw new Error('No Local Project belongs to this fixture.')
      },
      github(input) {
        inputs.push(input)
        const observer = pool.create(input)
        function capture(contribution: SourceContribution) {
          sourceEvidence.push({ repositoryId: input.source.repositoryId, contribution })
        }
        return {
          async observe() {
            const contribution = await observer.observe()
            capture(contribution)
            return contribution
          },
          subscribe(listener) {
            return observer.subscribe((contribution) => {
              capture(contribution)
              listener(contribution)
            })
          },
          refresh: () => observer.refresh(),
          stop: () => observer.stop(),
        }
      },
      reconcileGitHubTopology: (values) => pool.reconcileTopology(values),
      stop: () => pool.stop(),
    },
    automation: {
      database: {
        async load() {
          return database
        },
        async append(batch) {
          database = appendAutomationDatabase(database, batch)
          return { database, durability: 'confirmed' }
        },
      },
      launcher: {
        classify(request) {
          launches.push(request)
          const completion = Promise.withResolvers<ClassificationProcessResult>()
          processes.push(completion)
          return {
            completed: completion.promise,
            async stop() {
              completion.resolve({ status: 'outcome-unknown', reason: 'Harmless fixture stopped.' })
            },
          }
        },
        async dispatch() {
          throw new Error('No Session dispatch belongs to this regression.')
        },
      },
    },
  })
  const unsubscribe = application.subscribe((state) =>
    states.push(structuredClone(readApplicationState(state))),
  )
  return {
    application,
    clock,
    baseline,
    reads,
    inputs,
    sourceEvidence,
    states,
    launches,
    newWorkspace,
    database: () => database,
    setOldRepository(name: string, poll: OldPoll) {
      old.name = name
      oldPoll = poll
    },
    replace(options: {
      oldPoll: OldPoll
      missingNewAlias?: boolean
      newRepositoryFailure?: boolean
    }) {
      oldPoll = options.oldPoll
      missingNewAlias = options.missingNewAlias ?? false
      newRepositoryFailure = options.newRepositoryFailure ?? false
      configuration = valid({
        ...initial,
        configurationVersion: 2,
        projects: [
          {
            ref: { integration: 'github', projectId: PROJECT.id },
            connectionId: NEW.id,
            locator: { repositoryId: replacement.id, nameWithOwner: replacement.name },
            workspace: { path: replacement.workspace },
          },
        ],
      })
      for (const listener of listeners) listener({ ok: true, document: configuration })
    },
    async stop() {
      baseline.release()
      unsubscribe()
      for (const completion of processes)
        completion.resolve({ status: 'outcome-unknown', reason: 'Harmless fixture stopped.' })
      try {
        await application.stop()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}

function decoded(state: ReadyApplicationState) {
  const serialized = JSON.stringify({ type: 'state', state })
  expect(serialized).not.toContain('readSequence')
  expect(serialized).not.toContain('sourceBindings')
  const result = decodeStateEnvelope(JSON.parse(serialized))
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) throw new Error('The binding publication must satisfy the public decoder.')
  return readApplicationState(result.value.state)
}
function project(state: ReadyApplicationState) {
  const value = state.projects.find(
    (row) => row.ref.integration === PROJECT.integration && row.ref.projectId === PROJECT.id,
  )
  if (!value) throw new Error('The same opaque public Project key must remain registered.')
  return value
}
function map(state: ReadyApplicationState, mapId = '7') {
  const value = project(state).maps.find((row) => row.ref.mapId === mapId)
  if (!value) throw new Error('Known map identity must remain addressable.')
  return value
}
function eligible(state: ReadyApplicationState) {
  return state.automation.overrides.find(
    (row) =>
      row.target.map.project.projectId === PROJECT.id &&
      row.target.map.mapId === '7' &&
      row.target.ticketId === '8',
  )?.classification.status
}

async function pendingOverlap(
  test: Awaited<ReturnType<typeof fixture>>,
  oldPoll: OldPoll,
  missingNewAlias = false,
) {
  await test.application.start()
  expect(eligible(decoded(readApplicationState(test.application.current())))).toBe('eligible')
  test.clock.value = 10
  test.replace({ oldPoll, missingNewAlias })
  await test.baseline.started
  const pending = decoded(readApplicationState(test.application.current()))
  expect(pending.configurationVersion).toBe(1)
  expect(project(pending)).toMatchObject({
    connectionId: OLD.id,
    source: {
      integration: 'github',
      repositoryId: '101',
      nameWithOwner: 'fixture/old-owner',
      url: 'https://github.com/fixture/old-owner',
    },
  })
  expect(pending.connections.find((row) => row.id === NEW.id)).toMatchObject({
    githubIdentity: { id: '77', login: 'new-account' },
  })
  expect(pending.automation.availability.status).toBe('unavailable')
  expect(eligible(pending)).not.toBe('eligible')
  expect(JSON.stringify(pending.projects)).not.toContain('fixture/new-owner')
  expect(test.inputs).toMatchObject([
    { source: { connectionId: OLD.id, accountId: '42', repositoryId: '101' } },
    { source: { connectionId: NEW.id, accountId: '77', repositoryId: '202' } },
  ])
  test.clock.value = 20
  await vi.advanceTimersByTimeAsync(30_000)
  const polled = decoded(readApplicationState(test.application.current()))
  expect(polled.configurationVersion).toBe(1)
  expect(test.reads).toContainEqual({
    repositoryId: '101',
    connectionId: OLD.id,
    path: '/repositories/101',
    at: 20,
  })
  if (oldPoll === 'success')
    expect(map(polled).resource).toMatchObject({
      kind: 'current-readable',
      observation: { observedAt: 20 },
    })
  if (oldPoll === 'complete absence')
    expect(map(polled).resource).toMatchObject({
      kind: 'proven-absent',
      absence: { observedAt: 20 },
    })
  if (oldPoll === 'repository failure')
    expect(project(polled).resource).toMatchObject({
      kind: 'retained-unavailable',
      unavailable: { attemptedAt: 20 },
    })
  expect(test.launches).toEqual([])
  expect(
    test
      .database()
      .events.filter(
        (event) => event.type === 'classification-started' || event.type === 'wayfinder-launching',
      ),
  ).toEqual([])
  const queuedOverride = test.application.execute(
    commandSchema.parse({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target: fixtureTicketRef(TARGET),
      stage: 'classification',
    }),
  )
  test.clock.value = 30
  test.baseline.release()
  await vi.advanceTimersByTimeAsync(0)
  expect(await queuedOverride).toMatchObject({
    ok: false,
    operation: 'start-automation-override',
    subject: { kind: 'ticket', target: fixtureTicketRef(TARGET), stage: 'classification' },
  })
  expect(readApplicationState(test.application.current()).configurationVersion).toBe(2)
  expect(test.launches).toEqual([])
  const committed = decoded(readApplicationState(test.application.current()))
  expect(committed.connections.find((row) => row.id === NEW.id)).toMatchObject({
    githubIdentity: { id: '77', login: 'new-account' },
    availability: { status: 'available' },
  })
  expect(committed.connections.find((row) => row.id === NEW.id)?.availability).toEqual(
    missingNewAlias ? { status: 'available' } : { status: 'available', observedAt: 30 },
  )
  return committed
}

function expectCurrentBinding(state: ReadyApplicationState) {
  const current = project(state)
  expect(current).toMatchObject({
    connectionId: NEW.id,
    source: {
      integration: 'github',
      repositoryId: '202',
      nameWithOwner: 'fixture/new-owner',
      url: 'https://github.com/fixture/new-owner',
    },
    resource: {
      kind: 'current-readable',
      observation: {
        attemptedAt: 10,
        observedAt: 10,
        completeness: { kind: 'complete' },
        provenance: {
          integration: 'github',
          connectionId: NEW.id,
          repositoryId: '202',
          stage: 'repository',
        },
        value: {
          name: 'fixture/new-owner',
          source: { repositoryId: '202', url: 'https://github.com/fixture/new-owner' },
        },
      },
    },
    mapsMembership: {
      kind: 'current-complete',
      observation: {
        attemptedAt: 10,
        observedAt: 10,
        provenance: {
          integration: 'github',
          connectionId: NEW.id,
          repositoryId: '202',
          stage: 'map-list',
        },
        value: {
          members: [
            fixtureResourceRef({ project: PROJECT, mapId: '7' }),
            fixtureResourceRef({ project: PROJECT, mapId: '9' }),
          ],
        },
      },
    },
    displayOrder: {
      open: ['7', '9'].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
      closed: [],
    },
    activeMap: { kind: 'known-current', ref: fixtureResourceRef({ project: PROJECT, mapId: '7' }) },
  })
  for (const [mapId, ticketId] of [
    ['7', '8'],
    ['9', '10'],
  ]) {
    const currentMap = map(state, mapId)
    expect(currentMap.resource).toMatchObject({
      kind: 'current-readable',
      observation: {
        attemptedAt: 10,
        observedAt: 30,
        completeness: { kind: 'complete' },
        provenance: {
          integration: 'github',
          connectionId: NEW.id,
          repositoryId: '202',
          stage: 'map-read',
        },
        value: {
          source: { kind: 'issue', url: `https://github.com/fixture/new-owner/issues/${mapId}` },
          body: { raw: expect.stringContaining(`Actual fixture/new-owner map ${mapId}.`) },
        },
      },
    })
    expect(currentMap.ticketsMembership).toMatchObject({
      kind: 'current-complete',
      observation: {
        attemptedAt: 10,
        observedAt: 30,
        provenance: { connectionId: NEW.id, repositoryId: '202' },
      },
    })
    expect(currentMap.tickets.find((row) => row.ref.ticketId === ticketId)?.resource).toMatchObject(
      {
        kind: 'current-readable',
        observation: {
          attemptedAt: 10,
          observedAt: 30,
          provenance: { connectionId: NEW.id, repositoryId: '202' },
          value: {
            body: 'fixture/new-owner actual ticket prose',
            source: {
              kind: 'issue',
              url: `https://github.com/fixture/new-owner/issues/${ticketId}`,
            },
            blockersComplete: true,
          },
        },
      },
    )
  }
}

afterEach(() => vi.useRealTimers())

describe('RoadmapApplication same-key source binding replacement', () => {
  it('associates the current source and action with an unavailable replacement repository while retaining old metadata as history', async () => {
    vi.useFakeTimers()
    const test = await fixture()
    try {
      await test.application.start()
      expect(project(decoded(readApplicationState(test.application.current()))).source).toEqual({
        integration: 'github',
        repositoryId: '101',
        nameWithOwner: 'fixture/old-owner',
        url: 'https://github.com/fixture/old-owner',
      })
      test.clock.value = 10
      test.replace({ oldPoll: 'success', newRepositoryFailure: true })
      await vi.waitFor(() =>
        expect(readApplicationState(test.application.current()).configurationVersion).toBe(2),
      )
      const state = decoded(readApplicationState(test.application.current()))
      const current = project(state)
      expect(current.resource).toMatchObject({
        kind: 'retained-unavailable',
        lastSuccessful: {
          observedAt: 1,
          provenance: { connectionId: OLD.id, repositoryId: '101' },
          value: {
            name: 'fixture/old-owner',
            source: {
              integration: 'github',
              repositoryId: '101',
              nameWithOwner: 'fixture/old-owner',
              url: 'https://github.com/fixture/old-owner',
            },
          },
        },
        unavailable: {
          attemptedAt: 10,
          provenance: { connectionId: NEW.id, repositoryId: '202' },
        },
      })
      expect(current.actions.find((action) => action.id === 'open-source')).toEqual({
        id: 'open-source',
        label: 'Open on GitHub',
        kind: 'external-link',
        href: 'https://github.com/fixture/new-owner',
      })
      expect(current).toMatchObject({
        connectionId: NEW.id,
        source: {
          integration: 'github',
          repositoryId: '202',
          nameWithOwner: 'fixture/new-owner',
          url: 'https://github.com/fixture/new-owner',
        },
      })
      expect(current.name).not.toBe('fixture/old-owner')
      expect(test.launches).toEqual([])
      for (const publication of test.states) decoded(publication)
    } finally {
      await test.stop()
    }
  })

  it('retains an observed repository rename through same-identity failure and recovery', async () => {
    vi.useFakeTimers()
    const test = await fixture()
    try {
      await test.application.start()
      for (const [time, poll, kind] of [
        [10, 'success', 'current-readable'],
        [20, 'repository failure', 'retained-unavailable'],
        [30, 'success', 'current-readable'],
      ] as const) {
        test.clock.value = time
        test.setOldRepository('fixture/renamed-owner', poll)
        expect(
          await test.application.execute(
            commandSchema.parse({
              type: 'refresh-project',
              project: { integration: 'github', projectId: PROJECT.id },
              expectedConfigurationVersion: 1,
            }),
          ),
        ).toMatchObject({
          ok: true,
          operation: 'refresh-project',
          subject: {
            kind: 'project',
            project: { integration: 'github', projectId: PROJECT.id },
          },
          result: {
            type: 'refresh-project',
            project: { integration: 'github', projectId: PROJECT.id },
            attempt: {
              kind: poll === 'repository failure' ? 'degraded' : 'observed',
              attemptedAt: time,
              observedAt: poll === 'repository failure' ? 10 : time,
              provenance: {
                integration: 'github',
                connectionId: OLD.id,
                repositoryId: '101',
                stage: 'repository',
              },
            },
          },
        })
        const current = project(decoded(readApplicationState(test.application.current())))
        expect(current).toMatchObject({
          source: {
            integration: 'github',
            repositoryId: '101',
            nameWithOwner: 'fixture/renamed-owner',
            url: 'https://github.com/fixture/renamed-owner',
          },
          resource: { kind },
        })
        expect(current.actions.find((action) => action.id === 'open-source')).toMatchObject({
          kind: 'external-link',
          href: 'https://github.com/fixture/renamed-owner',
        })
        if (current.resource.kind === 'retained-unavailable')
          expect(current.resource.lastSuccessful).toMatchObject({
            observedAt: 10,
            value: { source: { repositoryId: '101', nameWithOwner: 'fixture/renamed-owner' } },
          })
      }
      expect(test.launches).toEqual([])
    } finally {
      await test.stop()
    }
  })

  // Rejecting a committed replacement by retired-owner timestamps loses real current authority.
  it.each(['success', 'complete absence', 'repository failure'] satisfies OldPoll[])(
    'admits the actual new baseline despite an overlapping old-owner %s at a later Project time',
    async (oldPoll) => {
      vi.useFakeTimers()
      const test = await fixture()
      try {
        const committed = await pendingOverlap(test, oldPoll)
        expectCurrentBinding(committed)
        const actual = test.sourceEvidence.findLast(
          (row) => row.repositoryId === '202',
        )?.contribution
        expect(actual?.attempts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: { kind: 'project', project: PROJECT },
              attemptedAt: 10,
              observedAt: 10,
            }),
            expect.objectContaining({
              kind: 'observed',
              scope: { kind: 'maps-membership', project: PROJECT },
              attemptedAt: 10,
              observedAt: 10,
            }),
            expect.objectContaining({
              kind: 'observed',
              scope: { kind: 'map', map: { project: PROJECT, mapId: '7' } },
              attemptedAt: 10,
              observedAt: 30,
            }),
          ]),
        )
        expect(eligible(committed)).toBe('eligible')
        expect(
          await test.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 2,
              target: fixtureTicketRef(TARGET),
              stage: 'classification',
            }),
          ),
        ).toMatchObject({ ok: true })
        expect(test.launches).toHaveLength(1)
        expect(test.launches[0]).toMatchObject({
          workspace: test.newWorkspace,
          prompt: expect.stringContaining(
            'https://github.com/fixture/new-owner/issues/7 https://github.com/fixture/new-owner/issues/8 ',
          ),
          environment: {
            ROADMAP_RUN_KIND: 'classification',
            ROADMAP_PROJECT_KEY: 'github:same-key',
            ROADMAP_MAP_ID: '7',
            ROADMAP_TICKET_ID: '8',
          },
        })
        for (const state of test.states) decoded(state)
      } finally {
        await test.stop()
      }
    },
  )

  // Retired content is trace for failed replacement scopes, not authority for a successful sibling.
  it('retains old success only where the new binding lacks an actual alias while independently successful scopes become current', async () => {
    vi.useFakeTimers()
    const test = await fixture()
    try {
      const committed = await pendingOverlap(test, 'success', true)
      expect(project(committed)).toMatchObject({
        resource: {
          kind: 'current-readable',
          observation: {
            attemptedAt: 10,
            observedAt: 10,
            provenance: { connectionId: NEW.id, repositoryId: '202' },
          },
        },
        mapsMembership: {
          kind: 'current-complete',
          observation: {
            observedAt: 10,
            provenance: { connectionId: NEW.id, repositoryId: '202' },
          },
        },
        activeMap: { kind: 'uncertain' },
      })
      expect(map(committed).resource).toMatchObject({
        kind: 'retained-unavailable',
        lastSuccessful: {
          observedAt: 20,
          provenance: { connectionId: OLD.id, repositoryId: '101' },
          value: {
            source: { kind: 'issue', url: 'https://github.com/fixture/old-owner/issues/7' },
          },
        },
        unavailable: {
          kind: 'source-failure',
          attemptedAt: 10,
          provenance: { connectionId: NEW.id, repositoryId: '202', stage: 'map-read' },
          failure: { kind: 'access-ambiguous', evidence: 'missing-alias' },
        },
      })
      expect(map(committed).tickets[0]?.resource).toMatchObject({
        kind: 'retained-unavailable',
        lastSuccessful: {
          observedAt: 20,
          provenance: { connectionId: OLD.id, repositoryId: '101' },
        },
      })
      expect(map(committed, '9').resource).toMatchObject({
        kind: 'current-readable',
        observation: {
          attemptedAt: 10,
          observedAt: 30,
          provenance: { connectionId: NEW.id, repositoryId: '202' },
          value: {
            source: { kind: 'issue', url: 'https://github.com/fixture/new-owner/issues/9' },
          },
        },
      })
      expect(map(committed, '9').ticketsMembership).toMatchObject({
        kind: 'current-complete',
        observation: { observedAt: 30, provenance: { connectionId: NEW.id, repositoryId: '202' } },
      })
      expect(map(committed, '9').tickets[0]?.resource).toMatchObject({
        kind: 'current-readable',
        observation: { observedAt: 30, provenance: { connectionId: NEW.id, repositoryId: '202' } },
      })
      expect(eligible(committed)).not.toBe('eligible')
      expect(
        await test.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 2,
            target: fixtureTicketRef(TARGET),
            stage: 'classification',
          }),
        ),
      ).toMatchObject({ ok: false })
      expect(test.launches).toEqual([])
      for (const state of test.states) decoded(state)
    } finally {
      await test.stop()
    }
  })
})
