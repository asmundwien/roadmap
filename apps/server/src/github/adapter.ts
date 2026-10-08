import type { ConnectionAvailability } from '@roadmap/contracts'
import type {
  AdapterHost,
  AdapterSlice,
  ObservationAttempt,
  SourceFailure,
  SourceIntegration,
  SourceMapKey,
  SourceProjectKey,
  SourceProvenance,
  SourceScope,
  SourceTicketKey,
  WayfinderAdapter,
} from '../observation/source.ts'
import {
  absentAttempt,
  failedAttempt,
  observedAttempt,
  sourceScopeKey,
} from '../observation/source.ts'
import { observeGitHubMap } from '../wayfinder/from-github.ts'
import { createGitHubClient, type GitHubClient, GitHubError, type RateLimit } from './client.ts'
import { GitHubConnectionError } from './connections.ts'
import { type FetchedMap, fetchMaps } from './map-query.ts'
import { listRepositoryMaps, type RepositoryIdentity, readRepository } from './repository.ts'

const RECONCILE_MS = 30_000
const MAX_RETRY_MS = 5 * 60_000
const DEGRADED_AFTER_FAILURES = 2
const THROTTLE_STEPS = [
  { remainingBelow: 300, multiplier: 8 },
  { remainingBelow: 1000, multiplier: 4 },
  { remainingBelow: 2000, multiplier: 2 },
]

interface SourceConnection {
  readonly id: string
  readonly integration: SourceIntegration
}

interface SourceRegistration {
  readonly key: SourceProjectKey
  readonly connectionId: string
  readonly displayName?: string
  readonly locator:
    | { readonly integration: 'local' }
    | { readonly integration: 'github'; readonly repositoryId: string }
}

type GitHubRegistration = SourceRegistration & {
  readonly locator: Extract<SourceRegistration['locator'], { integration: 'github' }>
}
type ObservationStage = Extract<SourceProvenance, { integration: 'github' }>['stage']

interface Worker {
  connection: SourceConnection
  registrations: GitHubRegistration[]
  token: string | null
  client: GitHubClient | null
  rateLimit: RateLimit | null
  attempts: Map<string, ObservationAttempt>
  mapMembers: Map<string, readonly SourceMapKey[]>
  ticketMembers: Map<string, readonly SourceTicketKey[]>
  reconcileTimer: ReturnType<typeof setTimeout> | null
  lastSuccessfulAt: number | null
  transientFailures: number
  failureStartedAt: number | null
}

interface WorkerRead {
  worker: Worker
  client: GitHubClient | null
  repositories: Map<GitHubRegistration, RepositoryIdentity>
  failures: { failure: SourceFailure; stage: ObservationStage }[]
}

export interface GitHubAdapterOptions {
  connections: readonly SourceConnection[]
  registrations: readonly SourceRegistration[]
  accessToken(connectionId: string): Promise<string>
  onConnectionAvailability?(connectionId: string, availability: ConnectionAvailability): void
  createClient?: (accessToken: string) => GitHubClient
  reconcileMs?: number
  now?: () => number
  logger?: { warn(message: string): void }
}

export interface GitHubAdapter extends WayfinderAdapter {
  type: 'github'
  refresh(project: SourceProjectKey): Promise<boolean>
  diagnostics(): { rateLimit: RateLimit | null }
}

export function createGitHubAdapter(options: GitHubAdapterOptions): GitHubAdapter {
  const createClient = options.createClient ?? ((token) => createGitHubClient({ token }))
  const reconcileMs = options.reconcileMs ?? RECONCILE_MS
  const now = options.now ?? Date.now
  const logger = options.logger ?? console
  const registrations = options.registrations.filter(isGitHubRegistration)
  const workers = options.connections
    .filter((connection) => connection.integration === 'github')
    .map<Worker>((connection) => ({
      connection,
      registrations: registrations.filter(
        (registration) => registration.connectionId === connection.id,
      ),
      token: null,
      client: null,
      rateLimit: null,
      attempts: new Map(),
      mapMembers: new Map(),
      ticketMembers: new Map(),
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
      attempts: workers.flatMap((worker) => [...worker.attempts.values()]),
    }
    const next = JSON.stringify(slice)
    if (next === sliceFingerprint) return
    sliceFingerprint = next
    host.update(slice)
  }

  function record(worker: Worker, attempt: ObservationAttempt): void {
    const validated =
      attempt.kind === 'observed'
        ? observedAttempt(attempt)
        : attempt.kind === 'failed'
          ? failedAttempt(attempt)
          : absentAttempt(attempt)
    worker.attempts.set(sourceScopeKey(validated.scope), validated)
  }

  function failed(
    worker: Worker,
    registration: GitHubRegistration,
    scope: SourceScope,
    stage: ObservationStage,
    attemptedAt: number,
    failure: SourceFailure,
  ): void {
    record(worker, {
      kind: 'failed',
      scope,
      attemptedAt,
      provenance: provenance(registration, stage),
      failure,
    })
  }

  async function readWorkerRepositories(worker: Worker): Promise<WorkerRead> {
    const read: WorkerRead = { worker, client: null, repositories: new Map(), failures: [] }
    const credentialAttemptedAt = now()
    try {
      const token = await options.accessToken(worker.connection.id)
      if (worker.client === null || worker.token !== token) {
        worker.token = token
        worker.client = createClient(token)
      }
      read.client = worker.client
    } catch (error) {
      const failure = sourceFailure(error)
      read.failures.push({ failure, stage: 'credentials' })
      for (const registration of worker.registrations) {
        failed(
          worker,
          registration,
          { kind: 'project', project: registration.key },
          'credentials',
          credentialAttemptedAt,
          failure,
        )
      }
      return read
    }
    const client = read.client
    await Promise.all(
      worker.registrations.map(async (registration) => {
        const attemptedAt = now()
        try {
          const repository = await readRepository(client, registration.locator.repositoryId)
          if (repository.id !== registration.locator.repositoryId) {
            throw new GitHubError({ kind: 'identity-mismatch' })
          }
          read.repositories.set(registration, repository)
          record(worker, {
            kind: 'observed',
            scope: { kind: 'project', project: registration.key },
            attemptedAt,
            observedAt: now(),
            provenance: provenance(registration, 'repository'),
            completeness: { kind: 'complete' },
            value: {
              key: registration.key,
              name: registration.displayName ?? repository.nameWithOwner,
              source: {
                integration: 'github',
                repositoryId: repository.id,
                nameWithOwner: repository.nameWithOwner,
                url: `https://github.com/${repository.nameWithOwner}`,
              },
              warnings: [],
            },
          })
        } catch (error) {
          const failure = sourceFailure(error)
          read.failures.push({ failure, stage: 'repository' })
          failed(
            worker,
            registration,
            { kind: 'project', project: registration.key },
            'repository',
            attemptedAt,
            failure,
          )
        }
      }),
    )
    return read
  }

  async function readMaps(
    read: WorkerRead,
    registration: GitHubRegistration,
    repository: RepositoryIdentity,
    resolveProject: (nameWithOwner: string, repositoryId?: string) => SourceProjectKey | undefined,
  ): Promise<void> {
    const client = read.client
    if (client === null) return
    const worker = read.worker
    const membershipScope = {
      kind: 'maps-membership',
      project: registration.key,
    } satisfies SourceScope
    const attemptedAt = now()
    let refs: Awaited<ReturnType<typeof listRepositoryMaps>>
    try {
      refs = (await listRepositoryMaps(client, repository.nameWithOwner)).map((ref) => ({
        ...ref,
        repositoryId: repository.id,
      }))
    } catch (error) {
      const failure = sourceFailure(error)
      failed(worker, registration, membershipScope, 'map-list', attemptedAt, failure)
      read.failures.push({ failure, stage: 'map-list' })
      return
    }
    const observedAt = now()
    const members = refs.map((ref) => ({ project: registration.key, mapId: String(ref.number) }))
    const membershipKey = sourceScopeKey(membershipScope)
    const knownMaps = worker.mapMembers.get(membershipKey) ?? []
    record(worker, {
      kind: 'observed',
      scope: membershipScope,
      attemptedAt,
      observedAt,
      provenance: provenance(registration, 'map-list'),
      completeness: { kind: 'complete' },
      value: { members },
    })
    // Only a complete list can end known membership. Failed lists never reach this branch.
    worker.mapMembers.set(membershipKey, members)
    const memberIds = new Set(members.map((member) => member.mapId))
    for (const map of knownMaps) {
      if (memberIds.has(map.mapId)) continue
      record(worker, {
        kind: 'proven-absent',
        scope: { kind: 'map', map },
        attemptedAt,
        observedAt,
        provenance: provenance(registration, 'map-list'),
        proof: { kind: 'complete-membership', parent: membershipScope },
      })
    }
    const fetchAttemptedAt = now()
    let fetched: Awaited<ReturnType<typeof fetchMaps>>
    try {
      fetched = await fetchMaps(client, refs, now)
    } catch (error) {
      const failure = sourceFailure(error)
      for (const ref of refs)
        failed(
          worker,
          registration,
          { kind: 'map', map: { project: registration.key, mapId: String(ref.number) } },
          'map-read',
          fetchAttemptedAt,
          failure,
        )
      read.failures.push({ failure, stage: 'map-read' })
      return
    }
    if (fetched.rateLimit)
      worker.rateLimit = conservativeRateLimit(worker.rateLimit, fetched.rateLimit)
    for (const entry of fetched.maps) {
      try {
        commitMap(read, registration, repository, entry, resolveProject)
      } catch (error) {
        const failure = sourceFailure(error)
        failed(
          worker,
          registration,
          { kind: 'map', map: { project: registration.key, mapId: String(entry.ref.number) } },
          'map-read',
          entry.attemptedAt,
          failure,
        )
        read.failures.push({ failure, stage: 'map-read' })
      }
    }
    for (const entry of fetched.failures) {
      failed(
        worker,
        registration,
        { kind: 'map', map: { project: registration.key, mapId: String(entry.ref.number) } },
        'map-read',
        entry.attemptedAt,
        entry.failure,
      )
      read.failures.push({ failure: entry.failure, stage: 'map-read' })
    }
  }

  function commitMap(
    read: WorkerRead,
    registration: GitHubRegistration,
    repository: RepositoryIdentity,
    entry: FetchedMap,
    resolveProject: (nameWithOwner: string, repositoryId?: string) => SourceProjectKey | undefined,
  ): void {
    if (
      entry.repository.databaseId !== undefined &&
      entry.repository.databaseId !== repository.id
    ) {
      throw new GitHubError({ kind: 'identity-mismatch' })
    }
    const slice = observeGitHubMap(entry, {
      project: registration.key,
      repositoryId: repository.id,
      connectionId: read.worker.connection.id,
      resolveProject,
    })
    for (const attempt of slice.attempts) record(read.worker, attempt)
    reconcileTickets(read.worker, registration, entry)
  }

  function reconcileTickets(
    worker: Worker,
    registration: GitHubRegistration,
    entry: FetchedMap,
  ): void {
    const map = { project: registration.key, mapId: String(entry.ref.number) }
    const membershipScope = { kind: 'tickets-membership', map } satisfies SourceScope
    const membershipKey = sourceScopeKey(membershipScope)
    const knownTickets = worker.ticketMembers.get(membershipKey) ?? []
    const tickets = (entry.issue.subIssues?.nodes ?? []).map((ticket) => ({
      map,
      ticketId: String(ticket.number),
    }))
    if (entry.ticketsCompleteness.kind === 'incomplete') {
      const knownIds = new Set(knownTickets.map((ticket) => ticket.ticketId))
      worker.ticketMembers.set(membershipKey, [
        ...knownTickets,
        ...tickets.filter((ticket) => !knownIds.has(ticket.ticketId)),
      ])
      return
    }
    const ticketIds = new Set(tickets.map((ticket) => ticket.ticketId))
    for (const ticket of knownTickets) {
      if (ticketIds.has(ticket.ticketId)) continue
      record(worker, {
        kind: 'proven-absent',
        scope: { kind: 'ticket', ticket },
        attemptedAt: entry.attemptedAt,
        observedAt: entry.observedAt,
        provenance: provenance(registration, 'map-read'),
        proof: { kind: 'complete-membership', parent: membershipScope },
      })
    }
    worker.ticketMembers.set(membershipKey, tickets)
  }

  function connectionAvailability(read: WorkerRead, completed: boolean): void {
    const worker = read.worker
    const authorization = read.failures.find((entry) => entry.failure.kind === 'authorization')
    if (authorization) {
      worker.transientFailures = 0
      worker.failureStartedAt = null
      options.onConnectionAvailability?.(worker.connection.id, {
        status: 'authorization-required',
        cause:
          authorization.failure.kind === 'authorization' &&
          authorization.failure.proof === 'rejected-credential'
            ? 'GitHub rejected the stored authorization. Reauthenticate this Connection.'
            : 'GitHub authorization is required for this Connection.',
        observedAt: now(),
      })
      return
    }
    const connectionFailure = read.failures.find(
      (entry) =>
        entry.failure.kind === 'transient' ||
        entry.failure.kind === 'execution' ||
        entry.failure.kind === 'read',
    )
    if (connectionFailure) {
      const failedAt = now()
      worker.failureStartedAt ??= failedAt
      worker.transientFailures += 1
      logger.warn(
        `GitHub observation failed connection=${worker.connection.id} stage=${connectionFailure.stage} class=${connectionFailure.failure.kind} durationMs=${failedAt - worker.failureStartedAt} retryInMs=${transientRetryDelay(worker)}`,
      )
      if (worker.lastSuccessfulAt === null) {
        options.onConnectionAvailability?.(worker.connection.id, {
          status: 'unavailable',
          cause: 'GitHub could not be observed for this Connection.',
          observedAt: failedAt,
        })
      } else if (worker.transientFailures < DEGRADED_AFTER_FAILURES) {
        options.onConnectionAvailability?.(worker.connection.id, {
          status: 'available',
          observedAt: worker.lastSuccessfulAt,
        })
      } else {
        options.onConnectionAvailability?.(worker.connection.id, {
          status: 'degraded',
          cause:
            'GitHub observations are temporarily failing; showing data from the last successful observation.',
          observedAt: worker.lastSuccessfulAt,
        })
      }
      return
    }
    if (!completed) return
    worker.transientFailures = 0
    worker.failureStartedAt = null
    if (read.failures.length === 0) worker.lastSuccessfulAt = now()
    options.onConnectionAvailability?.(worker.connection.id, {
      status: 'available',
      observedAt: worker.lastSuccessfulAt ?? now(),
    })
  }

  function reconcile(reason: string, selected?: Worker): Promise<void> {
    const run = chain.then(async () => {
      if (stopped) return
      try {
        // All admitted identities are reconciled before any blocker reference is projected.
        const reads = await Promise.all(workers.map(readWorkerRepositories))
        const byName = new Map<string, SourceProjectKey>()
        const byId = new Map(
          registrations.map((registration) => [
            registration.locator.repositoryId,
            registration.key,
          ]),
        )
        for (const read of reads) {
          for (const [registration, repository] of read.repositories) {
            byName.set(repository.nameWithOwner.toLowerCase(), registration.key)
          }
        }
        const resolveProject = (
          nameWithOwner: string,
          repositoryId?: string,
        ): SourceProjectKey | undefined =>
          repositoryId === undefined
            ? byName.get(nameWithOwner.toLowerCase())
            : byId.get(repositoryId)
        await Promise.all(
          reads.map(async (read) => {
            const completed = selected === undefined || read.worker === selected
            if (completed)
              await Promise.all(
                [...read.repositories].map(([registration, repository]) =>
                  readMaps(read, registration, repository, resolveProject),
                ),
              )
            connectionAvailability(read, completed)
          }),
        )
        publish()
      } catch {
        logger.warn(`GitHub reconcile (${reason}) failed unexpectedly; retaining scoped evidence`)
        publish()
      }
    })
    chain = run
    return run
  }

  function transientRetryDelay(worker: Worker): number {
    const baseDelay = rateLimitedDelay(worker)
    return Math.min(
      baseDelay * 2 ** Math.max(0, worker.transientFailures - 1),
      Math.max(baseDelay, MAX_RETRY_MS),
    )
  }

  function rateLimitedDelay(worker: Worker): number {
    const remaining = worker.rateLimit?.remaining
    if (remaining === undefined) return reconcileMs
    const step = THROTTLE_STEPS.find((candidate) => remaining < candidate.remainingBelow)
    return reconcileMs * (step?.multiplier ?? 1)
  }

  function scheduleReconcile(worker: Worker): void {
    if (stopped) return
    worker.reconcileTimer = setTimeout(
      async () => {
        await reconcile(`interval for ${worker.connection.id}`, worker)
        scheduleReconcile(worker)
      },
      worker.transientFailures > 0 ? transientRetryDelay(worker) : rateLimitedDelay(worker),
    )
  }

  return {
    type: 'github',
    diagnostics() {
      let rateLimit: RateLimit | null = null
      for (const worker of workers)
        if (
          worker.rateLimit !== null &&
          (rateLimit === null || worker.rateLimit.remaining < rateLimit.remaining)
        )
          rateLimit = worker.rateLimit
      return { rateLimit }
    },
    refresh(project) {
      const worker = workers.find((candidate) =>
        candidate.registrations.some((registration) => sameProject(registration.key, project)),
      )
      return worker ? reconcile('manual refresh', worker).then(() => true) : Promise.resolve(false)
    },
    async start(nextHost) {
      if (started) return
      started = true
      host = nextHost
      await reconcile('baseline')
      if (!stopped) for (const worker of workers) scheduleReconcile(worker)
    },
    async stop() {
      stopped = true
      for (const worker of workers) clearTimeout(worker.reconcileTimer ?? undefined)
      await chain
    },
  }
}

function provenance(registration: GitHubRegistration, stage: ObservationStage): SourceProvenance {
  return {
    integration: 'github',
    connectionId: registration.connectionId,
    repositoryId: registration.locator.repositoryId,
    stage,
  }
}

function sourceFailure(error: unknown): SourceFailure {
  if (error instanceof GitHubError) return error.failure
  if (error instanceof GitHubConnectionError) {
    if (error.kind === 'network') return { kind: 'transient', cause: 'network' }
    if (error.kind === 'unauthorized' || error.kind === 'bad-refresh-token')
      return { kind: 'authorization', proof: 'rejected-credential' }
    return { kind: 'read', cause: 'malformed-response' }
  }
  return { kind: 'read', cause: 'malformed-response' }
}

function conservativeRateLimit(current: RateLimit | null, observed: RateLimit): RateLimit {
  if (current === null || observed.resetAt > current.resetAt) return observed
  if (observed.resetAt < current.resetAt || observed.remaining >= current.remaining) return current
  return observed
}

function isGitHubRegistration(
  registration: SourceRegistration,
): registration is GitHubRegistration {
  return registration.key.integration === 'github' && registration.locator.integration === 'github'
}

function sameProject(a: SourceProjectKey, b: SourceProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
