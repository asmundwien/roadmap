import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
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
import {
  type AutomationDatabase,
  type AutomationEvent,
  createAutomationDatabaseDocument,
  decodeAutomationDatabase,
} from '../../apps/server/src/automation/database.ts'
import type { AutomationTarget } from '../../apps/server/src/automation/model.ts'
import { createConfigurationDocument } from '../../apps/server/src/configuration/document.ts'
import { GitHubError } from '../../apps/server/src/github/client.ts'
import { createGitHubObserverPool } from '../../apps/server/src/github/observer.ts'
import { createLocalProjectAdmission } from '../../apps/server/src/local/admission.ts'
import { createLocalObserver } from '../../apps/server/src/local/observer.ts'
import type {
  AdmissionOutcome,
  GitHubProviderRead,
  ProjectAdmission,
  ProjectConfiguration,
  ProjectRevalidationRequest,
} from '../../apps/server/src/projects/registry.ts'
import { createRoadmapTransport, type RoadmapTransport } from '../../apps/server/src/transport.ts'

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void
const ids = {
  localProject: 'resource%2F/local:α',
  localMap: '.wayfinder/resource%2F:α space/map.md',
  localTicket: 'ticket%2F/α:1',
  blocker: 'blocker:2',
  siblingMap: '.wayfinder/sibling/map.md',
  emptyProject: 'resource-empty',
  neverProject: 'resource-never',
  closedProject: 'resource-closed',
  githubProject: 'github%2F/resource:α',
  missingProject: 'missing%2F/project:α',
  missingMap: 'never%2F/map:α',
}
const segment = (value: string) => encodeURIComponent(value).replaceAll('%3A', ':')
const projectPath = (integration: string, id: string) => `/projects/${integration}/${segment(id)}`
const mapPath = (integration: string, id: string, map: string) =>
  `${projectPath(integration, id)}/maps/${segment(map)}`
const ticketPath = (integration: string, id: string, map: string, ticket: string) =>
  `${mapPath(integration, id, map)}/tickets/${segment(ticket)}`
const local = projectPath('local', ids.localProject)
const localMap = mapPath('local', ids.localProject, ids.localMap)
const paths = {
  local,
  localSettings: `${local}/settings`,
  localMap,
  localTicket: ticketPath('local', ids.localProject, ids.localMap, ids.localTicket),
  localBlocker: ticketPath('local', ids.localProject, ids.localMap, ids.blocker),
  localSibling: mapPath('local', ids.localProject, ids.siblingMap),
  empty: projectPath('local', ids.emptyProject),
  emptySettings: `${projectPath('local', ids.emptyProject)}/settings`,
  never: projectPath('local', ids.neverProject),
  neverSettings: `${projectPath('local', ids.neverProject)}/settings`,
  closed: projectPath('local', ids.closedProject),
  closedMap: mapPath('local', ids.closedProject, '.wayfinder/closed/map.md'),
  githubTicket: ticketPath('github', ids.githubProject, '71', '72'),
  githubMap: mapPath('github', ids.githubProject, '71'),
  githubSettings: `${projectPath('github', ids.githubProject)}/settings`,
  queuedTicket: ticketPath('local', ids.localProject, ids.localMap, 'queued'),
  finishedTicket: ticketPath('local', ids.localProject, ids.localMap, 'finished'),
  acknowledgedTicket: ticketPath('local', ids.localProject, ids.localMap, 'acknowledged'),
  missingMap: mapPath('local', ids.localProject, ids.missingMap),
  missingMapTicket: ticketPath('local', ids.localProject, ids.missingMap, 'lost-map-ticket'),
  missingTicket: ticketPath('local', ids.localProject, ids.localMap, 'lost-ticket'),
  missingProjectTicket: ticketPath('local', ids.missingProject, 'lost-map', 'lost-project-ticket'),
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (address === null || typeof address === 'string')
        return reject(new Error('Missing listener address.'))
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
function markdownTicket(id: string, title: string, body: string, extra = '') {
  return `---\nid: ${id}\ntitle: ${title}\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: []\n${extra}---\n\n${body}\n`
}
function completeMap(title: string, prose: string, status = 'open') {
  return `---\ntitle: ${title}\nlabels: [wayfinder:map]\nstatus: ${status}\n---\n\n## Destination\n\n${prose}\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n`
}

function durableHistory(): AutomationDatabase {
  const opportunities: AutomationDatabase['opportunities'][number][] = []
  const events: AutomationEvent[] = []
  const targets = [
    { ticket: 'queued', mode: 'queued', reason: '' },
    { ticket: 'finished', mode: 'finished', reason: '' },
    { ticket: ids.localTicket, mode: 'finished', reason: '' },
    {
      ticket: 'acknowledged',
      mode: 'acknowledged',
      reason: 'Acknowledged unknown remains unknown.',
    },
    {
      ticket: 'lost-map-ticket',
      mode: 'unknown',
      map: ids.missingMap,
      reason: 'Never-present map interruption.',
    },
    { ticket: 'lost-ticket', mode: 'unknown', reason: 'Never-present ticket interruption.' },
    {
      ticket: 'lost-project-ticket',
      mode: 'unknown',
      project: ids.missingProject,
      map: 'lost-map',
      reason: 'Never-present Project interruption.',
    },
  ]
  for (const [index, entry] of targets.entries()) {
    const opportunityId = `opportunity-${index}`
    const target: AutomationTarget = {
      project: { integration: 'local', id: entry.project ?? ids.localProject },
      mapId: entry.map ?? ids.localMap,
      ticketId: entry.ticket,
    }
    opportunities.push({ id: opportunityId, target })
    const identity = (label: string) => ({
      id: `${opportunityId}-${label}`,
      opportunityId,
      recordedAt: '2026-10-09T10:00:00.000Z',
    })
    events.push(
      {
        ...identity('classification-started'),
        type: 'classification-started',
        admission: 'automatic',
      },
      {
        ...identity('classification-completed'),
        type: 'classification-completed',
        processResult: { status: 'exited', code: 3 },
        verdict: { value: 'afk', reason: 'Classification verdict is independent of process exit.' },
      },
    )
    if (entry.mode === 'queued') continue
    events.push(
      { ...identity('wayfinder-launching'), type: 'wayfinder-launching', admission: 'override' },
      { ...identity('wayfinder-running'), type: 'wayfinder-running' },
    )
    if (entry.mode === 'finished') {
      events.push({
        ...identity('wayfinder-finished'),
        type: 'wayfinder-finished',
        processResult: { status: 'exited', code: 9 },
        report: {
          status: 'received',
          report: { outcome: 'completed', reason: 'Report disagrees with process exit.' },
        },
      })
    } else {
      const unknown = identity('wayfinder-outcome-unknown')
      events.push({ ...unknown, type: 'wayfinder-outcome-unknown', reason: entry.reason })
      if (entry.mode === 'acknowledged')
        events.push({
          ...identity('acknowledged'),
          type: 'wayfinder-outcome-unknown-acknowledged',
          unknownEventId: unknown.id,
        })
    }
  }
  // The same strict decoder and replay transition validator used by disk load accepts this history.
  return decodeAutomationDatabase({ schemaVersion: 3, opportunities, events })
}

/** Private dependencies are harmless. Public state is produced only by RoadmapApplication. */
export async function createResourceResultsServer(middleware: Middleware, entryPath: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-resource-results-')))
  const workspace = join(root, 'local')
  const mapDirectory = join(workspace, '.wayfinder', 'resource%2F:α space')
  const sourceFile = join(mapDirectory, 'map.md')
  const primaryFile = join(mapDirectory, 'tickets', '01-primary.md')
  const duplicateFile = join(mapDirectory, 'tickets', '99-duplicate.md')
  const databasePath = join(root, 'automation.json')
  let application: RoadmapApplication | null = null
  let transport: RoadmapTransport | null = null
  let backend: Server | null = null
  let backendUrl = ''
  let origin = ''
  let held = true
  let closing = false
  let commandRequests = 0
  let hostInvocations = 0
  let selectorInvocations = 0
  let classificationLaunches = 0
  let wayfinderLaunches = 0
  let remoteUnreadable = false
  let remoteRootUnreadable = false
  const providerRequests: { kind: string; request: string }[] = []
  const clients = new Set<{ browser: WebSocket; upstream: WebSocket; latest: string | null }>()
  const pool = createGitHubObserverPool({ reconcileMs: 1_000_000, logger: { warn() {} } })
  const credentials = {
    accessToken: 'fixture-access-only',
    refreshToken: 'fixture-refresh-only',
    accessTokenExpiresAt: Date.now() + 86_400_000,
    refreshTokenExpiresAt: Date.now() + 172_800_000,
  }
  const primary = `---\nid: ${ids.localTicket}\ntitle: Opaque primary\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: [${ids.blocker}, unknown-blocker]\nassignee: Fixture owner\n---\n\nOpaque primary ticket.\n\n[Return to resource map](../map.md)\n\n[Open known blocker](02-blocker.md)\n\n[Public source reference](https://example.invalid/resource-source)\n`
  const duplicate = markdownTicket(
    ids.localTicket,
    'Duplicate opaque primary',
    'Raw duplicate ticket prose.',
  )
  const rawMap = `---\ntitle: Resource opaque map\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\nRaw incomplete resource prose.\n\n[Open opaque primary](tickets/01-primary.md)\n\n## Custom retained heading\n\nUnindexed prose survives.\n\n## Decisions so far\n\n- [Opaque primary](tickets/01-primary.md): Preserve the actual source identity.\n`
  const connection = {
    id: 'fixture-github',
    integration: 'github',
    name: 'Fixture GitHub',
    builtIn: false,
    githubIdentity: { id: '9001', login: 'fixture' },
  } satisfies ProjectConfiguration['connections'][number]
  const provider: GitHubProviderRead = {
    async restGet(path) {
      providerRequests.push({ kind: 'REST', request: path })
      if (path === '/repositories/8001') {
        if (remoteRootUnreadable)
          throw new GitHubError({ kind: 'access-ambiguous', evidence: 'http-404' }, 404)
        return { id: 8001, full_name: 'fixture/resources' }
      }
      if (
        path ===
        '/repos/fixture/resources/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1'
      )
        return [{ number: 71 }]
      throw new Error(`Unexpected provider REST request ${path}`)
    },
    async graphql(query, variables = {}) {
      providerRequests.push({ kind: 'GraphQL', request: query })
      if (!query.includes('subIssuesSummary') || !query.includes('blockedBy(first: 50)'))
        throw new Error('Fixture must use actual map/dependency API.')
      if (remoteUnreadable) throw new GitHubError({ kind: 'transient', cause: 'network' })
      const connectionNodes = (
        nodes: unknown[],
        totalCount = nodes.length,
        hasNextPage = false,
      ) => ({ totalCount, pageInfo: { hasNextPage }, nodes })
      const child = (number: number, title: string, blocked: boolean) => ({
        number,
        title,
        url: `https://github.com/fixture/resources/issues/${number}`,
        state: 'OPEN',
        stateReason: null,
        createdAt: '2026-10-08T10:00:00Z',
        closedAt: null,
        body:
          number === 72
            ? 'GitHub child prose.\n\n[Remote Markdown map](https://github.com/fixture/resources/issues/71)'
            : 'GitHub blocker prose.',
        labels: connectionNodes([{ name: 'wayfinder:task', color: 'ffffff' }]),
        assignees: connectionNodes([
          {
            login: 'fixture',
            avatarUrl: 'https://example.invalid/avatar.png',
            url: 'https://github.com/fixture',
          },
        ]),
        blockedBy: blocked
          ? connectionNodes(
              [
                {
                  number: 73,
                  title: 'Remote known blocker',
                  url: 'https://github.com/fixture/resources/issues/73',
                  state: 'OPEN',
                  repository: { databaseId: 8001, nameWithOwner: 'fixture/resources' },
                },
              ],
              2,
              true,
            )
          : connectionNodes([]),
      })
      const issue = {
        number: 71,
        title: 'Remote aggregate map',
        url: 'https://github.com/fixture/resources/issues/71',
        state: 'OPEN',
        updatedAt: '2026-10-09T10:00:00Z',
        closedAt: null,
        body: completeMap(
          'Remote aggregate map',
          'Remote aggregate prose.\n\n[Remote Markdown ticket](https://github.com/fixture/resources/issues/72)',
        ).replace(/^---[\s\S]*?---\n/, ''),
        subIssuesSummary: { total: 12, completed: 7, percentCompleted: 58.333333333333336 },
        subIssues: connectionNodes(
          [child(72, 'Remote primary', true), child(73, 'Remote known blocker', false)],
          12,
          true,
        ),
      }
      const data: Record<string, unknown> = {
        rateLimit: { cost: 1, remaining: 4999, limit: 5000, resetAt: '2026-10-11T10:00:00Z' },
      }
      for (let index = 0; `o${index}` in variables; index += 1) {
        if (
          variables[`o${index}`] !== 'fixture' ||
          variables[`n${index}`] !== 'resources' ||
          variables[`i${index}`] !== 71
        )
          throw new Error('Unexpected scoped GraphQL map request.')
        data[`m${index}`] = { databaseId: 8001, nameWithOwner: 'fixture/resources', issue }
      }
      return { data, errors: [] }
    },
  }
  async function remoteAdmission(request: ProjectRevalidationRequest): Promise<AdmissionOutcome> {
    if (request.intent.ref.integration !== 'github') throw new Error('Not a fixture GitHub intent.')
    return {
      integration: 'github',
      source: {
        ok: true,
        value: {
          connectionId: connection.id,
          accountId: connection.githubIdentity.id,
          repositoryId: '8001',
          access: provider,
        },
      },
      workspace: {
        ok: false,
        error: {
          code: 'admission-failed',
          message: 'Fixture remote Workspace is deliberately not admitted.',
        },
      },
    }
  }
  const admission: ProjectAdmission = {
    async admit() {
      throw new Error('Fixture does not register GitHub Projects.')
    },
    repair: remoteAdmission,
    revalidate: remoteAdmission,
  }
  function readyApplication() {
    if (application === null) throw new Error('Fixture application is not initialized.')
    return application
  }
  async function refresh(integration: 'local' | 'github', projectId: string) {
    const app = readyApplication()
    const state = app.current()
    if (state.phase !== 'ready') throw new Error('Fixture application is not ready.')
    const outcome = await app.execute(
      commandSchema.parse({
        type: 'refresh-project',
        expectedConfigurationVersion: state.configurationVersion,
        project: { integration, projectId },
      }),
    )
    if (!outcome.ok) throw new Error(`Fixture refresh failed: ${outcome.error.message}`)
  }
  async function status() {
    return {
      root,
      origin,
      held,
      activeSockets: clients.size,
      upstreamSockets: transport?.clientCount() ?? 0,
      commandRequests,
      hostInvocations,
      selectorInvocations,
      classificationLaunches,
      wayfinderLaunches,
      automationEvents: decodeAutomationDatabase(JSON.parse(await readFile(databasePath, 'utf8')))
        .events.length,
      providerRequests: [...providerRequests],
      state: application?.current() ?? null,
    }
  }
  async function control(action: string) {
    switch (action) {
      case 'status':
        break
      case 'release-baseline':
        held = false
        for (const client of clients)
          if (client.latest !== null && client.browser.readyState === WebSocket.OPEN)
            client.browser.send(client.latest)
        break
      case 'local-map-unreadable':
        // ENOENT comes from the actual reader while complete membership still names this directory/map.
        await rename(sourceFile, join(root, 'map-unreadable.md'))
        await refresh('local', ids.localProject)
        break
      case 'local-map-recover':
        await rename(join(root, 'map-unreadable.md'), sourceFile)
        await refresh('local', ids.localProject)
        break
      case 'local-root-unreadable':
        await rename(workspace, join(root, 'root-unreadable'))
        await refresh('local', ids.localProject)
        break
      case 'local-root-recover':
        await rename(join(root, 'root-unreadable'), workspace)
        await refresh('local', ids.localProject)
        break
      case 'local-ticket-disappear':
        await rename(primaryFile, join(root, 'primary-absent.md'))
        await rename(duplicateFile, join(root, 'duplicate-absent.md'))
        await refresh('local', ids.localProject)
        break
      case 'local-ticket-recover':
        await rename(join(root, 'primary-absent.md'), primaryFile)
        await rename(join(root, 'duplicate-absent.md'), duplicateFile)
        await refresh('local', ids.localProject)
        break
      case 'local-map-disappear':
        await rename(mapDirectory, join(root, 'map-absent'))
        await refresh('local', ids.localProject)
        break
      case 'local-map-recover-membership':
        await rename(join(root, 'map-absent'), mapDirectory)
        await refresh('local', ids.localProject)
        break
      case 'github-unreadable':
        remoteUnreadable = true
        await refresh('github', ids.githubProject)
        await refresh('github', ids.githubProject)
        await refresh('github', ids.githubProject)
        break
      case 'github-recover':
        remoteUnreadable = false
        await refresh('github', ids.githubProject)
        break
      case 'github-root-unreadable':
        remoteRootUnreadable = true
        await refresh('github', ids.githubProject)
        break
      case 'github-root-recover':
        remoteRootUnreadable = false
        await refresh('github', ids.githubProject)
        break
      case 'remove-local-project': {
        const app = readyApplication()
        const state = app.current()
        if (state.phase !== 'ready') throw new Error('Fixture is not ready.')
        const outcome = await app.execute(
          commandSchema.parse({
            type: 'remove-project',
            expectedConfigurationVersion: state.configurationVersion,
            project: { integration: 'local', projectId: ids.localProject },
          }),
        )
        if (!outcome.ok) throw new Error(outcome.error.message)
        break
      }
      default:
        throw new Error(`Unknown fixture control ${action}`)
    }
    return status()
  }
  const front = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.invalid')
    if (url.pathname === '/__fixture/control') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      void control(url.searchParams.get('action') ?? 'status').then(
        (result) =>
          response
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify(result)),
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
      if (!backendUrl) {
        response.writeHead(503).end()
        return
      }
      if (url.pathname === '/api/command') commandRequests += 1
      const proxy = httpRequest(
        new URL(request.url ?? '/', backendUrl),
        {
          method: request.method,
          headers: { ...request.headers, host: new URL(backendUrl).host, origin },
        },
        (upstream) => {
          const chunks: Buffer[] = []
          upstream.on('data', (chunk: Buffer) => chunks.push(chunk))
          upstream.on('end', () => {
            const body = Buffer.concat(chunks)
            if (url.pathname === '/api/command' && upstream.statusCode === 200) {
              const decoded = commandResultEnvelopeSchema.safeParse(JSON.parse(body.toString()))
              if (!decoded.success) {
                response.destroy(new Error('Invalid real transport outcome.'))
                return
              }
            }
            response
              .writeHead(upstream.statusCode ?? 502, { 'Content-Type': 'application/json' })
              .end(body)
          })
        },
      )
      proxy.on('error', () => response.destroy())
      request.pipe(proxy)
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
          `<!doctype html><html><head><meta charset="utf-8"><title>Resource results regression</title></head><body><div id="root"></div><script type="module" src="/@fs/${entryPath}"></script></body></html>`,
        )
      return
    }
    middleware(request, response, () => response.writeHead(404).end())
  })
  const sockets = new WebSocketServer({ noServer: true })
  front.on('upgrade', (request, socket, head) => {
    if (closing || request.url !== '/ws' || !backendUrl) {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (browser) => {
      const upstream = new WebSocket(`${backendUrl.replace('http:', 'ws:')}/ws`, { origin })
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
          browser.close(1011, 'Invalid actual application wire state')
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
    for (const client of clients) {
      client.browser.terminate()
      client.upstream.terminate()
    }
    await attempt(
      () =>
        new Promise<void>((resolve, reject) =>
          sockets.close((error) => (error ? reject(error) : resolve())),
        ),
    )
    await attempt(async () => {
      await application?.stop()
    })
    await attempt(() => pool.stop())
    await attempt(async () => {
      await transport?.close()
    })
    const currentBackend = backend
    if (currentBackend !== null) await attempt(() => closeServer(currentBackend))
    await attempt(() => closeServer(front))
    await attempt(() => rm(root, { recursive: true, force: true }))
    if (errors.length) throw new AggregateError(errors, 'Resource-results fixture cleanup failed.')
  }
  try {
    await mkdir(join(mapDirectory, 'tickets'), { recursive: true })
    await mkdir(join(workspace, '.wayfinder', 'sibling', 'tickets'), { recursive: true })
    await mkdir(join(root, 'empty', '.wayfinder'), { recursive: true })
    await mkdir(join(root, 'closed', '.wayfinder', 'closed', 'tickets'), { recursive: true })
    await writeFile(sourceFile, rawMap)
    await writeFile(primaryFile, primary)
    await writeFile(duplicateFile, duplicate)
    await writeFile(
      join(mapDirectory, 'tickets', '02-blocker.md'),
      markdownTicket(ids.blocker, 'Known blocker', 'Known blocker ticket.'),
    )
    for (const id of ['queued', 'finished', 'acknowledged'])
      await writeFile(
        join(mapDirectory, 'tickets', `${id}.md`),
        markdownTicket(id, `${id} evidence target`, `${id} target prose.`),
      )
    await writeFile(
      join(workspace, '.wayfinder', 'sibling', 'map.md'),
      completeMap('Sibling map', 'Sibling map prose.'),
    )
    await writeFile(
      join(root, 'closed', '.wayfinder', 'closed', 'map.md'),
      completeMap('Closed only map', 'Closed default prose.', 'closed'),
    )
    const configuration: ProjectConfiguration = {
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [
        { id: 'local', integration: 'local', name: 'Local', builtIn: true },
        connection,
      ],
      projects: [
        {
          ref: { integration: 'local', projectId: ids.localProject },
          connectionId: 'local',
          displayName: 'Resource Local',
          workspace: { path: workspace },
        },
        {
          ref: { integration: 'local', projectId: ids.emptyProject },
          connectionId: 'local',
          displayName: 'Resource Empty',
          workspace: { path: join(root, 'empty') },
        },
        {
          ref: { integration: 'local', projectId: ids.neverProject },
          connectionId: 'local',
          displayName: 'Resource Never',
          workspace: { path: join(root, 'never-created') },
        },
        {
          ref: { integration: 'local', projectId: ids.closedProject },
          connectionId: 'local',
          displayName: 'Resource Closed',
          workspace: { path: join(root, 'closed') },
        },
        {
          ref: { integration: 'github', projectId: ids.githubProject },
          connectionId: connection.id,
          displayName: 'Resource GitHub',
          locator: { repositoryId: '8001', nameWithOwner: 'fixture/resources' },
          workspace: { path: join(root, 'remote-not-admitted') },
        },
      ],
      automation: { enabled: false, enabledProjects: [] },
    }
    const configurationPath = join(root, 'configuration.json')
    await writeFile(configurationPath, JSON.stringify(configuration))
    await writeFile(databasePath, JSON.stringify(durableHistory()))
    origin = `http://127.0.0.1:${await listen(front)}`
    application = createRoadmapApplication({
      configuration: createConfigurationDocument(configurationPath, { debounceMs: 25 }),
      admissions: { local: createLocalProjectAdmission(), github: admission },
      credentialVault: {
        async read(id) {
          return id === connection.id ? credentials : null
        },
        async write() {
          throw new Error('No fixture authorization writes are expected.')
        },
        async delete() {},
        async cleanupOrphans() {},
      },
      github: {
        integration: {
          integration: 'github',
          name: 'GitHub',
          connectionKind: 'device-authorization',
          newInstallationUrl: 'https://example.invalid/install',
          installationsUrl: 'https://example.invalid/installations',
          authorizationsUrl: 'https://example.invalid/authorizations',
        },
        async identify() {
          return connection.githubIdentity
        },
        async beginDeviceAuthorization() {
          throw new Error('No device authorization is used by the fixture.')
        },
        async pollDeviceAuthorization() {
          throw new Error('No device authorization polling is used by the fixture.')
        },
        async refresh() {
          return credentials
        },
      },
      providerRead: () => provider,
      observers: {
        local(input) {
          return createLocalObserver(input, {
            reconcileMs: 1_000_000,
            debounceMs: 25,
            logger: { info() {}, warn() {} },
          })
        },
        github: (input) => pool.create(input),
        reconcileGitHubTopology: (inputs) => pool.reconcileTopology(inputs),
        stop: () => pool.stop(),
      },
      automation: {
        database: createAutomationDatabaseDocument(databasePath),
        launcher: {
          classify() {
            classificationLaunches += 1
            throw new Error('Fixture must never launch Classification.')
          },
          async dispatch() {
            wayfinderLaunches += 1
            throw new Error('Fixture must never launch Wayfinder.')
          },
        },
      },
      operations: createApplicationOperations({
        host: {
          async execute(operation) {
            if (operation.type === 'select-workspace') {
              selectorInvocations += 1
              return { kind: 'cancelled' }
            }
            hostInvocations += 1
            return { kind: 'invoked' }
          },
        },
      }),
    })
    backend = createServer((request, response) => {
      if (transport?.handle(request, response)) return
      response.writeHead(404).end()
    })
    transport = createRoadmapTransport({ server: backend, application, allowedOrigin: origin })
    await application.start()
    backendUrl = `http://127.0.0.1:${await listen(backend)}`
  } catch (error) {
    try {
      await close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Fixture startup and cleanup failed.')
    }
    throw error
  }
  return { origin, paths, ids, control, close }
}
