import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { correlationIdSchema } from '@roadmap/contracts/identity'
import { type Command, commandSchema, querySchema } from '@roadmap/contracts/operations'
import type { ApplicationState } from '@roadmap/contracts/state'
import {
  decodeCommandResultEnvelope,
  decodeQueryResultEnvelope,
  decodeStateEnvelope,
} from '@roadmap/contracts/wire'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createRoadmapApplication, type RoadmapApplication } from './application/application.ts'
import { createApplicationOperations } from './application/operations.ts'
import {
  type ConfigurationDocument,
  createConfigurationDocument,
} from './configuration/document.ts'
import { createLocalProjectAdmission } from './local/admission.ts'
import { createLocalObserver } from './local/observer.ts'
import type { ProjectConfiguration } from './projects/registry.ts'
import { fixtureProjectRef, readApplicationState } from './public-test-fixtures.ts'
import { createRoadmapTransport, type RoadmapTransport } from './transport.ts'
import { readLocalProject } from './wayfinder/from-local.ts'

const ORIGIN = 'http://localhost:5173'
const PROJECT = { integration: 'local', id: 'fixture' } as const
const CORRELATION_ID = correlationIdSchema.parse('27cc82a7-2fef-4f63-b5d4-842d12f3afc4')
const QUERY = {
  type: 'query',
  correlationId: CORRELATION_ID,
  query: querySchema.parse({ type: 'select-workspace' }),
}
const RAW_SECRET = 'lifecycle-private-error-token'

function gate() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type Gate = ReturnType<typeof gate>

interface FixtureOptions {
  loadGate?: Gate
  baselineGate?: Gate
  selectorGate?: Gate
  launchGate?: Gate
  invalid?: boolean
  missingWorkspace?: boolean
  loadFailure?: boolean
}

interface Fixture {
  application: RoadmapApplication
  transport: RoadmapTransport
  server: Server
  root: string
  workspace: string
  configuration: ConfigurationDocument
  url: string
  wsUrl: string
  loadEntered: Gate
  baselineEntered: Gate
  baselineControl: { gate: Gate | undefined; entered: Gate }
  selectorEntered: Gate
  launchEntered: Gate
  effects: (
    | { kind: 'selector' }
    | {
        kind: 'launch'
        operation: 'open-workspace' | 'open-terminal' | 'reveal-source'
        project: { integration: 'local' | 'github'; projectId: string }
        workspacePath: string
      }
  )[]
  releases: Gate[]
}

const fixtures: Fixture[] = []
const sockets = new Set<WebSocket>()

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-transport-lifecycle-')))
  const workspace = join(root, 'workspace')
  await mkdir(join(workspace, '.wayfinder'), { recursive: true })
  const path = join(root, 'roadmap.config.json')
  const initial: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: [
      {
        ref: { integration: 'local', projectId: PROJECT.id },
        connectionId: 'local',
        displayName: 'Committed fixture',
        workspace: { path: options.missingWorkspace ? join(root, 'missing') : workspace },
      },
    ],
    automation: { enabled: false, enabledProjects: [] },
  }
  await writeFile(
    path,
    options.invalid ? `{"accessToken":"${RAW_SECRET}"}` : JSON.stringify(initial),
  )
  const document = createConfigurationDocument(path, { debounceMs: 60_000 })
  const loadEntered = gate()
  const baselineEntered = gate()
  const baselineControl = { gate: options.baselineGate, entered: baselineEntered }
  const selectorEntered = gate()
  const launchEntered = gate()
  const effects: Fixture['effects'] = []
  const configuration: ConfigurationDocument = {
    async load() {
      loadEntered.resolve()
      await options.loadGate?.promise
      if (options.loadFailure) throw new Error(RAW_SECRET)
      return document.load()
    },
    subscribe: (listener) => document.subscribe(listener),
    write: (next) => document.write(next),
    stop: () => document.stop(),
  }
  const application = createRoadmapApplication({
    configuration,
    serverEpoch: 'lifecycle-fixture',
    admissions: { local: createLocalProjectAdmission() },
    observers: {
      local: (input) =>
        createLocalObserver(input, {
          reconcileMs: 60_000_000,
          recoveryMs: 60_000_000,
          logger: { info() {}, warn() {} },
          async readProject(readInput, readOptions) {
            baselineControl.entered.resolve()
            await baselineControl.gate?.promise
            return readLocalProject(readInput, readOptions)
          },
        }),
      github() {
        throw new Error('This fixture has no GitHub source')
      },
    },
    operations: createApplicationOperations({
      host: {
        async execute(operation) {
          if (operation.type === 'select-workspace') {
            effects.push({ kind: 'selector' })
            selectorEntered.resolve()
            await options.selectorGate?.promise
            return { kind: 'cancelled' }
          }
          effects.push({
            kind: 'launch',
            operation: operation.type,
            project: operation.project,
            workspacePath: operation.workspacePath,
          })
          launchEntered.resolve()
          await options.launchGate?.promise
          return { kind: 'invoked' }
        },
      },
    }),
  })
  let transport: RoadmapTransport | null = null
  const server = createServer((request, response) => {
    if (transport?.handle(request, response)) return
    response.writeHead(404).end()
  })
  transport = createRoadmapTransport({ server, application, allowedOrigin: ORIGIN })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing lifecycle address')
  const current: Fixture = {
    application,
    transport,
    server,
    root,
    workspace,
    configuration,
    url: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    loadEntered,
    baselineEntered,
    baselineControl,
    selectorEntered,
    launchEntered,
    effects,
    releases: [
      options.loadGate,
      options.baselineGate,
      options.selectorGate,
      options.launchGate,
    ].filter((value): value is Gate => value !== undefined),
  }
  fixtures.push(current)
  return current
}

async function bounded<T>(operation: Promise<T>, barrier = 'Lifecycle fixture'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${barrier} did not reach its barrier`)), 2_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function openSocket(url: string) {
  const socket = new WebSocket(url, { headers: { Origin: ORIGIN } })
  sockets.add(socket)
  const states: ApplicationState[] = []
  socket.on('message', (data) => {
    const input: unknown = JSON.parse(String(data))
    const decoded = decodeStateEnvelope(input)
    if (!decoded.ok) throw new Error('Invalid lifecycle state envelope')
    states.push(decoded.value.state)
  })
  await bounded(once(socket, 'open'))
  return { socket, states }
}

async function socketBarrier(socket: WebSocket): Promise<void> {
  const pong = once(socket, 'pong')
  socket.ping('lifecycle-barrier')
  await bounded(pong)
}

function post(
  current: Fixture,
  family: 'query' | 'command',
  operation: unknown,
): Promise<Response> {
  return fetch(`${current.url}/api/${family}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'X-Roadmap-Request-Id': CORRELATION_ID,
    },
    body: JSON.stringify(operation),
  })
}

function launch(): { type: 'command'; correlationId: typeof CORRELATION_ID; command: Command } {
  return {
    type: 'command',
    correlationId: CORRELATION_ID,
    command: commandSchema.parse({
      type: 'launch-project-operation',
      expectedConfigurationVersion: 1,
      project: fixtureProjectRef(PROJECT),
      operation: 'open-workspace',
    }),
  }
}

async function health(current: Fixture, phase: string): Promise<unknown> {
  const response = await bounded(fetch(`${current.url}/health`))
  expect(response.status).toBe(200)
  const body = await response.text()
  const payload: unknown = JSON.parse(body)
  expect(payload).toMatchObject({ lifecycle: { phase } })
  expect(body).not.toContain(RAW_SECRET)
  return payload
}

async function readiness(current: Fixture, status: number, lifecycle: unknown): Promise<unknown> {
  const response = await bounded(fetch(`${current.url}/ready`))
  expect(response.status).toBe(status)
  const body = await response.text()
  const payload: unknown = JSON.parse(body)
  expect(payload).toMatchObject({ lifecycle })
  expect(body).not.toContain(RAW_SECRET)
  return payload
}

afterEach(async () => {
  for (const current of fixtures) for (const release of current.releases) release.resolve()
  for (const socket of sockets) socket.terminate()
  sockets.clear()
  for (const current of fixtures.splice(0)) {
    const closed = current.transport.close()
    await Promise.all([
      closed,
      current.application.stop(),
      new Promise<void>((resolve) => current.server.close(() => resolve())),
    ])
    await rm(current.root, { recursive: true, force: true })
  }
})

describe('real application HTTP and WebSocket lifecycle', () => {
  it('keeps liveness separate from deferred configuration and real source baseline readiness', async () => {
    const loadGate = gate()
    const baselineGate = gate()
    const current = await fixture({ loadGate, baselineGate })
    await health(current, 'idle')
    await readiness(current, 503, { phase: 'idle' })
    const wire = await openSocket(current.wsUrl)
    await socketBarrier(wire.socket)
    expect(wire.states).toEqual([])

    const started = current.application.start()
    void started.catch(() => undefined)
    try {
      await bounded(current.loadEntered.promise)
      await health(current, 'starting')
      await readiness(current, 503, { phase: 'starting' })
      await socketBarrier(wire.socket)
      expect(wire.states).toEqual([])

      loadGate.resolve()
      await bounded(current.baselineEntered.promise)
      await readiness(current, 503, { phase: 'starting' })
      await socketBarrier(wire.socket)
      expect(wire.states).toEqual([])

      baselineGate.resolve()
      await bounded(started)
      await readiness(current, 200, { phase: 'ready', mode: 'mutable' })
      await health(current, 'ready')
      await socketBarrier(wire.socket)
      expect(wire.states.length).toBeGreaterThan(0)
      expect(wire.states[0]).toMatchObject({
        configuration: { valid: true },
        projects: [{ ref: fixtureProjectRef(PROJECT), resource: { kind: 'current-readable' } }],
      })
    } finally {
      loadGate.resolve()
      baselineGate.resolve()
      await started.catch(() => undefined)
    }
  })

  it('rejects interaction and command admission while configuration is still loading', async () => {
    const loadGate = gate()
    const current = await fixture({ loadGate })
    const started = current.application.start()
    void started.catch(() => undefined)
    await bounded(current.loadEntered.promise)
    const wire = await openSocket(current.wsUrl)
    try {
      const query = await bounded(post(current, 'query', QUERY))
      expect(query.status).toBe(200)
      expect(
        decodeQueryResultEnvelope(await query.json(), QUERY.query, CORRELATION_ID),
      ).toMatchObject({
        ok: true,
        value: { result: { ok: false, error: { code: 'not-supported' } } },
      })
      const command = await bounded(post(current, 'command', launch()))
      expect(command.status).toBe(200)
      expect(
        decodeCommandResultEnvelope(await command.json(), launch().command, CORRELATION_ID),
      ).toMatchObject({
        ok: true,
        value: { outcome: { ok: false, error: { code: 'not-supported' } } },
      })
      expect(current.effects).toEqual([])
      await socketBarrier(wire.socket)
      expect(wire.states).toEqual([])
      expect(current.application.current().phase).toBe('starting')
    } finally {
      loadGate.resolve()
      await bounded(started)
    }
  })

  it('withholds the startup placeholder socket state until a real source baseline commits', async () => {
    const baselineGate = gate()
    const current = await fixture({ baselineGate })
    const started = current.application.start()
    void started.catch(() => undefined)
    try {
      await bounded(current.baselineEntered.promise)
      const wire = await openSocket(current.wsUrl)
      await socketBarrier(wire.socket)
      expect(wire.states).toEqual([])
      baselineGate.resolve()
      await bounded(started)
      await socketBarrier(wire.socket)
      expect(wire.states[0]).toMatchObject({
        configuration: { valid: true },
        projects: [{ ref: fixtureProjectRef(PROJECT), resource: { kind: 'current-readable' } }],
      })
    } finally {
      baselineGate.resolve()
      await started.catch(() => undefined)
    }
  })

  it('becomes mutable ready with truthful evidence for a legitimate unreachable source', async () => {
    const current = await fixture({ missingWorkspace: true })
    await current.application.start()
    await health(current, 'ready')
    expect(await readiness(current, 200, { phase: 'ready', mode: 'mutable' })).toMatchObject({
      projects: 1,
      unavailable: 1,
      maps: null,
    })
    const wire = await openSocket(current.wsUrl)
    await socketBarrier(wire.socket)
    expect(wire.states[0]).toMatchObject({
      configuration: { valid: true },
      projects: [{ ref: fixtureProjectRef(PROJECT), resource: { kind: 'never-observed' } }],
    })
  })

  it('keeps map counts unknown when an empty Workspace has no successful map enumeration', async () => {
    const current = await fixture()
    await rm(join(current.workspace, '.wayfinder'), { recursive: true })
    await current.application.start()
    expect(await health(current, 'ready')).toMatchObject({
      projects: 1,
      maps: null,
      unavailable: 0,
      absent: 0,
    })
    expect(await readiness(current, 200, { phase: 'ready', mode: 'mutable' })).toMatchObject({
      projects: 1,
      maps: null,
      unavailable: 0,
      absent: 0,
    })
    expect(readApplicationState(current.application.current()).projects[0]?.resource.kind).toBe(
      'current-readable',
    )
  })

  it('exposes invalid configuration as read-only ready without admitting mutation or Automation', async () => {
    const current = await fixture({ invalid: true })
    await current.application.start()
    await health(current, 'ready')
    await readiness(current, 200, { phase: 'ready', mode: 'read-only' })
    const wire = await openSocket(current.wsUrl)
    await socketBarrier(wire.socket)
    expect(wire.states[0]).toMatchObject({
      configuration: { valid: false },
      automation: { enabled: false, enabledProjects: [] },
    })
    const before = await readFile(join(current.root, 'roadmap.config.json'), 'utf8')
    const commands: Command[] = [
      commandSchema.parse({
        type: 'rename-connection',
        expectedConfigurationVersion: readApplicationState(current.application.current())
          .configurationVersion,
        connectionId: 'local',
        name: 'Must not persist',
      }),
      commandSchema.parse({
        type: 'set-automation-enabled',
        expectedConfigurationVersion: readApplicationState(current.application.current())
          .configurationVersion,
        enabled: true,
      }),
    ]
    for (const command of commands) {
      const response = await bounded(
        post(current, 'command', { type: 'command', correlationId: CORRELATION_ID, command }),
      )
      expect(response.status).toBe(200)
      expect(
        decodeCommandResultEnvelope(await response.json(), command, CORRELATION_ID),
      ).toMatchObject({
        ok: true,
        value: { outcome: { ok: false } },
      })
    }
    expect(await readFile(join(current.root, 'roadmap.config.json'), 'utf8')).toBe(before)
    expect(current.effects).toEqual([])
    const query = await bounded(post(current, 'query', QUERY))
    expect(
      decodeQueryResultEnvelope(await query.json(), QUERY.query, CORRELATION_ID),
    ).toMatchObject({
      ok: true,
      value: { result: { ok: true, operation: 'select-workspace', result: { kind: 'cancelled' } } },
    })
    expect(current.effects).toEqual([{ kind: 'selector' }])
  })

  it('keeps health and readiness counts bound to committed owners while a candidate baseline waits', async () => {
    const current = await fixture()
    await current.application.start()
    const replacement = join(current.root, 'replacement')
    await mkdir(replacement)
    const candidateGate = gate()
    current.releases.push(candidateGate)
    current.baselineControl.gate = candidateGate
    current.baselineControl.entered = gate()
    // The real configuration document publishes the new intent, but activation still needs a source read.
    const next: ProjectConfiguration = {
      schemaVersion: 6,
      configurationVersion: 2,
      connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
      projects: [
        {
          ref: { integration: 'local', projectId: PROJECT.id },
          connectionId: 'local',
          displayName: 'Committed fixture',
          workspace: { path: current.workspace },
        },
        {
          ref: { integration: 'local', projectId: 'pending' },
          connectionId: 'local',
          displayName: 'Pending candidate',
          workspace: { path: replacement },
        },
      ],
      automation: { enabled: false, enabledProjects: [] },
    }
    try {
      await current.configuration.write(next)
      await bounded(current.baselineControl.entered.promise)
      expect(await readiness(current, 200, { phase: 'ready', mode: 'mutable' })).toMatchObject({
        projects: 1,
        maps: 0,
        unavailable: 0,
        absent: 0,
      })
      expect(await health(current, 'ready')).toMatchObject({
        projects: 1,
        maps: 0,
        unavailable: 0,
        absent: 0,
      })
      expect(readApplicationState(current.application.current()).projects[0]?.ref).toEqual(
        fixtureProjectRef(PROJECT),
      )
    } finally {
      candidateGate.resolve()
    }
  })

  it('reports failed startup without leaking its private cause while liveness stays available', async () => {
    const current = await fixture({ loadFailure: true })
    await expect(current.application.start()).rejects.toThrow()
    await health(current, 'failed')
    await readiness(current, 503, { phase: 'failed' })
    const wire = await openSocket(current.wsUrl)
    await socketBarrier(wire.socket)
    expect(wire.states).toEqual([])
  })

  it.each(['selector', 'launch'] as const)(
    'joins an admitted %s response, WebSocket closure and HTTP listener shutdown',
    async (kind) => {
      const effectGate = gate()
      const current = await fixture(
        kind === 'selector' ? { selectorGate: effectGate } : { launchGate: effectGate },
      )
      await current.application.start()
      current.server.keepAliveTimeout = 60_000
      const wire = await openSocket(current.wsUrl)
      await socketBarrier(wire.socket)
      const response = post(
        current,
        kind === 'selector' ? 'query' : 'command',
        kind === 'selector' ? QUERY : launch(),
      )
      void response.catch(() => undefined)
      try {
        await bounded(
          kind === 'selector' ? current.selectorEntered.promise : current.launchEntered.promise,
        )
        const socketClosed = once(wire.socket, 'close')
        let transportClosed = false
        const closing = current.transport.close()
        expect(closing).toBeInstanceOf(Promise)
        expect(current.transport.close()).toBe(closing)
        const transportDone = closing.then(() => {
          transportClosed = true
        })
        let applicationStopped = false
        const stopped = current.application.stop().then(() => {
          applicationStopped = true
        })
        const listenerClosed = new Promise<void>((resolve, reject) => {
          current.server.close((error) => (error ? reject(error) : resolve()))
        })
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(transportClosed).toBe(false)
        expect(applicationStopped).toBe(false)
        expect(current.effects).toHaveLength(1)
        effectGate.resolve()
        const reply = await bounded(response, 'Admitted HTTP response')
        expect(reply.status).toBe(200)
        expect(reply.headers.get('connection')).toBe('close')
        const decoded =
          kind === 'selector'
            ? decodeQueryResultEnvelope(await reply.json(), QUERY.query, CORRELATION_ID)
            : decodeCommandResultEnvelope(await reply.json(), launch().command, CORRELATION_ID)
        expect(decoded).toMatchObject({ ok: true })
        if (kind === 'selector')
          expect(decoded).toMatchObject({
            value: { result: { ok: true, result: { kind: 'cancelled' } } },
          })
        else
          expect(decoded).toMatchObject({
            value: {
              outcome: {
                ok: true,
                result: { type: 'launch-project-operation', status: 'invoked' },
              },
            },
          })
        if (kind === 'launch') {
          expect(current.effects).toEqual([
            {
              kind: 'launch',
              operation: 'open-workspace',
              project: fixtureProjectRef(PROJECT),
              workspacePath: current.workspace,
            },
          ])
          expect(decoded).toMatchObject({
            value: {
              correlationId: CORRELATION_ID,
              outcome: {
                operation: 'launch-project-operation',
                subject: { kind: 'project', project: fixtureProjectRef(PROJECT) },
                result: {
                  project: fixtureProjectRef(PROJECT),
                  operation: 'open-workspace',
                  status: 'invoked',
                },
              },
            },
          })
          expect(decoded).not.toHaveProperty('value.outcome.state')
        }
        await Promise.all([
          bounded(transportDone, 'Transport request drain'),
          bounded(stopped, 'Application drain'),
          bounded(socketClosed, 'WebSocket closure'),
          bounded(listenerClosed, 'HTTP listener closure'),
        ])
        expect(current.transport.clientCount()).toBe(0)
        expect(current.server.listening).toBe(false)
        expect(current.effects).toHaveLength(1)
      } finally {
        effectGate.resolve()
        await response.catch(() => undefined)
      }
    },
  )

  it('keeps health live but readiness unavailable while an admitted selector drains on application stop', async () => {
    const selectorGate = gate()
    const current = await fixture({ selectorGate })
    await current.application.start()
    const admitted = post(current, 'query', QUERY)
    void admitted.catch(() => undefined)
    await bounded(current.selectorEntered.promise)
    const stopped = current.application.stop()
    try {
      await health(current, 'stopping')
      await readiness(current, 503, { phase: 'stopping' })
      const rejected = await bounded(post(current, 'query', QUERY))
      expect(
        decodeQueryResultEnvelope(await rejected.json(), QUERY.query, CORRELATION_ID),
      ).toMatchObject({
        ok: true,
        value: { result: { ok: false, error: { code: 'not-supported' } } },
      })
      const rejectedCommand = await bounded(post(current, 'command', launch()))
      expect(
        decodeCommandResultEnvelope(await rejectedCommand.json(), launch().command, CORRELATION_ID),
      ).toMatchObject({
        ok: true,
        value: { outcome: { ok: false, error: { code: 'not-supported' } } },
      })
      expect(current.effects).toEqual([{ kind: 'selector' }])
      selectorGate.resolve()
      expect((await bounded(admitted)).status).toBe(200)
      await bounded(stopped)
      await health(current, 'stopped')
      await readiness(current, 503, { phase: 'stopped' })
    } finally {
      selectorGate.resolve()
      await Promise.all([admitted.catch(() => undefined), stopped])
    }
  })
})
