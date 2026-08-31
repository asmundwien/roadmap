import type { MapBody, Project, ProjectRegistration, WayfinderMap } from '@roadmap/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalAdapter } from './adapter.ts'

const RISIKO_FIXTURE = '/Users/asmund.wien/source/hdir/platform/microsoft-risiko'
const PIPELINES_FIXTURE = '/Users/asmund.wien/source/hdir/felleskomponenter/frontend-pipelines'
const REAL_WATCH_PATHS = new Set([
  `${RISIKO_FIXTURE}/.wayfinder`,
  `${PIPELINES_FIXTURE}/.wayfinder`,
])

afterEach(() => {
  vi.useRealTimers()
})

describe('createLocalAdapter', () => {
  it('composes both standardized local projects into one baseline slice', async () => {
    const updates: { projects: Project[]; unreachable: unknown[] }[] = []
    const adapter = createLocalAdapter({
      registrations: [
        localRegistration('microsoft-risiko', RISIKO_FIXTURE, 'Microsoft Risiko'),
        localRegistration('frontend-pipelines', PIPELINES_FIXTURE, 'Frontend pipelines'),
      ],
      inspectRoot: async () => ({ ok: true }),
      pathExists: async (path) => REAL_WATCH_PATHS.has(path),
      watchDirectory: () => ({ close() {} }),
      logger: silentLogger(),
    })

    await adapter.start({ update: (slice) => updates.push(slice) })

    expect(updates).toHaveLength(1)
    expect(updates[0]?.unreachable).toEqual([])
    expect(updates[0]?.projects).toHaveLength(2)

    const risiko = updates[0]?.projects.find(
      (project) => project.key.integration === 'local' && project.key.id === 'microsoft-risiko',
    )
    expect(risiko).toMatchObject({
      name: 'Microsoft Risiko',
      warnings: [],
      sourcePath: RISIKO_FIXTURE,
    })
    expect(risiko?.openMaps[0]).toMatchObject({
      id: '.wayfinder/azure-strategy-leadership-deck/map.md',
      ticketsComplete: true,
      warnings: [],
    })

    const pipelines = updates[0]?.projects.find(
      (project) => project.key.integration === 'local' && project.key.id === 'frontend-pipelines',
    )
    expect(pipelines).toMatchObject({
      name: 'Frontend pipelines',
      warnings: [],
      sourcePath: PIPELINES_FIXTURE,
    })
    expect(pipelines?.openMaps[0]).toMatchObject({
      id: '.wayfinder/frontend-pipeline-versioning/map.md',
      ticketsComplete: true,
      warnings: [],
    })
    expect(pipelines?.openMaps[0]?.tickets.find((ticket) => ticket.id === '1')?.state).toBe(
      'closed',
    )

    await adapter.stop()
  })
  it('publishes a missing registered root as project-level unreachable on startup', async () => {
    vi.useFakeTimers()

    const adapter = createLocalAdapter({
      registrations: [localRegistration('missing', '/tmp/missing', 'Missing')],
      inspectRoot: async () => ({
        ok: false as const,
        reason: 'Registered path "/tmp/missing" does not exist right now.',
      }),
      pathExists: async () => false,
      watchDirectory: () => ({ close() {} }),
      logger: silentLogger(),
    })
    const updates: { projects: Project[]; unreachable: unknown[] }[] = []

    await adapter.start({ update: (slice) => updates.push(slice) })

    expect(updates).toEqual([
      {
        projects: [],
        unreachable: [
          {
            integration: 'local',
            project: { integration: 'local', id: 'missing' },
            projectName: 'Missing',
            reason: 'Registered path "/tmp/missing" does not exist right now.',
          },
        ],
      },
    ])

    await adapter.stop()
  })

  it('publishes a readable registered folder even when it has no Wayfinder map', async () => {
    const registration = localRegistration('empty', '/tmp/empty', 'Empty')
    const adapter = createLocalAdapter({
      registrations: [registration],
      inspectRoot: async () => ({ ok: true }),
      pathExists: async () => false,
      watchDirectory: () => ({ close() {} }),
      readProject: async () => ({
        key: registration.key,
        name: 'Empty',
        openMaps: [],
        closedMaps: [],
        warnings: ['No local maps found under .wayfinder/.'],
        sourcePath: '/tmp/empty',
      }),
      logger: silentLogger(),
    })
    const updates: { projects: Project[]; unreachable: unknown[] }[] = []

    await adapter.start({ update: (slice) => updates.push(slice) })

    expect(updates).toEqual([
      {
        projects: [
          expect.objectContaining({ key: registration.key, openMaps: [], closedMaps: [] }),
        ],
        unreachable: [],
      },
    ])
    await adapter.stop()
  })

  it('coalesces an atomic-save burst into one debounced whole-slice update', async () => {
    vi.useFakeTimers()

    let title = 'Before'
    let readCount = 0
    const harness = watchHarness('/tmp/demo')
    const adapter = createLocalAdapter({
      debounceMs: 50,
      maxDebounceMs: 200,
      reconcileMs: 60_000,
      recoveryMs: 20,
      maxRecoveryMs: 40,
      registrations: [localRegistration('demo', '/tmp/demo', 'Demo')],
      inspectRoot: harness.inspectRoot,
      pathExists: harness.pathExists,
      watchDirectory: harness.watchDirectory,
      readProject: async (input) => {
        readCount += 1
        expect(input.name).toBe('Demo')
        return project(input.key.id, input.name ?? input.key.id, title)
      },
      logger: silentLogger(),
    })
    const updates: { projects: Project[]; unreachable: unknown[] }[] = []

    await adapter.start({ update: (slice) => updates.push(slice) })
    expect(updates).toHaveLength(1)
    expect(readCount).toBe(1)

    title = 'After atomic save'
    harness.lastWatcher()?.dirty()
    harness.lastWatcher()?.dirty()
    harness.lastWatcher()?.dirty()
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(49)
    expect(updates).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(updates).toHaveLength(2)
    expect(readCount).toBe(2)
    expect(updates[1]?.projects[0]?.openMaps[0]?.title).toBe('After atomic save')
    expect(updates[1]?.unreachable).toEqual([])

    await adapter.stop()
    expect(harness.closedCount()).toBe(1)
  })

  it('surfaces a vanished root as unreachable, then recovers when the watcher path returns', async () => {
    vi.useFakeTimers()

    const harness = watchHarness('/tmp/demo')
    const adapter = createLocalAdapter({
      debounceMs: 10,
      maxDebounceMs: 100,
      reconcileMs: 60_000,
      recoveryMs: 20,
      maxRecoveryMs: 40,
      registrations: [localRegistration('demo', '/tmp/demo', 'Demo')],
      inspectRoot: harness.inspectRoot,
      pathExists: harness.pathExists,
      watchDirectory: harness.watchDirectory,
      readProject: async (input) => project(input.key.id, input.name ?? input.key.id, 'Live title'),
      logger: silentLogger(),
    })
    const updates: { projects: Project[]; unreachable: unknown[] }[] = []

    await adapter.start({ update: (slice) => updates.push(slice) })
    expect(updates).toHaveLength(1)
    expect(harness.watchCount()).toBe(1)

    harness.setLive(false)
    harness.lastWatcher()?.dirty()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10)

    expect(updates).toHaveLength(2)
    expect(updates[1]?.projects).toEqual([])
    expect(updates[1]?.unreachable).toEqual([
      {
        integration: 'local',
        project: { integration: 'local', id: 'demo' },
        projectName: 'Demo',
        reason: 'Registered path "/tmp/demo" does not exist right now.',
      },
    ])
    expect(harness.closedCount()).toBe(1)

    harness.setLive(true)
    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(10)

    expect(harness.watchCount()).toBe(2)
    expect(updates).toHaveLength(3)
    expect(updates[2]?.unreachable).toEqual([])
    expect(updates[2]?.projects[0]?.openMaps[0]?.title).toBe('Live title')

    await adapter.stop()
  })
})

function localRegistration(id: string, path: string, displayName?: string): ProjectRegistration {
  return {
    key: { integration: 'local', id },
    connectionId: 'local',
    locator: { integration: 'local', path },
    workspace: { path },
    ...(displayName ? { displayName } : {}),
  }
}

function watchHarness(rootPath: string) {
  let rootLive = true
  let watchPathLive = true
  const opened: FakeWatcher[] = []
  const watchPath = `${rootPath}/.wayfinder`

  return {
    setLive(live: boolean) {
      rootLive = live
      watchPathLive = live
    },
    inspectRoot: async () =>
      rootLive
        ? { ok: true as const }
        : {
            ok: false as const,
            reason: `Registered path ${JSON.stringify(rootPath)} does not exist right now.`,
          },
    pathExists: async (path: string) => path === watchPath && watchPathLive,
    watchDirectory: (path: string, onDirty: () => void, onError: (error: Error) => void) => {
      expect(path).toBe(watchPath)
      const watcher = new FakeWatcher(onDirty, onError)
      opened.push(watcher)
      return watcher
    },
    lastWatcher: () => opened.at(-1) ?? null,
    watchCount: () => opened.length,
    closedCount: () => opened.filter((watcher) => watcher.closed).length,
  }
}

class FakeWatcher {
  closed = false
  private readonly onDirty: () => void
  private readonly onError: (error: Error) => void

  constructor(onDirty: () => void, onError: (error: Error) => void) {
    this.onDirty = onDirty
    this.onError = onError
  }

  dirty(): void {
    this.onDirty()
  }

  error(message = 'boom'): void {
    this.onError(new Error(message))
  }

  close(): void {
    this.closed = true
  }
}

function project(id: string, name: string, title: string): Project {
  const map = openMap(id, title)
  return {
    key: { integration: 'local', id },
    name,
    openMaps: [map],
    closedMaps: [],
    warnings: [],
    sourcePath: `/tmp/${id}`,
  }
}

function openMap(projectId: string, title: string): WayfinderMap {
  return {
    project: { integration: 'local', id: projectId },
    id: '.wayfinder/map.md',
    title,
    isOpen: true,
    updatedAt: 1,
    body: emptyBody(),
    tickets: [],
    frontier: [],
    progress: { total: 0, completed: 0 },
    ticketsComplete: true,
    warnings: [],
    sourcePath: `/tmp/${projectId}/.wayfinder/map.md`,
  }
}

function emptyBody(): MapBody {
  return {
    raw: '',
    destination: '',
    notes: [],
    decisions: [],
    notYetSpecified: [],
    notYetSpecifiedNote: '',
    outOfScope: [],
    sections: [],
    missingSections: [],
  }
}

function silentLogger() {
  return {
    info() {},
    warn() {},
  }
}
