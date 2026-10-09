import type { ApplicationState, Project, Snapshot, Ticket, WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { ChangeEvent } from '../change-feed.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
} from '../configuration/document.ts'
import type { CredentialBundle } from '../github/connections.ts'
import type { ObservationBatch, SourceObservationHealth } from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import {
  controlledSourceFixture,
  fixtureAdmissions,
  sourceFixture,
} from '../source-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const EMPTY_BATCH: ObservationBatch = { attempts: [] }
const LOCAL_CONNECTION: ProjectConfiguration['connections'][number] = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}
const BASE_CONFIGURATION: ProjectConfiguration = {
  schemaVersion: 6,
  configurationVersion: 1,
  connections: [LOCAL_CONNECTION],
  projects: [
    {
      ref: { integration: 'local', projectId: 'demo' },
      connectionId: 'local',
      workspace: { path: '/tmp/demo' },
    },
  ],
  automation: { enabled: false, enabledProjects: [] },
}
const HARNESS_COMMAND = {
  command: '/usr/bin/true',
  args: [],
  promptDelivery: 'stdin' as const,
  promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
}
const CLASSIFICATION_HARNESS_COMMAND = {
  ...HARNESS_COMMAND,
  promptTemplate:
    'Map {{roadmap.map}} ticket {{roadmap.ticket}} schema {{roadmap.classificationResultSchema}}',
}

function memoryConfiguration(
  initial: ConfigurationRead,
  writeResult: ConfigurationWrite = { ok: true, durability: 'confirmed' },
) {
  let current = initial
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const writes: ProjectConfiguration[] = []
  const document: ConfigurationDocument = {
    async load() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next): Promise<ConfigurationWrite> {
      writes.push(next)
      if (!writeResult.ok) return writeResult
      current = { ok: true, document: next }
      for (const listener of listeners) listener(current)
      return writeResult
    },
    async stop() {},
  }
  return {
    document,
    writes,
    emit(next: ConfigurationRead) {
      current = next
      for (const listener of listeners) listener(next)
    },
  }
}

function immediateObserver(batch: ObservationBatch = EMPTY_BATCH, id = 'demo') {
  const scope = batch.attempts[0]?.scope
  return controlledSourceFixture(
    scope?.kind === 'project' ? scope.project : { integration: 'local', id },
    batch,
  )
}

function deferredObserver(id = 'demo') {
  const gate = Promise.withResolvers<void>()
  return {
    ...controlledSourceFixture({ integration: 'local', id }, EMPTY_BATCH, { gate: gate.promise }),
    release: () => gate.resolve(),
  }
}

function controlledObserver(
  _integration: 'local' | 'github',
  baseline: ObservationBatch,
  options: { gate?: Promise<void>; health?: SourceObservationHealth } = {},
) {
  const first = baseline.attempts[0]
  if (!first || first.scope.kind !== 'project') throw new Error('Expected scoped baseline')
  return controlledSourceFixture(first.scope.project, baseline, options)
}

function notificationProject(claimed = false, closed = false): Project {
  const key = { integration: 'local', id: 'notifications' } as const
  const ticket: Ticket = {
    id: '1',
    sourcePath: '/tmp/notifications/.wayfinder/tickets/01-notification.md',
    body: 'Keep notification comparison across policy and presentation edits.',
    typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
    state: closed ? 'closed' : claimed ? 'claimed' : 'frontier',
    isClaimed: claimed,
    isBlocked: false,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
  }
  const map: WayfinderMap = {
    project: key,
    id: '.wayfinder/map.md',
    sourcePath: '/tmp/notifications/.wayfinder/map.md',
    isOpen: true,
    updatedAt: 100,
    body: {
      raw: 'Notification map',
      destination: 'Preserve notification comparison.',
      notes: [],
      decisions: [],
      notYetSpecified: [],
      notYetSpecifiedNote: '',
      outOfScope: [],
      sections: [],
      missingSections: [],
    },
    tickets: [ticket],
    frontier: claimed || closed ? [] : [ticket],
    progress: { total: 1, completed: closed ? 1 : 0 },
    ticketsComplete: true,
    warnings: [],
  }
  return { key, name: 'Notifications', openMaps: [map], closedMaps: [], warnings: [] }
}

function localProject(id: string): Project {
  return {
    key: { integration: 'local', id },
    name: id,
    sourcePath: `/tmp/${id}`,
    openMaps: [],
    closedMaps: [],
    warnings: [],
  }
}

function unavailable(id: string): ObservationBatch {
  return {
    attempts: [
      {
        kind: 'failed',
        scope: { kind: 'project', project: { integration: 'local', id } },
        attemptedAt: 50,
        provenance: { integration: 'local', path: `/tmp/${id}`, operation: 'inspect-root' },
        failure: { kind: 'filesystem', operation: 'inspect-root', code: 'other' },
      },
    ],
  }
}

function configuredProjects(projects: readonly Project[]): ProjectConfiguration {
  return {
    ...BASE_CONFIGURATION,
    connections: [
      LOCAL_CONNECTION,
      {
        id: 'github',
        integration: 'github',
        name: 'GitHub',
        builtIn: false,
        githubIdentity: { id: '7', login: 'octocat' },
      },
    ],
    projects: projects.map((project) =>
      project.key.integration === 'local'
        ? {
            ref: { integration: 'local', projectId: project.key.id },
            connectionId: 'local',
            workspace: { path: project.sourcePath ?? '/tmp/' + project.key.id },
          }
        : {
            ref: { integration: 'github', projectId: project.key.id },
            connectionId: 'github',
            locator: { repositoryId: project.key.id, nameWithOwner: project.name },
            workspace: { path: '/tmp/' + project.key.id },
          },
    ),
  }
}

function snapshotProjectIds(snapshot: Snapshot): string[] {
  return snapshot.projects.map((project) => project.key.id)
}

describe('RoadmapApplication', () => {
  it.each([
    'rename-connection',
    'rename-project',
    'set-automation-enabled',
    'set-project-automation-enabled',
  ] as const)('preserves observer ownership and notification comparison after %s', async (type) => {
    const project = notificationProject()
    const registered: ProjectConfiguration = {
      ...BASE_CONFIGURATION,
      projects: [
        {
          ref: { integration: 'local', projectId: project.key.id },
          connectionId: 'local',
          workspace: { path: '/tmp/notifications' },
        },
      ],
      automation: {
        enabled: false,
        enabledProjects: [],
        classificationCommand: CLASSIFICATION_HARNESS_COMMAND,
        wayfinderCommand: HARNESS_COMMAND,
      },
    }
    const configuration = memoryConfiguration({ ok: true, document: registered })
    const original = controlledObserver('local', sourceFixture([project], 1_000))
    const reconstruction = controlledObserver(
      'local',
      sourceFixture([notificationProject(true)], 2_000),
    )
    let created = false
    const events: ChangeEvent[] = []
    const states: ApplicationState[] = []
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local() {
          if (created) return reconstruction.observer
          created = true
          return original.observer
        },
        github() {
          throw new Error('Unused GitHub source')
        },
      },
      onChangeEvents: (batch) => events.push(...batch),
      serverEpoch: 'neutral-edit-test',
    })
    application.subscribe((state) => states.push(state))
    try {
      await application.start()
      const command =
        type === 'rename-connection'
          ? { type, connectionId: 'local', name: 'On this Mac', expectedConfigurationVersion: 1 }
          : type === 'rename-project'
            ? {
                type,
                project: project.key,
                name: 'Renamed notifications',
                expectedConfigurationVersion: 1,
              }
            : type === 'set-automation-enabled'
              ? { type, enabled: true, expectedConfigurationVersion: 1 }
              : { type, project: project.key, enabled: true, expectedConfigurationVersion: 1 }
      expect((await application.execute(command)).ok).toBe(true)
      expect(application.current().configurationVersion).toBe(2)
      if (type === 'rename-connection') {
        expect(application.current().connections[0]?.name).toBe('On this Mac')
      } else if (type === 'rename-project') {
        expect(application.current().projects[0]?.name).toBe('Renamed notifications')
      } else if (type === 'set-automation-enabled') {
        expect(application.current().automation.enabled).toBe(true)
      } else {
        expect(application.current().automation.enabledProjects).toEqual([
          { integration: 'local', id: 'notifications' },
        ])
      }
      for (const state of states) {
        expect(state.projects[0]?.availability.observedAt).toBe(1_000)
        expect(state.projects[0]?.openMaps[0]?.tickets[0]?.isClaimed).toBe(false)
      }
      expect(events).toEqual([])
      original.push(sourceFixture([notificationProject(true)], 3_000))
      expect(application.current().projects[0]?.openMaps[0]?.tickets[0]?.isClaimed).toBe(true)
      expect(application.current().projects[0]?.availability.observedAt).toBe(3_000)
      expect(events.filter((event) => event.type === 'ticket-claimed')).toEqual([
        {
          type: 'ticket-claimed',
          ticket: expect.objectContaining({
            project: { integration: 'local', id: 'notifications' },
            mapId: '.wayfinder/map.md',
            id: '1',
          }),
        },
      ])
      original.push(sourceFixture([notificationProject(true)], 4_000))
      expect(application.current().projects[0]?.availability.observedAt).toBe(4_000)
      expect(events.filter((event) => event.type === 'ticket-claimed')).toHaveLength(1)
    } finally {
      await application.stop()
    }
  })

  it('publishes coherent replacement status while unrelated Integration observations continue', async () => {
    const github: Project = {
      ...localProject('remote'),
      key: { integration: 'github', id: 'remote' },
      name: 'acme/original',
      sourceUrl: 'https://github.com/acme/original',
    }
    const registered: ProjectConfiguration = {
      ...BASE_CONFIGURATION,
      connections: [
        LOCAL_CONNECTION,
        {
          id: 'github',
          integration: 'github',
          name: 'GitHub',
          builtIn: false,
          githubIdentity: { id: '7', login: 'octocat' },
        },
      ],
      projects: [
        {
          ref: { integration: 'local', projectId: 'notifications' },
          connectionId: 'local',
          workspace: { path: '/tmp/notifications' },
        },
        {
          ref: { integration: 'github', projectId: github.key.id },
          connectionId: 'github',
          locator: { repositoryId: 'remote', nameWithOwner: 'acme/original' },
          workspace: { path: '/tmp/remote' },
        },
      ],
    }
    const configuration = memoryConfiguration({ ok: true, document: registered })
    const local = controlledObserver('local', sourceFixture([notificationProject()], 1_000))
    const gate = Promise.withResolvers<void>()
    let createdRemote = false
    const original = controlledObserver('github', sourceFixture([github], 1_000, registered), {
      health: { status: 'available', observedAt: 1_000 },
    })
    const replacement = controlledObserver(
      'github',
      sourceFixture(
        [{ ...github, name: 'acme/renamed', sourceUrl: 'https://github.com/acme/renamed' }],
        3_000,
        registered,
      ),
      {
        gate: gate.promise,
        health: { status: 'unavailable', cause: 'Replacement access failed.' },
      },
    )
    const events: ChangeEvent[] = []
    let credentials: CredentialBundle = {
      accessToken: 'original-access',
      refreshToken: 'original-refresh',
      accessTokenExpiresAt: Number.MAX_SAFE_INTEGER,
      refreshTokenExpiresAt: Number.MAX_SAFE_INTEGER,
    }
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      credentialVault: {
        async read() {
          return credentials
        },
        async write() {},
        async delete() {},
        async cleanupOrphans() {},
      },
      github: {
        integration: {
          integration: 'github',
          name: 'GitHub',
          connectionKind: 'device-authorization',
          newInstallationUrl: 'https://github.com/apps/test/installations/new',
          installationsUrl: 'https://github.com/settings/installations',
          authorizationsUrl: 'https://github.com/settings/connections/applications/test',
        },
        async identify(accessToken) {
          if (accessToken === 'original-access') return { id: '7', login: 'octocat' }
          if (accessToken === 'replacement-access') return { id: '8', login: 'replacement' }
          throw new Error('Unexpected replacement fixture credential.')
        },
        async beginDeviceAuthorization() {
          throw new Error('The replacement fixture does not authorize Connections.')
        },
        async pollDeviceAuthorization() {
          throw new Error('The replacement fixture does not authorize Connections.')
        },
        async refresh() {
          throw new Error('The replacement fixture uses unexpired credentials.')
        },
      },
      providerRead: () => ({
        async restGet() {
          return {}
        },
        async graphql() {
          return { data: {}, errors: [] }
        },
      }),
      observers: {
        local: () => local.observer,
        github() {
          if (createdRemote) return replacement.observer
          createdRemote = true
          return original.observer
        },
      },
      onChangeEvents: (batch) => events.push(...batch),
      serverEpoch: 'replacement-test',
    })
    const states: ApplicationState[] = []
    application.subscribe((state) => states.push(state))
    try {
      await application.start()
      credentials = {
        ...credentials,
        accessToken: 'replacement-access',
        refreshToken: 'replacement-refresh',
      }
      configuration.emit({
        ok: true,
        document: {
          ...registered,
          configurationVersion: 2,
          connections: registered.connections.map((connection) =>
            connection.integration === 'github'
              ? { ...connection, githubIdentity: { id: '8', login: 'replacement' } }
              : connection,
          ),
          projects: registered.projects.map((registration) =>
            registration.ref.integration === 'github'
              ? {
                  ...registration,
                  locator: { repositoryId: 'remote', nameWithOwner: 'acme/renamed' },
                }
              : registration,
          ),
        },
      })
      await replacement.started
      local.push(sourceFixture([notificationProject(true)], 2_000))
      expect(
        application
          .current()
          .roadmap.projects.find((project) => project.key.integration === 'local')?.openMaps[0]
          ?.tickets[0]?.isClaimed,
      ).toBe(true)
      expect(events.filter((event) => event.type === 'ticket-claimed')).toHaveLength(1)
      for (const state of states) {
        expect(state.configurationVersion).toBe(1)
        expect(
          state.registrations.find((row) => row.key.integration === 'github')?.locator,
        ).toMatchObject({ nameWithOwner: 'acme/original' })
        expect(state.projects.find((row) => row.key.integration === 'github')).toMatchObject({
          name: 'acme/original',
          availability: { status: 'available', observedAt: 1_000 },
        })
        expect(
          state.connections.find((connection) => connection.id === 'github')?.availability,
        ).toEqual({ status: 'available', observedAt: 1_000 })
      }
      original.push(sourceFixture([github], 1_500, registered))
      expect(application.current().configurationVersion).toBe(1)
      expect(
        application
          .current()
          .projects.find(
            (project) => project.key.integration === 'github' && project.key.id === github.key.id,
          ),
      ).toMatchObject({
        name: 'acme/original',
        availability: { status: 'available', observedAt: 1_500 },
      })
      gate.resolve()
      await vi.waitFor(() => expect(application.current().configurationVersion).toBe(2))
      for (const state of states.filter((state) => state.configurationVersion === 2)) {
        expect(
          state.registrations.find((row) => row.key.integration === 'github')?.locator,
        ).toMatchObject({ nameWithOwner: 'acme/renamed' })
        expect(state.projects.find((row) => row.key.integration === 'github')).toMatchObject({
          name: 'acme/renamed',
          availability: { observedAt: 3_000 },
        })
        expect(
          state.connections.find((connection) => connection.id === 'github')?.availability.status,
        ).toBe('unavailable')
      }
      const committedSequence = application.current().stateSequence
      original.push(sourceFixture([{ ...github, name: 'retired-callback' }], 4_000, registered))
      expect(application.current().stateSequence).toBe(committedSequence)
      expect(states.at(-1)?.projects.find((row) => row.key.integration === 'github')?.name).toBe(
        'acme/renamed',
      )
      local.push(sourceFixture([notificationProject(true, true)], 5_000))
      expect(
        application
          .current()
          .roadmap.projects.find((project) => project.key.integration === 'local')?.openMaps[0]
          ?.tickets[0]?.state,
      ).toBe('closed')
      expect(events.filter((event) => event.type === 'ticket-claimed')).toHaveLength(1)
      expect(events.filter((event) => event.type === 'ticket-closed')).toEqual([
        {
          type: 'ticket-closed',
          ticket: expect.objectContaining({
            project: { integration: 'local', id: 'notifications' },
            id: '1',
          }),
        },
      ])
      expect(
        application
          .current()
          .projects.find(
            (project) => project.key.integration === 'github' && project.key.id === github.key.id,
          )?.availability.observedAt,
      ).toBe(3_000)
      expect(
        application
          .current()
          .projects.find(
            (project) => project.key.integration === 'local' && project.key.id === 'notifications',
          )?.availability.observedAt,
      ).toBe(5_000)
    } finally {
      gate.resolve()
      await application.stop()
    }
  })

  it('adds an empty-map warning across integrations without mutating source diagnostics', async () => {
    const local = localProject('empty')
    const github: Project = {
      ...localProject('owner/repo'),
      key: { integration: 'github', id: 'owner/repo' },
      warnings: ['Source diagnostic'],
    }
    const registered = configuredProjects([local, github])
    const adapter = immediateObserver(sourceFixture([local], 1_000))
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({
        ok: true,
        document: registered,
      }).document,
      admissions: fixtureAdmissions,
      observers: {
        local: () => adapter.observer,
        github: () =>
          controlledSourceFixture(github.key, sourceFixture([github], 1_000, registered)).observer,
      },
      serverEpoch: 'test',
    })
    try {
      await application.start()
      const projects = application.current().roadmap.projects
      expect(
        projects.find((project) => project.key.integration === 'local')?.warnings,
      ).toHaveLength(1)
      expect(
        projects.find((project) => project.key.integration === 'github')?.warnings,
      ).toHaveLength(2)
      expect(projects.find((project) => project.key.integration === 'github')?.warnings).toContain(
        'Source diagnostic',
      )
      expect(local.warnings).toEqual([])
      expect(github.warnings).toEqual(['Source diagnostic'])
      adapter.push(sourceFixture([local], 1_000))
      expect(
        application
          .current()
          .roadmap.projects.find((project) => project.key.integration === 'local')?.warnings,
      ).toHaveLength(1)
    } finally {
      await application.stop()
    }
  })

  it('publishes only after the complete source baseline is ready', async () => {
    const configuration = memoryConfiguration({
      ok: true,
      document: configuredProjects([localProject('demo'), localProject('ready')]),
    })
    const adapter = deferredObserver()
    const ready = controlledSourceFixture(
      { integration: 'local', id: 'ready' },
      sourceFixture([localProject('ready')], 10),
    )
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) => (input.ref.projectId === 'demo' ? adapter.observer : ready.observer),
        github() {
          throw new Error('Unused source')
        },
      },
      serverEpoch: 'test',
      now: () => 10,
    })
    const states = vi.fn()
    application.subscribe(states)

    const starting = application.start()
    await Promise.resolve()
    expect(states).not.toHaveBeenCalled()

    adapter.release()
    await starting
    expect(states).toHaveBeenCalledOnce()
    expect(application.current().roadmap.capturedAt).toBeGreaterThan(0)
    expect(snapshotProjectIds(application.current().roadmap)).toEqual(['ready'])
    await application.stop()
  })

  it('deduplicates semantically identical source publications', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const adapter = immediateObserver()
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: () => adapter.observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      serverEpoch: 'test',
    })
    await application.start()
    const states = vi.fn()
    application.subscribe(states)
    states.mockClear()

    adapter.push(EMPTY_BATCH)
    expect(states).not.toHaveBeenCalled()
    await application.stop()
  })

  it('keeps a committed Project and its last-known facts visible while unavailable', async () => {
    const registered: ProjectConfiguration = {
      ...BASE_CONFIGURATION,
      projects: [
        {
          ref: { integration: 'local', projectId: 'demo' },
          connectionId: 'local',
          workspace: { path: '/tmp/demo' },
        },
      ],
    }
    const configuration = memoryConfiguration({ ok: true, document: registered })
    const adapter = immediateObserver(sourceFixture([localProject('demo')], 25))
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: () => adapter.observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      serverEpoch: 'test',
      now: () => 25,
    })
    await application.start()

    adapter.push(unavailable('demo'))

    expect(application.current().projects).toEqual([
      expect.objectContaining({
        name: 'demo',
        availability: {
          status: 'unavailable',
          cause: 'Workspace cannot be read.',
          observedAt: 25,
        },
        actions: expect.arrayContaining([
          { id: 'open-workspace', label: 'Open in VS Code', kind: 'server-launch' },
          { id: 'reveal-source', label: 'View source folder', kind: 'server-launch' },
        ]),
      }),
    ])
    await application.stop()
  })

  it('does not advance a failed GitHub scope when an unrelated Local source changes', async () => {
    let clock = 1_000
    const githubProject: Project = {
      key: { integration: 'github', id: 'opaque/github-key' },
      name: 'acme/remote',
      sourceUrl: 'https://github.com/acme/remote',
      openMaps: [],
      closedMaps: [],
      warnings: [],
    }
    const configuration = memoryConfiguration({
      ok: true,
      document: {
        ...BASE_CONFIGURATION,
        connections: [
          LOCAL_CONNECTION,
          {
            id: 'github',
            integration: 'github',
            name: 'GitHub',
            builtIn: false,
            githubIdentity: { id: '7', login: 'octocat' },
          },
        ],
        projects: [
          {
            ref: { integration: 'local', projectId: 'local-source' },
            connectionId: 'local',
            workspace: { path: '/tmp/local-source' },
          },
          {
            ref: { integration: 'github', projectId: githubProject.key.id },
            connectionId: 'github',
            locator: {
              repositoryId: '42',
              nameWithOwner: 'acme/remote',
            },
            workspace: { path: '/unused/github-workspace' },
          },
        ],
      },
    })
    const local = immediateObserver(sourceFixture([localProject('local-source')], clock))
    const remote = controlledSourceFixture(
      githubProject.key,
      sourceFixture([githubProject], clock, {
        projects: [
          {
            ref: { integration: 'github', projectId: githubProject.key.id },
            connectionId: 'github',
            locator: { repositoryId: '42', nameWithOwner: 'acme/remote' },
          },
        ],
      }),
    )
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: { local: () => local.observer, github: () => remote.observer },
      serverEpoch: 'source-time-test',
      now: () => clock,
    })
    try {
      await application.start()
      expect(application.current().projects[0]?.availability.observedAt).toBe(1_000)

      clock = 2_000
      remote.push({
        attempts: [
          {
            kind: 'failed',
            scope: { kind: 'project', project: githubProject.key },
            attemptedAt: clock,
            provenance: {
              integration: 'github',
              connectionId: 'github',
              repositoryId: '42',
              stage: 'repository',
            },
            failure: { kind: 'read', cause: 'response-read' },
          },
        ],
      })
      clock = 3_000
      local.push(
        sourceFixture(
          [{ ...localProject('local-source'), warnings: ['A Local file changed.'] }],
          clock,
        ),
      )

      const retained = application
        .current()
        .projects.find((project) => project.key.integration === 'github')
      expect(retained?.key).toEqual({ integration: 'github', id: 'opaque/github-key' })
      expect(retained?.availability.observedAt).toBe(1_000)
      expect(
        application.current().connections.find((connection) => connection.id === 'github'),
      ).toMatchObject({ availability: { observedAt: 1_000 } })
    } finally {
      await application.stop()
    }
  })

  it('projects the current GitHub source URL without changing the stable route key', async () => {
    const githubProject: Project = {
      key: { integration: 'github', id: 'stable/route' },
      name: 'acme/renamed',
      sourceUrl: 'https://github.com/acme/renamed',
      openMaps: [],
      closedMaps: [],
      warnings: [],
    }
    const registered: ProjectConfiguration = {
      ...BASE_CONFIGURATION,
      connections: [
        ...BASE_CONFIGURATION.connections,
        {
          id: 'github',
          integration: 'github',
          name: 'GitHub',
          builtIn: false,
          githubIdentity: { id: '7', login: 'octocat' },
        },
      ],
      projects: [
        {
          ref: { integration: 'github', projectId: githubProject.key.id },
          connectionId: 'github',
          locator: {
            repositoryId: '42',
            nameWithOwner: 'acme/original',
          },
          workspace: { path: '/workspace' },
        },
      ],
    }
    const adapter = controlledSourceFixture(
      githubProject.key,
      sourceFixture([githubProject], 1_000, registered),
    )
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({ ok: true, document: registered }).document,
      admissions: fixtureAdmissions,
      observers: {
        local() {
          throw new Error('Unused source')
        },
        github: () => adapter.observer,
      },
      serverEpoch: 'test',
    })

    await application.start()

    expect(application.current().projects[0]).toMatchObject({
      key: { integration: 'github', id: 'stable/route' },
      name: 'acme/renamed',
      actions: expect.arrayContaining([
        {
          id: 'open-roadmap',
          label: 'Open in Roadmap',
          kind: 'roadmap',
          href: '/projects/github/stable%2Froute',
        },
        {
          id: 'open-source',
          label: 'Open on GitHub',
          kind: 'external-link',
          href: 'https://github.com/acme/renamed',
        },
      ]),
    })
    await application.stop()
  })

  it('reveals the registered GitHub workspace as its source folder', async () => {
    const key = { integration: 'github' as const, id: 'acme/app' }
    const configuration = memoryConfiguration({
      ok: true,
      document: {
        ...BASE_CONFIGURATION,
        connections: [
          LOCAL_CONNECTION,
          {
            id: 'github',
            integration: 'github',
            name: 'GitHub',
            builtIn: false,
            githubIdentity: { id: '7', login: 'octocat' },
          },
        ],
        projects: [
          {
            ref: { integration: 'github', projectId: key.id },
            connectionId: 'github',
            locator: {
              repositoryId: '42',
              nameWithOwner: 'acme/app',
            },
            workspace: { path: '/committed/source' },
          },
        ],
      },
    })
    const launch = vi.fn(async () => {})
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      operations: createApplicationOperations({ launch }),
      serverEpoch: 'test',
    })
    await application.start()

    expect(application.current().projects[0]?.actions).toContainEqual({
      id: 'reveal-source',
      label: 'View source folder',
      kind: 'server-launch',
    })
    const result = await application.execute({
      type: 'launch-action',
      expectedConfigurationVersion: application.current().configurationVersion,
      actionId: 'reveal-source',
      project: key,
    })
    expect(result).toMatchObject({ ok: true })
    expect(launch).toHaveBeenCalledWith('/usr/bin/open', ['-R', '/committed/source'])
    await application.stop()
  })

  it('opens Terminal in each committed Project Workspace', async () => {
    const localKey = { integration: 'local' as const, id: 'local-demo' }
    const githubKey = { integration: 'github' as const, id: 'acme/app' }
    const configuration = memoryConfiguration({
      ok: true,
      document: {
        ...BASE_CONFIGURATION,
        connections: [
          LOCAL_CONNECTION,
          {
            id: 'github',
            integration: 'github',
            name: 'GitHub',
            builtIn: false,
            githubIdentity: { id: '7', login: 'octocat' },
          },
        ],
        projects: [
          {
            ref: { integration: localKey.integration, projectId: localKey.id },
            connectionId: 'local',
            workspace: { path: '/committed/local-workspace' },
          },
          {
            ref: { integration: githubKey.integration, projectId: githubKey.id },
            connectionId: 'github',
            locator: {
              repositoryId: '42',
              nameWithOwner: 'acme/app',
            },
            workspace: { path: '/committed/github-workspace' },
          },
        ],
      },
    })
    const launch = vi.fn(async () => {})
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      operations: createApplicationOperations({ launch }),
      serverEpoch: 'test',
    })
    await application.start()

    for (const project of application.current().projects) {
      expect(project.actions).toContainEqual({
        id: 'open-terminal',
        label: 'Open Terminal',
        kind: 'server-launch',
      })
    }
    for (const project of [localKey, githubKey]) {
      const result = await application.execute({
        type: 'launch-action',
        expectedConfigurationVersion: application.current().configurationVersion,
        actionId: 'open-terminal',
        project,
      })
      expect(result).toMatchObject({ ok: true })
    }
    expect(launch.mock.calls).toEqual([
      ['/usr/bin/open', ['-a', 'Terminal', '/committed/local-workspace']],
      ['/usr/bin/open', ['-a', 'Terminal', '/committed/github-workspace']],
    ])
    await application.stop()
  })

  it('rejects stale commands through the public Interface', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      serverEpoch: 'test',
    })
    await application.start()

    const outcome = await application.execute({
      type: 'rename-connection',
      connectionId: 'local',
      name: 'On this Mac',
      expectedConfigurationVersion: 0,
    })

    expect(outcome).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(configuration.writes).toEqual([])
    await application.stop()
  })

  it('persists independent Automation switches and retains Project preferences', async () => {
    const project = {
      ref: { integration: 'local' as const, projectId: 'demo' },
      connectionId: 'local',
      workspace: { path: '/tmp/demo' },
    }
    const configured: ProjectConfiguration = {
      ...BASE_CONFIGURATION,
      projects: [project],
      automation: {
        enabled: false,
        classificationCommand: CLASSIFICATION_HARNESS_COMMAND,
        wayfinderCommand: HARNESS_COMMAND,
        enabledProjects: [],
      },
    }
    const configuration = memoryConfiguration({ ok: true, document: configured })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      serverEpoch: 'test',
    })
    await application.start()

    expect(application.current().automation).toEqual({
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    })
    const projectOn = await application.execute({
      type: 'set-project-automation-enabled',
      project: { integration: 'local', id: project.ref.projectId },
      enabled: true,
      expectedConfigurationVersion: 1,
    })
    expect(projectOn).toMatchObject({ ok: true, state: { configurationVersion: 2 } })
    const globalOn = await application.execute({
      type: 'set-automation-enabled',
      enabled: true,
      expectedConfigurationVersion: 2,
    })
    expect(globalOn).toMatchObject({
      ok: true,
      state: {
        automation: {
          enabled: true,
          enabledProjects: [{ integration: 'local', id: project.ref.projectId }],
        },
        configurationVersion: 3,
      },
    })
    const globalOff = await application.execute({
      type: 'set-automation-enabled',
      enabled: false,
      expectedConfigurationVersion: 3,
    })
    expect(globalOff).toMatchObject({
      ok: true,
      state: {
        automation: {
          enabled: false,
          enabledProjects: [{ integration: 'local', id: project.ref.projectId }],
        },
      },
    })
    await application.stop()
  })

  it('keeps global Automation off until both Harness Commands exist', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      serverEpoch: 'test',
    })
    await application.start()

    expect(application.current().automation).toMatchObject({
      enabled: false,
      availability: {
        status: 'unavailable',
        cause: expect.stringContaining('Classification Harness Command'),
      },
    })
    const outcome = await application.execute({
      type: 'set-automation-enabled',
      enabled: true,
      expectedConfigurationVersion: 1,
    })
    expect(outcome).toMatchObject({ ok: false, error: { code: 'validation' } })
    expect(configuration.writes).toEqual([])
    await application.stop()
  })

  it('keeps authoritative Automation state when persistence fails', async () => {
    const configured: ProjectConfiguration = {
      ...BASE_CONFIGURATION,
      automation: {
        enabled: false,
        classificationCommand: CLASSIFICATION_HARNESS_COMMAND,
        wayfinderCommand: HARNESS_COMMAND,
        enabledProjects: [],
      },
    }
    const configuration = memoryConfiguration(
      { ok: true, document: configured },
      { ok: false, kind: 'persistence', message: 'Disk is read-only.' },
    )
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      serverEpoch: 'test',
    })
    await application.start()

    const outcome = await application.execute({
      type: 'set-automation-enabled',
      enabled: true,
      expectedConfigurationVersion: 1,
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'persistence-failed', message: 'Disk is read-only.' },
      state: { automation: { enabled: false }, configurationVersion: 1 },
    })
    await application.stop()
  })

  it('keeps the last valid runtime, gates writes, and recovers after a valid manual save', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      serverEpoch: 'test',
    })
    await application.start()

    configuration.emit({
      ok: false,
      issues: [
        { path: '$.automation.wayfinderCommand.command', message: 'Must be a non-empty string.' },
      ],
    })
    await vi.waitFor(() => expect(application.current().configuration.valid).toBe(false))
    expect(application.current().connections[0]?.name).toBe('Local')
    expect(application.current().automation.availability.status).toBe('unavailable')

    const gated = await application.execute({
      type: 'rename-connection',
      connectionId: 'local',
      name: 'On this Mac',
      expectedConfigurationVersion: 1,
    })
    expect(gated).toMatchObject({ ok: false, error: { code: 'configuration-invalid' } })

    configuration.emit({
      ok: true,
      document: {
        ...BASE_CONFIGURATION,
        configurationVersion: 2,
        connections: [{ ...LOCAL_CONNECTION, name: 'On this Mac' }],
      },
    })
    await vi.waitFor(() => {
      expect(application.current().configurationVersion).toBe(2)
      expect(application.current().configuration.valid).toBe(true)
      expect(application.current().connections[0]?.name).toBe('On this Mac')
    })
    expect(application.current().connections[0]?.name).toBe('On this Mac')
    await application.stop()
  })

  it('keeps the active source live until a replacement baseline and ignores retired updates', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const first = immediateObserver()
    const second = deferredObserver('replacement')
    let created = false
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local() {
          if (created) return second.observer
          created = true
          return first.observer
        },
        github() {
          throw new Error('Unused source')
        },
      },
      serverEpoch: 'test',
    })
    await application.start()

    configuration.emit({
      ok: true,
      document: {
        ...BASE_CONFIGURATION,
        configurationVersion: 2,
        projects: [
          {
            ref: { integration: 'local', projectId: 'replacement' },
            connectionId: 'local',
            workspace: { path: '/tmp/replacement' },
          },
        ],
      },
    })
    first.push(sourceFixture([{ ...localProject('demo'), warnings: ['Still live'] }], 1_000))
    await vi.waitFor(() =>
      expect(snapshotProjectIds(application.current().roadmap)).toEqual(['demo']),
    )

    second.release()
    await vi.waitFor(() => expect(application.current().configurationVersion).toBe(2))
    expect(first.stopped).toBe(true)
    first.push(sourceFixture([{ ...localProject('demo'), warnings: ['Late callback'] }], 2_000))
    expect(snapshotProjectIds(application.current().roadmap)).toEqual([])
    await application.stop()
  })

  it('commits configuration before exposing an unavailable replacement source', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture(
            { integration: 'local', id: input.ref.projectId },
            unavailable(input.ref.projectId),
            { health: { status: 'unavailable', cause: 'Workspace cannot be read.' } },
          ).observer,
        github() {
          throw new Error('Unused source')
        },
      },
      serverEpoch: 'test',
    })
    await application.start()

    const outcome = await application.execute({
      type: 'register-project',
      candidate: {
        integration: 'local',
        connectionId: 'local',
        workspace: { path: '/tmp/microsoft-risiko' },
      },
      expectedConfigurationVersion: 1,
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.state.configurationVersion).toBe(2)
    expect(outcome.state.roadmap.projects).toEqual([])
    expect(outcome.state.roadmap.unreachable).toContainEqual(
      expect.objectContaining({ project: { integration: 'local', id: 'microsoft-risiko' } }),
    )
    expect(configuration.writes[0]?.configurationVersion).toBe(2)
    await application.stop()
  })

  it('persists the normalized registration returned by admission and reconciles immediately', async () => {
    const localAdmission = fixtureAdmissions.local
    if (!localAdmission) throw new Error('Local fixture admission is required.')
    const configuration = memoryConfiguration({
      ok: true,
      document: { ...BASE_CONFIGURATION, projects: [] },
    })
    const normalized = {
      ref: { integration: 'local', projectId: 'canonical' },
      connectionId: 'local',
      workspace: { path: '/canonical' },
    }
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: {
        ...fixtureAdmissions,
        local: {
          ...localAdmission,
          async admit() {
            return {
              integration: 'local',
              workspace: {
                ok: true,
                value: {
                  integration: 'local',
                  path: '/canonical',
                  readable: true,
                  searchable: true,
                },
              },
            }
          },
        },
      },
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github() {
          throw new Error('Unused source')
        },
      },
      serverEpoch: 'test',
    })
    await application.start()

    const outcome = await application.execute({
      type: 'register-project',
      candidate: {
        integration: 'local',
        connectionId: 'local',
        workspace: { path: '/unclean' },
      },
      expectedConfigurationVersion: 1,
    })

    expect(outcome.ok).toBe(true)
    expect(configuration.writes[0]?.projects).toEqual([normalized])
    expect(application.current().registrations).toContainEqual(
      expect.objectContaining({
        key: { integration: 'local', id: 'canonical' },
        workspace: { path: '/canonical' },
      }),
    )
    await application.stop()
  })

  it('allows Workspace repair only for an unavailable registered Project', async () => {
    const localAdmission = fixtureAdmissions.local
    if (!localAdmission) throw new Error('Local fixture admission is required.')
    const registered: ProjectConfiguration = {
      ...BASE_CONFIGURATION,
      projects: [
        {
          ref: { integration: 'local', projectId: 'demo' },
          connectionId: 'local',
          workspace: { path: '/missing', gitIdentity: 'same' },
        },
      ],
    }
    const configuration = memoryConfiguration({ ok: true, document: registered })
    const repair = vi.fn(async () => ({
      integration: 'local' as const,
      workspace: {
        ok: true as const,
        value: {
          integration: 'local' as const,
          path: '/canonical',
          gitIdentity: 'same',
          readable: true as const,
          searchable: true as const,
        },
      },
    }))
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: {
        ...fixtureAdmissions,
        local: {
          ...localAdmission,
          repair,
          async revalidate() {
            return {
              integration: 'local',
              workspace: {
                ok: false,
                error: { code: 'admission-failed', message: 'Workspace cannot be read.' },
              },
            }
          },
        },
      },
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      serverEpoch: 'test',
    })
    await application.start()

    const outcome = await application.execute({
      type: 'repair-project-workspace',
      project: { integration: 'local', id: 'demo' },
      workspace: { path: '/candidate' },
      expectedConfigurationVersion: 1,
    })

    expect(outcome.ok).toBe(true)
    expect(configuration.writes[0]?.projects[0]?.workspace).toEqual({
      path: '/canonical',
      gitIdentity: 'same',
    })
    expect(configuration.writes[0]?.projects[0]?.ref).toEqual({
      integration: 'local',
      projectId: 'demo',
    })
    await application.stop()
  })

  it('cleans only orphan credentials without admitting secret data to state', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const cleanupOrphans = vi.fn(async () => {})
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: fixtureAdmissions,
      observers: {
        local: (input) =>
          controlledSourceFixture({ integration: 'local', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
      credentialVault: {
        read: vi.fn(async () => null),
        write: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        cleanupOrphans,
      },
      serverEpoch: 'test',
    })

    await application.start()
    expect(cleanupOrphans).toHaveBeenCalledWith(new Set(['local']))
    expect(JSON.stringify(application.current())).not.toMatch(/token|secret|credential/i)
    await application.stop()
  })

  it('projects ticket state precedence and keeps complete frontier order including closed external blockers', async () => {
    const key = { integration: 'local', id: 'ticket-policy' } as const
    const ticket = (id: string, extra: Partial<Ticket> = {}): Ticket => ({
      id,
      body: `Ticket ${id}`,
      sourcePath: `/tmp/ticket-policy/.wayfinder/tickets/${id}.md`,
      typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
      state: 'frontier',
      isClaimed: false,
      isBlocked: false,
      assignees: [],
      blockedBy: [],
      blockersComplete: true,
      warnings: [],
      ...extra,
    })
    const openBlocker: Ticket['blockedBy'][number] = {
      reference: { kind: 'registered', project: key },
      ticketId: 'outside',
      state: 'open',
    }
    const map: WayfinderMap = {
      project: key,
      id: '.wayfinder/map.md',
      sourcePath: '/tmp/ticket-policy/.wayfinder/map.md',
      isOpen: true,
      updatedAt: 1,
      body: {
        raw: 'Raw map prose',
        destination: 'Destination',
        notes: [],
        decisions: [],
        notYetSpecified: [],
        notYetSpecifiedNote: '',
        outOfScope: [],
        sections: [],
        missingSections: [],
      },
      tickets: [
        ticket('first'),
        ticket('claimed', { isClaimed: true }),
        ticket('blocked', { blockedBy: [openBlocker] }),
        ticket('blocked-claimed', { isClaimed: true, blockedBy: [openBlocker] }),
        ticket('closed', { state: 'closed', isClaimed: true, blockedBy: [openBlocker] }),
        ticket('external-closed', {
          blockedBy: [
            {
              reference: {
                kind: 'external',
                integration: 'github',
                nameWithOwner: 'outside/repository',
              },
              ticketId: '7',
              state: 'closed',
              url: 'https://github.com/outside/repository/issues/7',
            },
          ],
        }),
        ticket('unknown-blocker', { blockedBy: [{ ...openBlocker, state: 'unknown' }] }),
      ],
      frontier: [],
      progress: { total: 7, completed: 1 },
      ticketsComplete: true,
      warnings: [],
    }
    const adapter = immediateObserver(
      sourceFixture(
        [{ key, name: 'Ticket policy', openMaps: [map], closedMaps: [], warnings: [] }],
        10,
      ),
    )
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({
        ok: true,
        document: configuredProjects([
          { key, name: 'Ticket policy', openMaps: [map], closedMaps: [], warnings: [] },
        ]),
      }).document,
      admissions: fixtureAdmissions,
      observers: {
        local: () => adapter.observer,
        github: (input) =>
          controlledSourceFixture({ integration: 'github', id: input.ref.projectId }, EMPTY_BATCH)
            .observer,
      },
    })
    try {
      await application.start()
      const projected = application.current().roadmap.projects[0]?.openMaps[0]
      expect(projected?.tickets.map((entry) => [entry.id, entry.state])).toEqual([
        ['first', 'frontier'],
        ['claimed', 'claimed'],
        ['blocked', 'blocked'],
        ['blocked-claimed', 'blocked'],
        ['closed', 'closed'],
        ['external-closed', 'frontier'],
        ['unknown-blocker', 'blocked'],
      ])
      expect(projected?.frontier.map((entry) => entry.id)).toEqual(['first', 'external-closed'])
      expect(
        projected?.tickets.find((entry) => entry.id === 'external-closed')?.blockedBy[0],
      ).toEqual({
        reference: { kind: 'external', integration: 'github', nameWithOwner: 'outside/repository' },
        ticketId: '7',
        state: 'closed',
        url: 'https://github.com/outside/repository/issues/7',
      })
      adapter.push(
        sourceFixture(
          [
            {
              key,
              name: 'Ticket policy',
              openMaps: [{ ...map, tickets: [ticket('incomplete', { blockersComplete: false })] }],
              closedMaps: [],
              warnings: [],
            },
          ],
          20,
        ),
      )
      expect(application.current().roadmap.projects[0]?.openMaps[0]?.tickets[0]?.state).toBe(
        'blocked',
      )
      expect(application.current().roadmap.projects[0]?.openMaps[0]?.frontier).toEqual([])
      const unknown = sourceFixture(
        [
          {
            key,
            name: 'Ticket policy',
            openMaps: [{ ...map, tickets: [ticket('unknown-status')] }],
            closedMaps: [],
            warnings: [],
          },
        ],
        30,
      )
      adapter.push({
        attempts: unknown.attempts.map((attempt) => {
          if (
            attempt.kind !== 'observed' ||
            attempt.scope.kind !== 'ticket' ||
            !('typeEvidence' in attempt.value)
          )
            return attempt
          return {
            ...attempt,
            scope: attempt.scope,
            value: { ...attempt.value, status: 'unknown' },
            completeness: { kind: 'incomplete', reason: 'malformed' },
          }
        }),
      })
      expect(application.current().roadmap.projects[0]?.openMaps[0]?.tickets[0]?.state).toBe(
        'blocked',
      )
      expect(application.current().roadmap.projects[0]?.openMaps[0]?.frontier).toEqual([])
    } finally {
      await application.stop()
    }
  })

  it('rejects contributions outside the configured source scope without publishing them', async () => {
    const control = immediateObserver(sourceFixture([localProject('demo')], 100))
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({ ok: true, document: BASE_CONFIGURATION }).document,
      admissions: fixtureAdmissions,
      observers: {
        local: () => control.observer,
        github() {
          throw new Error('Unused source')
        },
      },
    })
    await application.start()
    try {
      const before = application.current()
      control.push(sourceFixture([localProject('unknown')], 200))
      expect(application.current().stateSequence).toBe(before.stateSequence)
      expect(snapshotProjectIds(application.current().roadmap)).toEqual(['demo'])
      expect(application.current().projects.some((project) => project.key.id === 'unknown')).toBe(
        false,
      )
      control.push(
        sourceFixture(
          [{ ...localProject('demo'), sourcePath: '/tmp/not-the-configured-source' }],
          300,
        ),
      )
      expect(application.current().stateSequence).toBe(before.stateSequence)
      expect(application.current().roadmap).toEqual(before.roadmap)
      expect(application.current().projects[0]?.availability.observedAt).toBe(100)
    } finally {
      await application.stop()
    }
  })

  it('does not publish callbacks after the application stops', async () => {
    const control = immediateObserver(sourceFixture([localProject('demo')], 100))
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({ ok: true, document: BASE_CONFIGURATION }).document,
      admissions: fixtureAdmissions,
      observers: {
        local: () => control.observer,
        github() {
          throw new Error('Unused source')
        },
      },
    })
    await application.start()
    const states = vi.fn()
    application.subscribe(states)
    await application.stop()
    states.mockClear()
    control.push(sourceFixture([{ ...localProject('demo'), warnings: ['Stopped callback'] }], 200))
    expect(states).not.toHaveBeenCalled()
  })
})
