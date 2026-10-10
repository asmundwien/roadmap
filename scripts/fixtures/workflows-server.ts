import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { commandSchema } from '@roadmap/contracts/operations'
import { commandResultEnvelopeSchema, decodeStateEnvelope } from '@roadmap/contracts/wire'
import { WebSocket, WebSocketServer } from 'ws'
import type { RoadmapApplication } from '../../apps/server/src/application/application.ts'
import { createRoadmapApplication } from '../../apps/server/src/application/application.ts'
import { createApplicationOperations } from '../../apps/server/src/application/operations.ts'
import type { DeviceAuthorizationPoll } from '../../apps/server/src/authorization/contracts.ts'
import {
  createAutomationDatabaseDocument,
  decodeAutomationDatabase,
} from '../../apps/server/src/automation/database.ts'
import { createConfigurationDocument } from '../../apps/server/src/configuration/document.ts'
import { createGitHubProjectAdmission } from '../../apps/server/src/github/admission.ts'
import { GitHubError } from '../../apps/server/src/github/client.ts'
import { createGitHubObserverPool } from '../../apps/server/src/github/observer.ts'
import { createLocalProjectAdmission } from '../../apps/server/src/local/admission.ts'
import { createLocalObserver } from '../../apps/server/src/local/observer.ts'
import { inspectLocalWorkspace } from '../../apps/server/src/local/workspace.ts'
import type {
  AdmissionOutcome,
  AdmissionRuntime,
  GitHubProviderRead,
  ProjectConfiguration,
  ProjectRevalidationRequest,
} from '../../apps/server/src/projects/registry.ts'
import type { RoadmapTransport } from '../../apps/server/src/transport.ts'
import { createRoadmapTransport } from '../../apps/server/src/transport.ts'

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void
type Backend = {
  application: RoadmapApplication
  transport: RoadmapTransport
  server: Server
  url: string
  configurationPath: string
  configuration: ReturnType<typeof createConfigurationDocument>
  stopPool: () => Promise<void>
}
type SocketClose = { code: number; reason: string }
type SocketRecord = {
  generation: number
  serverEpoch: ReturnType<RoadmapApplication['current']>['serverEpoch']
  upstreamOpened: boolean
  receivedMessages: number
  forwardedMessages: number
  latestPublication: Pick<
    ReturnType<RoadmapApplication['current']>,
    'serverEpoch' | 'stateSequence'
  > | null
  browserClosed: SocketClose | null
  upstreamClosed: SocketClose | null
}
type RelayClient = {
  browser: WebSocket
  upstream: WebSocket
  latest: string | null
  record: SocketRecord
}
type SocketTransition = { generation: number } & (
  | { kind: 'accepted' | 'upstream-open' }
  | {
      kind: 'close-requested'
      cause:
        | 'fixture-disconnect'
        | 'fixture-restart'
        | 'fixture-successor'
        | 'upstream-error'
        | 'upstream-close'
        | 'invalid-state'
      code: number
      reason: string
    }
  | { kind: 'browser-close' | 'upstream-close'; code: number; reason: string }
)
type Reply = { id: number; response: ServerResponse; status: number; body: Buffer }
type ReplyMode =
  | 'normal'
  | 'hold'
  | 'lost'
  | 'unreadable'
  | 'wrong-correlation'
  | 'wrong-operation'
  | 'wrong-subject'
type RequestRecord = {
  id: number
  endpoint: string
  correlationId: string | null
  afterHeadersTruncated: boolean
  envelope: unknown
  outcome: unknown
  forwarded: boolean
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string')
        return reject(new Error('Missing fixture address.'))
      resolve(address.port)
    })
  })
}
function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

/** Every read fact and operation comes from the public application and its real transport. */
export async function createWorkflowsServer(middleware: Middleware, entryPath: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-workflows-')))
  const workspace = join(root, 'alpha')
  const otherWorkspace = join(root, 'beta')
  const newWorkspace = join(root, 'registration')
  const movedWorkspace = join(root, 'alpha-moved')
  const githubWorkspace = join(root, 'github-registration')
  const githubAlias = join(root, 'github-registration-alias')
  const githubMovedWorkspace = join(root, 'github-registration-moved')
  const githubRepairAlias = join(root, 'github-repair-alias')
  const githubWrongWorkspace = join(root, 'github-wrong-repository')
  const githubWrongAlias = join(root, 'github-wrong-repository-alias')
  const alias = join(root, 'registration-alias')
  const repairAlias = join(root, 'alpha-alias')
  const databasePath = join(root, 'automation.json')
  const ids = {
    alpha: 'workflow-alpha',
    beta: 'workflow-beta',
    github: 'workflow-github',
    connection: 'fixture-github',
    map: '.wayfinder/workflow/map.md',
    ticket: '1',
  }
  const paths = {
    alpha: `/projects/local/${ids.alpha}/settings`,
    beta: `/projects/local/${ids.beta}/settings`,
    github: `/projects/github/${ids.github}/settings`,
    connections: '/connections',
    import: '/connections/local/projects/import',
    githubImport: `/connections/${ids.connection}/projects/import`,
    ticket: `/projects/local/${ids.alpha}/maps/${encodeURIComponent(ids.map)}/tickets/1`,
  }
  const credentials = {
    accessToken: 'fixture-only',
    refreshToken: 'fixture-only-refresh',
    accessTokenExpiresAt: Date.now() + 86_400_000,
    refreshTokenExpiresAt: Date.now() + 172_800_000,
  }
  const newAccountCredentials = {
    ...credentials,
    accessToken: 'fixture-new-account-only',
    refreshToken: 'fixture-new-account-only-refresh',
  }
  const deviceCredentials = new Map<string, typeof credentials>()
  let authorizationCredentials = credentials
  const vault = new Map([[ids.connection, credentials]])
  let origin = ''
  let backend: Backend | null = null
  const backends: Backend[] = []
  const backendClosures = new Map<Backend, Promise<void>>()
  let closing = false
  let held = false
  let socketConnections = 0
  let nextReply: ReplyMode = 'normal'
  let nextRequest = 'normal'
  let selector: 'selected' | 'cancelled' | 'error' = 'selected'
  let selectedPath = alias
  let remoteFailure: 'none' | 'map' | 'authorization' = 'none'
  let authorizationPoll: DeviceAuthorizationPoll['status'] = 'pending'
  let failAuthorizationBegin = false
  let unconfirmedCommit = false
  let authorizationBegins = 0
  let hostInvocations = 0
  let selectorInvocations = 0
  let classificationLaunches = 0
  let wayfinderLaunches = 0
  let withheldClassificationCommand: ProjectConfiguration['automation']['classificationCommand']
  const ambiguityWorkspaces = Array.from({ length: 5 }, (_, index) =>
    join(root, `ambiguous-registration-${index}`),
  )
  let hostBarrier: (() => void) | null = null
  let holdHost = false
  const requests: RequestRecord[] = []
  const replies: Reply[] = []
  const dispatches: (() => void)[] = []
  const clients = new Set<RelayClient>()
  const socketRecords: SocketRecord[] = []
  const socketTransitions: SocketTransition[] = []
  const provider: GitHubProviderRead = {
    async restGet(path) {
      if (remoteFailure === 'authorization')
        throw new GitHubError({ kind: 'authorization', proof: 'http-401' }, 401)
      if (path === '/repositories/8001') return { id: 8001, full_name: 'fixture/workflows' }
      if (path === '/repos/fixture/workflows') return { id: 8001, full_name: 'fixture/workflows' }
      if (path === '/repos/fixture/registration' || path === '/repositories/8002')
        return { id: 8002, full_name: 'fixture/registration' }
      if (
        path ===
        '/repos/fixture/registration/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1'
      )
        return []
      if (
        path ===
        '/repos/fixture/workflows/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1'
      )
        return [{ number: 71 }]
      throw new Error(`Unexpected fixture REST request ${path}`)
    },
    async graphql(_query, variables = {}) {
      if (remoteFailure === 'map') throw new GitHubError({ kind: 'transient', cause: 'network' })
      if (remoteFailure === 'authorization')
        throw new GitHubError({ kind: 'authorization', proof: 'http-401' }, 401)
      const data: Record<string, unknown> = {
        rateLimit: { cost: 1, remaining: 4999, limit: 5000, resetAt: '2026-10-11T10:00:00Z' },
      }
      for (let index = 0; `o${index}` in variables; index += 1) {
        data[`m${index}`] = {
          databaseId: 8001,
          nameWithOwner: 'fixture/workflows',
          issue: {
            number: 71,
            title: 'GitHub workflow map',
            url: 'https://github.com/fixture/workflows/issues/71',
            state: 'OPEN',
            updatedAt: '2026-10-09T10:00:00Z',
            closedAt: null,
            body: '## Destination\n\nHarmless GitHub workflow.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n',
            subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
            subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
          },
        }
      }
      return { data, errors: [] }
    },
  }
  const githubAdmission = createGitHubProjectAdmission({
    async inspectWorkspace(path) {
      const canonical = await realpath(path)
      if (![githubWorkspace, githubMovedWorkspace, githubWrongWorkspace].includes(canonical))
        throw new Error('Fixture has no GitHub worktree authority for this directory.')
      await access(canonical, constants.R_OK | constants.X_OK)
      return {
        path: canonical,
        remotes: [
          {
            name: 'origin',
            nameWithOwner:
              canonical === githubWrongWorkspace ? 'fixture/workflows' : 'fixture/registration',
          },
        ],
      }
    },
  })
  const localAdmission = createLocalProjectAdmission()
  async function remoteAdmission(
    request: ProjectRevalidationRequest,
    runtime: AdmissionRuntime,
  ): Promise<AdmissionOutcome> {
    if (!('locator' in request.intent)) throw new Error('Unexpected admission integration.')
    if (request.intent.locator.repositoryId === '8002')
      return githubAdmission.revalidate(request, runtime)
    return {
      integration: 'github',
      source: {
        ok: true,
        value: {
          connectionId: ids.connection,
          accountId: '9001',
          repositoryId: '8001',
          access: provider,
        },
      },
      workspace: {
        ok: false,
        error: {
          code: 'admission-failed',
          message: 'No native Workspace authority for the GitHub fixture.',
        },
      },
    }
  }
  function app() {
    if (!backend) throw new Error('Fixture application is not initialized.')
    return backend.application
  }
  async function makeBackend(configuration: ProjectConfiguration): Promise<Backend> {
    const configurationPath = join(root, `configuration-${backends.length}.json`)
    await writeFile(configurationPath, JSON.stringify(configuration))
    const pool = createGitHubObserverPool({ reconcileMs: 1_000_000, logger: { warn() {} } })
    const document = createConfigurationDocument(configurationPath, { debounceMs: 25 })
    const application = createRoadmapApplication({
      configuration: {
        load: () => document.load(),
        subscribe: (listener) => document.subscribe(listener),
        stop: () => document.stop(),
        async write(configuration) {
          const unconfirmed = unconfirmedCommit
          unconfirmedCommit = false
          const result = await document.write(configuration)
          return result.ok && unconfirmed
            ? {
                ok: true,
                durability: 'unconfirmed',
                message:
                  'Fixture durability confirmation was withheld after the real filesystem replacement.',
              }
            : result
        },
      },
      admissions: {
        local: localAdmission,
        github: {
          admit: githubAdmission.admit,
          repair: remoteAdmission,
          revalidate: remoteAdmission,
        },
      },
      credentialVault: {
        async read(id) {
          return vault.get(id) ?? null
        },
        async write(id, value) {
          vault.set(id, value)
        },
        async delete(id) {
          vault.delete(id)
        },
        async cleanupOrphans(ids) {
          for (const id of vault.keys()) if (!ids.has(id)) vault.delete(id)
        },
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
        async identify(accessToken) {
          if (accessToken === credentials.accessToken) return { id: '9001', login: 'fixture' }
          if (accessToken === newAccountCredentials.accessToken)
            return { id: '9002', login: 'fixture-new-account' }
          throw new Error('Unknown harmless fixture access token.')
        },
        async beginDeviceAuthorization() {
          authorizationBegins += 1
          if (failAuthorizationBegin) throw new Error('Harmless provider authorization failure.')
          deviceCredentials.set(`fixture-device-${authorizationBegins}`, authorizationCredentials)
          return {
            deviceCode: `fixture-device-${authorizationBegins}`,
            userCode: 'FIXTURE',
            verificationUri: 'https://example.invalid/device',
            expiresAt: Date.now() + 60_000,
            intervalMs: 50,
          }
        },
        async pollDeviceAuthorization(deviceCode) {
          const credentials = deviceCredentials.get(deviceCode)
          if (!credentials) throw new Error('Unknown harmless fixture device code.')
          if (authorizationPoll === 'granted') return { status: 'granted', credentials }
          return { status: authorizationPoll }
        },
        async refresh(refreshToken) {
          if (refreshToken === credentials.refreshToken) return credentials
          if (refreshToken === newAccountCredentials.refreshToken) return newAccountCredentials
          throw new Error('Unknown harmless fixture refresh token.')
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
            return {
              completed: Promise.resolve({
                status: 'finished',
                code: 0,
                signal: null,
                stdout: JSON.stringify({
                  schemaVersion: 1,
                  verdict: 'afk',
                  reason: 'Fixture verdict remains independent of process exit.',
                }),
                stdoutOversized: false,
              }),
              async stop() {},
            }
          },
          async dispatch() {
            wayfinderLaunches += 1
            return {
              completed: Promise.resolve({
                status: 'finished',
                code: 9,
                signal: null,
                stdout: JSON.stringify({
                  schemaVersion: 1,
                  outcome: 'completed',
                  reason: 'Fixture report remains independent of process exit.',
                }),
                stdoutOversized: false,
              }),
            }
          },
        },
      },
      operations: createApplicationOperations({
        host: {
          async execute(operation) {
            if (operation.type === 'select-workspace') {
              selectorInvocations += 1
              if (selector === 'error') throw new Error('Harmless selector failure.')
              return selector === 'cancelled'
                ? { kind: 'cancelled' }
                : { kind: 'selected', path: selectedPath }
            }
            hostInvocations += 1
            if (holdHost) {
              holdHost = false
              await new Promise<void>((resolve) => {
                hostBarrier = resolve
              })
            }
            return { kind: 'invoked' }
          },
        },
      }),
    })
    let transport: RoadmapTransport | null = null
    const server = createServer((request, response) => {
      if (!transport?.handle(request, response)) response.writeHead(404).end()
    })
    transport = createRoadmapTransport({ server, application, allowedOrigin: origin })
    const result = {
      application,
      transport,
      server,
      url: '',
      configurationPath,
      configuration: document,
      stopPool: () => pool.stop(),
    }
    backends.push(result)
    await application.start()
    result.url = `http://127.0.0.1:${await listen(server)}`
    return result
  }
  function stopBackend(item: Backend): Promise<void> {
    const existing = backendClosures.get(item)
    if (existing) return existing
    const closure = Promise.resolve().then(async () => {
      const errors: unknown[] = []
      async function attempt(cleanup: () => Promise<void>) {
        try {
          await cleanup()
        } catch (error) {
          errors.push(error)
        }
      }
      await attempt(() => item.application.stop())
      await attempt(() => item.stopPool())
      await attempt(() => item.transport.close())
      await attempt(() => closeServer(item.server))
      if (errors.length) throw new AggregateError(errors, 'Workflow backend shutdown failed.')
    })
    backendClosures.set(item, closure)
    return closure
  }
  async function mutation(type: 'rename-connection' | 'set-automation-enabled') {
    const state = app().current()
    if (state.phase !== 'ready') throw new Error('Application is not ready.')
    const outcome = await app().execute(
      commandSchema.parse(
        type === 'rename-connection'
          ? {
              type,
              expectedConfigurationVersion: state.configurationVersion,
              connectionId: 'local',
              name: `Local revision ${state.configurationVersion + 1}`,
            }
          : {
              type,
              expectedConfigurationVersion: state.configurationVersion,
              enabled: !state.automation.enabled,
            },
      ),
    )
    if (!outcome.ok) throw new Error(outcome.error.message)
  }
  function flush(reply: Reply) {
    if (!reply.response.destroyed)
      reply.response.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(reply.body)
  }
  function truncate(reply: Reply) {
    if (reply.response.destroyed) return
    const record = requests.find((record) => record.id === reply.id)
    if (record) record.afterHeadersTruncated = true
    reply.response.writeHead(reply.status, {
      'Content-Type': 'application/json',
      'Content-Length': reply.body.length,
      Connection: 'close',
    })
    reply.response.flushHeaders()
    reply.response.end(reply.body.subarray(0, Math.max(1, reply.body.length - 1)))
  }
  async function setHarnessAvailability(available: boolean) {
    if (!backend) throw new Error('Missing backend.')
    const current = backend
    const loaded = await current.configuration.load()
    if (!loaded.ok) throw new Error('Fixture configuration must remain valid.')
    const configurationVersion = loaded.document.configurationVersion + 1
    const { classificationCommand, ...automation } = loaded.document.automation
    if (!available) withheldClassificationCommand = classificationCommand
    if (available && !withheldClassificationCommand)
      throw new Error('Missing previously configured harmless Classification Harness Command.')
    const result = await current.configuration.write({
      ...loaded.document,
      configurationVersion,
      automation: available
        ? { ...automation, classificationCommand: withheldClassificationCommand }
        : automation,
    })
    if (!result.ok) throw new Error(result.message)
    await new Promise<void>((resolve) => {
      let accepted = false
      let unsubscribe = () => {}
      unsubscribe = current.application.subscribe((state) => {
        if (
          state.phase === 'ready' &&
          state.configurationVersion === configurationVersion &&
          state.automation.availability.status === (available ? 'ready' : 'unavailable')
        ) {
          accepted = true
          unsubscribe()
          resolve()
        }
      })
      if (accepted) unsubscribe()
    })
  }
  async function status() {
    // Preserve captured request counts and outcomes when later real HTTP requests append or settle.
    return {
      root,
      paths,
      ids,
      workspace,
      otherWorkspace,
      newWorkspace,
      alias,
      repairAlias,
      githubWorkspace,
      githubAlias,
      githubMovedWorkspace,
      githubRepairAlias,
      githubWrongWorkspace,
      githubWrongAlias,
      ambiguityWorkspaces,
      databasePath,
      held,
      activeSockets: clients.size,
      socketConnections,
      upstreamSockets: backends.reduce((count, item) => count + item.transport.clientCount(), 0),
      socketGenerations: socketRecords.map((record) => ({ ...record })),
      socketTransitions: socketTransitions.map((transition) => ({ ...transition })),
      backends: backends.map((item) => ({
        serverEpoch: item.application.current().serverEpoch,
        lifecycle: item.application.diagnostics().lifecycle.phase,
        upstreamSockets: item.transport.clientCount(),
      })),
      pendingResponses: replies.map((reply) => reply.id),
      pendingDispatches: dispatches.length,
      hostBlocked: hostBarrier !== null,
      requests: requests.map((record) => ({ ...record })),
      hostInvocations,
      selectorInvocations,
      authorizationBegins,
      classificationLaunches,
      wayfinderLaunches,
      automation: decodeAutomationDatabase(JSON.parse(await readFile(databasePath, 'utf8'))),
      state: backend?.application.current() ?? null,
    }
  }
  function closeBrowser(
    client: RelayClient,
    code: number,
    reason: string,
    cause: Extract<SocketTransition, { kind: 'close-requested' }>['cause'],
  ) {
    if (client.browser.readyState >= WebSocket.CLOSING) return
    socketTransitions.push({
      generation: client.record.generation,
      kind: 'close-requested',
      cause,
      code,
      reason,
    })
    client.browser.close(code, reason)
  }
  async function control(action: string, argument = '') {
    if (closing) throw new Error('Workflow fixture is closed.')
    switch (action) {
      case 'status':
        break
      case 'reply': {
        const modes: ReplyMode[] = [
          'normal',
          'hold',
          'lost',
          'unreadable',
          'wrong-correlation',
          'wrong-operation',
          'wrong-subject',
        ]
        const mode = modes.find((mode) => mode === argument)
        if (!mode) throw new Error(`Unknown reply mode ${argument}`)
        nextReply = mode
        break
      }
      case 'request':
        nextRequest = argument
        break
      case 'release-reply': {
        const index = argument ? replies.findIndex((reply) => reply.id === Number(argument)) : 0
        if (index < 0 || !replies[index]) throw new Error('Missing held reply.')
        const [reply] = replies.splice(index, 1)
        flush(reply)
        break
      }
      case 'release-lost-reply': {
        const index = replies.findIndex((reply) => reply.id === Number(argument))
        if (index < 0 || !replies[index]) throw new Error('Missing held reply.')
        const [reply] = replies.splice(index, 1)
        truncate(reply)
        break
      }
      case 'release-dispatch': {
        const dispatch = dispatches.shift()
        if (!dispatch) throw new Error('Missing held dispatch.')
        dispatch()
        break
      }
      case 'hold-host':
        holdHost = true
        break
      case 'release-host':
        if (!hostBarrier) throw new Error('Missing host barrier.')
        hostBarrier()
        hostBarrier = null
        break
      case 'withhold':
        held = true
        break
      case 'release-baseline':
        held = false
        for (const client of clients)
          if (client.latest && client.browser.readyState === WebSocket.OPEN) {
            client.browser.send(client.latest)
            client.record.forwardedMessages += 1
          }
        break
      case 'disconnect':
        for (const client of clients)
          closeBrowser(client, 1012, 'Fixture reconnect', 'fixture-disconnect')
        break
      case 'advance-revision':
        await mutation('rename-connection')
        break
      case 'toggle-automation':
        await mutation('set-automation-enabled')
        break
      case 'automation-harness':
        if (argument !== 'ready' && argument !== 'unavailable')
          throw new Error(`Unknown Automation Harness Command policy ${argument}`)
        await setHarnessAvailability(argument === 'ready')
        break
      case 'selector-selected':
        selector = 'selected'
        selectedPath = argument || alias
        break
      case 'selector-cancelled':
        selector = 'cancelled'
        break
      case 'selector-error':
        selector = 'error'
        break
      case 'github-degraded':
        remoteFailure = 'map'
        break
      case 'github-authorization':
        remoteFailure = 'authorization'
        break
      case 'github-recover':
        remoteFailure = 'none'
        break
      case 'authorization-existing-account':
        authorizationCredentials = credentials
        break
      case 'authorization-new-account':
        authorizationCredentials = newAccountCredentials
        break
      case 'authorization-pending':
        authorizationPoll = 'pending'
        break
      case 'authorization-granted':
        authorizationPoll = 'granted'
        break
      case 'authorization-denied':
        authorizationPoll = 'denied'
        break
      case 'authorization-expired':
        authorizationPoll = 'expired'
        break
      case 'authorization-failed':
        failAuthorizationBegin = true
        break
      case 'authorization-recover':
        failAuthorizationBegin = false
        break
      case 'local-unreadable':
        await rename(workspace, join(root, 'alpha-unreadable'))
        break
      case 'unconfirmed-commit':
        unconfirmedCommit = true
        break
      case 'local-recover':
        await rename(join(root, 'alpha-unreadable'), workspace)
        break
      case 'move-workspace':
        await rename(workspace, movedWorkspace)
        await rm(repairAlias)
        await symlink(movedWorkspace, repairAlias, 'dir')
        break
      case 'move-github-workspace':
        await rename(githubWorkspace, githubMovedWorkspace)
        await symlink(githubMovedWorkspace, githubRepairAlias, 'dir')
        break
      case 'invalid-configuration':
        if (!backend) throw new Error('Missing backend.')
        await writeFile(backend.configurationPath, '{not-json')
        break
      // The real transport does not publish terminal application lifecycle. Close its owned stream instead.
      case 'stop-application':
        if (!backend) throw new Error('Missing backend.')
        await stopBackend(backend)
        break
      case 'restart-application': {
        if (!backend) throw new Error('Missing backend.')
        const configuration: ProjectConfiguration = JSON.parse(
          await readFile(backend.configurationPath, 'utf8'),
        )
        await stopBackend(backend)
        backend = await makeBackend(configuration)
        held = false
        for (const client of clients)
          closeBrowser(client, 1012, 'Fixture restart', 'fixture-restart')
        break
      }
      case 'successor':
      case 'http-successor': {
        if (!backend) throw new Error('Missing backend.')
        const configuration: ProjectConfiguration = JSON.parse(
          await readFile(backend.configurationPath, 'utf8'),
        )
        held = true
        // Stop source ownership, not transport ownership. Accepted predecessor streams remain physically open.
        await backend.application.stop()
        backend = await makeBackend({
          ...configuration,
          configurationVersion: configuration.configurationVersion + 1,
        })
        if (action === 'successor')
          for (const client of clients)
            closeBrowser(client, 1012, 'Fixture successor', 'fixture-successor')
        break
      }
      default:
        throw new Error(`Unknown control ${action}`)
    }
    return status()
  }
  const front = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.invalid')
    if (url.pathname === '/__fixture/control') {
      void control(
        url.searchParams.get('action') ?? 'status',
        url.searchParams.get('argument') ?? '',
      ).then(
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
    if (url.pathname.startsWith('/api/')) {
      if (!backend) {
        response.writeHead(503).end()
        return
      }
      const current = backend
      const mode = nextReply
      const requestMode = nextRequest
      nextReply = 'normal'
      nextRequest = 'normal'
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const body = Buffer.concat(chunks)
        const record: RequestRecord = {
          id: requests.length + 1,
          endpoint: url.pathname,
          correlationId:
            typeof request.headers['x-roadmap-request-id'] === 'string'
              ? request.headers['x-roadmap-request-id']
              : null,
          afterHeadersTruncated: false,
          envelope: JSON.parse(body.toString()),
          outcome: null,
          forwarded: false,
        }
        requests.push(record)
        const dispatch = () => {
          record.forwarded = true
          const headers = { ...request.headers, host: new URL(current.url).host, origin }
          if (requestMode === 'not-admitted') headers['content-type'] = 'text/plain'
          const destination = requestMode === 'hold' ? (backend ?? current) : current
          const proxy = httpRequest(
            new URL(request.url ?? '/', destination.url),
            {
              method: request.method,
              headers: { ...headers, host: new URL(destination.url).host },
            },
            (upstream) => {
              const result: Buffer[] = []
              upstream.on('data', (chunk: Buffer) => result.push(chunk))
              upstream.on('end', () => {
                let received = Buffer.concat(result)
                const parsed = JSON.parse(received.toString())
                record.outcome = parsed
                if (
                  url.pathname === '/api/command' &&
                  upstream.statusCode === 200 &&
                  !commandResultEnvelopeSchema.safeParse(parsed).success
                ) {
                  response.destroy(new Error('Actual transport produced invalid outcome.'))
                  return
                }
                if (mode === 'wrong-correlation')
                  received = Buffer.from(
                    JSON.stringify({ ...parsed, correlationId: crypto.randomUUID() }),
                  )
                if (mode === 'wrong-operation' && parsed.outcome)
                  received = Buffer.from(
                    JSON.stringify({
                      ...parsed,
                      outcome: {
                        ...parsed.outcome,
                        operation: 'set-automation-enabled',
                        subject: { kind: 'automation' },
                        result: {
                          type: 'set-automation-enabled',
                          enabled: false,
                          configurationVersion: 1,
                          commit: 'committed',
                        },
                      },
                    }),
                  )
                if (mode === 'wrong-subject' && parsed.outcome) {
                  const changed =
                    parsed.outcome.operation === 'register-project'
                      ? {
                          ...parsed,
                          outcome: {
                            ...parsed.outcome,
                            subject: { ...parsed.outcome.subject, connectionId: 'other-fixture' },
                            result: { ...parsed.outcome.result, connectionId: 'other-fixture' },
                          },
                        }
                      : {
                          ...parsed,
                          outcome: {
                            ...parsed.outcome,
                            subject: {
                              kind: 'project',
                              project: { integration: 'local', projectId: ids.beta },
                            },
                            result: {
                              ...parsed.outcome.result,
                              project: { integration: 'local', projectId: ids.beta },
                            },
                          },
                        }
                  received = Buffer.from(JSON.stringify(changed))
                }
                if (mode === 'unreadable') received = Buffer.from('{unreadable')
                const reply = {
                  id: record.id,
                  response,
                  status: upstream.statusCode ?? 502,
                  body: received,
                }
                if (mode === 'hold') replies.push(reply)
                else if (mode === 'lost') truncate(reply)
                else flush(reply)
              })
            },
          )
          proxy.on('error', () => response.destroy())
          proxy.end(body)
        }
        if (requestMode === 'hold') dispatches.push(dispatch)
        else dispatch()
      })
      return
    }
    if (
      url.pathname === '/' ||
      (!url.pathname.startsWith('/@') &&
        !url.pathname.startsWith('/scripts/') &&
        !url.pathname.startsWith('/node_modules/') &&
        !url.pathname.includes('.'))
    ) {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><html><head><meta charset="utf-8"><title>Workflow regression</title></head><body><div id="root"></div><script type="module" src="/@fs/${entryPath}"></script></body></html>`,
        )
      return
    }
    middleware(request, response, () => response.writeHead(404).end())
  })
  const sockets = new WebSocketServer({ noServer: true })
  front.on('upgrade', (request, socket, head) => {
    if (closing || request.url !== '/ws' || !backend) {
      socket.destroy()
      return
    }
    const current = backend
    if (current.application.diagnostics().lifecycle.phase !== 'ready') {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (browser) => {
      const upstream = new WebSocket(`${current.url.replace('http:', 'ws:')}/ws`, { origin })
      const record: SocketRecord = {
        generation: ++socketConnections,
        serverEpoch: current.application.current().serverEpoch,
        upstreamOpened: false,
        receivedMessages: 0,
        forwardedMessages: 0,
        latestPublication: null,
        browserClosed: null,
        upstreamClosed: null,
      }
      const client: RelayClient = { browser, upstream, latest: null, record }
      clients.add(client)
      socketRecords.push(record)
      socketTransitions.push({ generation: record.generation, kind: 'accepted' })
      browser.on('error', () => undefined)
      upstream.on('open', () => {
        record.upstreamOpened = true
        socketTransitions.push({ generation: record.generation, kind: 'upstream-open' })
      })
      upstream.on('error', () =>
        closeBrowser(client, 1012, 'Fixture upstream error', 'upstream-error'),
      )
      upstream.on('message', (bytes) => {
        const raw = bytes.toString()
        const decoded = decodeStateEnvelope(JSON.parse(raw))
        if (!decoded.ok) {
          closeBrowser(client, 1011, 'Invalid real state', 'invalid-state')
          return
        }
        client.latest = raw
        record.receivedMessages += 1
        record.latestPublication = {
          serverEpoch: decoded.value.state.serverEpoch,
          stateSequence: decoded.value.state.stateSequence,
        }
        if (!held && browser.readyState === WebSocket.OPEN) {
          browser.send(raw)
          record.forwardedMessages += 1
        }
      })
      browser.on('close', (code, reason) => {
        record.browserClosed = { code, reason: reason.toString() }
        socketTransitions.push({
          generation: record.generation,
          kind: 'browser-close',
          ...record.browserClosed,
        })
        clients.delete(client)
        upstream.close()
      })
      upstream.on('close', (code, reason) => {
        record.upstreamClosed = { code, reason: reason.toString() }
        socketTransitions.push({
          generation: record.generation,
          kind: 'upstream-close',
          ...record.upstreamClosed,
        })
        // Reserved close codes cannot appear in a close frame. Real upstream closure still revokes the browser's read authority.
        closeBrowser(
          client,
          code === 1005 || code === 1006 || code === 1015 ? 1012 : code,
          reason.toString(),
          'upstream-close',
        )
      })
    })
  })
  async function close() {
    if (closing) return
    closing = true
    hostBarrier?.()
    hostBarrier = null
    for (const dispatch of dispatches.splice(0)) dispatch()
    for (const reply of replies.splice(0)) reply.response.destroy()
    for (const client of clients) {
      client.browser.terminate()
      client.upstream.terminate()
    }
    const errors: unknown[] = []
    async function attempt(cleanup: () => void | Promise<void>) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    await attempt(
      () =>
        new Promise<void>((resolve, reject) =>
          sockets.close((error) => (error ? reject(error) : resolve())),
        ),
    )
    for (const item of backends) await attempt(() => stopBackend(item))
    await attempt(() => closeServer(front))
    await attempt(() => rm(root, { recursive: true, force: true }))
    if (errors.length) throw new AggregateError(errors, 'Workflow fixture cleanup failed.')
  }
  try {
    for (const directory of [
      workspace,
      otherWorkspace,
      newWorkspace,
      githubWorkspace,
      githubWrongWorkspace,
      ...ambiguityWorkspaces,
    ]) {
      const map = join(directory, '.wayfinder', 'workflow')
      await mkdir(join(map, 'tickets'), { recursive: true })
      await writeFile(
        join(map, 'map.md'),
        '---\ntitle: Workflow map\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\nHarmless workflow.\n\n## Notes\n\n## Decisions so far\n\n- [Workflow ticket](tickets/1.md)\n\n## Not yet specified\n\n## Out of scope\n',
      )
      await writeFile(
        join(map, 'tickets', '1.md'),
        '---\nid: 1\ntitle: Workflow ticket\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: []\n---\n\nHarmless workflow target.\n',
      )
    }
    const git = promisify(execFile)
    const gitEnvironment = {
      HOME: root,
      PATH: '/usr/bin:/bin',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_DATE: '2026-10-09T10:00:00Z',
      GIT_COMMITTER_DATE: '2026-10-09T10:00:00Z',
    }
    const gitOptions = { env: gitEnvironment }
    await git('/usr/bin/git', ['-C', workspace, 'init', '--template=', '-b', 'main'], gitOptions)
    await git('/usr/bin/git', ['-C', workspace, 'add', '.wayfinder'], gitOptions)
    await git(
      '/usr/bin/git',
      [
        '-C',
        workspace,
        '-c',
        'user.name=Workflow fixture',
        '-c',
        'user.email=workflow-fixture@example.invalid',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'Disposable workflow history',
      ],
      gitOptions,
    )
    const alphaInspection = await inspectLocalWorkspace(workspace)
    if (!alphaInspection.gitIdentity)
      throw new Error('Fixture alpha must have Git-history identity.')
    await symlink(newWorkspace, alias, 'dir')
    await symlink(workspace, repairAlias, 'dir')
    await symlink(githubWorkspace, githubAlias, 'dir')
    await symlink(githubWrongWorkspace, githubWrongAlias, 'dir')
    const target = {
      project: { integration: 'local', id: ids.alpha },
      mapId: ids.map,
      ticketId: ids.ticket,
    }
    const identity = { opportunityId: 'fixture-history', recordedAt: '2026-10-09T10:00:00.000Z' }
    const history = decodeAutomationDatabase({
      schemaVersion: 3,
      opportunities: [{ id: 'fixture-history', target }],
      events: [
        {
          ...identity,
          id: 'classification-start',
          type: 'classification-started',
          admission: 'automatic',
        },
        {
          ...identity,
          id: 'classification-result',
          type: 'classification-completed',
          processResult: { status: 'exited', code: 3 },
          verdict: { value: 'afk', reason: 'Verdict is independent of process exit.' },
        },
        { ...identity, id: 'launch', type: 'wayfinder-launching', admission: 'override' },
        { ...identity, id: 'running', type: 'wayfinder-running' },
        {
          ...identity,
          id: 'unknown',
          type: 'wayfinder-outcome-unknown',
          reason: 'Fixture durable unknown.',
        },
        {
          ...identity,
          id: 'acknowledged',
          type: 'wayfinder-outcome-unknown-acknowledged',
          unknownEventId: 'unknown',
        },
      ],
    })
    await writeFile(databasePath, JSON.stringify(history))
    origin = `http://127.0.0.1:${await listen(front)}`
    backend = await makeBackend({
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [
        { id: 'local', integration: 'local', name: 'Local', builtIn: true },
        {
          id: ids.connection,
          integration: 'github',
          name: 'Fixture GitHub',
          builtIn: false,
          githubIdentity: { id: '9001', login: 'fixture' },
        },
      ],
      projects: [
        {
          ref: { integration: 'local', projectId: ids.alpha },
          connectionId: 'local',
          displayName: 'Workflow Alpha',
          workspace: { path: alphaInspection.path, gitIdentity: alphaInspection.gitIdentity },
        },
        {
          ref: { integration: 'local', projectId: ids.beta },
          connectionId: 'local',
          displayName: 'Workflow Beta',
          workspace: { path: otherWorkspace },
        },
        {
          ref: { integration: 'github', projectId: ids.github },
          connectionId: ids.connection,
          displayName: 'Workflow GitHub',
          locator: { repositoryId: '8001', nameWithOwner: 'fixture/workflows' },
          workspace: { path: join(root, 'unadmitted-remote') },
        },
      ],
      automation: {
        enabled: false,
        enabledProjects: [],
        classificationCommand: {
          command: 'fixture-no-process',
          args: [],
          promptDelivery: 'stdin',
          promptTemplate: '{{roadmap.ticket}}',
        },
        wayfinderCommand: {
          command: 'fixture-no-process',
          args: [],
          promptDelivery: 'stdin',
          promptTemplate: '{{roadmap.ticket}}',
        },
      },
    })
  } catch (error) {
    await close()
    throw error
  }
  return { origin, paths, ids, control, close }
}
