import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandSchema } from '@roadmap/contracts/operations'
import { commandResultEnvelopeSchema, decodeStateEnvelope } from '@roadmap/contracts/wire'
import { WebSocket, WebSocketServer } from 'ws'
import {
  createRoadmapApplication,
  type RoadmapApplication,
} from '../../apps/server/src/application/application.ts'
import { createApplicationOperations } from '../../apps/server/src/application/operations.ts'
import { createConfigurationDocument } from '../../apps/server/src/configuration/document.ts'
import { createLocalProjectAdmission } from '../../apps/server/src/local/admission.ts'
import { createLocalObserver } from '../../apps/server/src/local/observer.ts'
import { createRoadmapTransport, type RoadmapTransport } from '../../apps/server/src/transport.ts'

type Backend = {
  application: RoadmapApplication
  transport: RoadmapTransport
  server: Server
  url: string
}
type HeldReply = {
  response: ServerResponse
  status: number
  headers: Record<string, string>
  body: Buffer
}
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (address === null || typeof address === 'string')
        return reject(new Error('Missing fixture listener address.'))
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  server.closeIdleConnections()
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

/** The only substitutions are host effects and network scheduling. All facts come from real application owners. */
export async function createClientOwnerServer(middleware: Middleware, entryPath: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-client-owner-')))
  const workspace = join(root, 'fixture')
  const mapDirectory = join(workspace, '.wayfinder', 'owner-map')
  const unavailablePath = join(root, 'unavailable-source')
  let hostInvocations = 0
  let selectorInvocations = 0
  let commandRequests = 0
  let acceptedCommandResponses = 0
  let socketConnections = 0
  let held = true
  let holdNextResponse = false
  let holdNextRequest = false
  let dropNextResponse = false
  let closing = false
  const replies: HeldReply[] = []
  const requests: (() => void)[] = []
  const backends: Backend[] = []
  const clients = new Set<{ browser: WebSocket; upstream: WebSocket; latest: string | null }>()
  let backend: Backend | null = null
  let origin = ''

  async function writeSource(label: string) {
    await writeFile(
      join(mapDirectory, 'map.md'),
      `---\ntitle: Pinned owner map\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\n${label} map prose.\n\n## Notes\n\n## Decisions so far\n\n- [Owner ticket](tickets/01-ticket.md)\n\n## Not yet specified\n\n## Out of scope\n`,
    )
    await writeFile(
      join(mapDirectory, 'tickets', '01-ticket.md'),
      `---\nid: 1\ntitle: Owner ticket\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: []\n---\n\n${label} ticket prose.\n`,
    )
  }

  async function makeBackend(label: string, version: number): Promise<Backend> {
    await writeSource(label)
    const filename = join(root, `configuration-${backends.length}.json`)
    await writeFile(
      filename,
      JSON.stringify({
        schemaVersion: 6,
        configurationVersion: version,
        connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
        projects: [
          {
            ref: { integration: 'local', projectId: 'fixture' },
            connectionId: 'local',
            workspace: { path: workspace },
            displayName: 'Owner fixture',
          },
          {
            ref: { integration: 'local', projectId: 'unavailable' },
            connectionId: 'local',
            workspace: { path: unavailablePath },
            displayName: 'Unavailable source',
          },
        ],
        automation: { enabled: false, enabledProjects: [] },
      }),
    )
    const application = createRoadmapApplication({
      configuration: createConfigurationDocument(filename, { debounceMs: 25 }),
      admissions: { local: createLocalProjectAdmission() },
      observers: {
        local(input) {
          return createLocalObserver(input, {
            reconcileMs: 1_000_000,
            debounceMs: 25,
            logger: { info() {}, warn() {} },
          })
        },
        github() {
          throw new Error('GitHub is outside this isolated fixture.')
        },
      },
      operations: createApplicationOperations({
        host: {
          async execute(operation) {
            if (operation.type === 'select-workspace') {
              selectorInvocations += 1
              return { kind: 'cancelled' }
            }
            if (operation.type !== 'open-workspace')
              throw new Error('Unexpected fixture host operation.')
            hostInvocations += 1
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
    transport = createRoadmapTransport({ server, application, allowedOrigin: origin })
    const result = { application, server, transport, url: '' }
    backends.push(result)
    await application.start()
    const accepted = application.current()
    if (accepted.phase !== 'ready') throw new Error('Fixture application did not become ready.')
    const repair = await application.execute(
      commandSchema.parse({
        type: 'repair-project-workspace',
        expectedConfigurationVersion: accepted.configurationVersion,
        project: { integration: 'local', projectId: 'fixture' },
        workspace: { path: workspace },
      }),
    )
    if (
      !repair.ok ||
      repair.result.type !== 'repair-project-workspace' ||
      repair.result.commit !== 'committed'
    )
      throw new Error('Fixture Workspace admission did not commit.')
    const admitted = application.current()
    if (
      admitted.phase !== 'ready' ||
      !admitted.projects.some(
        (project) =>
          project.ref.projectId === 'fixture' &&
          project.actions.some(
            (action) => action.kind === 'server-launch' && action.operation === 'open-workspace',
          ),
      )
    )
      throw new Error('Fixture did not publish an actual admitted launch capability.')
    const port = await listen(server)
    result.url = `http://127.0.0.1:${port}`
    return result
  }

  function flush(reply: HeldReply) {
    if (reply.response.destroyed) return
    reply.response.writeHead(reply.status, reply.headers).end(reply.body)
  }

  function status() {
    const state = backend?.application.current() ?? null
    return {
      root,
      origin,
      held,
      socketConnections,
      activeSockets: clients.size,
      upstreamSockets: backends.reduce((count, item) => count + item.transport.clientCount(), 0),
      pendingResponses: replies.length,
      pendingRequests: requests.length,
      commandRequests,
      acceptedCommandResponses,
      hostInvocations,
      selectorInvocations,
      state,
      epoch: state?.serverEpoch ?? null,
    }
  }

  async function control(action: string) {
    switch (action) {
      case 'status':
        break
      case 'malformed':
        for (const client of clients)
          client.browser.send('{"type":"state","state":{"phase":"ready"}}')
        break
      case 'release-baseline':
        held = false
        for (const client of clients)
          if (client.latest !== null && client.browser.readyState === WebSocket.OPEN)
            client.browser.send(client.latest)
        break
      case 'withhold':
        held = true
        break
      case 'disconnect':
        for (const client of clients) client.browser.close(1012, 'Fixture disconnect')
        break
      case 'successor': {
        held = true
        const previous = backend
        // Stop real observation before replacing Markdown, so the predecessor cannot borrow successor content.
        if (previous !== null) await previous.application.stop()
        backend = await makeBackend('Successor', 7)
        for (const client of clients) client.browser.close(1012, 'Fixture successor')
        break
      }
      case 'http-successor': {
        const previous = backend
        if (previous === null) throw new Error('Missing backend.')
        const state = previous.application.current()
        if (state.phase !== 'ready') throw new Error('Backend is not ready.')
        held = true
        // Retain the established socket authority, but stop its source observation before replacement.
        await previous.application.stop()
        backend = await makeBackend('HTTP successor', state.configurationVersion + 1)
        break
      }
      case 'hold-next-request':
        holdNextRequest = true
        break
      case 'release-requests':
        for (const forward of requests.splice(0)) forward()
        break
      case 'hold-next-response':
        holdNextResponse = true
        break
      case 'drop-next-response':
        dropNextResponse = true
        break
      case 'release-responses':
        for (const reply of replies.splice(0)) flush(reply)
        break
      case 'release-first-response': {
        const reply = replies.shift()
        if (reply !== undefined) flush(reply)
        break
      }
      case 'release-last-response': {
        const reply = replies.pop()
        if (reply !== undefined) flush(reply)
        break
      }
      case 'equal-projects': {
        if (backend === null) throw new Error('Missing backend.')
        const state = backend.application.current()
        if (state.phase !== 'ready') throw new Error('Backend is not ready.')
        // Real presentation-only publication changes Connection facts, not selected Projects.
        const outcome = await backend.application.execute(
          commandSchema.parse({
            type: 'rename-connection',
            expectedConfigurationVersion: state.configurationVersion,
            connectionId: 'local',
            name: `Local ${state.configurationVersion}`,
          }),
        )
        if (!outcome.ok) throw new Error('Equal-projects fixture command was rejected.')
        break
      }
      case 'mutate-projects': {
        if (backend === null) throw new Error('Missing backend.')
        const state = backend.application.current()
        if (state.phase !== 'ready') throw new Error('Backend is not ready.')
        const outcome = await backend.application.execute(
          commandSchema.parse({
            type: 'rename-project',
            expectedConfigurationVersion: state.configurationVersion,
            project: { integration: 'local', projectId: 'fixture' },
            name: 'Changed selected Project',
          }),
        )
        if (!outcome.ok) throw new Error('Changed-projects fixture command was rejected.')
        break
      }
      default:
        throw new Error(`Unknown fixture action ${action}.`)
    }
    return status()
  }

  const front = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.invalid')
    if (url.pathname === '/__fixture/control') {
      if (request.method !== 'POST' && request.method !== 'GET') {
        response.writeHead(405).end()
        return
      }
      void control(url.searchParams.get('action') ?? 'status').then(
        (value) =>
          response
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify(value)),
        (error: unknown) =>
          response
            .writeHead(500, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: String(error) })),
      )
      return
    }
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname === '/health' ||
      url.pathname === '/ready'
    ) {
      if (backend === null) {
        response.writeHead(503).end()
        return
      }
      const shouldHold = url.pathname === '/api/command' && holdNextResponse
      const shouldHoldRequest = url.pathname === '/api/command' && holdNextRequest
      const shouldDrop = url.pathname === '/api/command' && dropNextResponse
      if (url.pathname === '/api/command') {
        commandRequests += 1
        holdNextRequest = false
        holdNextResponse = false
        dropNextResponse = false
      }
      const forward = () => {
        if (backend === null) {
          response.writeHead(503).end()
          return
        }
        const proxy = httpRequest(
          new URL(request.url ?? '/', backend.url),
          {
            method: request.method,
            headers: { ...request.headers, host: new URL(backend.url).host, origin },
          },
          (upstream) => {
            const chunks: Buffer[] = []
            upstream.on('data', (chunk: Buffer) => chunks.push(chunk))
            upstream.on('end', () => {
              const body = Buffer.concat(chunks)
              if (url.pathname === '/api/command' && upstream.statusCode === 200) {
                const decoded = commandResultEnvelopeSchema.safeParse(JSON.parse(body.toString()))
                if (!decoded.success) {
                  response.destroy(new Error('Real transport sent an invalid outcome.'))
                  return
                }
                acceptedCommandResponses += 1
              }
              const reply = {
                response,
                status: upstream.statusCode ?? 502,
                headers: { 'Content-Type': 'application/json' },
                body,
              }
              if (shouldDrop) {
                response.writeHead(reply.status, {
                  ...reply.headers,
                  'Content-Length': body.length,
                  Connection: 'close',
                })
                response.flushHeaders()
                response.end(body.subarray(0, Math.max(1, body.length - 1)))
              } else if (shouldHold) replies.push(reply)
              else flush(reply)
            })
          },
        )
        proxy.on('error', () => response.destroy())
        request.pipe(proxy)
      }
      if (shouldHoldRequest) requests.push(forward)
      else forward()
      return
    }
    if (
      url.pathname === '/' ||
      url.pathname.startsWith('/projects/') ||
      (!url.pathname.startsWith('/@') &&
        !url.pathname.startsWith('/scripts/') &&
        !url.pathname.startsWith('/node_modules/') &&
        !url.pathname.includes('.'))
    ) {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><html><head><meta charset="utf-8"><title>Client owner regression</title></head><body><div id="root"></div><script type="module" src="/@fs/${entryPath}"></script></body></html>`,
        )
      return
    }
    middleware(request, response, () => response.writeHead(404).end())
  })
  const sockets = new WebSocketServer({ noServer: true })
  front.on('upgrade', (request, socket, head) => {
    if (closing || request.url !== '/ws' || backend === null) {
      socket.destroy()
      return
    }
    const target = backend.url.replace('http:', 'ws:')
    sockets.handleUpgrade(request, socket, head, (browser) => {
      socketConnections += 1
      const upstream = new WebSocket(`${target}/ws`, { origin })
      const client: { browser: WebSocket; upstream: WebSocket; latest: string | null } = {
        browser,
        upstream,
        latest: null,
      }
      clients.add(client)
      browser.on('error', () => undefined)
      upstream.on('error', () => browser.close())
      upstream.on('message', (bytes) => {
        const raw = bytes.toString()
        const decoded = decodeStateEnvelope(JSON.parse(raw))
        if (!decoded.ok) {
          browser.close(1011, 'Invalid real application wire state')
          return
        }
        client.latest = raw
        if (!held && browser.readyState === WebSocket.OPEN) browser.send(raw)
      })
      browser.on('close', () => {
        clients.delete(client)
        upstream.close()
      })
      upstream.on('close', () => browser.close())
    })
  })
  async function close() {
    if (closing) return
    closing = true
    const errors: unknown[] = []
    async function attempt(cleanup: () => void | Promise<void>) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      for (const forward of requests.splice(0)) await attempt(forward)
      for (const reply of replies.splice(0)) await attempt(() => flush(reply))
      for (const client of clients) {
        await attempt(() => client.browser.terminate())
        await attempt(() => client.upstream.terminate())
      }
      await attempt(
        () =>
          new Promise<void>((resolve, reject) =>
            sockets.close((error) => (error ? reject(error) : resolve())),
          ),
      )
      for (const item of backends) {
        await Promise.all([
          attempt(() => item.application.stop()),
          attempt(() => item.transport.close()),
        ])
        await attempt(() => closeServer(item.server))
      }
      await attempt(() => closeServer(front))
    } finally {
      await attempt(() => rm(root, { recursive: true, force: true }))
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Fixture cleanup failed.')
  }

  try {
    await mkdir(join(mapDirectory, 'tickets'), { recursive: true })
    origin = `http://127.0.0.1:${await listen(front)}`
    backend = await makeBackend('Predecessor', 1)
  } catch (error) {
    try {
      await close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Fixture startup and cleanup failed.')
    }
    throw error
  }

  return {
    origin,
    control,
    close,
  }
}
