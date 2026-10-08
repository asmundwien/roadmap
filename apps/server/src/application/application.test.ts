import type { Project, Snapshot, Ticket, WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { AdapterHost, AdapterSlice, WayfinderAdapter } from '../observation/source.ts'
import { sourceFixture } from '../source-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
  RoadmapConfiguration,
} from './configuration.ts'
import { createApplicationOperations } from './operations.ts'

const EMPTY_SLICE: AdapterSlice = { attempts: [] }
const LOCAL_CONNECTION: RoadmapConfiguration['connections'][number] = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}
const BASE_CONFIGURATION: RoadmapConfiguration = {
  schemaVersion: 5,
  configurationVersion: 1,
  connections: [LOCAL_CONNECTION],
  projects: [],
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
  writeResult: ConfigurationWrite = { ok: true },
) {
  let current = initial
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const writes: RoadmapConfiguration[] = []
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

function immediateAdapter(slice: AdapterSlice = EMPTY_SLICE) {
  let host: AdapterHost | null = null
  let stopped = false
  const adapter: WayfinderAdapter = {
    type: 'local',
    start(nextHost) {
      host = nextHost
      host.update(slice)
    },
    stop() {
      stopped = true
    },
  }
  return {
    adapter,
    push(next: AdapterSlice) {
      if (!host) throw new Error('adapter not started')
      host.update(next)
    },
    get stopped() {
      return stopped
    },
  }
}

function deferredAdapter() {
  let host: AdapterHost | null = null
  let release: (() => void) | null = null
  const started = new Promise<void>((resolve) => {
    release = resolve
  })
  const adapter: WayfinderAdapter = {
    type: 'local',
    async start(nextHost) {
      host = nextHost
      await started
      host.update(EMPTY_SLICE)
    },
    stop() {},
  }
  return {
    adapter,
    release() {
      release?.()
    },
    push(next: AdapterSlice) {
      if (!host) throw new Error('adapter not started')
      host.update(next)
    },
  }
}

function localProject(id: string): Project {
  return {
    key: { integration: 'local', id },
    name: id,
    openMaps: [],
    closedMaps: [],
    warnings: [],
  }
}

function unavailable(id: string): AdapterSlice {
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

function snapshotProjectIds(snapshot: Snapshot): string[] {
  return snapshot.projects.map((project) => project.key.id)
}

describe('RoadmapApplication', () => {
  it('adds an empty-map warning across integrations without mutating adapter diagnostics', async () => {
    const local = localProject('empty')
    const github: Project = {
      ...localProject('owner/repo'),
      key: { integration: 'github', id: 'owner/repo' },
      warnings: ['Source diagnostic'],
    }
    const adapter = immediateAdapter(sourceFixture([local], 1_000))
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({ ok: true, document: BASE_CONFIGURATION }).document,
      createAdapters: () => [
        adapter.adapter,
        {
          type: 'github',
          start(host) {
            host.update(sourceFixture([github], 1_000))
          },
          stop() {},
        },
      ],
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

  it('publishes only after the complete Adapter baseline is ready', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const adapter = deferredAdapter()
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => [adapter.adapter],
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
    await application.stop()
  })

  it('deduplicates semantically identical Adapter publications', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const adapter = immediateAdapter()
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => [adapter.adapter],
      serverEpoch: 'test',
    })
    await application.start()
    const states = vi.fn()
    application.subscribe(states)
    states.mockClear()

    adapter.push(EMPTY_SLICE)
    expect(states).not.toHaveBeenCalled()
    await application.stop()
  })

  it('keeps a committed Project and its last-known facts visible while unavailable', async () => {
    const registered: RoadmapConfiguration = {
      ...BASE_CONFIGURATION,
      projects: [
        {
          key: { integration: 'local', id: 'demo' },
          connectionId: 'local',
          locator: { integration: 'local', path: '/tmp/demo' },
          workspace: { path: '/tmp/demo' },
        },
      ],
    }
    const configuration = memoryConfiguration({ ok: true, document: registered })
    const adapter = immediateAdapter(sourceFixture([localProject('demo')], 25))
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => [adapter.adapter],
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
            key: githubProject.key,
            connectionId: 'github',
            locator: {
              integration: 'github',
              repositoryId: '42',
              nameWithOwner: 'acme/remote',
            },
            workspace: { path: '/unused/github-workspace', gitIdentity: '42' },
          },
        ],
      },
    })
    const local = immediateAdapter(sourceFixture([localProject('local-source')], clock))
    const githubHost: { current: AdapterHost | null } = { current: null }
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: (_configuration, runtime) => [
        local.adapter,
        {
          type: 'github',
          start(host) {
            githubHost.current = host
            runtime.setConnectionAvailability('github', { status: 'available', observedAt: clock })
            host.update(sourceFixture([githubProject], clock))
          },
          stop() {},
        },
      ],
      serverEpoch: 'source-time-test',
      now: () => clock,
    })
    try {
      await application.start()
      expect(application.current().projects[0]?.availability.observedAt).toBe(1_000)

      clock = 2_000
      if (!githubHost.current) throw new Error('GitHub Adapter did not start')
      githubHost.current.update({
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

      const retained = application.current().projects[0]
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
    const registered: RoadmapConfiguration = {
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
          key: githubProject.key,
          connectionId: 'github',
          locator: {
            integration: 'github',
            repositoryId: '42',
            nameWithOwner: 'acme/original',
          },
          workspace: { path: '/workspace', gitIdentity: '42' },
        },
      ],
    }
    const adapter: WayfinderAdapter = {
      type: 'github',
      start(host) {
        host.update(sourceFixture([githubProject], 1_000))
      },
      stop() {},
    }
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({ ok: true, document: registered }).document,
      createAdapters: () => [adapter],
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
            key,
            connectionId: 'github',
            locator: {
              integration: 'github',
              repositoryId: '42',
              nameWithOwner: 'acme/app',
            },
            workspace: { path: '/committed/source', gitIdentity: '42' },
          },
        ],
      },
    })
    const launch = vi.fn(async () => {})
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => [immediateAdapter().adapter],
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
            key: localKey,
            connectionId: 'local',
            locator: { integration: 'local', path: '/committed/local-source' },
            workspace: { path: '/committed/local-workspace' },
          },
          {
            key: githubKey,
            connectionId: 'github',
            locator: {
              integration: 'github',
              repositoryId: '42',
              nameWithOwner: 'acme/app',
            },
            workspace: { path: '/committed/github-workspace', gitIdentity: '42' },
          },
        ],
      },
    })
    const launch = vi.fn(async () => {})
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => [immediateAdapter().adapter],
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
      createAdapters: () => [immediateAdapter().adapter],
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
      key: { integration: 'local' as const, id: 'demo' },
      connectionId: 'local',
      locator: { integration: 'local' as const, path: '/tmp/demo' },
      workspace: { path: '/tmp/demo' },
    }
    const configured: RoadmapConfiguration = {
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
      createAdapters: () => [immediateAdapter().adapter],
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
      project: project.key,
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
        automation: { enabled: true, enabledProjects: [project.key] },
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
      state: { automation: { enabled: false, enabledProjects: [project.key] } },
    })
    await application.stop()
  })

  it('keeps global Automation off until both Harness Commands exist', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => [immediateAdapter().adapter],
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
    const configured: RoadmapConfiguration = {
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
      createAdapters: () => [immediateAdapter().adapter],
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
      createAdapters: () => [immediateAdapter().adapter],
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
    expect(application.current().automation.availability).toEqual({
      status: 'unavailable',
      cause:
        'Harness Command is invalid: $.automation.wayfinderCommand.command Must be a non-empty string.',
    })

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
    await vi.waitFor(() => expect(application.current().configuration.valid).toBe(true))
    expect(application.current().connections[0]?.name).toBe('On this Mac')
    await application.stop()
  })

  it('keeps the old generation live until a replacement baseline and ignores retired updates', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const first = immediateAdapter()
    const second = deferredAdapter()
    let generation = 0
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => (generation++ === 0 ? [first.adapter] : [second.adapter]),
      serverEpoch: 'test',
    })
    await application.start()

    configuration.emit({
      ok: true,
      document: {
        ...BASE_CONFIGURATION,
        configurationVersion: 2,
        connections: [{ ...LOCAL_CONNECTION, name: 'On this Mac' }],
      },
    })
    first.push(sourceFixture([localProject('still-live')], 1_000))
    await vi.waitFor(() =>
      expect(snapshotProjectIds(application.current().roadmap)).toEqual(['still-live']),
    )

    second.release()
    await vi.waitFor(() => expect(application.current().configurationVersion).toBe(2))
    expect(first.stopped).toBe(true)
    first.push(sourceFixture([localProject('late')], 1_000))
    expect(snapshotProjectIds(application.current().roadmap)).toEqual([])
    await application.stop()
  })

  it('commits configuration before exposing an unavailable replacement generation', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    let generation = 0
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => {
        generation += 1
        return [
          immediateAdapter(generation === 1 ? EMPTY_SLICE : unavailable('microsoft-risiko'))
            .adapter,
        ]
      },
      serverEpoch: 'test',
    })
    await application.start()

    const outcome = await application.execute({
      type: 'rename-connection',
      connectionId: 'local',
      name: 'On this Mac',
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
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const normalized = {
      key: { integration: 'local' as const, id: 'canonical' },
      connectionId: 'local',
      locator: { integration: 'local' as const, path: '/canonical' },
      workspace: { path: '/canonical' },
    }
    const generations: RoadmapConfiguration[] = []
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admission: {
        admit: vi.fn(async () => ({ ok: true as const, registration: normalized })),
        repair: vi.fn(async () => ({ ok: true as const, workspace: normalized.workspace })),
      },
      createAdapters(next) {
        generations.push(next)
        return [immediateAdapter().adapter]
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
    expect(generations.at(-1)?.projects).toEqual([normalized])
    await application.stop()
  })

  it('allows Workspace repair only for an unavailable registered Project', async () => {
    const registered: RoadmapConfiguration = {
      ...BASE_CONFIGURATION,
      projects: [
        {
          key: { integration: 'local', id: 'demo' },
          connectionId: 'local',
          locator: { integration: 'local', path: '/missing' },
          workspace: { path: '/missing' },
        },
      ],
    }
    const configuration = memoryConfiguration({ ok: true, document: registered })
    const repair = vi.fn(async () => ({
      ok: true as const,
      workspace: { path: '/canonical', gitIdentity: 'same' },
    }))
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admission: { admit: vi.fn(), repair },
      createAdapters: () => [immediateAdapter().adapter],
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
    expect(configuration.writes[0]?.projects[0]?.locator).toEqual({
      integration: 'local',
      path: '/canonical',
    })
    await application.stop()
  })

  it('cleans only orphan credentials without admitting secret data to state', async () => {
    const configuration = memoryConfiguration({ ok: true, document: BASE_CONFIGURATION })
    const cleanupOrphans = vi.fn(async () => {})
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => [immediateAdapter().adapter],
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
      sourcePath: `/tmp/ticket-policy/${id}.md`,
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
      id: 'map',
      sourcePath: '/tmp/ticket-policy/map.md',
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
    const adapter = immediateAdapter(
      sourceFixture(
        [{ key, name: 'Ticket policy', openMaps: [map], closedMaps: [], warnings: [] }],
        10,
      ),
    )
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({ ok: true, document: BASE_CONFIGURATION }).document,
      createAdapters: () => [adapter.adapter],
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
})
