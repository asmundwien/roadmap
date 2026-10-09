import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProjectKey, TicketTypeEvidence } from '@roadmap/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AutomationAppend,
  type AutomationDatabase,
  type AutomationDatabaseDocument,
  type AutomationEvent,
  appendAutomationDatabase,
  createAutomationDatabaseDocument,
  replayAutomationDatabase,
} from '../automation/database.ts'
import {
  type AutomationLaunch,
  type AutomationLauncher,
  type ClassificationProcessResult,
  createAutomationLauncher,
  type WayfinderProcessResult,
} from '../automation/engine.ts'
import type { AutomationEvidence, AutomationTarget } from '../automation/model.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
} from '../configuration/document.ts'
import type { CredentialBundle, GitHubConnectionPort } from '../github/connections.ts'
import type {
  GitHubObservationInput,
  LocalObservationInput,
  SourceObserverFactories,
} from '../observation/coordinator.ts'
import type {
  ObservationAttempt,
  SourceContribution,
  SourceObserver,
} from '../observation/source.ts'
import type {
  AdmissionOutcome,
  GitHubProviderRead,
  HarnessCommand,
  ProjectAdmission,
  ProjectConfiguration,
  ProjectRevalidationRequest,
} from '../projects/registry.ts'
import {
  createSourceFixtureOwner,
  type FixtureMap,
  type FixtureProject,
  type FixtureTicket,
  publicProjectObservation,
} from '../source-test-fixtures.ts'
import { isRecord } from '../type-guards.ts'
import { createRoadmapApplication } from './application.ts'
import type { CredentialVault } from './credential-vault.ts'
import { sessionReportSchemaJson } from './session-report-contract.ts'

const TASK: TicketTypeEvidence = { kind: 'recognized', value: 'task', labels: ['task'] }
const COMMAND: HarnessCommand = {
  command: process.execPath,
  args: ['-e', 'process.stdin.resume()'],
  promptDelivery: 'stdin',
  promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
}
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function ticket(
  id: string,
  typeEvidence: TicketTypeEvidence = TASK,
  overrides: Partial<FixtureTicket> = {},
): FixtureTicket {
  return {
    id,
    displayId: id,
    title: `Ticket ${id}`,
    body: 'Resolve the route.',
    typeEvidence,
    state: 'frontier',
    isClaimed: false,
    isBlocked: false,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
    sourcePath: `/tmp/project-${id}/.wayfinder/tickets/${id}.md`,
    ...overrides,
  }
}

function map(
  project: ProjectKey,
  tickets: FixtureTicket[],
  overrides: Partial<FixtureMap> = {},
): FixtureMap {
  return {
    project,
    id: 'map',
    title: 'Map',
    isOpen: true,
    updatedAt: 1,
    body: {
      raw: '',
      destination: 'Reach the destination.',
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
    sourcePath: `/tmp/project-${project.id}/.wayfinder/map.md`,
    ...overrides,
  }
}

function project(
  id: string,
  tickets: FixtureTicket[],
  overrides: Partial<FixtureProject> = {},
): FixtureProject {
  const key = { integration: 'local' as const, id }
  return {
    key,
    name: id,
    openMaps: [map(key, tickets)],
    closedMaps: [],
    warnings: [],
    ...overrides,
  }
}

function memoryConfiguration(
  initial: ProjectConfiguration,
  writeResult: ConfigurationWrite = { ok: true, durability: 'confirmed' },
) {
  let current = initial
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const writes: ProjectConfiguration[] = []
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: current }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next): Promise<ConfigurationWrite> {
      writes.push(next)
      if (!writeResult.ok) return writeResult
      current = next
      return writeResult
    },
    async stop() {},
  }
  return {
    document,
    writes,
    emit(next: ProjectConfiguration | ConfigurationRead) {
      const result: ConfigurationRead = 'ok' in next ? next : { ok: true, document: next }
      if (result.ok) current = result.document
      for (const listener of listeners) listener(result)
    },
  }
}

interface MemoryAutomationDatabase {
  database: AutomationDatabaseDocument
  evidence(): AutomationEvidence[]
  events(): readonly AutomationEvent[]
  writes: AutomationDatabase[]
}

function memoryAutomationDatabase(
  initial: AutomationDatabase = { schemaVersion: 3, opportunities: [], events: [] },
  options: {
    failAppend?: (batch: AutomationAppend) => boolean
    beforeAppend?: (batch: AutomationAppend) => Promise<void>
  } = {},
): MemoryAutomationDatabase {
  let current = initial
  const writes: AutomationDatabase[] = []
  const database: AutomationDatabaseDocument = {
    async load() {
      return current
    },
    async append(batch) {
      await options.beforeAppend?.(batch)
      if (options.failAppend?.(batch)) throw new Error('Automation database is read-only.')
      current = appendAutomationDatabase(current, batch)
      writes.push(current)
      return { database: current, durability: 'confirmed' }
    },
  }
  return {
    database,
    evidence: () => [...replayAutomationDatabase(current).evidence],
    events: () => current.events,
    writes,
  }
}

function controlledObservers(initial: FixtureProject[]) {
  let projects = initial
  let observedAt = 100
  type Owner = {
    input: LocalObservationInput | GitHubObservationInput
    read: ReturnType<typeof createSourceFixtureOwner>
    listeners: Set<(value: SourceContribution) => void>
    lastSourceContribution: SourceContribution | undefined
  }
  const owners = new Set<Owner>()

  function localMap(entry: FixtureMap, root: string): FixtureMap {
    const sourcePath = resolve(root, entry.id)
    const tickets = entry.tickets.map((ticket) => ({
      ...ticket,
      sourcePath: join(dirname(sourcePath), 'tickets', `${ticket.id}.md`),
    }))
    return {
      ...entry,
      sourcePath,
      tickets,
      frontier: tickets.filter((ticket) => ticket.state === 'frontier'),
    }
  }

  function contribution(owner: Owner, completedAt = observedAt): SourceContribution {
    const { input, read } = owner
    const key: ProjectKey = { integration: input.integration, id: input.ref.projectId }
    const entry = projects.find(
      (candidate) => candidate.key.integration === key.integration && candidate.key.id === key.id,
    ) ?? { ...project(key.id, []), key, openMaps: [], closedMaps: [] }
    const sourceProject: FixtureProject =
      input.integration === 'local'
        ? {
            ...entry,
            sourcePath: input.workspace.path,
            openMaps: entry.openMaps.map((map) => localMap(map, input.workspace.path)),
            closedMaps: entry.closedMaps.map((map) => localMap(map, input.workspace.path)),
          }
        : { ...entry, name: input.source.locator.nameWithOwner }
    const batch = read(
      [sourceProject],
      completedAt,
      input.integration === 'github'
        ? {
            projects: [
              {
                ref: input.ref,
                connectionId: input.source.connectionId,
                locator: {
                  repositoryId: input.source.repositoryId,
                  nameWithOwner: input.source.locator.nameWithOwner,
                },
              },
            ],
          }
        : undefined,
    )
    const attempts = batch.attempts.map((attempt): ObservationAttempt => {
      if (input.integration === 'github') return attempt
      let path: string
      let operation: 'inspect-root' | 'enumerate' | 'read' = 'read'
      switch (attempt.scope.kind) {
        case 'project':
          path = input.workspace.path
          operation = 'inspect-root'
          break
        case 'maps-membership':
          path = join(input.workspace.path, '.wayfinder')
          operation = 'enumerate'
          break
        case 'map':
          path = resolve(input.workspace.path, attempt.scope.map.mapId)
          break
        case 'tickets-membership':
          path = join(dirname(resolve(input.workspace.path, attempt.scope.map.mapId)), 'tickets')
          operation = 'enumerate'
          break
        case 'ticket':
          path = join(
            dirname(resolve(input.workspace.path, attempt.scope.ticket.map.mapId)),
            'tickets',
            `${attempt.scope.ticket.ticketId}.md`,
          )
          break
      }
      return { ...attempt, provenance: { integration: 'local', path, operation } }
    })
    const value: SourceContribution = {
      project: key,
      attempts,
      health: { status: 'available', observedAt: completedAt },
    }
    owner.lastSourceContribution = value
    return value
  }

  function observer(input: LocalObservationInput | GitHubObservationInput): SourceObserver {
    const owner: Owner = {
      input,
      read: createSourceFixtureOwner(),
      listeners: new Set<(value: SourceContribution) => void>(),
      lastSourceContribution: undefined,
    }
    owners.add(owner)
    return {
      async observe() {
        return contribution(owner)
      },
      subscribe(listener) {
        owner.listeners.add(listener)
        return () => owner.listeners.delete(listener)
      },
      async refresh() {
        return contribution(owner)
      },
      async stop() {
        owners.delete(owner)
        owner.listeners.clear()
      },
    }
  }

  const observers: SourceObserverFactories = { local: observer, github: observer }
  return {
    observers,
    push(next: FixtureProject[]) {
      projects = next
      observedAt += 1
      for (const owner of owners) {
        const value = contribution(owner)
        for (const listener of owner.listeners) listener(value)
      }
    },
    pushProject(next: FixtureProject) {
      projects = projects.map((entry) =>
        entry.key.integration === next.key.integration && entry.key.id === next.key.id
          ? next
          : entry,
      )
      observedAt += 1
      for (const owner of owners) {
        if (
          owner.input.integration !== next.key.integration ||
          owner.input.ref.projectId !== next.key.id
        )
          continue
        const value = contribution(owner)
        for (const listener of owner.listeners) listener(value)
      }
    },
    fail(projectKey: ProjectKey) {
      const lastObservedAt = observedAt++
      for (const owner of owners) {
        if (
          owner.input.integration !== 'local' ||
          owner.input.ref.projectId !== projectKey.id ||
          projectKey.integration !== 'local'
        )
          continue
        const lastSourceContribution = owner.lastSourceContribution
        if (!lastSourceContribution)
          throw new Error('Controlled observer must read before failing.')
        const value: SourceContribution = {
          project: projectKey,
          attempts: [
            ...lastSourceContribution.attempts.filter(
              (attempt) => attempt.scope.kind !== 'maps-membership',
            ),
            {
              kind: 'failed',
              readSequence: owner.read.nextReadSequence(),
              scope: { kind: 'maps-membership', project: projectKey },
              attemptedAt: observedAt,
              provenance: {
                integration: 'local',
                path: join(owner.input.workspace.path, '.wayfinder'),
                operation: 'enumerate',
              },
              failure: { kind: 'filesystem', operation: 'enumerate', code: 'EACCES' },
            },
          ],
          health: {
            status: 'degraded',
            cause: 'The map directory is unreadable.',
            observedAt: lastObservedAt,
          },
        }
        owner.lastSourceContribution = value
        for (const listener of owner.listeners) listener(value)
      }
    },
  }
}

const PROVIDER_READ: GitHubProviderRead = {
  async restGet() {
    throw new Error('Controlled observers must not read GitHub.')
  },
  async graphql() {
    throw new Error('Controlled observers must not read GitHub.')
  },
}

function admissionFixtures(): Partial<Record<'local' | 'github', ProjectAdmission>> {
  async function inspect(
    request: ProjectRevalidationRequest,
    runtime: Parameters<ProjectAdmission['revalidate']>[1],
  ): Promise<AdmissionOutcome> {
    if (request.intent.ref.integration === 'local') return localInspection(request.path)
    if (request.connection.integration !== 'github' || !('locator' in request.intent))
      throw new Error('GitHub fixture requires a matching Connection.')
    const access = await runtime.github(request.connection)
    return {
      integration: 'github',
      source: { ok: true, value: { ...access, repositoryId: request.intent.locator.repositoryId } },
      workspace: {
        ok: true,
        value: {
          integration: 'github',
          path: request.path,
          readable: true,
          searchable: true,
          worktreeRoot: true,
          matchedRepositoryId: request.intent.locator.repositoryId,
          verifiedConnectionId: request.connection.id,
          nameWithOwner: request.intent.locator.nameWithOwner,
        },
      },
    }
  }
  const local: ProjectAdmission = {
    async admit(request) {
      return localInspection(request.path)
    },
    repair: inspect,
    revalidate: inspect,
  }
  const github: ProjectAdmission = {
    async admit() {
      return {
        integration: 'github',
        source: {
          ok: false,
          error: {
            code: 'not-supported',
            message: 'This fixture only revalidates configured GitHub Projects.',
          },
        },
        workspace: {
          ok: false,
          error: {
            code: 'not-supported',
            message: 'This fixture only revalidates configured GitHub Projects.',
          },
        },
      }
    },
    repair: inspect,
    revalidate: inspect,
  }
  return { local, github }
}

function localInspection(path: string): AdmissionOutcome {
  return {
    integration: 'local',
    workspace:
      path === '/tmp/missing-workspace'
        ? {
            ok: false,
            error: {
              code: 'admission-failed',
              field: 'workspace.path',
              message: 'Workspace is missing.',
              filesystemCode: 'ENOENT',
            },
          }
        : { ok: true, value: { integration: 'local', path, readable: true, searchable: true } },
  }
}

function githubAuthorizationFixtures(): {
  github: GitHubConnectionPort
  credentialVault: CredentialVault
  providerRead: () => GitHubProviderRead
} {
  const credentials: CredentialBundle = {
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    accessTokenExpiresAt: Number.MAX_SAFE_INTEGER,
    refreshTokenExpiresAt: Number.MAX_SAFE_INTEGER,
  }
  return {
    github: {
      integration: {
        integration: 'github',
        name: 'GitHub',
        connectionKind: 'device-authorization',
        newInstallationUrl: 'https://github.com/apps/test/installations/new',
        installationsUrl: 'https://github.com/settings/installations',
        authorizationsUrl: 'https://github.com/settings/connections/applications/test',
      },
      async identify() {
        return { id: 'account', login: 'tester' }
      },
      async beginDeviceAuthorization() {
        throw new Error('The automation fixture does not authorize Connections.')
      },
      async pollDeviceAuthorization() {
        throw new Error('The automation fixture does not authorize Connections.')
      },
      async refresh() {
        throw new Error('The automation fixture uses unexpired credentials.')
      },
    },
    credentialVault: {
      async read() {
        return credentials
      },
      async write() {},
      async delete() {},
      async cleanupOrphans() {},
    },
    providerRead: () => PROVIDER_READ,
  }
}

function githubProject(id: string, tickets: FixtureTicket[]): FixtureProject {
  const key: ProjectKey = { integration: 'github', id }
  const remoteTickets = tickets.map((entry) => ({
    ...entry,
    sourcePath: undefined,
    url: `https://github.com/owner/${id}/issues/${entry.id}`,
  }))
  return project(id, [], {
    key,
    name: `owner/${id}`,
    sourceUrl: `https://github.com/owner/${id}`,
    openMaps: [
      map(key, remoteTickets, {
        sourcePath: undefined,
        url: `https://github.com/owner/${id}/issues/100`,
      }),
    ],
  })
}

function configuration(
  projects: FixtureProject[],
  overrides: Partial<ProjectConfiguration['automation']> = {},
): ProjectConfiguration {
  return {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [
      { id: 'local', integration: 'local', name: 'Local', builtIn: true },
      ...(projects.some((entry) => entry.key.integration === 'github')
        ? [
            {
              id: 'github',
              integration: 'github' as const,
              name: 'GitHub',
              builtIn: false as const,
              githubIdentity: { id: 'account', login: 'tester' },
            },
          ]
        : []),
    ],
    projects: projects.map((entry): ProjectConfiguration['projects'][number] =>
      entry.key.integration === 'local'
        ? {
            ref: { integration: 'local', projectId: entry.key.id },
            connectionId: 'local',
            workspace: { path: `/tmp/${entry.key.id}` },
          }
        : {
            ref: { integration: 'github', projectId: entry.key.id },
            connectionId: 'github',
            locator: { repositoryId: entry.key.id, nameWithOwner: entry.name },
            workspace: { path: `/tmp/${entry.key.id}` },
          },
    ),
    automation: {
      enabled: true,
      classificationCommand: COMMAND,
      wayfinderCommand: COMMAND,
      enabledProjects: projects.map((entry) => entry.key),
      ...overrides,
    },
  }
}

function processResult(
  overrides: Partial<
    Omit<Extract<ClassificationProcessResult, { status: 'finished' }>, 'status'>
  > = {},
): ClassificationProcessResult {
  return {
    status: 'finished',
    code: 0,
    signal: null,
    stdout: JSON.stringify({ schemaVersion: 1, verdict: 'afk', reason: 'Agent-ready.' }),
    stdoutOversized: false,
    ...overrides,
  }
}
function wayfinderResult(
  overrides: Partial<Omit<WayfinderProcessResult, 'status'>> = {},
): WayfinderProcessResult {
  return {
    status: 'finished',
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      schemaVersion: 1,
      outcome: 'completed',
      reason: 'Ticket resolved.',
    }),
    stdoutOversized: false,
    ...overrides,
  }
}

function deferredLauncher(
  options: {
    beforeClassify?: (request: AutomationLaunch) => void
    beforeDispatch?: (request: AutomationLaunch) => void
    dispatchError?: Error
    dispatchGate?: Promise<void>
  } = {},
) {
  const classifications: Array<{
    request: AutomationLaunch
    resolve(result: ClassificationProcessResult): void
    reject(error: Error): void
    stopped: boolean
  }> = []
  const dispatches: AutomationLaunch[] = []
  const sessions: Array<{
    resolve(result: WayfinderProcessResult): void
    reject(error: Error): void
  }> = []
  let running = 0
  let maximumRunning = 0
  const launcher: AutomationLauncher = {
    classify(request) {
      options.beforeClassify?.(request)
      running += 1
      maximumRunning = Math.max(maximumRunning, running)
      const { promise, resolve, reject } = Promise.withResolvers<ClassificationProcessResult>()
      const launch = {
        request,
        stopped: false,
        resolve(result: ClassificationProcessResult) {
          running -= 1
          resolve(result)
        },
        reject(error: Error) {
          running -= 1
          reject(error)
        },
      }
      classifications.push(launch)
      return {
        completed: promise,
        async stop() {
          launch.stopped = true
          launch.resolve(processResult({ signal: 'SIGTERM' }))
          await promise
        },
      }
    },
    async dispatch(request) {
      options.beforeDispatch?.(request)
      dispatches.push(request)
      if (options.dispatchError) throw options.dispatchError
      await options.dispatchGate
      const { promise, resolve, reject } = Promise.withResolvers<WayfinderProcessResult>()
      sessions.push({ resolve, reject })
      return { completed: promise }
    },
  }
  return {
    launcher,
    classifications,
    dispatches,
    sessions,
    settleSessions() {
      for (const session of sessions)
        session.resolve(wayfinderResult({ code: null, signal: 'SIGTERM', stdout: '' }))
    },
    maximumRunning: () => maximumRunning,
  }
}

async function harness(options: {
  projects: FixtureProject[]
  launcher: AutomationLauncher
  database?: MemoryAutomationDatabase
  configuration?: ProjectConfiguration
  configurationWriteResult?: ConfigurationWrite
}) {
  const source = controlledObservers(options.projects)
  const database = options.database ?? memoryAutomationDatabase()
  const configured = memoryConfiguration(
    options.configuration ?? configuration(options.projects),
    options.configurationWriteResult,
  )
  const application = createRoadmapApplication({
    configuration: configured.document,
    automation: { database: database.database, launcher: options.launcher },
    observers: source.observers,
    admissions: admissionFixtures(),
    ...(options.projects.some((entry) => entry.key.integration === 'github')
      ? githubAuthorizationFixtures()
      : {}),
    serverEpoch: 'automation-test',
  })
  await application.start()
  return { application, source, database, configured }
}
const RECORDED_AT = '2026-08-29T00:00:00.000Z'

function storedEvent(id: string, opportunityId = 'opportunity') {
  return { id, opportunityId, recordedAt: RECORDED_AT }
}

function queuedDatabase(targets: readonly AutomationTarget[]): AutomationDatabase {
  return {
    schemaVersion: 3,
    opportunities: targets.map((target, index) => ({ id: `opportunity-${index}`, target })),
    events: targets.flatMap((_, index): AutomationEvent[] => [
      {
        ...storedEvent(`classification-started-${index}`, `opportunity-${index}`),
        type: 'classification-started',
        admission: 'automatic',
      },
      {
        ...storedEvent(`classification-completed-${index}`, `opportunity-${index}`),
        type: 'classification-completed',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'afk', reason: 'Agent-ready.' },
      },
    ]),
  }
}

function appendGate(type: AutomationEvent['type']) {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let didEnter = false
  return {
    async waitForEntry() {
      await vi.waitFor(() => expect(didEnter, `Expected ${type} append to be entered.`).toBe(true))
      await entered.promise
    },
    release: () => release.resolve(),
    async beforeAppend(batch: AutomationAppend) {
      if (!batch.events.some((event) => event.type === type)) return
      didEnter = true
      entered.resolve()
      await release.promise
    },
  }
}

const INVALID_CONFIGURATION: ConfigurationRead = {
  ok: false,
  issues: [{ path: '$', message: 'Invalid JSON.' }],
}

describe('Automation admission after durable append', () => {
  it.each(['fresh target', 'AFK handoff'])(
    'blocks %s after an invalid manual configuration read',
    async (scenario) => {
      const sourceProject = project('invalid-read', [ticket('1')])
      const launches = deferredLauncher()
      const current = await harness({ projects: [sourceProject], launcher: launches.launcher })
      try {
        current.configured.emit(INVALID_CONFIGURATION)
        await vi.waitFor(() =>
          expect(current.application.current().automation.availability.status).toBe('unavailable'),
        )
        launches.classifications[0]?.resolve(
          processResult(
            scenario === 'fresh target'
              ? {
                  stdout: JSON.stringify({
                    schemaVersion: 1,
                    verdict: 'hitl',
                    reason: 'Requires a person.',
                  }),
                }
              : {},
          ),
        )
        await vi.waitFor(() =>
          expect(current.database.evidence()[0]?.classification.status).toBe('completed'),
        )
        if (scenario === 'fresh target')
          current.source.push([project('invalid-read', [ticket('2')])])
        await delay(20)
        expect(launches.classifications).toHaveLength(1)
        expect(launches.dispatches).toEqual([])
        expect(current.application.current().configurationVersion).toBe(1)
        expect(current.application.current().projects[0]?.key).toEqual(sourceProject.key)
        expect(
          current.application
            .current()
            .automation.overrides.every(
              (entry) =>
                entry.classification.status === 'ineligible' &&
                entry.wayfinder.status === 'ineligible',
            ),
        ).toBe(true)
        expect(
          await current.application.execute({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target: {
              project: sourceProject.key,
              mapId: 'map',
              ticketId: scenario === 'fresh target' ? '2' : '1',
            },
            stage: scenario === 'fresh target' ? 'classification' : 'wayfinder',
          }),
        ).toMatchObject({ ok: false, error: { code: 'configuration-invalid' } })
      } finally {
        const stopping = current.application.stop()
        launches.settleSessions()
        await stopping
      }
    },
  )

  for (const stage of ['classification', 'wayfinder'] as const) {
    for (const admission of ['automatic', 'override'] as const) {
      it.each([
        'claimed',
        'blocked',
        'closed map',
        'incomplete tickets',
        'incomplete blockers',
        'missing source',
        'source failure',
        'invalid configuration',
        'changed command',
        'changed workspace',
        'missing workspace',
        'removed Project',
        ...(admission === 'automatic' ? ['disabled policy'] : []),
      ])(
        `records known nonlaunch for ${admission} ${stage} when %s revokes deferred admission`,
        async (change) => {
          const sourceProject = project('revoked', [ticket('1')])
          const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
          const startType =
            stage === 'classification' ? 'classification-started' : 'wayfinder-launching'
          const failureType =
            stage === 'classification' ? 'classification-launch-failed' : 'wayfinder-launch-failed'
          const gate = appendGate(startType)
          const database = memoryAutomationDatabase(
            stage === 'wayfinder' ? queuedDatabase([target]) : undefined,
            { beforeAppend: gate.beforeAppend },
          )
          const launches = deferredLauncher()
          const disabled = configuration([sourceProject], { enabled: false })
          const current = await harness({
            projects: [sourceProject],
            launcher: launches.launcher,
            database,
            configuration: disabled,
          })
          const enabled = {
            ...disabled,
            configurationVersion: 2,
            automation: { ...disabled.automation, enabled: true },
          }
          try {
            expect(current.application.current().automation.overrides).toContainEqual(
              expect.objectContaining({ target, [stage]: { status: 'eligible' } }),
            )
            const pending =
              admission === 'override'
                ? current.application.execute({
                    type: 'start-automation-override',
                    expectedConfigurationVersion: 1,
                    target,
                    stage,
                  })
                : null
            if (admission === 'automatic') current.configured.emit(enabled)
            await gate.waitForEntry()
            expect(launches.classifications).toEqual([])
            expect(launches.dispatches).toEqual([])
            expect(database.events().some((event) => event.type === startType)).toBe(false)
            expect(
              database.evidence().some((entry) => entry.target.ticketId === target.ticketId),
            ).toBe(stage === 'wayfinder')
            if (change === 'invalid configuration') {
              current.configured.emit(INVALID_CONFIGURATION)
              await vi.waitFor(() =>
                expect(current.application.current().automation.availability.status).toBe(
                  'unavailable',
                ),
              )
            } else if (
              [
                'disabled policy',
                'changed command',
                'changed workspace',
                'missing workspace',
                'removed Project',
              ].includes(change)
            ) {
              const base = admission === 'automatic' ? enabled : disabled
              current.configured.emit({
                ...base,
                configurationVersion: 3,
                projects:
                  change === 'removed Project'
                    ? []
                    : change === 'missing workspace'
                      ? base.projects.map((entry) => ({
                          ...entry,
                          workspace: { path: '/tmp/missing-workspace' },
                        }))
                      : change === 'changed workspace'
                        ? base.projects.map((entry) => ({
                            ...entry,
                            workspace: { path: '/tmp/replaced-workspace' },
                          }))
                        : base.projects,
                automation: {
                  ...base.automation,
                  enabledProjects:
                    change === 'removed Project' ? [] : base.automation.enabledProjects,
                  enabled: change === 'disabled policy' ? false : base.automation.enabled,
                  ...(change === 'changed command'
                    ? {
                        [stage === 'classification' ? 'classificationCommand' : 'wayfinderCommand']:
                          { ...COMMAND, args: ['-e', 'process.exit(0)'] },
                      }
                    : {}),
                },
              })
              if (admission === 'automatic')
                await vi.waitFor(() =>
                  expect(current.application.current().configurationVersion).toBe(3),
                )
            } else if (change === 'missing source') current.source.push([project('revoked', [])])
            else if (change === 'source failure') {
              const baseline = current.application.current().projects[0]
              if (!baseline) throw new Error('The admitted Project must have a baseline.')
              const unavailable = {
                kind: 'source-failure',
                scope: { kind: 'maps-membership', project: sourceProject.key },
                attemptedAt: 101,
                provenance: {
                  integration: 'local',
                  path: join(`/tmp/${sourceProject.key.id}`, '.wayfinder'),
                  operation: 'enumerate',
                },
                failure: { kind: 'filesystem', operation: 'enumerate', code: 'EACCES' },
              }
              current.source.fail(sourceProject.key)
              const failed = current.application.current().projects[0]
              expect(failed).toMatchObject({
                resource: { kind: 'current-readable', observation: { observedAt: 100 } },
                mapsMembership: { kind: 'unavailable', unavailable },
                activeMap: { kind: 'uncertain' },
                displayOrder: baseline.displayOrder,
              })
              expect(failed?.maps).toHaveLength(baseline.maps.length)
              for (const map of baseline.maps) {
                if (map.resource.kind !== 'current-readable')
                  throw new Error('The admitted map must have a readable baseline.')
                const retainedMap = failed?.maps.find((entry) => entry.key.mapId === map.key.mapId)
                expect(retainedMap?.resource).toEqual({
                  kind: 'retained-unavailable',
                  lastSuccessful: map.resource.observation,
                  unavailable: expect.objectContaining(unavailable),
                })
                expect(map.resource.observation.observedAt).toBe(100)
                expect(retainedMap?.tickets).toHaveLength(map.tickets.length)
                for (const ticket of map.tickets) {
                  if (ticket.resource.kind !== 'current-readable')
                    throw new Error('The admitted ticket must have a readable baseline.')
                  expect(
                    retainedMap?.tickets.find((entry) => entry.key.ticketId === ticket.key.ticketId)
                      ?.resource,
                  ).toEqual({
                    kind: 'retained-unavailable',
                    lastSuccessful: ticket.resource.observation,
                    unavailable: expect.objectContaining(unavailable),
                  })
                  expect(ticket.resource.observation.observedAt).toBe(100)
                }
              }
              expect(current.application.current().connections[0]?.availability.status).toBe(
                'degraded',
              )
            } else {
              const changedTicket = ticket('1', TASK, {
                isClaimed: change === 'claimed',
                state: change === 'claimed' ? 'claimed' : 'frontier',
                isBlocked: change === 'blocked',
                blockersComplete: change !== 'incomplete blockers',
                blockedBy:
                  change === 'blocked'
                    ? [
                        {
                          reference: { kind: 'registered', project: sourceProject.key },
                          ticketId: 'blocker',
                          state: 'open',
                        },
                      ]
                    : [],
              })
              current.source.push([
                project('revoked', [changedTicket], {
                  openMaps: [
                    map(sourceProject.key, [changedTicket], {
                      isOpen: change !== 'closed map',
                      ticketsComplete: change !== 'incomplete tickets',
                    }),
                  ],
                }),
              ])
            }
            gate.release()
            if (pending)
              expect(await pending).toMatchObject({
                ok: false,
                error: {
                  code: expect.stringMatching(
                    /^(validation|configuration-invalid|selection-failed)$/,
                  ),
                },
              })
            await vi.waitFor(() =>
              expect(database.events().some((event) => event.type === failureType)).toBe(true),
            )
            const reservation = database.events().filter((event) => event.type === startType)
            const nonlaunch = database.events().filter((event) => event.type === failureType)
            expect(reservation).toHaveLength(1)
            expect(nonlaunch).toHaveLength(1)
            expect(nonlaunch[0]?.opportunityId).toBe(reservation[0]?.opportunityId)
            expect(current.application.current().automation.evidence[0]?.target).toEqual(target)
            expect(launches.classifications).toEqual([])
            expect(launches.dispatches).toEqual([])
            expect(database.events().some((event) => event.type === 'wayfinder-running')).toBe(
              false,
            )
            expect(current.application.current().automation.evidence[0]).toMatchObject(
              stage === 'classification'
                ? { classification: { status: 'launch-failed', admission } }
                : {
                    classification: { status: 'completed', verdict: { value: 'afk' } },
                    wayfinder: { status: 'launch-failed', admission },
                  },
            )
            current.configured.emit({ ...enabled, configurationVersion: 4 })
            current.source.push([project('revoked', [])])
            expect(current.application.current().automation.evidence[0]?.target).toEqual(target)
            expect(current.application.current().automation.evidence[0]?.[stage]).toMatchObject({
              status: 'launch-failed',
              admission,
            })
            current.source.push([sourceProject])
            await vi.waitFor(() =>
              expect(current.application.current().configurationVersion).toBe(4),
            )
            expect(
              await current.application.execute({
                type: 'start-automation-override',
                expectedConfigurationVersion: 4,
                target,
                stage,
              }),
            ).toMatchObject({ ok: false })
            expect(database.events().filter((event) => event.type === startType)).toHaveLength(1)
            expect(launches.classifications).toEqual([])
            expect(launches.dispatches).toEqual([])
          } finally {
            gate.release()
            const stopping = current.application.stop()
            launches.settleSessions()
            await stopping
          }
          const restartedLaunches = deferredLauncher()
          const restarted = await harness({
            projects: [sourceProject],
            launcher: restartedLaunches.launcher,
            database,
          })
          try {
            expect(restartedLaunches.classifications).toEqual([])
            expect(restartedLaunches.dispatches).toEqual([])
          } finally {
            const stopping = restarted.application.stop()
            restartedLaunches.settleSessions()
            await stopping
          }
        },
      )
    }
  }

  for (const stage of ['classification', 'wayfinder'] as const) {
    it.each(['rename', 'unrelated source', 'override enablement'])(
      `admits deferred ${stage} after observation-neutral %s`,
      async (change) => {
        const sourceProject = project('neutral', [ticket('1')])
        const unrelated = project('unrelated', [])
        const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
        const gate = appendGate(
          stage === 'classification' ? 'classification-started' : 'wayfinder-launching',
        )
        const database = memoryAutomationDatabase(
          stage === 'wayfinder' ? queuedDatabase([target]) : undefined,
          { beforeAppend: gate.beforeAppend },
        )
        const launches = deferredLauncher()
        const disabled = configuration([sourceProject, unrelated], { enabled: false })
        const current = await harness({
          projects: [sourceProject, unrelated],
          launcher: launches.launcher,
          database,
          configuration: disabled,
        })
        try {
          expect(current.application.current().automation.overrides).toContainEqual(
            expect.objectContaining({ target, [stage]: { status: 'eligible' } }),
          )
          const pending = current.application.execute({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target,
            stage,
          })
          await gate.waitForEntry()
          expect(launches.classifications).toEqual([])
          expect(launches.dispatches).toEqual([])
          if (change === 'unrelated source')
            current.source.push([sourceProject, project('unrelated', [ticket('2')])])
          else
            current.configured.emit({
              ...disabled,
              configurationVersion: 2,
              connections:
                change === 'rename'
                  ? disabled.connections.map((entry) => ({ ...entry, name: 'Renamed Local' }))
                  : disabled.connections,
              automation:
                change === 'override enablement'
                  ? { ...disabled.automation, enabled: true }
                  : disabled.automation,
            })
          gate.release()
          expect(await pending).toMatchObject({ ok: true })
          const requests =
            stage === 'classification'
              ? launches.classifications.map((entry) => entry.request)
              : launches.dispatches
          expect(requests).toHaveLength(1)
          expect(requests[0]?.environment.ROADMAP_TICKET_ID).toBe('1')
          expect(
            database
              .events()
              .some(
                (event) =>
                  event.type ===
                  (stage === 'classification'
                    ? 'classification-launch-failed'
                    : 'wayfinder-launch-failed'),
              ),
          ).toBe(false)
        } finally {
          gate.release()
          const stopping = current.application.stop()
          launches.settleSessions()
          await stopping
        }
      },
    )

    it.each(['automatic', 'override'] as const)(
      `admits deferred ${stage} for a retained GitHub target after an unrelated Local source read with %s admission`,
      async (admission) => {
        const sourceProject = githubProject('remote-neutral', [ticket('1')])
        const unrelated = project('local-neutral', [])
        const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
        const startType =
          stage === 'classification' ? 'classification-started' : 'wayfinder-launching'
        const gate = appendGate(startType)
        const database = memoryAutomationDatabase(
          stage === 'wayfinder' ? queuedDatabase([target]) : undefined,
          { beforeAppend: gate.beforeAppend },
        )
        const launches = deferredLauncher()
        const disabled = configuration([sourceProject, unrelated], {
          enabled: false,
          enabledProjects: [sourceProject.key],
        })
        const current = await harness({
          projects: [sourceProject, unrelated],
          launcher: launches.launcher,
          database,
          configuration: disabled,
        })
        try {
          expect(current.application.current().automation.overrides).toContainEqual(
            expect.objectContaining({ target, [stage]: { status: 'eligible' } }),
          )
          const pending =
            admission === 'override'
              ? current.application.execute({
                  type: 'start-automation-override',
                  expectedConfigurationVersion: 1,
                  target,
                  stage,
                })
              : null
          if (admission === 'automatic')
            current.configured.emit({
              ...disabled,
              configurationVersion: 2,
              automation: { ...disabled.automation, enabled: true },
            })
          await gate.waitForEntry()
          const githubResource = current.application
            .current()
            .projects.find((entry) => entry.key.integration === 'github')
          const retainedObservedAt =
            githubResource && publicProjectObservation(githubResource)?.observedAt
          expect(retainedObservedAt).toBe(100)
          expect(launches.classifications).toEqual([])
          expect(launches.dispatches).toEqual([])
          current.source.pushProject(project('local-neutral', [ticket('2')]))
          const stillRetained = current.application
            .current()
            .projects.find((entry) => entry.key.integration === 'github')
          expect(stillRetained && publicProjectObservation(stillRetained)?.observedAt).toBe(
            retainedObservedAt,
          )
          gate.release()
          if (pending) expect(await pending).toMatchObject({ ok: true })
          const requests = () =>
            stage === 'classification'
              ? launches.classifications.map((entry) => entry.request)
              : launches.dispatches
          await vi.waitFor(() => expect(requests()).toHaveLength(1))
          expect(requests()[0]?.environment.ROADMAP_TICKET_ID).toBe('1')
          expect(database.events().filter((event) => event.type === startType)).toHaveLength(1)
          expect(
            database
              .events()
              .some(
                (event) =>
                  event.type ===
                  (stage === 'classification'
                    ? 'classification-launch-failed'
                    : 'wayfinder-launch-failed'),
              ),
          ).toBe(false)
          expect(launches.maximumRunning()).toBe(stage === 'classification' ? 1 : 0)
        } finally {
          gate.release()
          const stopping = current.application.stop()
          launches.settleSessions()
          await stopping
        }
      },
    )

    it.each(['start', 'nonlaunch'])(
      `launches nothing when ${stage} %s append fails without erasing durable truth`,
      async (failedAppend) => {
        const sourceProject = project('append-failure', [ticket('1')])
        const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
        const startType =
          stage === 'classification' ? 'classification-started' : 'wayfinder-launching'
        const failureType =
          stage === 'classification' ? 'classification-launch-failed' : 'wayfinder-launch-failed'
        const gate = appendGate(startType)
        const database = memoryAutomationDatabase(
          stage === 'wayfinder' ? queuedDatabase([target]) : undefined,
          {
            beforeAppend: gate.beforeAppend,
            failAppend: (batch) =>
              batch.events.some(
                (event) => event.type === (failedAppend === 'start' ? startType : failureType),
              ),
          },
        )
        const launches = deferredLauncher()
        const current = await harness({
          projects: [sourceProject],
          launcher: launches.launcher,
          database,
          configuration: configuration([sourceProject], { enabled: false }),
        })
        try {
          expect(current.application.current().automation.overrides).toContainEqual(
            expect.objectContaining({ target, [stage]: { status: 'eligible' } }),
          )
          const pending = current.application.execute({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target,
            stage,
          })
          await gate.waitForEntry()
          if (failedAppend === 'nonlaunch')
            current.source.push([
              project('append-failure', [ticket('1', TASK, { isClaimed: true, state: 'claimed' })]),
            ])
          gate.release()
          expect(await pending).toMatchObject({ ok: false, error: { code: 'persistence-failed' } })
          expect(launches.classifications).toEqual([])
          expect(launches.dispatches).toEqual([])
          expect(database.events().some((event) => event.type === startType)).toBe(
            failedAppend === 'nonlaunch',
          )
          expect(database.events().some((event) => event.type === failureType)).toBe(false)
          if (failedAppend === 'nonlaunch')
            expect(database.evidence()[0]).toMatchObject(
              stage === 'classification'
                ? { classification: { status: 'running', admission: 'override' } }
                : { wayfinder: { status: 'launching', admission: 'override' } },
            )
          expect(current.application.current().automation.evidence).toEqual(database.evidence())
          current.source.push([sourceProject])
          expect(
            await current.application.execute({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target,
              stage,
            }),
          ).toMatchObject({ ok: false })
          expect(launches.classifications).toEqual([])
          expect(launches.dispatches).toEqual([])
        } finally {
          gate.release()
          const stopping = current.application.stop()
          launches.settleSessions()
          await stopping
        }
      },
    )
  }

  it.each([false, true])(
    'waits for the exact interruption acknowledgement before enablement persistence, failure=%s',
    async (fail) => {
      const sourceProject = project('ack-order', [ticket('1')])
      const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
      const initial = appendAutomationDatabase(queuedDatabase([target]), {
        events: [
          {
            ...storedEvent('launch', 'opportunity-0'),
            type: 'wayfinder-launching',
            admission: 'automatic',
          },
          {
            ...storedEvent('exact-unknown', 'opportunity-0'),
            type: 'wayfinder-outcome-unknown',
            reason: 'Stopped.',
          },
        ],
      })
      const gate = appendGate('wayfinder-outcome-unknown-acknowledged')
      const database = memoryAutomationDatabase(initial, {
        beforeAppend: gate.beforeAppend,
        failAppend: (batch) =>
          fail &&
          batch.events.some((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
      })
      const launches = deferredLauncher()
      const current = await harness({
        projects: [sourceProject],
        launcher: launches.launcher,
        database,
        configuration: configuration([sourceProject], { enabledProjects: [] }),
      })
      try {
        const pending = current.application.execute({
          type: 'set-project-automation-enabled',
          expectedConfigurationVersion: 1,
          project: sourceProject.key,
          enabled: true,
        })
        await gate.waitForEntry()
        expect(current.configured.writes).toEqual([])
        expect(database.evidence()[0]?.wayfinder).toMatchObject({
          status: 'outcome-unknown',
          acknowledged: false,
        })
        expect(launches.dispatches).toEqual([])
        gate.release()
        expect(await pending).toMatchObject({ ok: !fail })
        expect(current.configured.writes).toHaveLength(fail ? 0 : 1)
        expect(database.evidence()[0]?.wayfinder).toMatchObject({
          status: 'outcome-unknown',
          acknowledged: !fail,
        })
        expect(current.application.current().automation.evidence).toEqual(database.evidence())
        if (!fail)
          expect(
            database
              .events()
              .find((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
          ).toMatchObject({ unknownEventId: 'exact-unknown' })
        expect(launches.classifications).toEqual([])
        expect(launches.dispatches).toEqual([])
      } finally {
        gate.release()
        const stopping = current.application.stop()
        launches.settleSessions()
        await stopping
      }
    },
  )

  it('records known Classification nonlaunch when stop closes admission during its durable append', async () => {
    const sourceProject = project('stop-race', [ticket('1')])
    const gate = appendGate('classification-started')
    const database = memoryAutomationDatabase(undefined, { beforeAppend: gate.beforeAppend })
    const launches = deferredLauncher()
    const disabled = configuration([sourceProject], { enabled: false })
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
      configuration: disabled,
    })
    try {
      current.configured.emit({
        ...disabled,
        configurationVersion: 2,
        automation: { ...disabled.automation, enabled: true },
      })
      await gate.waitForEntry()
      const stopping = current.application.stop()
      gate.release()
      await stopping
      expect(launches.classifications).toEqual([])
      expect(database.events().map((event) => event.type)).toEqual([
        'classification-started',
        'classification-launch-failed',
      ])
      expect(database.evidence()[0]?.classification).toMatchObject({
        status: 'launch-failed',
        admission: 'automatic',
      })
    } finally {
      gate.release()
      const stopping = current.application.stop()
      launches.settleSessions()
      await stopping
    }
  })
})

describe('RoadmapApplication Automation', () => {
  it('recovers interrupted Sessions before leaving other Projects running on startup', async () => {
    const interrupted = project('restart', [ticket('1')])
    const unaffected = project('unaffected', [ticket('2')])
    const targets = [
      { project: interrupted.key, mapId: 'map', ticketId: '1' },
      { project: unaffected.key, mapId: 'map', ticketId: '2' },
    ]
    const active = appendAutomationDatabase(queuedDatabase(targets), {
      events: [
        {
          ...storedEvent('wayfinder-launching', 'opportunity-0'),
          type: 'wayfinder-launching',
          admission: 'override',
        },
        {
          ...storedEvent('wayfinder-running', 'opportunity-0'),
          type: 'wayfinder-running',
        },
      ],
    })
    const database = memoryAutomationDatabase(active)
    const launches = deferredLauncher()
    const current = await harness({
      projects: [interrupted, unaffected],
      launcher: launches.launcher,
      database,
    })

    expect(database.evidence()[0]?.wayfinder).toMatchObject({
      status: 'outcome-unknown',
      admission: 'override',
      reason: expect.stringContaining('restarted'),
    })
    expect(current.configured.writes[0]?.automation.enabledProjects).toEqual([unaffected.key])
    expect(launches.dispatches).toHaveLength(1)
    expect(launches.dispatches[0]?.environment.ROADMAP_TICKET_ID).toBe('2')
    await current.application.stop()
  })

  it('records a running Session as interrupted and disables its Project on graceful stop', async () => {
    const sourceProject = project('stopping', [ticket('1')])
    const database = memoryAutomationDatabase(
      queuedDatabase([{ project: sourceProject.key, mapId: 'map', ticketId: '1' }]),
    )
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
    })
    await vi.waitFor(() => expect(database.evidence()[0]?.wayfinder?.status).toBe('running'))

    await current.application.stop()

    expect(database.evidence()[0]?.wayfinder).toMatchObject({
      status: 'outcome-unknown',
      reason: expect.stringContaining('stopped'),
    })
    expect(current.configured.writes.at(-1)?.automation.enabledProjects).toEqual([])
  })

  it('records a still-launching Session as interrupted without waiting for launch', async () => {
    const sourceProject = project('launching-stop', [ticket('1')])
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
    const database = memoryAutomationDatabase(queuedDatabase([target]))
    const gate = Promise.withResolvers<void>()
    const launches = deferredLauncher({ dispatchGate: gate.promise })
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
    })
    expect(database.evidence()[0]?.wayfinder?.status).toBe('launching')

    await current.application.stop()

    expect(database.evidence()[0]?.wayfinder).toMatchObject({
      status: 'outcome-unknown',
      reason: expect.stringContaining('stopped'),
    })
    expect(current.configured.writes.at(-1)?.automation.enabledProjects).toEqual([])
    gate.resolve()
  })

  it('acknowledges the exact interruption before re-enabling and resuming queued work', async () => {
    const sourceProject = project('resume', [ticket('1'), ticket('2')])
    const targets = ['1', '2'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: 'map',
      ticketId,
    }))
    const unknown = {
      ...storedEvent('unknown', 'opportunity-0'),
      type: 'wayfinder-outcome-unknown',
      reason: 'Roadmap stopped.',
    } satisfies AutomationEvent
    const interrupted = appendAutomationDatabase(queuedDatabase(targets), {
      events: [
        {
          ...storedEvent('wayfinder-launching', 'opportunity-0'),
          type: 'wayfinder-launching',
          admission: 'automatic',
        },
        unknown,
      ],
    })
    const database = memoryAutomationDatabase(interrupted)
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
      configuration: configuration([sourceProject], { enabledProjects: [] }),
    })
    expect(current.application.current().automation.enabledProjects).toEqual([])
    expect(
      current.application
        .current()
        .automation.evidence.find((entry) => entry.target.ticketId === '1')?.wayfinder,
    ).toMatchObject({
      status: 'outcome-unknown',
      admission: 'automatic',
      acknowledged: false,
    })

    const blocked = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target: { project: sourceProject.key, mapId: 'map', ticketId: '2' },
      stage: 'wayfinder',
    })
    expect(blocked).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('must be acknowledged') },
    })

    const enabled = await current.application.execute({
      type: 'set-project-automation-enabled',
      expectedConfigurationVersion: 1,
      project: sourceProject.key,
      enabled: true,
    })

    expect(enabled).toMatchObject({ ok: true, result: { configurationVersion: 2 } })
    expect(
      database.events().find((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
    ).toMatchObject({ opportunityId: 'opportunity-0', unknownEventId: unknown.id })
    expect(
      current.application
        .current()
        .automation.evidence.find((entry) => entry.target.ticketId === '1')?.wayfinder,
    ).toMatchObject({ status: 'outcome-unknown', acknowledged: true })
    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    expect(launches.dispatches[0]?.environment.ROADMAP_TICKET_ID).toBe('2')
    await current.application.stop()
  })

  it('requires a new exact acknowledgement when a later Session becomes unknown after an earlier acknowledgement', async () => {
    const sourceProject = project('newer-unknown', [ticket('1'), ticket('2'), ticket('3')])
    const targets = ['1', '2', '3'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: 'map',
      ticketId,
    }))
    const initial = appendAutomationDatabase(queuedDatabase(targets), {
      events: [
        {
          ...storedEvent('first-launch', 'opportunity-0'),
          type: 'wayfinder-launching',
          admission: 'automatic',
        },
        {
          ...storedEvent('first-unknown', 'opportunity-0'),
          type: 'wayfinder-outcome-unknown',
          reason: 'Stopped.',
        },
      ],
    })
    const database = memoryAutomationDatabase(initial)
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
      configuration: configuration([sourceProject], { enabledProjects: [] }),
    })
    try {
      expect(
        await current.application.execute({
          type: 'set-project-automation-enabled',
          expectedConfigurationVersion: 1,
          project: sourceProject.key,
          enabled: true,
        }),
      ).toMatchObject({ ok: true })
      await vi.waitFor(() =>
        expect(
          database.evidence().filter((entry) => entry.wayfinder?.status === 'running'),
        ).toHaveLength(1),
      )
      const running = database.evidence().find((entry) => entry.wayfinder?.status === 'running')
      const queued = database.evidence().find((entry) => entry.wayfinder?.status === 'queued')
      if (!running || !queued) throw new Error('Expected one running and one queued Session.')
      const runningOpportunity = initial.opportunities.find(
        (entry) => entry.target.ticketId === running.target.ticketId,
      )
      if (!runningOpportunity) throw new Error('The running Session must have an opportunity.')
      expect(['2', '3']).toContain(running.target.ticketId)
      expect(['2', '3']).toContain(queued.target.ticketId)
      expect(launches.dispatches.map((request) => request.environment.ROADMAP_TICKET_ID)).toEqual([
        running.target.ticketId,
      ])
      launches.sessions[0]?.reject(new Error('The second Session result was lost.'))
      await vi.waitFor(() =>
        expect(current.application.current().automation.enabledProjects).toEqual([]),
      )
      expect(
        current.application
          .current()
          .automation.evidence.find((entry) => entry.target.ticketId === '1')?.wayfinder,
      ).toMatchObject({ status: 'outcome-unknown', acknowledged: true })
      expect(
        current.application
          .current()
          .automation.evidence.find((entry) => entry.target.ticketId === running.target.ticketId)
          ?.wayfinder,
      ).toMatchObject({ status: 'outcome-unknown', acknowledged: false })
      const secondUnknown = database
        .events()
        .find(
          (event) =>
            event.type === 'wayfinder-outcome-unknown' &&
            event.opportunityId === runningOpportunity.id,
        )
      if (!secondUnknown) throw new Error('The lost Session must have durable unknown evidence.')
      expect(
        database
          .events()
          .filter((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
      ).toMatchObject([{ unknownEventId: 'first-unknown' }])
      const version = current.application.current().configurationVersion
      expect(
        await current.application.execute({
          type: 'start-automation-override',
          expectedConfigurationVersion: version,
          target: queued.target,
          stage: 'wayfinder',
        }),
      ).toMatchObject({ ok: false, error: { code: 'validation' } })
      expect(launches.dispatches).toHaveLength(1)
      expect(
        await current.application.execute({
          type: 'set-project-automation-enabled',
          expectedConfigurationVersion: version,
          project: sourceProject.key,
          enabled: true,
        }),
      ).toMatchObject({ ok: true })
      expect(
        database
          .events()
          .filter((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
      ).toMatchObject([
        { opportunityId: 'opportunity-0', unknownEventId: 'first-unknown' },
        { opportunityId: runningOpportunity.id, unknownEventId: secondUnknown.id },
      ])
      await vi.waitFor(() =>
        expect(
          launches.dispatches.map((request) => request.environment.ROADMAP_TICKET_ID).sort(),
        ).toEqual(['2', '3']),
      )
      expect(
        database.evidence().filter((entry) => entry.wayfinder?.status === 'running'),
      ).toHaveLength(1)
      expect(launches.classifications).toEqual([])
    } finally {
      await current.application.stop()
    }
  })

  it('does not re-enable when the interruption acknowledgement cannot persist', async () => {
    const sourceProject = project('ack-failure', [ticket('1')])
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
    const unknown = {
      ...storedEvent('unknown', 'opportunity-0'),
      type: 'wayfinder-outcome-unknown',
      reason: 'Roadmap stopped.',
    } satisfies AutomationEvent
    const interrupted = appendAutomationDatabase(queuedDatabase([target]), {
      events: [
        {
          ...storedEvent('wayfinder-launching', 'opportunity-0'),
          type: 'wayfinder-launching',
          admission: 'automatic',
        },
        unknown,
      ],
    })
    const database = memoryAutomationDatabase(interrupted, {
      failAppend: (batch) =>
        batch.events.some((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
    })
    const current = await harness({
      projects: [sourceProject],
      launcher: deferredLauncher().launcher,
      database,
      configuration: configuration([sourceProject], { enabledProjects: [] }),
    })

    const enabled = await current.application.execute({
      type: 'set-project-automation-enabled',
      expectedConfigurationVersion: 1,
      project: sourceProject.key,
      enabled: true,
    })

    expect(enabled).toMatchObject({ ok: false, error: { code: 'persistence-failed' } })
    expect(current.configured.writes).toEqual([])
    expect(current.application.current().automation.enabledProjects).toEqual([])
    await current.application.stop()
  })

  it('keeps queued work stopped when Project re-enable persistence fails after acknowledgement', async () => {
    const sourceProject = project('config-failure', [ticket('1'), ticket('2')])
    const targets = ['1', '2'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: 'map',
      ticketId,
    }))
    const unknown = {
      ...storedEvent('unknown', 'opportunity-0'),
      type: 'wayfinder-outcome-unknown',
      reason: 'Roadmap stopped.',
    } satisfies AutomationEvent
    const database = memoryAutomationDatabase(
      appendAutomationDatabase(queuedDatabase(targets), {
        events: [
          {
            ...storedEvent('wayfinder-launching', 'opportunity-0'),
            type: 'wayfinder-launching',
            admission: 'automatic',
          },
          unknown,
        ],
      }),
    )
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
      configuration: configuration([sourceProject], { enabledProjects: [] }),
      configurationWriteResult: { ok: false, kind: 'persistence', message: 'Disk is read-only.' },
    })

    const enabled = await current.application.execute({
      type: 'set-project-automation-enabled',
      expectedConfigurationVersion: 1,
      project: sourceProject.key,
      enabled: true,
    })

    expect(enabled).toMatchObject({ ok: false, error: { code: 'persistence-failed' } })
    expect(
      database.events().find((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
    ).toMatchObject({ unknownEventId: unknown.id })
    expect(
      current.application
        .current()
        .automation.evidence.find((entry) => entry.target.ticketId === '1')?.wayfinder,
    ).toMatchObject({
      status: 'outcome-unknown',
      acknowledged: true,
    })
    expect(current.application.current().automation.evidence).toEqual(database.evidence())
    expect(launches.dispatches).toEqual([])
    expect(current.application.current().automation.enabledProjects).toEqual([])
    await current.application.stop()
  })

  it('runs one Wayfinder Session per Project and releases the lane on completion', async () => {
    const sourceProject = project('serialized', [ticket('1'), ticket('2')])
    const targets = ['1', '2'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: 'map',
      ticketId,
    }))
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: memoryAutomationDatabase(queuedDatabase(targets)),
    })

    expect(launches.sessions).toHaveLength(1)
    expect(
      current.application
        .current()
        .automation.overrides.find((control) => control.target.ticketId === '2')?.wayfinder,
    ).toEqual({
      status: 'ineligible',
      reason: 'Another Wayfinder Session is in progress for this Project.',
    })

    launches.sessions[0]?.resolve(wayfinderResult())
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(2))
    expect(
      current.application
        .current()
        .automation.evidence.find((evidence) => evidence.target.ticketId === '2')?.wayfinder,
    ).toMatchObject({ status: 'running' })

    launches.sessions[1]?.resolve(wayfinderResult())
    await vi.waitFor(() =>
      expect(
        current.application.current().automation.evidence.map((evidence) => evidence.wayfinder),
      ).toEqual([
        expect.objectContaining({ status: 'finished' }),
        expect.objectContaining({ status: 'finished' }),
      ]),
    )
    await current.application.stop()
  })

  it('runs Wayfinder Sessions for different Projects concurrently', async () => {
    const projects = [project('one', [ticket('1')]), project('two', [ticket('2')])]
    const targets = projects.map((entry, index) => ({
      project: entry.key,
      mapId: 'map',
      ticketId: String(index + 1),
    }))
    const launches = deferredLauncher()
    const current = await harness({
      projects,
      launcher: launches.launcher,
      database: memoryAutomationDatabase(queuedDatabase(targets)),
    })

    expect(launches.sessions).toHaveLength(2)
    await vi.waitFor(() =>
      expect(
        current.application.current().automation.evidence.map((evidence) => evidence.wayfinder),
      ).toEqual([
        expect.objectContaining({ status: 'running' }),
        expect.objectContaining({ status: 'running' }),
      ]),
    )

    for (const session of launches.sessions) session.resolve(wayfinderResult())
    await current.application.stop()
  })

  it('retains a disabled queued Session and revalidates it on configuration and snapshots', async () => {
    const sourceProject = project('gated', [ticket('1')])
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
    const launches = deferredLauncher()
    const disabled = configuration([sourceProject], { enabledProjects: [] })
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: memoryAutomationDatabase(queuedDatabase([target])),
      configuration: disabled,
    })

    expect(launches.sessions).toHaveLength(0)
    expect(current.database.events().map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
    ])

    current.source.push([
      project('gated', [ticket('1', TASK, { state: 'claimed', isClaimed: true })]),
    ])
    current.configured.emit({
      ...disabled,
      configurationVersion: 2,
      automation: { ...disabled.automation, enabledProjects: [sourceProject.key] },
    })
    await vi.waitFor(() => expect(current.application.current().configurationVersion).toBe(2))
    await delay(10)
    expect(launches.sessions).toHaveLength(0)
    expect(current.database.events().map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
    ])

    current.source.push([sourceProject])
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))
    launches.sessions[0]?.resolve(wayfinderResult())
    await current.application.stop()
  })

  it('persists each attempt before launch and never repeats the same ticket identity', async () => {
    const sourceProject = project('one', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher({
      beforeClassify() {
        expect(database.evidence()).toEqual([
          expect.objectContaining({
            classification: { status: 'running', admission: 'automatic' },
          }),
        ])
        expect(database.events().map((event) => event.type)).toEqual(['classification-started'])
      },
      beforeDispatch() {
        expect(database.evidence()[0]?.wayfinder).toEqual({
          status: 'launching',
          admission: 'automatic',
        })
        expect(database.events().map((event) => event.type)).toEqual([
          'classification-started',
          'classification-completed',
          'wayfinder-launching',
        ])
      },
    })
    const first = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })

    expect(launches.classifications).toHaveLength(1)
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toEqual({
        status: 'running',
        admission: 'automatic',
      }),
    )
    expect(database.events().map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
      'wayfinder-launching',
      'wayfinder-running',
    ])

    first.source.push([project('one', [ticket('1', TASK, { body: 'Edited body.' })])])
    first.source.push([project('one', [])])
    first.source.push([project('one', [ticket('1')])])
    first.configured.emit({
      ...configuration([sourceProject]),
      configurationVersion: 2,
      automation: {
        ...configuration([sourceProject]).automation,
        classificationCommand: { ...COMMAND, args: ['-e', 'process.exit(0)'] },
      },
    })
    await delay(20)
    expect(launches.classifications).toHaveLength(1)
    expect(launches.dispatches).toHaveLength(1)
    await first.application.stop()

    const restartedLaunches = deferredLauncher()
    const restarted = await harness({
      projects: [sourceProject],
      launcher: restartedLaunches.launcher,
      database: database,
    })
    expect(restartedLaunches.classifications).toHaveLength(0)
    expect(restartedLaunches.dispatches).toHaveLength(0)
    expect(database.events().map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
      'wayfinder-launching',
      'wayfinder-running',
      'wayfinder-outcome-unknown',
    ])
    await restarted.application.stop()
  })

  it('inspects current frontier immediately when Automation becomes enabled', async () => {
    const sourceProject = project('one', [ticket('1')])
    const disabled = configuration([sourceProject], { enabled: false })
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: disabled,
    })
    expect(launches.classifications).toHaveLength(0)

    current.configured.emit({
      ...disabled,
      configurationVersion: 2,
      automation: { ...disabled.automation, enabled: true },
    })

    await vi.waitFor(() => expect(launches.classifications).toHaveLength(1))
    await current.application.stop()
  })
  it('runs each eligible stage once without changing Automation enablement', async () => {
    const sourceProject = project('override', [ticket('1'), ticket('2')])
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: configuration([sourceProject], { enabled: false, enabledProjects: [] }),
    })
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }

    expect(current.application.current().automation.overrides).toContainEqual({
      target,
      classification: { status: 'eligible' },
      wayfinder: { status: 'ineligible', reason: 'Run Classification first.' },
    })
    const classification = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target,
      stage: 'classification',
    })
    expect(classification).toMatchObject({
      ok: true,
      result: { type: 'automation-override-started', target, stage: 'classification' },
      state: { automation: { enabled: false, enabledProjects: [] } },
    })
    expect(launches.classifications).toHaveLength(1)
    expect(current.database.evidence()[0]?.classification).toEqual({
      status: 'running',
      admission: 'override',
    })
    expect(
      current.application
        .current()
        .automation.overrides.find((control) => control.target.ticketId === '2')?.classification,
    ).toEqual({ status: 'ineligible', reason: 'Another Classification Run is in progress.' })

    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() =>
      expect(current.application.current().automation.overrides[0]?.wayfinder).toEqual({
        status: 'eligible',
      }),
    )
    expect(launches.dispatches).toHaveLength(0)
    expect(current.application.current().automation.overrides[0]?.classification).toEqual({
      status: 'ineligible',
      reason: 'This Automation opportunity has already been classified.',
    })

    const wayfinder = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target,
      stage: 'wayfinder',
    })
    expect(wayfinder).toMatchObject({
      ok: true,
      result: { type: 'automation-override-started', target, stage: 'wayfinder' },
    })
    await vi.waitFor(() =>
      expect(current.database.evidence()[0]?.wayfinder).toEqual({
        status: 'running',
        admission: 'override',
      }),
    )
    expect(launches.dispatches).toHaveLength(1)
    expect(current.application.current().automation.overrides[0]?.wayfinder).toEqual({
      status: 'ineligible',
      reason: 'A Wayfinder Session is already recorded for this opportunity.',
    })

    launches.sessions[0]?.resolve(wayfinderResult())
    await current.application.stop()
  })

  it('keeps automatic handoff gated by effective enablement after an override Classification', async () => {
    const sourceProject = project('override-handoff', [ticket('1')])
    const launches = deferredLauncher()
    const disabled = configuration([sourceProject], { enabled: false, enabledProjects: [] })
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: disabled,
    })
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }

    await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target,
      stage: 'classification',
    })
    current.configured.emit({
      ...disabled,
      configurationVersion: 2,
      automation: { ...disabled.automation, enabled: true, enabledProjects: [sourceProject.key] },
    })
    launches.classifications[0]?.resolve(processResult())

    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    await vi.waitFor(() =>
      expect(current.database.evidence()[0]?.wayfinder).toEqual({
        status: 'running',
        admission: 'automatic',
      }),
    )
    launches.sessions[0]?.resolve(wayfinderResult())
    await current.application.stop()
  })
  it('requires an AFK Verdict before a Wayfinder override', async () => {
    const sourceProject = project('override-hitl', [ticket('1')])
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
    const database = memoryAutomationDatabase({
      schemaVersion: 3,
      opportunities: [{ id: 'opportunity', target }],
      events: [
        {
          ...storedEvent('classification-started'),
          type: 'classification-started',
          admission: 'override',
        },
        {
          ...storedEvent('classification-completed'),
          type: 'classification-completed',
          processResult: { status: 'exited', code: 0 },
          verdict: { value: 'hitl', reason: 'Human judgment is required.' },
        },
      ],
    })
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
      configuration: configuration([sourceProject], { enabled: false, enabledProjects: [] }),
    })

    expect(current.application.current().automation.overrides[0]?.wayfinder).toEqual({
      status: 'ineligible',
      reason: 'Classification did not produce an AFK Verdict.',
    })
    const rejected = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target,
      stage: 'wayfinder',
    })
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Classification did not produce an AFK Verdict.' },
    })
    expect(launches.dispatches).toHaveLength(0)
    await current.application.stop()
  })

  it('rejects a claimed ticket override without recording or launching an attempt', async () => {
    const sourceProject = project('override-eligibility', [
      ticket('claimed', TASK, { state: 'claimed', isClaimed: true }),
    ])
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: configuration([sourceProject], { enabled: false, enabledProjects: [] }),
    })
    const rejected = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target: { project: sourceProject.key, mapId: 'map', ticketId: 'claimed' },
      stage: 'classification',
    })
    expect(rejected).toMatchObject({ ok: false, error: { code: 'validation' } })
    expect(current.database.events()).toEqual([])
    expect(launches.classifications).toHaveLength(0)
    await current.application.stop()
  })

  it('fails closed for missing commands, non-task types, and incomplete source facts', async () => {
    const research = project('research', [
      ticket('1', { kind: 'recognized', value: 'research', labels: ['research'] }),
    ])
    const conflicting = project('conflicting', [
      ticket('2', { kind: 'conflicting', labels: ['research', 'task'] }),
    ])
    const incompleteTickets = project('tickets', [ticket('3')])
    incompleteTickets.openMaps[0] = map(
      incompleteTickets.key,
      incompleteTickets.openMaps[0]?.tickets ?? [],
      {
        ticketsComplete: false,
      },
    )
    const incompleteBlockers = project('blockers', [ticket('4', TASK, { blockersComplete: false })])
    const projects = [research, conflicting, incompleteTickets, incompleteBlockers]
    const launches = deferredLauncher()
    const current = await harness({ projects, launcher: launches.launcher })

    expect(launches.classifications).toHaveLength(0)
    await current.application.stop()

    const taskProject = project('missing-command', [ticket('5')])
    const missingCommand = await harness({
      projects: [taskProject],
      launcher: launches.launcher,
      configuration: configuration([taskProject], { wayfinderCommand: undefined }),
    })
    expect(launches.classifications).toHaveLength(0)
    await missingCommand.application.stop()
  })

  it.each([
    [
      'hitl',
      processResult({
        stdout: JSON.stringify({ schemaVersion: 1, verdict: 'hitl', reason: 'Human.' }),
      }),
    ],
    [
      'unable',
      processResult({
        stdout: JSON.stringify({ schemaVersion: 1, verdict: 'unable', reason: 'Unknown.' }),
      }),
    ],
    ['malformed output', processResult({ stdout: '{bad-json' })],
    ['nonzero exit', processResult({ code: 7 })],
    [
      'launch failure',
      {
        status: 'launch-failed',
        reason: 'The command was not found.',
      } satisfies ClassificationProcessResult,
    ],
  ])('records %s as terminal without dispatch or retry', async (_name, result) => {
    const sourceProject = project('one', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.resolve(result)

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.classification.status).not.toBe('running'),
    )
    expect(launches.dispatches).toHaveLength(0)
    current.source.push([sourceProject])
    await delay(10)
    expect(launches.classifications).toHaveLength(1)
    await current.application.stop()
  })

  it('treats a lost Classification process as terminal', async () => {
    const sourceProject = project('one', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.reject(new Error('lost'))

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.classification.status).toBe('outcome-unknown'),
    )
    expect(launches.dispatches).toHaveLength(0)
    await current.application.stop()
  })

  it('records a failed session launch before moving to the next classifier', async () => {
    const projects = [project('one', [ticket('1')]), project('two', [ticket('2')])]
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher({ dispatchError: new Error('missing') })
    const current = await harness({ projects, launcher: launches.launcher, database })
    launches.classifications[0]?.resolve(processResult())

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toMatchObject({
        status: 'launch-failed',
        admission: 'automatic',
      }),
    )
    await vi.waitFor(() => expect(launches.classifications).toHaveLength(2))
    expect(launches.maximumRunning()).toBe(1)
    await current.application.stop()
  })

  it('persists independent Process result and Session report facts on completion', async () => {
    const sourceProject = project('one', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))
    await vi.waitFor(() => expect(database.evidence()[0]?.wayfinder?.status).toBe('running'))

    launches.sessions[0]?.resolve(wayfinderResult({ code: 7 }))

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toEqual({
        status: 'finished',
        admission: 'automatic',
        processResult: { status: 'exited', code: 7 },
        report: {
          status: 'received',
          report: { outcome: 'completed', reason: 'Ticket resolved.' },
        },
      }),
    )
    await current.application.stop()
  })

  it.each([
    [
      'missing',
      'missing',
      wayfinderResult({ stdout: '' }),
      'The Wayfinder Session produced no Session report.',
    ],
    [
      'invalid',
      'invalid',
      wayfinderResult({ stdout: '{bad-json' }),
      'Wayfinder Session stdout did not match the current report contract.',
    ],
    [
      'oversized',
      'invalid',
      wayfinderResult({ stdout: '{}', stdoutOversized: true }),
      'Wayfinder Session stdout exceeded 16384 bytes.',
    ],
  ])('records %s Session report evidence', async (_name, status, result, reason) => {
    const sourceProject = project(`report-${_name}`, [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))

    launches.sessions[0]?.resolve(result)

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toMatchObject({
        status: 'finished',
        processResult: { status: 'exited', code: 0 },
        report: { status, reason },
      }),
    )
    await current.application.stop()
  })

  it('records a lost Wayfinder process as outcome unknown', async () => {
    const sourceProject = project('lost-session', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))
    await vi.waitFor(() => expect(database.evidence()[0]?.wayfinder?.status).toBe('running'))

    launches.sessions[0]?.reject(new Error('lost'))

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toMatchObject({
        status: 'outcome-unknown',
        reason: expect.stringContaining('process result was lost'),
      }),
    )
    await vi.waitFor(() =>
      expect(current.application.current().automation.enabledProjects).toEqual([]),
    )
    await current.application.stop()
  })

  it('allows only one global classifier at a time', async () => {
    const projects = [project('one', [ticket('1')]), project('two', [ticket('2')])]
    const launches = deferredLauncher()
    const current = await harness({ projects, launcher: launches.launcher })
    expect(launches.classifications).toHaveLength(1)
    expect(launches.maximumRunning()).toBe(1)

    launches.classifications[0]?.resolve(
      processResult({
        stdout: JSON.stringify({ schemaVersion: 1, verdict: 'hitl', reason: 'Human.' }),
      }),
    )
    await vi.waitFor(() => expect(launches.classifications).toHaveLength(2))
    expect(launches.maximumRunning()).toBe(1)
    await current.application.stop()
  })

  it('renders GitHub source URLs for both Harness Commands in the admitted Workspace', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'roadmap-github-harness-'))
    roots.push(temporaryRoot)
    const workspace = await realpath(temporaryRoot)
    const sourceProject = githubProject('harness-pointers', [ticket('9')])
    const classificationCommand: HarnessCommand = {
      ...COMMAND,
      promptTemplate: 'Classify map={{roadmap.map}} ticket={{roadmap.ticket}}',
    }
    const wayfinderCommand: HarnessCommand = {
      ...COMMAND,
      promptTemplate: 'Run map={{roadmap.map}} ticket={{roadmap.ticket}}',
    }
    const configured = configuration([sourceProject], {
      classificationCommand,
      wayfinderCommand,
    })
    configured.projects = configured.projects.map((entry) => ({
      ...entry,
      workspace: { path: workspace },
    }))
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: configured,
    })

    try {
      expect(current.application.current().projects[0]).toMatchObject({
        key: { integration: 'github', id: 'harness-pointers' },
        connectionId: 'github',
        locator: {
          integration: 'github',
          repositoryId: 'harness-pointers',
          nameWithOwner: 'owner/harness-pointers',
        },
        workspace: { path: workspace },
        resource: { kind: 'current-readable' },
      })
      expect(launches.classifications).toHaveLength(1)
      expect(launches.classifications[0]?.request).toMatchObject({
        command: classificationCommand,
        workspace,
        prompt:
          'Classify map=https://github.com/owner/harness-pointers/issues/100 ticket=https://github.com/owner/harness-pointers/issues/9',
      })

      launches.classifications[0]?.resolve(processResult())
      await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
      expect(launches.dispatches[0]).toMatchObject({
        command: wayfinderCommand,
        workspace,
        prompt:
          'Run map=https://github.com/owner/harness-pointers/issues/100 ticket=https://github.com/owner/harness-pointers/issues/9',
      })
      await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))
      launches.sessions[0]?.resolve(wayfinderResult())

      await vi.waitFor(() =>
        expect(current.application.current().automation.evidence).toEqual([
          expect.objectContaining({
            target: {
              project: { integration: 'github', id: 'harness-pointers' },
              mapId: 'map',
              ticketId: '9',
            },
            classification: {
              status: 'completed',
              admission: 'automatic',
              processResult: { status: 'exited', code: 0 },
              verdict: { value: 'afk', reason: 'Agent-ready.' },
            },
            wayfinder: {
              status: 'finished',
              admission: 'automatic',
              processResult: { status: 'exited', code: 0 },
              report: {
                status: 'received',
                report: { outcome: 'completed', reason: 'Ticket resolved.' },
              },
            },
          }),
        ]),
      )
      expect(current.application.current().automation.evidence).toEqual(current.database.evidence())
    } finally {
      await current.application.stop()
    }
  })

  it('direct-spawns the classifier and detaches a Wayfinder session in the Workspace', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'roadmap-automation-'))
    roots.push(temporaryRoot)
    const root = await realpath(temporaryRoot)
    const outputPath = join(root, 'session.json')
    const classifier: HarnessCommand = {
      command: process.execPath,
      args: [
        '-e',
        `process.stdin.resume(); process.stdout.write(JSON.stringify({schemaVersion:1, verdict:'afk', reason:'Ready.'}))`,
      ],
      promptDelivery: 'stdin',
      promptTemplate:
        'Classify {{roadmap.ticket}} for {{roadmap.map}} with {{roadmap.classificationResultSchema}}.',
    }
    const wayfinder: HarnessCommand = {
      command: process.execPath,
      args: [
        '-e',
        `let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => input += value); process.stdin.on('end', () => { require('node:fs').writeFileSync(process.argv[1], JSON.stringify({cwd:process.cwd(), input, kind:process.env.ROADMAP_RUN_KIND, map:process.env.ROADMAP_MAP_ID, ticket:process.env.ROADMAP_TICKET_ID})); process.stdout.write(JSON.stringify({schemaVersion:1, outcome:'completed', reason:'Ticket resolved.'})) })`,
        outputPath,
      ],
      promptDelivery: 'stdin',
      promptTemplate:
        'Configured map={{roadmap.map}} ticket={{roadmap.ticket}} report={{roadmap.sessionReportSchema}}',
    }
    const sourceProject = project('real', [ticket('9')])
    sourceProject.openMaps[0] = map(sourceProject.key, sourceProject.openMaps[0]?.tickets ?? [], {
      id: '.wayfinder/map.md',
      sourcePath: join(root, '.wayfinder/map.md'),
    })
    const configured = configuration([sourceProject], {
      classificationCommand: classifier,
      wayfinderCommand: wayfinder,
    })
    configured.projects[0] = {
      ref: { integration: 'local', projectId: sourceProject.key.id },
      connectionId: 'local',
      workspace: { path: root },
    }
    const current = await harness({
      projects: [sourceProject],
      launcher: createAutomationLauncher({ stopGraceMs: 10 }),
      configuration: configured,
    })

    let observed = ''
    await vi.waitFor(async () => {
      observed = await readFile(outputPath, 'utf8')
      expect(observed).not.toBe('')
    })
    const session: unknown = JSON.parse(observed)
    expect(session).toMatchObject({
      cwd: root,
      kind: 'wayfinder',
      map: '.wayfinder/map.md',
      ticket: '9',
    })
    expect(isRecord(session) && session.input).toBe(
      `Configured map=${join(root, '.wayfinder/map.md')} ticket=${join(root, '.wayfinder/tickets/9.md')} report=${sessionReportSchemaJson}`,
    )
    await vi.waitFor(() =>
      expect(current.database.evidence()[0]?.wayfinder).toEqual({
        status: 'finished',
        admission: 'automatic',
        processResult: { status: 'exited', code: 0 },
        report: {
          status: 'received',
          report: { outcome: 'completed', reason: 'Ticket resolved.' },
        },
      }),
    )
    await current.application.stop()
  })

  it('advances two queued Sessions for one Project in series with the configured launcher', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'roadmap-automation-series-'))
    roots.push(temporaryRoot)
    const root = await realpath(temporaryRoot)
    const lifecyclePath = join(root, 'sessions.log')
    const lockPath = join(root, 'session.lock')
    const wayfinder: HarnessCommand = {
      command: process.execPath,
      args: [
        '-e',
        `const fs=require('node:fs'); const ticket=process.env.ROADMAP_TICKET_ID; let lock; try { lock=fs.openSync(process.argv[2], 'wx'); } catch { fs.appendFileSync(process.argv[1], 'overlap:'+ticket+'\\n'); } fs.appendFileSync(process.argv[1], 'started:'+ticket+'\\n'); setTimeout(() => { fs.appendFileSync(process.argv[1], 'finished:'+ticket+'\\n'); if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(process.argv[2]); } process.stdout.write(JSON.stringify({schemaVersion:1, outcome:'completed', reason:'Ticket '+ticket+' resolved.'})); }, 100);`,
        lifecyclePath,
        lockPath,
      ],
      promptDelivery: 'stdin',
      promptTemplate: 'Run {{roadmap.ticket}} under {{roadmap.map}}.',
    }
    const sourceProject = project('series', [ticket('1'), ticket('2')])
    sourceProject.openMaps[0] = map(sourceProject.key, sourceProject.openMaps[0]?.tickets ?? [], {
      id: '.wayfinder/map.md',
      sourcePath: join(root, '.wayfinder/map.md'),
    })
    const configured = configuration([sourceProject], { wayfinderCommand: wayfinder })
    configured.projects[0] = {
      ref: { integration: 'local', projectId: sourceProject.key.id },
      connectionId: 'local',
      workspace: { path: root },
    }
    const targets = ['1', '2'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: '.wayfinder/map.md',
      ticketId,
    }))
    const queued = queuedDatabase(targets)
    const databasePath = join(root, 'automation.json')
    const database = createAutomationDatabaseDocument(databasePath)
    await database.load()
    await database.append({ opportunities: queued.opportunities, events: queued.events })
    const source = controlledObservers([sourceProject])
    const configuredDocument = memoryConfiguration(configured)
    const application = createRoadmapApplication({
      configuration: configuredDocument.document,
      automation: {
        database,
        launcher: createAutomationLauncher({ stopGraceMs: 10 }),
      },
      observers: source.observers,
      admissions: admissionFixtures(),
      serverEpoch: 'automation-series-test',
    })

    await application.start()

    await vi.waitFor(
      async () =>
        expect(await readFile(lifecyclePath, 'utf8')).toBe(
          'started:1\nfinished:1\nstarted:2\nfinished:2\n',
        ),
      { timeout: 5_000 },
    )
    await vi.waitFor(() =>
      expect(application.current().automation.evidence.map((entry) => entry.wayfinder)).toEqual([
        expect.objectContaining({ status: 'finished' }),
        expect.objectContaining({ status: 'finished' }),
      ]),
    )
    await application.stop()

    const stored = await createAutomationDatabaseDocument(databasePath).load()
    expect(stored.events.map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
      'classification-started',
      'classification-completed',
      'wayfinder-launching',
      'wayfinder-running',
      'wayfinder-finished',
      'wayfinder-launching',
      'wayfinder-running',
      'wayfinder-finished',
    ])
  })
})
