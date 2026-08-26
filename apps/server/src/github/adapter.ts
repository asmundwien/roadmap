import type {
  ConnectionAvailability,
  Project,
  ProjectKey,
  ProjectRegistration,
  Unreachable,
} from '@roadmap/contracts'
import type { ConfiguredConnection } from '../application/configuration.ts'
import type { AdapterHost, AdapterSlice, WayfinderAdapter } from '../store.ts'
import { toWayfinderMap } from '../wayfinder/from-github.ts'
import { createGitHubClient, type GitHubClient, GitHubError, type RateLimit } from './client.ts'
import { GitHubConnectionError } from './connections.ts'
import { type FetchedMap, fetchMaps } from './map-query.ts'
import { listRepositoryMaps, readRepository } from './repository.ts'

const RECONCILE_MS = 30_000
const MAX_RETRY_MS = 5 * 60_000
const DEGRADED_AFTER_FAILURES = 2
const THROTTLE_STEPS: { remainingBelow: number; multiplier: number }[] = [
  { remainingBelow: 300, multiplier: 8 },
  { remainingBelow: 1000, multiplier: 4 },
  { remainingBelow: 2000, multiplier: 2 },
]

type GitHubConnection = ConfiguredConnection & { integration: 'github' }
type GitHubRegistration = ProjectRegistration & {
  key: { integration: 'github'; id: string }
  locator: Extract<ProjectRegistration['locator'], { integration: 'github' }>
}

type ObservationStage = 'credentials' | 'repository' | 'map-list' | 'map-read'

interface ObservationFailure {
  error: unknown
  stage: ObservationStage
}

interface Logger {
  warn(message: string): void
}

interface Worker {
  connection: GitHubConnection
  registrations: GitHubRegistration[]
  token: string | null
  client: GitHubClient | null
  rateLimit: RateLimit | null
  projects: Project[]
  unreachable: Unreachable[]
  reconcileTimer: ReturnType<typeof setTimeout> | null
  lastSuccessfulAt: number | null
  transientFailures: number
  failureStartedAt: number | null
}

export interface GitHubAdapterOptions {
  connections: readonly ConfiguredConnection[]
  registrations: readonly ProjectRegistration[]
  accessToken(connectionId: string): Promise<string>
  onConnectionAvailability?(connectionId: string, availability: ConnectionAvailability): void
  createClient?: (accessToken: string) => GitHubClient
  reconcileMs?: number
  now?: () => number
  logger?: Logger
}

export interface GitHubDiagnostics {
  rateLimit: RateLimit | null
}

export interface GitHubAdapter extends WayfinderAdapter {
  type: 'github'
  refresh(project: ProjectKey): Promise<boolean>
  diagnostics(): GitHubDiagnostics
}

export function createGitHubAdapter(options: GitHubAdapterOptions): GitHubAdapter {
  const createClient = options.createClient ?? ((token) => createGitHubClient({ token }))
  const reconcileMs = options.reconcileMs ?? RECONCILE_MS
  const now = options.now ?? Date.now
  const logger = options.logger ?? console
  const registrations = options.registrations.filter(isGitHubRegistration)
  const workers = options.connections.filter(isGitHubConnection).map<Worker>((connection) => ({
    connection,
    registrations: registrations.filter(
      (registration) => registration.connectionId === connection.id,
    ),
    token: null,
    client: null,
    rateLimit: null,
    projects: [],
    unreachable: [],
    reconcileTimer: null,
    lastSuccessfulAt: null,
    transientFailures: 0,
    failureStartedAt: null,
  }))
  let host: AdapterHost | null = null
  let stopped = false
  let started = false
  let sliceFingerprint = ''
  let chain: Promise<void> = Promise.resolve()

  function publish(): void {
    if (host === null || stopped) return
    const slice: AdapterSlice = {
      projects: workers.flatMap((worker) => worker.projects),
      unreachable: workers.flatMap((worker) => worker.unreachable),
    }
    const next = JSON.stringify(slice)
    if (next === sliceFingerprint) return
    sliceFingerprint = next
    host.update(slice)
  }

  function enqueue(label: string, operation: () => Promise<void>): Promise<void> {
    const run = chain.then(async () => {
      if (stopped) return
      try {
        await operation()
      } catch {
        logger.warn(`${label} failed unexpectedly; keeping the last good GitHub slice`)
      }
    })
    chain = run
    return run
  }

  async function clientFor(worker: Worker): Promise<GitHubClient> {
    const token = await options.accessToken(worker.connection.id)
    if (worker.client === null || worker.token !== token) {
      worker.token = token
      worker.client = createClient(token)
    }
    return worker.client
  }

  async function reconcileWorker(worker: Worker): Promise<void> {
    let client: GitHubClient
    try {
      client = await clientFor(worker)
    } catch (error) {
      connectionFailed(worker, { error, stage: 'credentials' })
      return
    }

    const entries = await Promise.all(
      worker.registrations.map((registration) => materializeProject(worker, registration, client)),
    )
    const connectionFailure = entries.find((entry) => entry.connectionFailure)?.connectionFailure
    if (connectionFailure) {
      connectionFailed(worker, connectionFailure)
      return
    }
    worker.projects = entries.flatMap((entry) => (entry.project ? [entry.project] : []))
    worker.unreachable = entries.flatMap((entry) => (entry.unreachable ? [entry.unreachable] : []))
    const observedAt = now()
    worker.lastSuccessfulAt = observedAt
    worker.transientFailures = 0
    worker.failureStartedAt = null
    options.onConnectionAvailability?.(worker.connection.id, {
      status: 'available',
      observedAt,
    })
  }

  async function materializeProject(
    worker: Worker,
    registration: GitHubRegistration,
    client: GitHubClient,
  ): Promise<{
    project: Project | null
    unreachable: Unreachable | null
    connectionFailure: ObservationFailure | null
  }> {
    let stage: ObservationStage = 'repository'
    try {
      const repository = await readRepository(client, registration.locator.repositoryId)
      if (repository.id !== registration.locator.repositoryId) {
        return unavailableResult(registration, 'GitHub returned a different repository identity.')
      }
      stage = 'map-list'
      const refs = await listRepositoryMaps(client, repository.nameWithOwner)
      stage = 'map-read'
      const fetched = await fetchMaps(client, refs)
      if (fetched.rateLimit)
        worker.rateLimit = conservativeRateLimit(worker.rateLimit, fetched.rateLimit)
      const projectKeys = new Map(
        registrations.map((candidate) => [
          candidate.locator.nameWithOwner.toLocaleLowerCase(),
          candidate.key,
        ]),
      )
      projectKeys.set(repository.nameWithOwner.toLocaleLowerCase(), registration.key)
      return {
        project: toRegisteredProject(registration, repository, fetched.maps, (nameWithOwner) =>
          projectKeys.get(nameWithOwner.toLocaleLowerCase()),
        ),
        unreachable: null,
        connectionFailure: null,
      }
    } catch (error) {
      if (isConnectionFailure(error)) {
        return { project: null, unreachable: null, connectionFailure: { error, stage } }
      }
      return unavailableResult(registration, repositoryFailure(registration, error))
    }
  }

  function connectionFailed(worker: Worker, failure: ObservationFailure): void {
    if (isAuthorizationFailure(failure.error)) {
      worker.transientFailures = 0
      worker.failureStartedAt = null
      const cause =
        failure.error instanceof GitHubConnectionError && failure.error.kind === 'bad-refresh-token'
          ? 'GitHub rejected the stored authorization. Reauthenticate this Connection.'
          : 'GitHub authorization is required for this Connection.'
      worker.projects = []
      worker.unreachable = worker.registrations.map((registration) =>
        toUnreachable(registration, cause),
      )
      options.onConnectionAvailability?.(worker.connection.id, {
        status: 'authorization-required',
        cause,
        observedAt: now(),
      })
      logger.warn(failureLog(worker, failure.stage, 'authorization', 0, nextReconcileDelay(worker)))
      return
    }

    const failedAt = now()
    worker.failureStartedAt ??= failedAt
    worker.transientFailures += 1
    const retryInMs = transientRetryDelay(worker)
    logger.warn(
      failureLog(worker, failure.stage, 'transient', failedAt - worker.failureStartedAt, retryInMs),
    )

    if (worker.lastSuccessfulAt === null) {
      options.onConnectionAvailability?.(worker.connection.id, {
        status: 'unavailable',
        cause: 'GitHub could not be observed for this Connection.',
        observedAt: failedAt,
      })
      return
    }
    if (worker.transientFailures < DEGRADED_AFTER_FAILURES) {
      options.onConnectionAvailability?.(worker.connection.id, {
        status: 'available',
        observedAt: worker.lastSuccessfulAt,
      })
      return
    }
    options.onConnectionAvailability?.(worker.connection.id, {
      status: 'degraded',
      cause:
        'GitHub observations are temporarily failing; showing data from the last successful observation.',
      observedAt: worker.lastSuccessfulAt,
    })
  }

  function transientRetryDelay(worker: Worker): number {
    const baseDelay = rateLimitedDelay(worker)
    const multiplier = 2 ** Math.max(0, worker.transientFailures - 1)
    return Math.min(baseDelay * multiplier, Math.max(baseDelay, MAX_RETRY_MS))
  }

  function failureLog(
    worker: Worker,
    stage: ObservationStage,
    failureClass: 'authorization' | 'transient',
    durationMs: number,
    retryInMs: number,
  ): string {
    return `GitHub observation failed connection=${worker.connection.id} stage=${stage} class=${failureClass} durationMs=${durationMs} retryInMs=${retryInMs}`
  }

  function reconcile(reason: string, selected?: Worker): Promise<void> {
    return enqueue(`GitHub reconcile (${reason})`, async () => {
      await Promise.all((selected ? [selected] : workers).map(reconcileWorker))
      publish()
    })
  }

  function nextReconcileDelay(worker: Worker): number {
    if (worker.transientFailures > 0) return transientRetryDelay(worker)
    return rateLimitedDelay(worker)
  }

  function rateLimitedDelay(worker: Worker): number {
    const remaining = worker.rateLimit?.remaining
    if (remaining === undefined) return reconcileMs
    const step = THROTTLE_STEPS.find((candidate) => remaining < candidate.remainingBelow)
    return reconcileMs * (step?.multiplier ?? 1)
  }

  function scheduleReconcile(worker: Worker): void {
    if (stopped) return
    worker.reconcileTimer = setTimeout(async () => {
      await reconcile(`interval for ${worker.connection.id}`, worker)
      scheduleReconcile(worker)
    }, nextReconcileDelay(worker))
  }

  return {
    type: 'github',
    diagnostics() {
      const available = workers
        .map((worker) => worker.rateLimit)
        .filter((rate): rate is RateLimit => rate !== null)
        .sort((a, b) => a.remaining - b.remaining)
      return {
        rateLimit: available[0] ?? null,
      }
    },
    refresh(project) {
      const worker = workers.find((candidate) =>
        candidate.registrations.some((registration) => sameProject(registration.key, project)),
      )
      if (!worker) return Promise.resolve(false)
      return reconcile('manual refresh', worker).then(() => true)
    },
    async start(nextHost) {
      if (started) return
      started = true
      host = nextHost
      await reconcile('baseline')
      if (stopped) return
      for (const worker of workers) scheduleReconcile(worker)
    },
    async stop() {
      stopped = true
      for (const worker of workers) {
        if (worker.reconcileTimer !== null) clearTimeout(worker.reconcileTimer)
      }
      await chain
    },
  }
}

function toRegisteredProject(
  registration: GitHubRegistration,
  repository: { nameWithOwner: string; visibility: 'public' | 'private' },
  fetched: readonly FetchedMap[],
  resolveProject: (nameWithOwner: string) => ProjectKey | undefined,
): Project {
  const project: Project = {
    key: registration.key,
    name: registration.displayName ?? repository.nameWithOwner,
    visibility: repository.visibility,
    sourceUrl: `https://github.com/${repository.nameWithOwner}`,
    openMaps: [],
    closedMaps: [],
    warnings: [],
  }
  for (const entry of fetched) {
    const map = toWayfinderMap(entry, registration.key, resolveProject)
    if (map.isOpen) project.openMaps.push(map)
    else project.closedMaps.push(map)
  }
  project.openMaps.sort((a, b) => b.updatedAt - a.updatedAt)
  project.closedMaps.sort((a, b) => (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt))
  return project
}

function unavailableResult(
  registration: GitHubRegistration,
  reason: string,
): { project: null; unreachable: Unreachable; connectionFailure: null } {
  return {
    project: null,
    unreachable: toUnreachable(registration, reason),
    connectionFailure: null,
  }
}

function toUnreachable(registration: GitHubRegistration, reason: string): Unreachable {
  return {
    integration: 'github',
    project: registration.key,
    projectName: registration.displayName ?? registration.locator.nameWithOwner,
    reason,
  }
}

function conservativeRateLimit(current: RateLimit | null, observed: RateLimit): RateLimit {
  if (current === null || observed.resetAt > current.resetAt) return observed
  if (observed.resetAt < current.resetAt || observed.remaining >= current.remaining) return current
  return observed
}

function repositoryFailure(registration: GitHubRegistration, error: unknown): string {
  if (error instanceof GitHubError && error.status === 404) {
    return `Repository ${registration.locator.nameWithOwner} is not available through this Connection.`
  }
  return `Could not read repository ${registration.locator.nameWithOwner} from GitHub.`
}

function isConnectionFailure(error: unknown): boolean {
  return (
    isAuthorizationFailure(error) ||
    (error instanceof GitHubError &&
      (error.status === 0 || error.status === 403 || error.status >= 500))
  )
}

function isAuthorizationFailure(error: unknown): boolean {
  return (
    (error instanceof GitHubError && error.status === 401) ||
    (error instanceof GitHubConnectionError && error.kind !== 'network')
  )
}

function isGitHubConnection(connection: ConfiguredConnection): connection is GitHubConnection {
  return connection.integration === 'github'
}

function isGitHubRegistration(
  registration: ProjectRegistration,
): registration is GitHubRegistration {
  return registration.key.integration === 'github' && registration.locator.integration === 'github'
}

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
