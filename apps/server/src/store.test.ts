import { describe, expect, it, vi } from 'vitest'
import type { AdapterHost, WayfinderAdapter } from './store.ts'
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
  visibility: 'public' as const,
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
    github.push({ projects: [githubProject], unreachable: [] })
    expect(store.snapshot().capturedAt).toBe(0)

    releaseLocal()
    await starting
    expect(store.snapshot().projects).toEqual([githubProject])
  })

  it('merges every adapter slice into one source-blind snapshot', async () => {
    const github = fakeAdapter('github')
    const local = fakeAdapter('local')
    const store = createSnapshotStore([github.adapter, local.adapter])

    await store.start()
    github.push({
      projects: [githubProject],
      unreachable: [
        {
          integration: 'github',
          project: githubProject.key,
          projectName: githubProject.name,
          mapId: '16',
          mapDisplayId: '#16',
          reason: 'gone',
        },
      ],
    })
    local.push({ projects: [localProject], unreachable: [] })

    expect(store.snapshot().projects.map((project) => project.name)).toEqual(['a/roadmap', 'demo'])
    expect(store.snapshot().unreachable).toHaveLength(1)
  })

  it('replaces an adapter by its whole current slice whenever that adapter updates', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])

    await store.start()
    github.push({ projects: [githubProject], unreachable: [] })
    github.push({ projects: [], unreachable: [] })

    expect(store.snapshot().projects).toEqual([])
  })

  it('hands the current snapshot to a late subscriber', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])

    await store.start()
    github.push({ projects: [githubProject], unreachable: [] })

    const late = vi.fn()
    store.onChange(late)
    expect(late).toHaveBeenCalledOnce()
    expect(late.mock.calls[0]?.[0].projects).toEqual([githubProject])
  })

  it('stays silent when an adapter republishes an identical slice', async () => {
    const github = fakeAdapter('github')
    const store = createSnapshotStore([github.adapter])

    await store.start()
    const changes = vi.fn()
    store.onChange(changes)
    github.push({ projects: [githubProject], unreachable: [] })
    changes.mockClear()

    github.push({ projects: [githubProject], unreachable: [] })
    expect(changes).not.toHaveBeenCalled()
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
