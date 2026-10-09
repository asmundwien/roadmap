import { createServer, type Server, type ServerResponse } from 'node:http'
import type { ApplicationState, Command } from '@roadmap/contracts'
import { stateEnvelopeCodec } from '@roadmap/contracts/codecs'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  createRoadmapStore,
  type RoadmapStore,
  type SocketLike,
} from '../../web/src/store/roadmap-store.ts'
import { createRoadmapApplication, type RoadmapApplication } from './application/application.ts'
import { createApplicationOperations } from './application/operations.ts'
import type { ConfigurationDocument, ConfigurationRead } from './configuration/document.ts'
import type { ProjectConfiguration } from './projects/registry.ts'
import {
  controlledSourceFixture,
  createSourceFixtureOwner,
  type FixtureProject,
  fixtureAdmissions,
  publicProjectObservation,
} from './source-test-fixtures.ts'
import { createRoadmapTransport, type RoadmapTransport } from './transport.ts'

const ORIGIN = 'http://localhost:5173'
const LAUNCH: Command = {
  type: 'launch-action',
  expectedConfigurationVersion: 1,
  project: { integration: 'local', id: 'fixture' },
  actionId: 'open-workspace',
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('authority fixture did not reach its barrier')
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
}

function memoryConfiguration(
  epoch: string,
  beforeWrite: () => Promise<void>,
  didWrite: (document: ProjectConfiguration) => void,
): ConfigurationDocument {
  let current: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: [
      {
        ref: { integration: 'local', projectId: 'fixture' },
        connectionId: 'local',
        workspace: { path: '/disposable-authority-fixture' },
        displayName: epoch,
      },
    ],
    automation: { enabled: false, enabledProjects: [] },
  }
  const listeners = new Set<(read: ConfigurationRead) => void>()
  return {
    async load() {
      return { ok: true, document: current }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next) {
      await beforeWrite()
      current = next
      didWrite(next)
      for (const listener of listeners) listener({ ok: true, document: current })
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {
      listeners.clear()
    },
  }
}

interface Backend {
  application: RoadmapApplication
  server: Server
  transport: RoadmapTransport
  url: string
  effects: number
  commandRequests: number
  effectGate: ReturnType<typeof deferred> | null
  effectReached: ReturnType<typeof deferred>
  loseNextReply: boolean
  configurationGate: ReturnType<typeof deferred> | null
  configurationReached: ReturnType<typeof deferred>
  persistedConfiguration: ProjectConfiguration | null
  sourceOwners: number
  retiredSourceOwners: number
}

const backends: Backend[] = []
const sockets = new Set<WebSocket>()
const releases: (() => void)[] = []

async function backend(epoch: string): Promise<Backend> {
  let transport: RoadmapTransport | null = null
  let commandResponse: ServerResponse | null = null
  let sourceOwners = 0
  let retiredSourceOwners = 0
  const server = createServer((request, response) => {
    if (request.url === '/api/command' && request.method === 'POST') {
      fixture.commandRequests += 1
      commandResponse = response
    }
    if (transport?.handle(request, response)) return
    response.writeHead(404).end()
  })
  const application = createRoadmapApplication({
    configuration: memoryConfiguration(
      epoch,
      async () => {
        fixture.configurationReached.resolve()
        await fixture.configurationGate?.promise
      },
      (document) => {
        fixture.persistedConfiguration = document
      },
    ),
    serverEpoch: epoch,
    admissions: fixtureAdmissions,
    observers: {
      local() {
        sourceOwners += 1
        const read = createSourceFixtureOwner()
        const source = controlledSourceFixture(
          { integration: 'local', id: 'fixture' },
          read(
            [
              {
                key: { integration: 'local', id: 'fixture' },
                name: epoch,
                sourcePath: '/disposable-authority-fixture',
                openMaps: [],
                closedMaps: [],
                warnings: [],
              } satisfies FixtureProject,
            ],
            100,
          ),
        )
        return {
          ...source.observer,
          async stop() {
            retiredSourceOwners += 1
            await source.observer.stop()
          },
        }
      },
      github() {
        throw new Error('Unused source')
      },
    },
    operations: createApplicationOperations({
      selectWorkspace: async () => null,
      async launch() {
        fixture.effects += 1
        fixture.effectReached.resolve()
        if (fixture.loseNextReply) {
          fixture.loseNextReply = false
          commandResponse?.destroy()
        }
        await fixture.effectGate?.promise
      },
    }),
  })
  await application.start()
  transport = createRoadmapTransport({ server, application, allowedOrigin: ORIGIN })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing fixture address')
  const fixture: Backend = {
    application,
    server,
    transport,
    url: `http://127.0.0.1:${address.port}`,
    effects: 0,
    commandRequests: 0,
    effectGate: null,
    effectReached: deferred(),
    loseNextReply: false,
    configurationGate: null,
    configurationReached: deferred(),
    persistedConfiguration: null,
    get sourceOwners() {
      return sourceOwners
    },
    get retiredSourceOwners() {
      return retiredSourceOwners
    },
  }
  backends.push(fixture)
  return fixture
}

interface WireSocket {
  native: WebSocket
  messages: ApplicationState[]
  flush(): void
}

function browser(initial: Backend, withhold = false) {
  let current = initial
  let hold = withhold
  const wires: WireSocket[] = []
  const observed: ReturnType<RoadmapStore['getSnapshot']>[] = []
  const store = createRoadmapStore(initial.url, {
    reconnectDelayMs: () => 5,
    fetch(input, init) {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      headers.set('Origin', ORIGIN)
      return fetch(new URL(url.pathname, current.url), {
        ...init,
        headers,
      })
    },
    createSocket(): SocketLike {
      const native = new WebSocket(`${current.url.replace('http:', 'ws:')}/ws`, {
        headers: { Origin: ORIGIN },
      })
      sockets.add(native)
      const listeners = new Set<(event: { data?: unknown }) => void>()
      const pending: string[] = []
      const wire: WireSocket = {
        native,
        messages: [],
        flush() {
          hold = false
          for (const data of pending.splice(0)) {
            for (const listener of listeners) listener({ data })
          }
        },
      }
      native.on('error', () => undefined)
      native.on('message', (raw) => {
        const data = String(raw)
        const body: unknown = JSON.parse(data)
        const decoded = stateEnvelopeCodec.decode(body)
        if (!decoded.ok) throw new Error('fixture emitted an invalid state')
        wire.messages.push(decoded.value.state)
        if (hold) pending.push(data)
        else for (const listener of listeners) listener({ data })
      })
      wires.push(wire)
      return {
        addEventListener(type, listener) {
          if (type === 'message') listeners.add(listener)
          else native.on(type, () => listener({}))
        },
        close() {
          native.close()
        },
      }
    },
  })
  const unsubscribe = store.subscribe(() => observed.push(store.getSnapshot()))
  const stop = store.start()
  releases.push(() => {
    unsubscribe()
    stop()
  })
  return {
    store,
    wires,
    observed,
    stop,
    route(next: Backend) {
      current = next
    },
    async reconnect(next: Backend, withheld = false) {
      current = next
      hold = withheld
      const previous = wires.length
      wires.at(-1)?.native.close()
      await until(() => wires.length > previous && (wires.at(-1)?.messages.length ?? 0) > 0)
    },
    withhold() {
      hold = true
    },
    async ready() {
      await until(() => (wires.at(-1)?.messages.length ?? 0) > 0)
    },
    flush() {
      wires.at(-1)?.flush()
    },
  }
}

async function publishName(fixture: Backend, name: string): Promise<void> {
  const outcome = await fixture.application.execute({
    type: 'rename-project',
    expectedConfigurationVersion: fixture.application.current().configurationVersion,
    project: { integration: 'local', id: 'fixture' },
    name,
  })
  if (!outcome.ok) throw new Error('fixture publication was rejected')
}

function expectEpoch(store: RoadmapStore, epoch: string, synchronization = 'synchronized') {
  const snapshot = store.getSnapshot()
  expect(snapshot).toMatchObject({ synchronization, state: { serverEpoch: epoch } })
  const state = snapshot.state
  if (!state) throw new Error('Expected an authoritative or retained application state.')
  const project = state.projects[0]
  if (!project) throw new Error('Expected the registered source Project.')
  expect(project.key).toEqual({ integration: 'local', id: 'fixture' })
  expect(project.resource.kind).toBe('current-readable')
  expect(publicProjectObservation(project)).toMatchObject({
    scope: { kind: 'project', project: { integration: 'local', id: 'fixture' } },
    observedAt: 100,
    value: {
      name: epoch,
      source: { integration: 'local', path: '/disposable-authority-fixture' },
    },
  })
  expect(project.maps).toEqual([])
  expect(project.mapsMembership).toMatchObject({
    kind: 'current-complete',
    observation: { value: { members: [] } },
  })
  expect(project.activeMap).toEqual({ kind: 'known-empty' })
  expect(state.roadmap).toEqual({ capturedAt: state.roadmap.capturedAt })
}

afterEach(async () => {
  for (const fixture of backends) {
    fixture.effectGate?.resolve()
    fixture.configurationGate?.resolve()
  }
  for (const release of releases.splice(0)) release()
  for (const socket of sockets) socket.terminate()
  sockets.clear()
  for (const fixture of backends.splice(0)) {
    const closed = fixture.transport.close()
    await Promise.all([
      closed,
      fixture.application.stop(),
      new Promise<void>((resolve) => fixture.server.close(() => resolve())),
    ])
  }
})

describe('HTTP outcomes and current WebSocket authority', () => {
  // Accepting an HTTP state's epoch before the first validated socket baseline must fail this.
  it('keeps an open socket without a baseline not-ready after a valid HTTP operation', async () => {
    const a = await backend('A')
    const client = browser(a, true)
    await client.ready()
    expect(client.store.getSnapshot()).toMatchObject({
      transport: 'live',
      synchronization: 'not-ready',
      state: null,
    })
    const outcome = await client.store.execute(LAUNCH)
    expect(outcome).toMatchObject({ ok: true, result: { type: 'action-launched' } })
    expect(client.store.getSnapshot()).toMatchObject({ synchronization: 'not-ready', state: null })
    expect(a.effects).toBe(1)
    client.flush()
    expectEpoch(client.store, 'A')
  })

  // Either globally adopting A from HTTP or retiring B because A arrives late must fail these.
  it.each(['reply-first', 'baseline-first'])(
    'ignores unseen A after reconnect to B, %s',
    async (order) => {
      const a = await backend('A')
      const client = browser(a, true)
      await client.ready()
      a.effectGate = deferred()
      const delayed = client.store.execute(LAUNCH)
      await a.effectReached.promise
      const b = await backend('B')
      await client.reconnect(b, true)

      if (order === 'baseline-first') client.flush()
      a.effectGate.resolve()
      const outcome = await delayed
      expect(outcome).toMatchObject({
        ok: true,
        result: { type: 'action-launched', actionId: 'open-workspace' },
        state: { serverEpoch: 'A' },
      })
      if (order === 'reply-first') {
        expect(client.store.getSnapshot()).toMatchObject({
          synchronization: 'not-ready',
          state: null,
        })
        client.flush()
      }
      expectEpoch(client.store, 'B')
      const before = client.store.getSnapshot().state?.stateSequence ?? -1
      await publishName(b, 'B continued')
      await until(() => (client.store.getSnapshot().state?.stateSequence ?? -1) > before)
      expectEpoch(client.store, 'B')
      expect(client.store.getSnapshot().state?.registrations[0]?.displayName).toBe('B continued')
      expect(client.observed.some((snapshot) => snapshot.state?.serverEpoch === 'A')).toBe(false)
      expect(a.effects).toBe(1)
      expect(a.commandRequests).toBe(1)
    },
  )

  // Treating every cross-epoch HTTP response as stale, or adopting C without a socket, must fail this.
  it('uses legitimate C HTTP completion only to request a fresh socket baseline', async () => {
    const b = await backend('B')
    const client = browser(b)
    await client.ready()
    expectEpoch(client.store, 'B')
    const c = await backend('C')
    client.route(c)
    client.withhold()
    const outcome = await client.store.execute(LAUNCH)
    expect(outcome).toMatchObject({ ok: true, state: { serverEpoch: 'C' } })
    // A new socket is required; its baseline is withheld independently of the completed HTTP call.
    await until(() => client.wires.length === 2)
    await until(() => (client.wires[1]?.messages.length ?? 0) > 0)
    expectEpoch(client.store, 'B', 'retained')
    client.flush()
    await until(() => client.store.getSnapshot().state?.serverEpoch === 'C')
    expectEpoch(client.store, 'C')
    expect(client.wires[1]?.messages[0]?.serverEpoch).toBe('C')
    expect(c.effects).toBe(1)
    expect(c.commandRequests).toBe(1)
    await publishName(c, 'C continued')
    await until(
      () => client.store.getSnapshot().state?.registrations[0]?.displayName === 'C continued',
    )
    expectEpoch(client.store, 'C')
  })

  // Clearing uncertainty on an ordinary snapshot, or automatically replaying a native effect, must fail this.
  it('keeps a lost native completion unknown through later snapshots without replay', async () => {
    const a = await backend('A')
    const client = browser(a)
    await client.ready()
    a.loseNextReply = true
    const lost = client.store.execute(LAUNCH).then(
      () => 'received',
      () => 'lost',
    )
    await a.effectReached.promise
    expect(await lost).toBe('lost')
    expect(client.store.getSnapshot().command.error?.code).toBe('transport-failed')
    await publishName(a, 'A after lost reply')
    await until(
      () =>
        client.store.getSnapshot().state?.registrations[0]?.displayName === 'A after lost reply',
    )
    expect(client.store.getSnapshot().command.error?.code).toBe('transport-failed')
    const b = await backend('B')
    await client.reconnect(b)
    expectEpoch(client.store, 'B')
    await publishName(b, 'B after lost reply')
    await until(
      () =>
        client.store.getSnapshot().state?.registrations[0]?.displayName === 'B after lost reply',
    )
    expect(client.store.getSnapshot().command.error?.code).toBe('transport-failed')
    expect(a.effects).toBe(1)
    expect(a.commandRequests).toBe(1)
    expect(b.effects).toBe(0)
    expect(b.commandRequests).toBe(0)
  })

  it.each(['rename-project', 'remove-project'] as const)(
    'returns a legal saved %s outcome after HTTP and socket authority drain during shutdown',
    async (type) => {
      const a = await backend('A')
      const client = browser(a)
      await client.ready()
      const retained = client.store.getSnapshot().state
      a.configurationGate = deferred()
      const project = { integration: 'local', id: 'fixture' } as const
      const command = client.store.execute(
        type === 'rename-project'
          ? { type, project, name: 'Saved after retirement', expectedConfigurationVersion: 1 }
          : { type, project, expectedConfigurationVersion: 1 },
      )
      void command.catch(() => undefined)
      await a.configurationReached.promise
      const applicationDone = a.application.stop()
      const transportDone = a.transport.close()
      const serverDone = new Promise<void>((resolve, reject) => {
        a.server.close((error) => (error ? reject(error) : resolve()))
      })
      client.stop()
      try {
        await until(() => a.retiredSourceOwners === 1)
        expect(a.persistedConfiguration).toBeNull()
        a.configurationGate.resolve()
        const outcome = await command
        expect(outcome).toMatchObject({
          ok: true,
          result: { type: 'configuration-updated', configurationVersion: 2 },
          state: { configurationVersion: 2 },
        })
        if (!('state' in outcome))
          throw new Error('A saved outcome must include its diagnostic state.')
        if (type === 'rename-project') {
          expect(a.persistedConfiguration?.projects[0]?.displayName).toBe('Saved after retirement')
          expect(outcome.state.projects[0]?.name).toBe('Saved after retirement')
          expect(outcome.state.registrations[0]?.displayName).toBe('Saved after retirement')
          expect(outcome.state.projects[0]?.resource).toEqual(retained?.projects[0]?.resource)
        } else {
          expect(a.persistedConfiguration?.projects).toEqual([])
          expect(outcome.state.projects).toEqual([])
          expect(outcome.state.registrations).toEqual([])
        }
        await Promise.all([applicationDone, transportDone, serverDone])
        expect(client.store.getSnapshot()).toMatchObject({
          synchronization: 'retained',
          state: retained,
          command: { error: null },
        })
        expect(a.application.current().registrations).toEqual(outcome.state.registrations)
        expect(a.application.current().automation.availability.status).toBe('unavailable')
        expect(a.sourceOwners).toBe(1)
        expect(a.retiredSourceOwners).toBe(1)
        expect(a.effects).toBe(0)
        expect(a.commandRequests).toBe(1)
        expect(a.transport.clientCount()).toBe(0)
        expect(a.server.listening).toBe(false)
      } finally {
        a.configurationGate.resolve()
        await command.catch(() => undefined)
        await Promise.all([applicationDone, transportDone, serverDone])
      }
    },
  )

  it('delivers an admitted native outcome after socket authority retires during joined shutdown', async () => {
    const a = await backend('A')
    const client = browser(a)
    await client.ready()
    a.effectGate = deferred()
    const command = client.store.execute(LAUNCH)
    void command.catch(() => undefined)
    await a.effectReached.promise
    try {
      const closing = a.transport.close()
      expect(closing).toBeInstanceOf(Promise)
      let transportClosed = false
      const transportDone = closing.then(() => {
        transportClosed = true
      })
      const applicationDone = a.application.stop()
      const serverDone = new Promise<void>((resolve, reject) => {
        a.server.close((error) => (error ? reject(error) : resolve()))
      })
      client.stop()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(transportClosed).toBe(false)
      a.effectGate.resolve()
      expect(await command).toMatchObject({
        ok: true,
        result: { type: 'action-launched', actionId: 'open-workspace' },
        state: { serverEpoch: 'A' },
      })
      await Promise.all([transportDone, applicationDone, serverDone])
      expectEpoch(client.store, 'A', 'retained')
      expect(a.transport.clientCount()).toBe(0)
      expect(a.server.listening).toBe(false)
      expect(a.effects).toBe(1)
      expect(a.commandRequests).toBe(1)
    } finally {
      a.effectGate.resolve()
      await command.catch(() => undefined)
    }
  })
})
