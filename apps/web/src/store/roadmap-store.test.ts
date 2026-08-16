import type { Project, Snapshot } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { createRoadmapStore, type SocketLike } from './roadmap-store.ts'

type SocketEvent = 'open' | 'message' | 'close'

class FakeSocket implements SocketLike {
  closed = false
  private listeners: Record<SocketEvent, ((event: { data?: unknown }) => void)[]> = {
    open: [],
    message: [],
    close: [],
  }

  addEventListener(type: SocketEvent, listener: (event: { data?: unknown }) => void): void {
    this.listeners[type].push(listener)
  }

  close(): void {
    this.closed = true
  }

  emit(type: SocketEvent, data?: unknown): void {
    for (const listener of this.listeners[type]) listener({ data })
  }
}

function project(nameWithOwner: string): Project {
  const [owner = '', repo = ''] = nameWithOwner.split('/')
  return { nameWithOwner, owner, repo, isPrivate: false, openMaps: [], closedMaps: [] }
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { capturedAt: 1000, projects: [], unreachable: [], rateLimit: null, ...overrides }
}

function wire(message: Snapshot): string {
  return JSON.stringify({ type: 'snapshot', snapshot: message })
}

/** A store wired to fakes: sockets are captured for driving, reconnect fires via `delays`. */
function harness() {
  const sockets: FakeSocket[] = []
  const delays: number[] = []
  const store = createRoadmapStore('ws://test/ws', {
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    reconnectDelayMs: (attempt) => {
      delays.push(attempt)
      return 0
    },
  })
  return { store, sockets, delays }
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createRoadmapStore', () => {
  it('starts connecting with an empty snapshot', () => {
    const { store, sockets } = harness()
    expect(store.getSnapshot()).toEqual({
      connection: 'connecting',
      projects: [],
      unreachable: [],
      rateLimit: null,
      capturedAt: null,
    })
    expect(sockets).toHaveLength(0)
  })

  it('opens one socket no matter how many watchers start', () => {
    const { store, sockets } = harness()
    store.start()
    store.start()
    expect(sockets).toHaveLength(1)
  })

  it('goes live on open and replaces the snapshot wholesale on every message', () => {
    const { store, sockets } = harness()
    store.start()
    const socket = sockets[0]
    if (!socket) throw new Error('no socket opened')

    socket.emit('open')
    expect(store.getSnapshot().connection).toBe('live')

    socket.emit('message', wire(snapshot({ capturedAt: 1000, projects: [project('a/one')] })))
    expect(store.getSnapshot().projects.map((p) => p.nameWithOwner)).toEqual(['a/one'])

    socket.emit('message', wire(snapshot({ capturedAt: 2000, projects: [project('b/two')] })))
    const replaced = store.getSnapshot()
    expect(replaced.projects.map((p) => p.nameWithOwner)).toEqual(['b/two'])
    expect(replaced.capturedAt).toBe(2000)
  })

  it('drops unparsable and unknown messages, keeping the last snapshot', () => {
    const { store, sockets } = harness()
    store.start()
    const socket = sockets[0]
    if (!socket) throw new Error('no socket opened')

    socket.emit('open')
    socket.emit('message', wire(snapshot({ capturedAt: 1000 })))
    socket.emit('message', 'not json')
    socket.emit('message', JSON.stringify({ type: 'mystery' }))
    socket.emit('message', 12345)

    expect(store.getSnapshot().capturedAt).toBe(1000)
    expect(store.getSnapshot().connection).toBe('live')
  })

  it('marks the kept snapshot disconnected when the socket drops, then reconnects', async () => {
    const { store, sockets } = harness()
    store.start()
    sockets[0]?.emit('open')
    sockets[0]?.emit('message', wire(snapshot({ capturedAt: 1000, projects: [project('a/one')] })))

    sockets[0]?.emit('close')
    const stale = store.getSnapshot()
    expect(stale.connection).toBe('disconnected')
    expect(stale.projects.map((p) => p.nameWithOwner)).toEqual(['a/one'])
    expect(stale.capturedAt).toBe(1000)

    await flushTimers()
    expect(sockets).toHaveLength(2)
    sockets[1]?.emit('open')
    expect(store.getSnapshot().connection).toBe('live')
  })

  it('backs off with the attempt count and resets it on a successful open', async () => {
    const { store, sockets, delays } = harness()
    store.start()

    sockets[0]?.emit('close')
    await flushTimers()
    sockets[1]?.emit('close')
    await flushTimers()
    expect(delays).toEqual([0, 1])

    sockets[2]?.emit('open')
    sockets[2]?.emit('close')
    await flushTimers()
    expect(delays).toEqual([0, 1, 0])
  })

  it('closes the socket and stops reconnecting once the last watcher stops', async () => {
    const { store, sockets } = harness()
    const stopFirst = store.start()
    const stopLast = store.start()

    stopFirst()
    expect(sockets[0]?.closed).toBe(false)

    stopLast()
    expect(sockets[0]?.closed).toBe(true)

    // A close event from the socket we abandoned must not schedule a comeback.
    sockets[0]?.emit('close')
    await flushTimers()
    expect(sockets).toHaveLength(1)
    expect(store.getSnapshot().connection).toBe('connecting')
  })

  it('reconnects rather than double-connecting when a watcher restarts mid-backoff', async () => {
    const { store, sockets } = harness()
    store.start()
    sockets[0]?.emit('close')

    // A second watcher arrives while the reconnect timer is pending.
    store.start()
    await flushTimers()
    expect(sockets).toHaveLength(2)
  })
})
