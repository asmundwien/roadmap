import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalObservationInput } from '../observation/coordinator.ts'
import type {
  ObservationAttempt,
  ObservationBatch,
  SourceContribution,
} from '../observation/source.ts'
import { createLocalProjectRegistration, refineLocalWorkspaceProof } from '../projects/registry.ts'
import { type LocalProjectReadOptions, readLocalProject } from '../wayfinder/from-local.ts'
import { createLocalObserver } from './observer.ts'

const fixtureRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('createLocalObserver', () => {
  it('keeps independent admitted source baselines scoped to their own identities', async () => {
    const firstRoot = await createFixture('first-map')
    const secondRoot = await createFixture('second-map')
    const options = {
      pathExists: async () => true,
      watchDirectory: () => ({ close() {} }),
      logger: silentLogger(),
    }
    const first = createLocalObserver(source('first', firstRoot), options)
    const second = createLocalObserver(source('second', secondRoot), options)
    try {
      const [firstBaseline, secondBaseline] = await Promise.all([first.observe(), second.observe()])
      expect(firstBaseline.project).toEqual({ integration: 'local', id: 'first' })
      expect(secondBaseline.project).toEqual({ integration: 'local', id: 'second' })
      expect(firstBaseline.health.status).toBe('available')
      expect(secondBaseline.health.status).toBe('available')
      expect(onlyMap(firstBaseline).value.key).toEqual({
        project: { integration: 'local', id: 'first' },
        mapId: '.wayfinder/first-map/map.md',
      })
      expect(onlyMap(secondBaseline).value.key).toEqual({
        project: { integration: 'local', id: 'second' },
        mapId: '.wayfinder/second-map/map.md',
      })
    } finally {
      await Promise.all([first.stop(), second.stop()])
    }
  })

  it('publishes a never-readable root failure without a successful time', async () => {
    const root = await createFixture('missing-map')
    const admittedInput = source('missing', root)
    await rm(root, { recursive: true })
    const updates: SourceContribution[] = []
    const observer = createLocalObserver(admittedInput, {
      pathExists: async () => false,
      logger: silentLogger(),
    })
    try {
      observer.subscribe((contribution) => updates.push(contribution))
      await observer.observe()
      expect(updates[0]?.attempts).toEqual([
        {
          kind: 'failed',
          scope: { kind: 'project', project: { integration: 'local', id: 'missing' } },
          attemptedAt: expect.any(Number),
          provenance: { integration: 'local', path: root, operation: 'inspect-root' },
          failure: { kind: 'filesystem', operation: 'inspect-root', code: 'ENOENT' },
        },
      ])
      expect(updates[0]?.attempts[0]).not.toHaveProperty('observedAt')
      expect(updates[0]?.health.status).toBe('unavailable')
      expect(updates[0]?.health).not.toHaveProperty('observedAt')
    } finally {
      await observer.stop()
    }
  })

  it('publishes complete-empty membership only after successful enumeration', async () => {
    const root = await createFixture('removed-map')
    await rm(join(root, '.wayfinder/removed-map'), { recursive: true })
    const updates: SourceContribution[] = []
    const observer = createLocalObserver(source('empty', root), {
      pathExists: async () => false,
      logger: silentLogger(),
    })
    try {
      observer.subscribe((contribution) => updates.push(contribution))
      await observer.observe()
      expect(updates[0]?.attempts).toContainEqual(
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'maps-membership', project: { integration: 'local', id: 'empty' } },
          completeness: { kind: 'complete' },
          value: { members: [] },
          observedAt: expect.any(Number),
        }),
      )
    } finally {
      await observer.stop()
    }
  })

  it('coalesces an atomic-save burst into one debounced whole-attempt update', async () => {
    vi.useFakeTimers()
    const root = await createFixture('active')
    const harness = watchHarness(root)
    let readCount = 0
    const reader = trackedReader()
    const updates: SourceContribution[] = []
    const observer = createLocalObserver(source('demo', root), {
      debounceMs: 50,
      maxDebounceMs: 200,
      reconcileMs: 60_000,
      pathExists: harness.pathExists,
      watchDirectory: harness.watchDirectory,
      readProject: async (input, options) => {
        readCount += 1
        return reader.read(input, options)
      },
      logger: silentLogger(),
    })
    try {
      observer.subscribe((contribution) => updates.push(contribution))
      await observer.observe()
      await writeMap(root, 'active', 'After atomic save')
      harness.lastWatcher()?.dirty()
      harness.lastWatcher()?.dirty()
      harness.lastWatcher()?.dirty()
      await vi.advanceTimersByTimeAsync(49)
      expect(updates).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      await reader.settle()
      expect(updates).toHaveLength(2)
      expect(readCount).toBe(2)
      expect(onlyMap(updates[1]).value.title).toBe('After atomic save')
    } finally {
      await observer.stop()
    }
    expect(harness.closedCount()).toBe(1)
  })

  it('supervises a vanished tree and recovers under the same identity', async () => {
    vi.useFakeTimers()
    const root = await createFixture('active')
    const harness = watchHarness(root)
    const updates: SourceContribution[] = []
    const reader = trackedReader()
    const observer = createLocalObserver(source('opaque-demo', root), {
      debounceMs: 10,
      reconcileMs: 60_000,
      recoveryMs: 20,
      maxRecoveryMs: 40,
      pathExists: harness.pathExists,
      watchDirectory: harness.watchDirectory,
      logger: silentLogger(),
      readProject: reader.read,
    })
    try {
      observer.subscribe((contribution) => updates.push(contribution))
      await observer.observe()
      const earlierMap = onlyMap(updates[0])
      await rm(root, { recursive: true })
      harness.setLive(false)
      harness.lastWatcher()?.dirty()
      await vi.advanceTimersByTimeAsync(10)
      await reader.settle()
      expect(updates.at(-1)?.attempts).toContainEqual(
        expect.objectContaining({
          kind: 'failed',
          scope: { kind: 'project', project: { integration: 'local', id: 'opaque-demo' } },
          failure: { kind: 'filesystem', operation: 'inspect-root', code: 'ENOENT' },
        }),
      )
      expect(onlyMap(updates.at(-1))).toEqual(earlierMap)
      expect(harness.closedCount()).toBe(1)
      await writeMap(root, 'active', 'Recovered')
      harness.setLive(true)
      await vi.advanceTimersByTimeAsync(20)
      await vi.advanceTimersByTimeAsync(10)
      await reader.settle()
      expect(harness.watchCount()).toBe(2)
      expect(onlyMap(updates.at(-1)).value).toMatchObject({
        key: earlierMap.value.key,
        title: 'Recovered',
      })
      expect(updates.at(-1)?.attempts.filter((attempt) => attempt.kind === 'failed')).toEqual([])
    } finally {
      await observer.stop()
    }
  })

  it('supersedes only failed scope evidence while retaining unaffected named scopes and their times', async () => {
    vi.useFakeTimers()
    const root = await createFixture('known-map')
    const updates: SourceContribution[] = []
    let failure = false
    const observer = createLocalObserver(source('admitted-key', root), {
      reconcileMs: 10,
      pathExists: async () => false,
      readProject: async (input) => {
        if (failure)
          throw Object.assign(new Error('secret provider payload must not escape'), {
            code: 'EACCES',
          })
        return readLocalProject(input)
      },
      logger: silentLogger(),
    })
    try {
      observer.subscribe((contribution) => updates.push(contribution))
      await observer.observe()
      const priorMap = onlyMap(updates[0])
      const priorSuccessfulAt = updates[0]?.health.observedAt
      expect(priorSuccessfulAt).toEqual(expect.any(Number))
      failure = true
      await vi.advanceTimersByTimeAsync(10)
      expect(onlyMap(updates.at(-1))).toEqual(priorMap)
      expect(updates.at(-1)?.health).toMatchObject({
        status: 'unavailable',
        observedAt: priorSuccessfulAt,
      })
      expect(updates.at(-1)?.attempts).toContainEqual(
        expect.objectContaining({
          kind: 'failed',
          scope: { kind: 'project', project: { integration: 'local', id: 'admitted-key' } },
          failure: { kind: 'filesystem', operation: 'read', code: 'EACCES' },
        }),
      )
      expect(
        updates
          .at(-1)
          ?.attempts.some(
            (attempt) => attempt.kind === 'observed' && attempt.scope.kind === 'project',
          ),
      ).toBe(false)
      expect(JSON.stringify(updates.at(-1))).not.toContain('secret provider payload')
    } finally {
      await observer.stop()
    }
  })

  it('proves omitted maps and tickets absent only through complete parent membership', async () => {
    vi.useFakeTimers()
    const root = await createFixture('known-map')
    const ticketPath = join(root, '.wayfinder/known-map/tickets/01.md')
    await writeFile(
      ticketPath,
      '---\nid: 1\ntitle: Ticket\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: []\n---\n\nHistorical prose.\n',
    )
    const updates: SourceContribution[] = []
    const reader = trackedReader()
    const observer = createLocalObserver(source('admitted-key', root), {
      readProject: reader.read,
      reconcileMs: 10,
      pathExists: async () => false,
      logger: silentLogger(),
    })
    try {
      observer.subscribe((contribution) => updates.push(contribution))
      await observer.observe()
      await rm(ticketPath)
      await vi.advanceTimersByTimeAsync(10)
      await reader.settle()
      expect(updates.at(-1)?.attempts).toContainEqual(
        expect.objectContaining({
          kind: 'proven-absent',
          scope: {
            kind: 'ticket',
            ticket: {
              map: {
                project: { integration: 'local', id: 'admitted-key' },
                mapId: '.wayfinder/known-map/map.md',
              },
              ticketId: '1',
            },
          },
          proof: {
            kind: 'complete-membership',
            parent: {
              kind: 'tickets-membership',
              map: {
                project: { integration: 'local', id: 'admitted-key' },
                mapId: '.wayfinder/known-map/map.md',
              },
            },
          },
        }),
      )
      await rm(join(root, '.wayfinder/known-map'), { recursive: true })
      await vi.advanceTimersByTimeAsync(10)
      await reader.settle()
      expect(updates.at(-1)?.attempts).toContainEqual(
        expect.objectContaining({
          kind: 'proven-absent',
          scope: {
            kind: 'map',
            map: {
              project: { integration: 'local', id: 'admitted-key' },
              mapId: '.wayfinder/known-map/map.md',
            },
          },
          proof: {
            kind: 'complete-membership',
            parent: {
              kind: 'maps-membership',
              project: { integration: 'local', id: 'admitted-key' },
            },
          },
        }),
      )
    } finally {
      await observer.stop()
    }
  })

  it('refreshes identical content with a new successful time and stops subscription delivery', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const root = await createFixture('active')
    const updates: SourceContribution[] = []
    const observer = createLocalObserver(source('demo', root), {
      pathExists: async () => false,
      logger: silentLogger(),
    })
    const unsubscribe = observer.subscribe((contribution) => updates.push(contribution))
    try {
      const baseline = await observer.observe()
      expect(await observer.observe()).toEqual(baseline)
      expect(updates).toHaveLength(1)
      vi.setSystemTime(2_000)
      const refreshed = await observer.refresh()
      expect(onlyMap(refreshed).value).toEqual(onlyMap(baseline).value)
      expect(onlyMap(refreshed).observedAt).toBe(2_000)
      expect(refreshed.health).toEqual({ status: 'available', observedAt: 2_000 })
      expect(updates).toHaveLength(2)
      unsubscribe()
      vi.setSystemTime(3_000)
      expect((await observer.refresh()).health).toEqual({ status: 'available', observedAt: 3_000 })
      expect(updates).toHaveLength(2)
    } finally {
      await observer.stop()
    }
    await expect(observer.refresh()).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(updates).toHaveLength(2)
  })

  it('does not serialize watcher exception text into logger messages', async () => {
    vi.useFakeTimers()
    const root = await createFixture('known-map')
    const harness = watchHarness(root)
    const messages: string[] = []
    const observer = createLocalObserver(source('demo', root), {
      pathExists: harness.pathExists,
      watchDirectory: harness.watchDirectory,
      logger: {
        info() {},
        warn: (...args) => {
          messages.push(JSON.stringify(args))
        },
      },
    })
    try {
      await observer.observe()
      harness.lastWatcher()?.error('secret read payload')
      expect(messages.join('\n')).not.toContain('secret read payload')
      expect(messages).toHaveLength(1)
    } finally {
      await observer.stop()
    }
  })
})

function source(id: string, path: string): LocalObservationInput {
  const proof = refineLocalWorkspaceProof({
    inspection: { integration: 'local', path, readable: true, searchable: true },
  })
  if (!proof.ok) throw new Error(proof.error.message)
  const registration = createLocalProjectRegistration({
    ref: { integration: 'local', projectId: id },
    connection: { id: 'local', integration: 'local', name: 'Local', builtIn: true },
    workspace: proof.value,
  })
  if (!registration.ok) throw new Error(registration.error.message)
  return {
    integration: 'local',
    ref: registration.value.ref,
    workspace: registration.value.workspace,
  }
}

function onlyMap(
  slice: ObservationBatch | undefined,
): Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'map' } }> {
  const map = slice?.attempts.find(
    (
      attempt,
    ): attempt is Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'map' } }> =>
      attempt.kind === 'observed' && attempt.scope.kind === 'map',
  )
  if (!map) throw new Error('Expected readable map evidence.')
  return map
}

function watchHarness(rootPath: string) {
  let live = true
  const opened: FakeWatcher[] = []
  return {
    setLive(value: boolean) {
      live = value
    },
    pathExists: async (path: string) => path === join(rootPath, '.wayfinder') && live,
    watchDirectory: (path: string, onDirty: () => void, onError: (error: Error) => void) => {
      expect(path).toBe(join(rootPath, '.wayfinder'))
      const watcher = new FakeWatcher(onDirty, onError)
      opened.push(watcher)
      return watcher
    },
    lastWatcher: () => opened.at(-1),
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
  error(message: string): void {
    this.onError(new Error(message))
  }
  close(): void {
    this.closed = true
  }
}

function silentLogger() {
  return { info() {}, warn() {} }
}

function trackedReader() {
  let pending: Promise<ObservationBatch> = Promise.resolve({ attempts: [] })
  return {
    read(input: LocalObservationInput, options: LocalProjectReadOptions) {
      pending = readLocalProject(input, options)
      return pending
    },
    async settle() {
      await pending
      await setImmediate()
    },
  }
}

async function createFixture(mapId: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-local-observer-'))
  fixtureRoots.push(root)
  await writeMap(root, mapId, mapId)
  return root
}

async function writeMap(root: string, mapId: string, title: string): Promise<void> {
  const directory = join(root, '.wayfinder', mapId)
  await mkdir(join(directory, 'tickets'), { recursive: true })
  await writeFile(
    join(directory, 'map.md'),
    `---\ntitle: ${title}\nlabels: [wayfinder:map]\nstatus: open\n---\n\n# ${title}\n\n## Destination\n\nReach the destination.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n`,
  )
}
