import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterSlice, ObservationAttempt } from '../observation/source.ts'
import { type LocalProjectInput, readLocalProject } from '../wayfinder/from-local.ts'
import { createLocalAdapter } from './adapter.ts'

const fixtureRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('createLocalAdapter', () => {
  it('commits independently readable canonical sources into one baseline attempt set', async () => {
    const firstRoot = await createFixture('first-map')
    const secondRoot = await createFixture('second-map')
    const updates: AdapterSlice[] = []
    const adapter = createLocalAdapter({
      sources: [source('first', firstRoot, 'First'), source('second', secondRoot, 'Second')],
      pathExists: async () => true,
      watchDirectory: () => ({ close() {} }),
      logger: silentLogger(),
    })
    try {
      await adapter.start({ update: (slice) => updates.push(slice) })
      expect(updates).toHaveLength(1)
      expect(updates[0]?.attempts.filter((attempt) => attempt.kind === 'failed')).toEqual([])
      expect(updates[0]?.attempts).toContainEqual(
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'project', project: { integration: 'local', id: 'first' } },
          value: expect.objectContaining({
            name: 'First',
            source: { integration: 'local', path: firstRoot },
          }),
        }),
      )
      expect(updates[0]?.attempts).toContainEqual(
        expect.objectContaining({
          kind: 'observed',
          scope: {
            kind: 'map',
            map: {
              project: { integration: 'local', id: 'second' },
              mapId: '.wayfinder/second-map/map.md',
            },
          },
        }),
      )
    } finally {
      await adapter.stop()
    }
  })

  it('publishes a never-readable root failure without a successful time', async () => {
    const root = await createFixture('missing-map')
    await rm(root, { recursive: true })
    const updates: AdapterSlice[] = []
    const adapter = createLocalAdapter({
      sources: [source('missing', root)],
      pathExists: async () => false,
      logger: silentLogger(),
    })
    try {
      await adapter.start({ update: (slice) => updates.push(slice) })
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
    } finally {
      await adapter.stop()
    }
  })

  it('publishes complete-empty membership only after successful enumeration', async () => {
    const root = await createFixture('removed-map')
    await rm(join(root, '.wayfinder/removed-map'), { recursive: true })
    const updates: AdapterSlice[] = []
    const adapter = createLocalAdapter({
      sources: [source('empty', root)],
      pathExists: async () => false,
      logger: silentLogger(),
    })
    try {
      await adapter.start({ update: (slice) => updates.push(slice) })
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
      await adapter.stop()
    }
  })

  it('coalesces an atomic-save burst into one debounced whole-attempt update', async () => {
    vi.useFakeTimers()
    const root = await createFixture('active')
    const harness = watchHarness(root)
    let readCount = 0
    const reader = trackedReader()
    const updates: AdapterSlice[] = []
    const adapter = createLocalAdapter({
      sources: [source('demo', root, 'Demo')],
      debounceMs: 50,
      maxDebounceMs: 200,
      reconcileMs: 60_000,
      pathExists: harness.pathExists,
      watchDirectory: harness.watchDirectory,
      readProject: async (input) => {
        readCount += 1
        return reader.read(input)
      },
      logger: silentLogger(),
    })
    try {
      await adapter.start({ update: (slice) => updates.push(slice) })
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
      await adapter.stop()
    }
    expect(harness.closedCount()).toBe(1)
  })

  it('supervises a vanished tree and recovers under the same identity', async () => {
    vi.useFakeTimers()
    const root = await createFixture('active')
    const harness = watchHarness(root)
    const updates: AdapterSlice[] = []
    const reader = trackedReader()
    const adapter = createLocalAdapter({
      sources: [source('opaque-demo', root)],
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
      await adapter.start({ update: (slice) => updates.push(slice) })
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
      await adapter.stop()
    }
  })

  it('supersedes only failed scope evidence while retaining unaffected named scopes and their times', async () => {
    vi.useFakeTimers()
    const root = await createFixture('known-map')
    const updates: AdapterSlice[] = []
    let failure = false
    const adapter = createLocalAdapter({
      sources: [source('admitted-key', root)],
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
      await adapter.start({ update: (slice) => updates.push(slice) })
      const priorMap = onlyMap(updates[0])
      failure = true
      await vi.advanceTimersByTimeAsync(10)
      expect(onlyMap(updates.at(-1))).toEqual(priorMap)
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
      await adapter.stop()
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
    const updates: AdapterSlice[] = []
    const reader = trackedReader()
    const adapter = createLocalAdapter({
      sources: [source('admitted-key', root)],
      readProject: reader.read,
      reconcileMs: 10,
      pathExists: async () => false,
      logger: silentLogger(),
    })
    try {
      await adapter.start({ update: (slice) => updates.push(slice) })
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
      await adapter.stop()
    }
  })

  it('does not serialize watcher exception text into logger messages', async () => {
    vi.useFakeTimers()
    const root = await createFixture('known-map')
    const harness = watchHarness(root)
    const messages: string[] = []
    const adapter = createLocalAdapter({
      sources: [source('demo', root)],
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
      await adapter.start({ update() {} })
      harness.lastWatcher()?.error('secret read payload')
      expect(messages.join('\n')).not.toContain('secret read payload')
      expect(messages).toHaveLength(1)
    } finally {
      await adapter.stop()
    }
  })
})

function source(id: string, rootPath: string, name?: string): LocalProjectInput {
  return { key: { integration: 'local', id }, rootPath, name }
}

function onlyMap(
  slice: AdapterSlice | undefined,
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
  let pending: Promise<AdapterSlice> = Promise.resolve({ attempts: [] })
  return {
    read(input: LocalProjectInput) {
      pending = readLocalProject(input)
      return pending
    },
    async settle() {
      await pending
      await setImmediate()
    },
  }
}

async function createFixture(mapId: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-local-adapter-'))
  fixtureRoots.push(root)
  await writeMap(root, mapId, mapId)
  return root
}

async function writeMap(root: string, mapId: string, title: string): Promise<void> {
  const directory = join(root, '.wayfinder', mapId)
  await mkdir(join(directory, 'tickets'), { recursive: true })
  await writeFile(
    join(directory, 'map.md'),
    `---\ntitle: ${title}\nlabels: [wayfinder:map]\nstatus: open\n---\n\n# ${title}\n`,
  )
}
