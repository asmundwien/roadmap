import { describe, expect, it, vi } from 'vitest'
import type { AdapterHost, ObservationAttempt, WayfinderAdapter } from './observation/source.ts'
import { sourceFixture } from './source-test-fixtures.ts'
import { createSnapshotStore } from './store.ts'

function fakeAdapter(type: WayfinderAdapter['type'], ready: Promise<void> = Promise.resolve()) {
  let host: AdapterHost | null = null
  const stop = vi.fn(async () => {})
  const adapter: WayfinderAdapter = {
    type,
    async start(nextHost) {
      host = nextHost
      await ready
    },
    stop,
  }
  return {
    adapter,
    push(slice: Parameters<AdapterHost['update']>[0]) {
      if (!host) throw new Error('adapter not started')
      host.update(slice)
    },
    stop,
  }
}

const githubProject = {
  key: { integration: 'github' as const, id: 'a/roadmap' },
  name: 'a/roadmap',
  openMaps: [],
  closedMaps: [],
  warnings: [],
}

const localProject = {
  key: { integration: 'local' as const, id: 'demo' },
  name: 'demo',
  openMaps: [],
  closedMaps: [],
  warnings: [],
}

const githubSlice = sourceFixture([githubProject], 100)
const localSlice = sourceFixture([localProject], 200)
const failedMap: ObservationAttempt = {
  kind: 'failed',
  scope: { kind: 'map', map: { project: githubProject.key, mapId: '16' } },
  attemptedAt: 300,
  provenance: {
    integration: 'github',
    connectionId: 'github',
    repositoryId: 'a/roadmap',
    stage: 'map-read',
  },
  failure: { kind: 'access-ambiguous', evidence: 'null-resource' },
}

describe('createSnapshotStore', () => {
  it('keeps partial Adapter baselines private until every Adapter is ready', async () => {
    let releaseLocal = (): void => {
      throw new Error('local readiness resolver was not installed')
    }
    const localReady = new Promise<void>((resolve) => {
      releaseLocal = resolve
    })
    const github = fakeAdapter('github')
    const local = fakeAdapter('local', localReady)
    const store = createSnapshotStore([github.adapter, local.adapter])

    const starting = store.start()
    await Promise.resolve()
    github.push(githubSlice)
    expect(store.snapshot().capturedAt).toBe(0)
    expect(store.snapshot().attempts).toEqual([])

    releaseLocal()
    await starting
    expect(store.snapshot().attempts).toEqual(githubSlice.attempts)
  })

  it('merges every adapter slice into one source-blind snapshot', async () => {
    const github = fakeAdapter('github')
    const local = fakeAdapter('local')
    const store = createSnapshotStore([github.adapter, local.adapter])

    await store.start()
    github.push({ attempts: [...githubSlice.attempts, failedMap] })
    local.push(localSlice)

    expect(store.snapshot().attempts).toEqual([
      ...githubSlice.attempts,
      failedMap,
      ...localSlice.attempts,
    ])
  })

  it('replaces an adapter by its whole current slice whenever that adapter updates', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])

    await store.start()
    github.push(githubSlice)
    github.push({ attempts: [] })

    expect(store.snapshot().attempts).toEqual([])
  })

  it('hands the current snapshot to a late subscriber', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])

    await store.start()
    github.push(githubSlice)

    const late = vi.fn()
    store.onChange(late)
    expect(late).toHaveBeenCalledOnce()
    expect(late.mock.calls[0]?.[0]).toEqual(store.snapshot())
  })

  it('stays silent when an adapter republishes an identical slice', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])

    await store.start()
    const changes = vi.fn()
    store.onChange(changes)
    github.push(githubSlice)
    changes.mockClear()

    github.push(githubSlice)
    expect(changes).not.toHaveBeenCalled()
  })

  it('retains prior contribution when an Adapter publishes another Integration', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])
    await store.start()
    github.push(githubSlice)
    github.push(localSlice)
    expect(store.snapshot().attempts).toEqual(githubSlice.attempts)
  })

  it('rejects contradictory publications for the same scope without losing prior evidence', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])
    await store.start()
    github.push(githubSlice)
    const previous = store.snapshot()
    const project = githubSlice.attempts.find((attempt) => attempt.scope.kind === 'project')
    if (!project) throw new Error('Missing fixture project evidence')
    github.push({
      attempts: [
        project,
        {
          kind: 'failed',
          scope: project.scope,
          attemptedAt: 300,
          provenance: project.provenance,
          failure: { kind: 'execution', cause: 'provider' },
        },
      ],
    })
    expect(store.snapshot()).toBe(previous)
  })

  it('rejects runtime malformed content without publishing raw diagnostics', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])
    await store.start()
    github.push(githubSlice)
    const previous = store.snapshot()
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const failure = {
        kind: 'execution',
        cause: 'provider',
        message: 'credential-secret',
      } as const
      github.push({ attempts: [{ ...failedMap, failure }] })
      expect(store.snapshot()).toBe(previous)
      expect(warnings.mock.calls.flat().join(' ')).not.toContain('credential-secret')
    } finally {
      warnings.mockRestore()
    }
  })
  it('stops every adapter', async () => {
    const github = fakeAdapter('github')
    const local = fakeAdapter('local')
    const store = createSnapshotStore([github.adapter, local.adapter])

    await store.start()
    await store.stop()

    expect(github.stop).toHaveBeenCalledOnce()
    expect(local.stop).toHaveBeenCalledOnce()
  })
})
