import type { GitHubObservationInput } from '../observation/coordinator.ts'
import type {
  ObservationAttempt,
  ReadSequenceAllocator,
  SourceContribution,
  SourceFailure,
  SourceMapKey,
  SourceObservationHealth,
  SourceObserver,
  SourceProjectKey,
  SourceProvenance,
  SourceScope,
  SourceTicketKey,
} from '../observation/source.ts'
import {
  absentAttempt,
  createReadSequenceAllocator,
  failedAttempt,
  observedAttempt,
  sourceScopeKey,
} from '../observation/source.ts'
import { GitHubAccessError } from '../projects/registry.ts'
import { observeGitHubMap } from '../wayfinder/from-github.ts'
import { type GitHubClient, GitHubError, type RateLimit } from './client.ts'
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
type ObservationStage = Extract<SourceProvenance, { integration: 'github' }>['stage']
interface ReadFailure {
  failure: SourceFailure
  stage: ObservationStage
}
interface Worker {
  readonly connectionId: string
  readonly owners: Set<Owner>
  rateLimit: RateLimit | null
  timer: ReturnType<typeof setTimeout> | null
}
interface CachedFetchedMap {
  readonly fetched: FetchedMap
  readonly readSequence: number
}
interface Owner {
  readonly input: GitHubObservationInput
  readonly project: SourceProjectKey
  readonly worker: Worker
  readonly attempts: Map<string, ObservationAttempt>
  readonly nextReadSequence: ReadSequenceAllocator
  readonly mapMembers: Map<string, readonly SourceMapKey[]>
  readonly ticketMembers: Map<string, readonly SourceTicketKey[]>
  readonly fetchedMaps: Map<string, CachedFetchedMap>
  readonly listeners: Set<(contribution: SourceContribution) => void>
  repository: RepositoryIdentity | null
  contribution: SourceContribution | null
  baseline: Promise<SourceContribution> | null
  chain: Promise<void>
  readonly tasks: Set<Promise<void>>
  stopPromise: Promise<void> | null
  reading: boolean
  lastSuccessfulAt: number | null
  transientFailures: number
  failureStartedAt: number | null
  fingerprint: string
  active: boolean
  stopped: boolean
}
interface RepositoryRead {
  owner: Owner
  repository: RepositoryIdentity | null
  failures: ReadFailure[]
}
export interface GitHubObserverOptions {
  reconcileMs?: number
  now?: () => number
  logger?: { warn(message: string): void }
}
export interface GitHubObserverPool {
  create(input: GitHubObservationInput): SourceObserver
  /** Called only after the coordinator has selected its complete active source topology. */
  reconcileTopology(inputs: readonly GitHubObservationInput[]): void
  stop(): Promise<void>
}

/** Source lifetimes share Connection pacing, while pending scopes never alter active topology. */
export function createGitHubObserverPool(options: GitHubObserverOptions = {}): GitHubObserverPool {
  const reconcileMs = options.reconcileMs ?? RECONCILE_MS
  const now = options.now ?? Date.now
  const logger = options.logger ?? console
  const workers = new Map<string, Worker>()
  const owners = new Set<Owner>()
  let topology: readonly GitHubObservationInput[] = []
  let stopped = false
  let stopPromise: Promise<void> | null = null
  const pendingRequests = new Set<Promise<void>>()
  const pendingReads = new Set<Promise<void>>()
  let queued = false
  const requests: {
    selected: readonly Owner[]
    resolve: () => void
    reject: (error: unknown) => void
  }[] = []

  function record(owner: Owner, attempt: ObservationAttempt): void {
    const validated =
      attempt.kind === 'observed'
        ? observedAttempt(attempt)
        : attempt.kind === 'failed'
          ? failedAttempt(attempt)
          : absentAttempt(attempt)
    owner.attempts.set(sourceScopeKey(validated.scope), validated)
  }

  function failed(
    owner: Owner,
    scope: SourceScope,
    stage: ObservationStage,
    attemptedAt: number,
    readSequence: number,
    failure: SourceFailure,
  ): void {
    record(owner, {
      kind: 'failed',
      scope,
      attemptedAt,
      readSequence,
      provenance: provenance(owner, stage),
      failure,
    })
  }

  function publish(owner: Owner, health: SourceObservationHealth): void {
    if (owner.stopped || stopped) return
    const contribution: SourceContribution = {
      project: owner.project,
      attempts: [...owner.attempts.values()],
      health,
    }
    const fingerprint = JSON.stringify(contribution)
    owner.contribution = contribution
    if (fingerprint === owner.fingerprint) return
    owner.fingerprint = fingerprint
    for (const listener of owner.listeners) {
      if (owner.stopped || stopped) break
      listener(contribution)
    }
  }

  function resolver(selected: readonly Owner[]) {
    const byId = new Map(topology.map((input) => [input.source.repositoryId, projectKey(input)]))
    const candidates = new Set(selected.filter((owner) => !owner.stopped))
    for (const owner of candidates) byId.set(owner.input.source.repositoryId, owner.project)
    const byName = new Map<string, SourceProjectKey>()
    for (const owner of owners) {
      if (owner.stopped || (!owner.active && !candidates.has(owner)) || !owner.repository) continue
      const project = byId.get(owner.repository.id)
      if (project) byName.set(owner.repository.nameWithOwner.toLowerCase(), project)
    }
    return (nameWithOwner: string, repositoryId?: string): SourceProjectKey | undefined =>
      repositoryId === undefined ? byName.get(nameWithOwner.toLowerCase()) : byId.get(repositoryId)
  }

  async function readIdentity(owner: Owner): Promise<RepositoryRead> {
    const read: RepositoryRead = { owner, repository: null, failures: [] }
    const readSequence = owner.nextReadSequence()
    const attemptedAt = now()
    try {
      const repository = await readRepository(
        owner.input.source.access,
        owner.input.source.repositoryId,
      )
      if (owner.stopped || stopped) return read
      read.repository = repository
      owner.repository = repository
      record(owner, {
        kind: 'observed',
        scope: { kind: 'project', project: owner.project },
        attemptedAt,
        readSequence,
        observedAt: now(),
        provenance: provenance(owner, 'repository'),
        completeness: { kind: 'complete' },
        value: {
          key: owner.project,
          name: repository.nameWithOwner,
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
      if (owner.stopped || stopped) return read
      const failure = sourceFailure(error)
      const stage =
        (error instanceof GitHubError && error.stage === 'credentials') ||
        (failure.kind === 'authorization' && failure.proof !== 'http-401') ||
        failure.kind === 'access-unavailable'
          ? 'credentials'
          : 'repository'
      read.failures.push({ failure, stage })
      failed(
        owner,
        { kind: 'project', project: owner.project },
        stage,
        attemptedAt,
        readSequence,
        failure,
      )
    }
    return read
  }

  async function readMaps(read: RepositoryRead, selected: readonly Owner[]): Promise<void> {
    const { owner, repository } = read
    if (!repository || owner.stopped || stopped) return
    const client = owner.input.source.access
    const membershipScope = {
      kind: 'maps-membership',
      project: owner.project,
    } satisfies SourceScope
    const membershipReadSequence = owner.nextReadSequence()
    const attemptedAt = now()
    let refs: Awaited<ReturnType<typeof listRepositoryMaps>>
    try {
      refs = (await listRepositoryMaps(client, repository.nameWithOwner)).map((ref) => ({
        ...ref,
        repositoryId: repository.id,
      }))
    } catch (error) {
      if (owner.stopped || stopped) return
      const failure = sourceFailure(error)
      failed(owner, membershipScope, 'map-list', attemptedAt, membershipReadSequence, failure)
      read.failures.push({ failure, stage: 'map-list' })
      return
    }
    if (owner.stopped || stopped) return
    const observedAt = now()
    const members = refs.map((ref) => ({ project: owner.project, mapId: String(ref.number) }))
    const membershipKey = sourceScopeKey(membershipScope)
    const knownMaps = owner.mapMembers.get(membershipKey) ?? []
    record(owner, {
      kind: 'observed',
      scope: membershipScope,
      attemptedAt,
      readSequence: membershipReadSequence,
      observedAt,
      provenance: provenance(owner, 'map-list'),
      completeness: { kind: 'complete' },
      value: { members },
    })
    owner.mapMembers.set(membershipKey, members)
    const memberIds = new Set(members.map((member) => member.mapId))
    for (const map of knownMaps) {
      if (memberIds.has(map.mapId)) continue
      owner.fetchedMaps.delete(map.mapId)
      record(owner, {
        kind: 'proven-absent',
        scope: { kind: 'map', map },
        attemptedAt,
        observedAt,
        readSequence: membershipReadSequence,
        provenance: provenance(owner, 'map-list'),
        proof: { kind: 'complete-membership', parent: membershipScope },
      })
    }
    const fetchAttemptedAt = now()
    const readSequences = new Map<number, number>()
    const mapClient: GitHubClient = {
      graphql(query, variables = {}) {
        if (owner.stopped || stopped) return Promise.reject(new Error('GitHub source has stopped.'))
        // Number named scopes when their actual provider batch starts, not during interpretation.
        for (let index = 0; `i${index}` in variables; index += 1) {
          const mapNumber = variables[`i${index}`]
          if (typeof mapNumber !== 'number')
            throw new Error('GitHub map read requires a named map alias.')
          readSequences.set(mapNumber, owner.nextReadSequence())
        }
        return client.graphql(query, variables)
      },
      restGet: (path) =>
        owner.stopped || stopped
          ? Promise.reject(new Error('GitHub source has stopped.'))
          : client.restGet(path),
    }
    function mapReadSequence(mapNumber: number): number {
      const sequence = readSequences.get(mapNumber)
      if (sequence === undefined) throw new Error('GitHub map evidence requires an actual read.')
      return sequence
    }
    let fetched: Awaited<ReturnType<typeof fetchMaps>>
    try {
      fetched = await fetchMaps(mapClient, refs, now)
    } catch (error) {
      if (owner.stopped || stopped) return
      const failure = sourceFailure(error)
      for (const ref of refs) {
        const readSequence = readSequences.get(ref.number)
        if (readSequence === undefined) continue
        failed(
          owner,
          { kind: 'map', map: { project: owner.project, mapId: String(ref.number) } },
          'map-read',
          fetchAttemptedAt,
          readSequence,
          failure,
        )
      }
      read.failures.push({ failure, stage: 'map-read' })
      return
    }
    if (owner.stopped || stopped) return
    const resolveProject = resolver(owner.active ? [] : selected)
    if (fetched.rateLimit)
      owner.worker.rateLimit = conservativeRateLimit(owner.worker.rateLimit, fetched.rateLimit)
    for (const entry of fetched.maps) {
      try {
        const readSequence = mapReadSequence(entry.ref.number)
        commitMap(owner, repository, entry, readSequence, resolveProject)
        owner.fetchedMaps.set(String(entry.ref.number), { fetched: entry, readSequence })
        reconcileTickets(owner, entry, readSequence)
      } catch (error) {
        const failure = sourceFailure(error)
        failed(
          owner,
          { kind: 'map', map: { project: owner.project, mapId: String(entry.ref.number) } },
          'map-read',
          entry.attemptedAt,
          mapReadSequence(entry.ref.number),
          failure,
        )
        read.failures.push({ failure, stage: 'map-read' })
      }
    }
    for (const entry of fetched.failures) {
      failed(
        owner,
        { kind: 'map', map: { project: owner.project, mapId: String(entry.ref.number) } },
        'map-read',
        entry.attemptedAt,
        mapReadSequence(entry.ref.number),
        entry.failure,
      )
      read.failures.push({ failure: entry.failure, stage: 'map-read' })
    }
  }

  function commitMap(
    owner: Owner,
    repository: RepositoryIdentity,
    entry: FetchedMap,
    readSequence: number,
    resolveProject: ReturnType<typeof resolver>,
  ): void {
    if (
      entry.repository.databaseId !== undefined &&
      String(entry.repository.databaseId) !== repository.id
    )
      throw new GitHubError({ kind: 'identity-mismatch' })
    const batch = observeGitHubMap(entry, {
      project: owner.project,
      repositoryId: repository.id,
      connectionId: owner.input.source.connectionId,
      readSequence,
      resolveProject,
    })
    for (const attempt of batch.attempts) record(owner, attempt)
  }

  function reconcileTickets(owner: Owner, entry: FetchedMap, readSequence: number): void {
    const map = { project: owner.project, mapId: String(entry.ref.number) }
    const membershipScope = { kind: 'tickets-membership', map } satisfies SourceScope
    const membershipKey = sourceScopeKey(membershipScope)
    const knownTickets = owner.ticketMembers.get(membershipKey) ?? []
    const tickets = (entry.issue.subIssues?.nodes ?? []).map((ticket) => ({
      map,
      ticketId: String(ticket.number),
    }))
    if (entry.ticketsCompleteness.kind === 'incomplete') {
      const knownIds = new Set(knownTickets.map((ticket) => ticket.ticketId))
      owner.ticketMembers.set(membershipKey, [
        ...knownTickets,
        ...tickets.filter((ticket) => !knownIds.has(ticket.ticketId)),
      ])
      return
    }
    const ticketIds = new Set(tickets.map((ticket) => ticket.ticketId))
    for (const ticket of knownTickets) {
      if (ticketIds.has(ticket.ticketId)) continue
      record(owner, {
        kind: 'proven-absent',
        scope: { kind: 'ticket', ticket },
        attemptedAt: entry.attemptedAt,
        observedAt: entry.observedAt,
        readSequence,
        provenance: provenance(owner, 'map-read'),
        proof: { kind: 'complete-membership', parent: membershipScope },
      })
    }
    owner.ticketMembers.set(membershipKey, tickets)
  }

  function health(read: RepositoryRead): SourceObservationHealth {
    const owner = read.owner
    const authorization = read.failures.find((entry) => entry.failure.kind === 'authorization')
    if (authorization) {
      owner.transientFailures = 0
      owner.failureStartedAt = null
      return {
        status: 'authorization-required',
        cause: 'GitHub authorization is required for this Connection.',
        ...(owner.lastSuccessfulAt === null ? {} : { observedAt: owner.lastSuccessfulAt }),
      }
    }
    if (read.failures.some((entry) => entry.failure.kind === 'access-unavailable')) {
      owner.transientFailures = 0
      owner.failureStartedAt = null
      return {
        status: 'unavailable',
        cause: 'GitHub access is currently unavailable for this Connection.',
        ...(owner.lastSuccessfulAt === null ? {} : { observedAt: owner.lastSuccessfulAt }),
      }
    }
    const connectionFailure = read.failures.find(
      (entry) =>
        entry.failure.kind === 'transient' ||
        entry.failure.kind === 'execution' ||
        entry.failure.kind === 'read',
    )
    if (connectionFailure) {
      const failedAt = now()
      owner.failureStartedAt ??= failedAt
      owner.transientFailures += 1
      logger.warn(
        `GitHub observation failed connection=${owner.worker.connectionId} stage=${connectionFailure.stage} class=${connectionFailure.failure.kind} durationMs=${failedAt - owner.failureStartedAt} retryInMs=${retryDelay(owner.worker)}`,
      )
      if (owner.lastSuccessfulAt === null)
        return {
          status: 'unavailable',
          cause: 'GitHub could not be observed for this Connection.',
        }
      if (owner.transientFailures < DEGRADED_AFTER_FAILURES)
        return { status: 'available', observedAt: owner.lastSuccessfulAt }
      return {
        status: 'degraded',
        cause:
          'GitHub observations are temporarily failing; showing data from the last successful observation.',
        observedAt: owner.lastSuccessfulAt,
      }
    }
    owner.transientFailures = 0
    owner.failureStartedAt = null
    if (read.failures.length === 0) {
      // A completed source read may have identical content or incomplete resource membership.
      // Its freshness comes from actual successful scopes, never the health publication clock.
      for (const attempt of owner.attempts.values()) {
        if (attempt.kind === 'failed') continue
        owner.lastSuccessfulAt = Math.max(
          owner.lastSuccessfulAt ?? attempt.observedAt,
          attempt.observedAt,
        )
      }
    }
    // Scoped access ambiguity/identity mismatch is not an authorization or Connection outage.
    return {
      status: 'available',
      ...(owner.lastSuccessfulAt === null ? {} : { observedAt: owner.lastSuccessfulAt }),
    }
  }

  async function reconcile(owner: Owner, candidates: readonly Owner[]): Promise<void> {
    if (stopped || owner.stopped) return
    owner.reading = true
    try {
      const read = await readIdentity(owner)
      await readMaps(read, candidates)
      if (owner.stopped || stopped) return
      publish(owner, health(read))
    } finally {
      owner.reading = false
    }
    // A validated active identity may rename a blocker referenced by another Connection.
    // Reclassify its cached facts without reading unrelated identities or advancing clocks.
    if (owner.active) {
      const resolveProject = resolver([])
      for (const active of owners) if (active.active) reproject(active, resolveProject)
    }
  }

  function request(selected: readonly Owner[]): Promise<void> {
    if (stopped) return Promise.reject(new Error('GitHub observation has stopped.'))
    const result = new Promise<void>((resolve, reject) =>
      requests.push({ selected, resolve, reject }),
    )
    pendingRequests.add(result)
    void result.then(
      () => pendingRequests.delete(result),
      () => pendingRequests.delete(result),
    )
    if (!queued) {
      queued = true
      queueMicrotask(() => {
        queued = false
        const batch = requests.splice(0)
        const selectedOwners = [...new Set(batch.flatMap((entry) => [...entry.selected]))]
        const candidates = selectedOwners.filter((owner) => !owner.active)
        const runs = new Map<Owner, Promise<void>>()
        for (const owner of selectedOwners) {
          // Only this owner's reads serialize. Candidates cannot block active owners,
          // while the Connection worker still owns their shared budget and cadence.
          const run = owner.chain.then(() => reconcile(owner, candidates))
          owner.chain = run.catch(() => {})
          runs.set(owner, run)
          pendingReads.add(run)
          run.then(
            () => pendingReads.delete(run),
            () => pendingReads.delete(run),
          )
        }
        for (const entry of batch) {
          Promise.all(entry.selected.map((owner) => runs.get(owner))).then(
            () => entry.resolve(),
            (error: unknown) => entry.reject(error),
          )
        }
      })
    }
    return result
  }

  function rateLimitedDelay(worker: Worker): number {
    const remaining = worker.rateLimit?.remaining
    if (remaining === undefined) return reconcileMs
    const step = THROTTLE_STEPS.find((candidate) => remaining < candidate.remainingBelow)
    return reconcileMs * (step?.multiplier ?? 1)
  }

  function retryDelay(worker: Worker): number {
    const failures = Math.max(
      0,
      ...[...worker.owners]
        .filter((owner) => owner.active && !owner.stopped && owner.baseline)
        .map((owner) => owner.transientFailures),
    )
    const base = rateLimitedDelay(worker)
    return Math.min(base * 2 ** Math.max(0, failures - 1), Math.max(base, MAX_RETRY_MS))
  }

  function schedule(worker: Worker): void {
    if (
      stopped ||
      worker.timer !== null ||
      ![...worker.owners].some((owner) => owner.active && !owner.stopped && owner.baseline)
    )
      return
    worker.timer = setTimeout(async () => {
      worker.timer = null
      try {
        await request(
          [...worker.owners].filter((owner) => owner.active && !owner.stopped && owner.baseline),
        )
      } catch {
        logger.warn('GitHub reconciliation failed unexpectedly; retaining scoped evidence.')
      }
      schedule(worker)
    }, retryDelay(worker))
  }

  function reproject(owner: Owner, resolveProject: ReturnType<typeof resolver>): void {
    if (owner.stopped || owner.reading || !owner.repository || !owner.contribution) return
    // Only reclassify existing successful ticket evidence. A topology edit does not replace
    // later failures/absence proofs or advance any observation clock.
    for (const { fetched, readSequence } of owner.fetchedMaps.values()) {
      const batch = observeGitHubMap(fetched, {
        project: owner.project,
        repositoryId: owner.repository.id,
        connectionId: owner.input.source.connectionId,
        readSequence,
        resolveProject,
      })
      for (const attempt of batch.attempts) {
        if (attempt.kind !== 'observed' || attempt.scope.kind !== 'ticket') continue
        const current = owner.attempts.get(sourceScopeKey(attempt.scope))
        if (current?.kind === 'observed' && current.readSequence === attempt.readSequence)
          record(owner, attempt)
      }
    }
    publish(owner, owner.contribution.health)
  }

  function completed(owner: Owner): SourceContribution {
    if (!owner.contribution)
      throw new Error('GitHub observation did not complete its scoped baseline.')
    return owner.contribution
  }

  function run<T>(owner: Owner, operation: () => Promise<T>): Promise<T> {
    const result = Promise.resolve().then(operation)
    const completion = result.then(
      () => undefined,
      () => undefined,
    )
    owner.tasks.add(completion)
    void completion.then(() => owner.tasks.delete(completion))
    return result
  }

  function stopOwner(owner: Owner): Promise<void> {
    if (owner.stopPromise) return owner.stopPromise
    owner.stopped = true
    owner.active = false
    owner.listeners.clear()
    owner.worker.owners.delete(owner)
    if (
      ![...owner.worker.owners].some(
        (candidate) => candidate.active && !candidate.stopped && candidate.baseline,
      )
    ) {
      clearTimeout(owner.worker.timer ?? undefined)
      owner.worker.timer = null
    }
    owner.stopPromise = Promise.resolve().then(async () => {
      await Promise.all([...owner.tasks])
      await owner.chain
    })
    void owner.stopPromise.then(
      () => owners.delete(owner),
      () => undefined,
    )
    return owner.stopPromise
  }

  return {
    create(input) {
      if (stopped) throw new Error('GitHub observation has stopped.')
      const connectionId = input.source.connectionId
      let worker = workers.get(connectionId)
      if (!worker) {
        worker = { connectionId, owners: new Set(), rateLimit: null, timer: null }
        workers.set(connectionId, worker)
      }
      const owner: Owner = {
        input,
        project: projectKey(input),
        worker,
        attempts: new Map(),
        nextReadSequence: createReadSequenceAllocator(),
        mapMembers: new Map(),
        ticketMembers: new Map(),
        fetchedMaps: new Map(),
        listeners: new Set(),
        repository: null,
        contribution: null,
        baseline: null,
        chain: Promise.resolve(),
        tasks: new Set(),
        stopPromise: null,
        reading: false,
        lastSuccessfulAt: null,
        transientFailures: 0,
        failureStartedAt: null,
        fingerprint: '',
        active: false,
        stopped: false,
      }
      owners.add(owner)
      worker.owners.add(owner)
      return {
        observe() {
          if (owner.stopped || stopped)
            return Promise.reject(new Error('GitHub source has stopped.'))
          owner.baseline ??= run(owner, async () => {
            if (owner.stopped || stopped) throw new Error('GitHub source has stopped.')
            await request([owner])
            if (owner.stopped || stopped) throw new Error('GitHub source has stopped.')
            schedule(owner.worker)
            return completed(owner)
          })
          return owner.baseline
        },
        subscribe(listener) {
          if (owner.stopped || stopped) return () => undefined
          owner.listeners.add(listener)
          return () => {
            owner.listeners.delete(listener)
          }
        },
        refresh() {
          if (owner.stopped || stopped)
            return Promise.reject(new Error('GitHub source has stopped.'))
          return run(owner, async () => {
            if (owner.stopped || stopped) throw new Error('GitHub source has stopped.')
            const selected = owner.active
              ? [...owner.worker.owners].filter(
                  (candidate) => candidate.active && !candidate.stopped,
                )
              : [owner]
            await request(selected)
            if (owner.stopped || stopped) throw new Error('GitHub source has stopped.')
            return completed(owner)
          })
        },
        stop: () => stopOwner(owner),
      }
    },
    reconcileTopology(inputs) {
      if (stopped) return
      topology = inputs
      for (const owner of owners)
        owner.active = !owner.stopped && inputs.some((input) => sameSource(input, owner.input))
      const resolveProject = resolver([])
      for (const owner of owners) if (owner.active) reproject(owner, resolveProject)
      for (const worker of workers.values()) schedule(worker)
    },
    stop() {
      if (stopPromise) return stopPromise
      stopped = true
      for (const worker of workers.values()) {
        clearTimeout(worker.timer ?? undefined)
        worker.timer = null
      }
      const retiring = [...owners].map(stopOwner)
      stopPromise = Promise.allSettled([...retiring, ...pendingReads, ...pendingRequests]).then(
        (results) => {
          owners.clear()
          workers.clear()
          const failures = results
            .slice(0, retiring.length)
            .flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
          if (failures.length === 1) throw failures[0]
          if (failures.length > 1)
            throw new AggregateError(failures, 'GitHub source shutdown failed.')
        },
      )
      return stopPromise
    },
  }
}

function projectKey(input: GitHubObservationInput): SourceProjectKey {
  return { integration: 'github', id: input.ref.projectId }
}
function provenance(owner: Owner, stage: ObservationStage): SourceProvenance {
  return {
    integration: 'github',
    connectionId: owner.input.source.connectionId,
    repositoryId: owner.input.source.repositoryId,
    stage,
  }
}
function sourceFailure(error: unknown): SourceFailure {
  if (error instanceof GitHubError) return error.failure
  if (error instanceof GitHubAccessError) {
    switch (error.failure) {
      case 'network':
        return { kind: 'transient', cause: 'network' }
      case 'malformed-response':
        return { kind: 'read', cause: 'malformed-response' }
      case 'rejected-credential':
        return { kind: 'authorization', proof: 'rejected-credential' }
      case 'account-mismatch':
        return { kind: 'authorization', proof: 'account-mismatch' }
      case 'authorization-required':
        return { kind: 'authorization', proof: 'authorization-required' }
      case 'unavailable':
        return { kind: 'access-unavailable' }
    }
  }
  return { kind: 'read', cause: 'malformed-response' }
}
function conservativeRateLimit(current: RateLimit | null, observed: RateLimit): RateLimit {
  if (current === null || observed.resetAt > current.resetAt) return observed
  if (observed.resetAt < current.resetAt || observed.remaining >= current.remaining) return current
  return observed
}

function sameSource(left: GitHubObservationInput, right: GitHubObservationInput): boolean {
  return (
    left.ref.projectId === right.ref.projectId &&
    left.source.connectionId === right.source.connectionId &&
    left.source.accountId === right.source.accountId &&
    left.source.repositoryId === right.source.repositoryId
  )
}
