import type { Project, Snapshot, Unreachable } from '@roadmap/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { AdapterHost, AdapterSlice, WayfinderAdapter } from '../store.ts'
import { createRoadmapApplication } from './application.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
  RoadmapConfiguration,
} from './configuration.ts'

const EMPTY_SLICE: AdapterSlice = { projects: [], unreachable: [] }
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

function unavailable(id: string): Unreachable {
  return {
    integration: 'local',
    project: { integration: 'local', id },
    projectName: id,
    reason: 'Workspace cannot be read.',
  }
}

function snapshotProjectIds(snapshot: Snapshot): string[] {
  return snapshot.projects.map((project) => project.key.id)
}

describe('RoadmapApplication', () => {
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
    const adapter = immediateAdapter({ projects: [localProject('demo')], unreachable: [] })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      createAdapters: () => [adapter.adapter],
      serverEpoch: 'test',
      now: () => 25,
    })
    await application.start()

    adapter.push({ projects: [], unreachable: [unavailable('demo')] })

    expect(application.current().projects).toEqual([
      expect.objectContaining({
        name: 'demo',
        availability: {
          status: 'unavailable',
          cause: 'Workspace cannot be read.',
          observedAt: 25,
        },
        actions: expect.arrayContaining([
          { id: 'open-workspace', label: 'Open Workspace in VS Code', kind: 'server-launch' },
          { id: 'reveal-source', label: 'Reveal source folder', kind: 'server-launch' },
        ]),
      }),
    ])
    await application.stop()
  })

  it('projects the current GitHub source URL without changing the stable route key', async () => {
    const githubProject: Project = {
      key: { integration: 'github', id: 'stable/route' },
      name: 'acme/renamed',
      visibility: 'private',
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
        host.update({ projects: [githubProject], unreachable: [] })
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
          id: 'open-source',
          label: 'Open on GitHub',
          kind: 'external-link',
          href: 'https://github.com/acme/renamed',
        },
      ]),
    })
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
    first.push({ projects: [localProject('still-live')], unreachable: [] })
    await vi.waitFor(() =>
      expect(snapshotProjectIds(application.current().roadmap)).toEqual(['still-live']),
    )

    second.release()
    await vi.waitFor(() => expect(application.current().configurationVersion).toBe(2))
    expect(first.stopped).toBe(true)
    first.push({ projects: [localProject('late')], unreachable: [] })
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
          immediateAdapter(
            generation === 1
              ? EMPTY_SLICE
              : { projects: [], unreachable: [unavailable('microsoft-risiko')] },
          ).adapter,
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
    expect(outcome.state.roadmap.unreachable).toEqual([unavailable('microsoft-risiko')])
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
})
