import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  CommittedConfiguration,
  GitHubSourceAccess,
  LocalProjectRegistration,
  LocalWorkspaceProof,
  ProjectAdmissionRecord,
  ProjectConfiguration,
  ProjectConfigurationIntent,
} from '../projects/registry.ts'
import {
  createReadSequenceAllocator,
  failedAttempt,
  type ObservationAttempt,
  type ReadSequenceAllocator,
  refineSourceContribution,
  type SourceContribution,
  type SourceFailure,
  type SourceObserver,
  type SourceProjectKey,
} from './source.ts'

export interface LocalObservationInput {
  readonly integration: 'local'
  readonly ref: LocalProjectRegistration['ref']
  readonly workspace: LocalWorkspaceProof
}

export interface GitHubObservationInput {
  readonly integration: 'github'
  readonly ref: GitHubSourceAccess['ref']
  readonly source: GitHubSourceAccess
}

type ObservationInput = LocalObservationInput | GitHubObservationInput

export interface SourceObserverFactories {
  local(input: LocalObservationInput): SourceObserver
  github(input: GitHubObservationInput): SourceObserver
  /** Updates the shared reference index only as part of a synchronous activation. */
  reconcileGitHubTopology?(inputs: readonly GitHubObservationInput[]): void
  stop?(): Promise<void>
}

export type AuthorizationUsability =
  | { readonly status: 'usable' }
  | { readonly status: 'authorization-required' | 'unavailable'; readonly cause: string }

const sourceBindingBrand: unique symbol = Symbol('SourceBinding')

/** Private lifetime identity. Sequences from different bindings are not comparable. */
export interface SourceBinding {
  readonly [sourceBindingBrand]: true
}

export interface CommittedObservation {
  readonly registry: CommittedConfiguration
  readonly observation: {
    readonly committedAt: number
    readonly attempts: readonly ObservationAttempt[]
  }
  readonly contributions: readonly SourceContribution[]
  readonly sourceBindings: ReadonlyMap<string, SourceBinding>
  readonly configurationValid: boolean
  readonly pendingAdmission: boolean
  readonly pendingConfigurations: readonly ProjectConfiguration[]
  readonly admissionRevision: number
  readonly authorizationUsability: ReadonlyMap<string, AuthorizationUsability>
  readonly classification: { readonly baselineProjects: readonly SourceProjectKey[] }
}

export interface ObservationCoordinator {
  activate(
    registry: CommittedConfiguration,
    authorization?: () => ReadonlyMap<string, AuthorizationUsability>,
  ): Promise<CommittedObservation>
  current(): CommittedObservation | null
  subscribe(listener: (committed: CommittedObservation) => void): () => void
  receiveConfigurationValidity(
    valid: boolean,
    pendingAdmission: boolean,
    pendingConfigurations?: readonly ProjectConfiguration[],
  ): void
  updateAuthorizationUsability(facts: ReadonlyMap<string, AuthorizationUsability>): void
  refresh(project: SourceProjectKey): Promise<SourceContribution>
  stop(): Promise<void>
}

export interface ObservationCoordinatorOptions {
  observers: SourceObserverFactories
  now?: () => number
  revalidateSources?: (
    configuration: CommittedConfiguration,
    connectionIds: readonly string[],
  ) => Promise<CommittedConfiguration>
  /** Shares the application's existing mutation lane for cadence-triggered recovery. */
  scheduleRecovery?: (recover: () => Promise<void>) => Promise<void>
}

interface SourceOwner {
  readonly key: string
  readonly project: SourceProjectKey
  readonly binding: SourceBinding
  readonly nextReadSequence: ReadSequenceAllocator
  readonly input: ObservationInput | null
  readonly dependency: string
  observer: SourceObserver | null
  unsubscribe: () => void
  contribution: SourceContribution | null
  fingerprint: string
  retired: boolean
}

export function createObservationCoordinator(
  options: ObservationCoordinatorOptions,
): ObservationCoordinator {
  const now = options.now ?? Date.now
  const listeners = new Set<(committed: CommittedObservation) => void>()
  const staged = new Set<SourceOwner>()
  let owners = new Map<string, SourceOwner>()
  let current: CommittedObservation | null = null
  let configurationValid = true
  let pendingAdmission = false
  let pendingConfigurations: readonly ProjectConfiguration[] = []
  let pendingFingerprint = '[]'
  let admissionRevision = 0
  let authorizationUsability: ReadonlyMap<string, AuthorizationUsability> = new Map()
  let activationLane: Promise<void> = Promise.resolve()
  let committing = false
  let stopped = false
  let stopPromise: Promise<void> | null = null
  const recoverySupervisors: {
    integration: SourceProjectKey['integration']
    delayMs: number
    timer: ReturnType<typeof setTimeout> | null
    running: Promise<void> | null
  }[] = [
    { integration: 'local', delayMs: 2_000, timer: null, running: null },
    { integration: 'github', delayMs: 30_000, timer: null, running: null },
  ]

  function recoveryConnections(
    project?: SourceProjectKey,
    integration?: SourceProjectKey['integration'],
  ): readonly string[] {
    const connections = new Set<string>()
    for (const admission of current?.registry.admissions ?? []) {
      const intent = admission.intent
      if (
        (integration && intent.ref.integration !== integration) ||
        (project &&
          (intent.ref.integration !== project.integration ||
            intent.ref.projectId !== project.id)) ||
        admission.source.status !== 'unavailable'
      )
        continue
      if (intent.ref.integration === 'github') {
        const failure = admission.source.error.githubAccessFailure
        if (failure !== 'network' && failure !== 'malformed-response' && failure !== 'unavailable')
          continue
      }
      const owner = owners.get(JSON.stringify([intent.ref.integration, intent.ref.projectId]))
      if (owner && !owner.retired && !owner.input && !owner.observer)
        connections.add(intent.connectionId)
    }
    return [...connections]
  }

  function inActivationLane<T>(operation: () => Promise<T>): Promise<T> {
    const result = activationLane.then(operation)
    activationLane = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function recover(
    project?: SourceProjectKey,
    integration?: SourceProjectKey['integration'],
  ): Promise<void> {
    return inActivationLane(async () => {
      if (
        stopped ||
        !current ||
        !configurationValid ||
        pendingAdmission ||
        !options.revalidateSources
      )
        return
      const connections = recoveryConnections(project, integration)
      if (connections.length === 0) return
      const before = current.registry
      const candidate = await options.revalidateSources(before, connections)
      if (stopped || !configurationValid || pendingAdmission || current.registry !== before) return
      await activate(candidate, before)
    })
  }

  function scheduleRecovery(): void {
    for (const supervisor of recoverySupervisors) {
      if (
        stopped ||
        !options.revalidateSources ||
        recoveryConnections(undefined, supervisor.integration).length === 0
      ) {
        clearTimeout(supervisor.timer ?? undefined)
        supervisor.timer = null
        supervisor.delayMs = supervisor.integration === 'local' ? 2_000 : 30_000
        continue
      }
      if (supervisor.timer !== null || supervisor.running !== null) continue
      // Only observerless inputs need supervision here. Admitted observers own their cadence.
      supervisor.timer = setTimeout(() => {
        supervisor.timer = null
        supervisor.running = (async () => {
          try {
            const recovery = () => recover(undefined, supervisor.integration)
            if (options.scheduleRecovery) await options.scheduleRecovery(recovery)
            else await recovery()
          } catch {
            // Failed reproof leaves the committed unavailable source authoritative.
          } finally {
            supervisor.running = null
            if (supervisor.integration === 'local')
              supervisor.delayMs = Math.min(supervisor.delayMs * 2, 10_000)
            scheduleRecovery()
          }
        })()
      }, supervisor.delayMs)
    }
  }

  function compose(
    registry: CommittedConfiguration,
    baselineProjects: readonly SourceProjectKey[],
  ): CommittedObservation {
    const contributions: SourceContribution[] = []
    const sourceBindings = new Map<string, SourceBinding>()
    for (const intent of registry.projects) {
      const owner = owners.get(JSON.stringify([intent.ref.integration, intent.ref.projectId]))
      if (!owner?.contribution)
        throw new Error('A committed source requires scoped baseline evidence.')
      contributions.push(owner.contribution)
      sourceBindings.set(owner.key, owner.binding)
    }
    return {
      registry,
      observation: {
        committedAt: now(),
        attempts: contributions.flatMap((value) => value.attempts),
      },
      contributions,
      sourceBindings,
      configurationValid,
      pendingAdmission,
      pendingConfigurations,
      admissionRevision,
      authorizationUsability,
      classification: { baselineProjects },
    }
  }

  function publish(baselineProjects: readonly SourceProjectKey[] = []): void {
    if (stopped || committing || !current) return
    current = compose(current.registry, baselineProjects)
    for (const listener of listeners) {
      if (stopped) break
      listener(current)
    }
  }

  function accept(owner: SourceOwner, value: unknown): boolean {
    if (stopped || owner.retired || (owners.get(owner.key) !== owner && !staged.has(owner)))
      return false
    const contribution = refineSourceContribution(value, owner.contribution)
    if (!contribution || !matchesOwner(owner, contribution)) return false
    // Required read sequences participate in equality, including unchanged same-clock reads.
    const fingerprint = JSON.stringify(contribution)
    if (fingerprint === owner.fingerprint) return true
    owner.contribution = contribution
    owner.fingerprint = fingerprint
    if (owners.get(owner.key) === owner) {
      admissionRevision += 1
      publish()
    }
    return true
  }

  async function retire(owner: SourceOwner): Promise<void> {
    if (owner.retired) return
    owner.retired = true
    staged.delete(owner)
    owner.unsubscribe()
    try {
      await owner.observer?.stop()
    } catch {
      // Retirement already revoked this owner's authority to publish.
    }
  }

  async function start(owner: SourceOwner, admission: ProjectAdmissionRecord): Promise<void> {
    const startupReadSequence = owner.nextReadSequence()
    if (!owner.input) {
      owner.contribution = failedContribution(admission, now(), startupReadSequence)
      owner.fingerprint = JSON.stringify(owner.contribution)
      return
    }
    try {
      owner.observer =
        owner.input.integration === 'local'
          ? options.observers.local(owner.input)
          : options.observers.github(owner.input)
      owner.unsubscribe = owner.observer.subscribe((value) => {
        accept(owner, value)
      })
      const baseline = await owner.observer.observe()
      if (owner.retired || stopped) return
      if (
        !refineSourceContribution(baseline, owner.contribution) ||
        !matchesOwner(owner, baseline)
      ) {
        throw new Error('The source baseline did not match its admitted scope.')
      }
      // The observer may have delivered a newer contribution before its baseline promise resolved.
      if (!owner.contribution) accept(owner, baseline)
    } catch {
      if (owner.retired || stopped) return
      // A callback may already have established an honest baseline before observe rejected.
      if (owner.contribution) return
      owner.contribution = failedContribution(admission, now(), startupReadSequence, true)
      owner.fingerprint = JSON.stringify(owner.contribution)
    }
  }

  async function activate(
    registry: CommittedConfiguration,
    recoveryFrom?: CommittedConfiguration,
    authorization?: () => ReadonlyMap<string, AuthorizationUsability>,
  ): Promise<CommittedObservation> {
    if (stopped) throw new Error('Observation has stopped.')
    const admissions = new Map<string, ProjectAdmissionRecord>()
    for (const admission of registry.admissions) {
      const key = JSON.stringify([admission.intent.ref.integration, admission.intent.ref.projectId])
      if (admissions.has(key)) throw new Error('Duplicate configured source admission.')
      admissions.set(key, admission)
    }
    if (admissions.size !== registry.projects.length)
      throw new Error('Source admissions must name exactly the configured Projects.')
    const next = new Map<string, SourceOwner>()
    const replacements: { owner: SourceOwner; admission: ProjectAdmissionRecord }[] = []
    const baselineProjects: SourceProjectKey[] = []
    for (const intent of registry.projects) {
      const key = JSON.stringify([intent.ref.integration, intent.ref.projectId])
      if (next.has(key)) throw new Error('Duplicate configured source identity.')
      const admission = admissions.get(key)
      if (!admission || !sameIntentSource(intent, admission.intent)) {
        throw new Error('Configured source admission does not match its intent.')
      }
      const input = observationInput(admission)
      const dependency = sourceDependency(admission, input)
      const previous = owners.get(key)
      if (previous && previous.dependency === dependency) {
        next.set(key, previous)
        continue
      }
      const project: SourceProjectKey = {
        integration: intent.ref.integration,
        id: intent.ref.projectId,
      }
      const owner: SourceOwner = {
        key,
        project,
        binding: Object.freeze<SourceBinding>({ [sourceBindingBrand]: true }),
        nextReadSequence: createReadSequenceAllocator(),
        input,
        dependency,
        observer: null,
        unsubscribe: () => undefined,
        contribution: null,
        fingerprint: '',
        retired: false,
      }
      next.set(key, owner)
      staged.add(owner)
      replacements.push({ owner, admission })
      baselineProjects.push(project)
    }
    for (const owner of owners.values()) {
      if (!next.has(owner.key)) baselineProjects.push(owner.project)
    }
    await Promise.all(replacements.map(({ owner, admission }) => start(owner, admission)))
    if (stopped) {
      await Promise.all(replacements.map(({ owner }) => retire(owner)))
      throw new Error('Observation stopped before activation.')
    }
    if (
      recoveryFrom &&
      (!configurationValid || pendingAdmission || current?.registry !== recoveryFrom)
    ) {
      await Promise.all(replacements.map(({ owner }) => retire(owner)))
      throw new Error('Current configuration no longer admits this source recovery.')
    }
    const previous = owners
    committing = true
    owners = next
    try {
      const githubInputs: GitHubObservationInput[] = []
      for (const admission of registry.admissions) {
        const input = observationInput(admission)
        if (input?.integration === 'github') githubInputs.push(input)
      }
      options.observers.reconcileGitHubTopology?.(githubInputs)
      if (authorization) authorizationUsability = new Map(authorization())
      admissionRevision += 1
      current = compose(registry, baselineProjects)
      for (const { owner } of replacements) staged.delete(owner)
    } finally {
      committing = false
    }
    const committed = current
    for (const listener of listeners) {
      if (stopped) break
      listener(committed)
    }
    await Promise.all(
      [...previous.values()].filter((owner) => next.get(owner.key) !== owner).map(retire),
    )
    scheduleRecovery()
    return committed
  }

  return {
    activate(registry, authorization) {
      return inActivationLane(() => activate(registry, undefined, authorization))
    },
    current: () => current,
    subscribe(listener) {
      if (stopped) return () => undefined
      listeners.add(listener)
      if (current) listener(current)
      return () => {
        listeners.delete(listener)
      }
    },
    receiveConfigurationValidity(valid, pending, configurations = []) {
      const fingerprint = JSON.stringify(configurations)
      if (
        stopped ||
        (configurationValid === valid &&
          pendingAdmission === pending &&
          pendingFingerprint === fingerprint)
      )
        return
      configurationValid = valid
      pendingAdmission = pending
      pendingConfigurations = [...configurations]
      pendingFingerprint = fingerprint
      admissionRevision += 1
      publish()
    },
    updateAuthorizationUsability(facts) {
      if (stopped || sameAuthorization(authorizationUsability, facts)) return
      authorizationUsability = new Map(facts)
      admissionRevision += 1
      publish()
    },
    async refresh(project) {
      const key = JSON.stringify([project.integration, project.id])
      let owner = owners.get(key)
      if (!stopped && owner && !owner.observer && !owner.retired) {
        await recover(project)
        owner = owners.get(key)
        if (owner?.observer && !owner.retired && owner.contribution) return owner.contribution
      }
      if (stopped || !owner?.observer || owner.retired)
        throw new Error('No active admitted source observer exists for this Project.')
      const fingerprint = owner.fingerprint
      const contribution = await owner.observer.refresh()
      if (stopped || owners.get(key) !== owner || owner.retired)
        throw new Error('The refreshed source retired before its result committed.')
      if (
        !refineSourceContribution(contribution, owner.contribution) ||
        !matchesOwner(owner, contribution)
      ) {
        throw new Error('The refresh did not match its admitted source scope.')
      }
      if (owner.fingerprint === fingerprint) accept(owner, contribution)
      return contribution
    },
    stop() {
      if (stopPromise) return stopPromise
      stopped = true
      for (const supervisor of recoverySupervisors) {
        clearTimeout(supervisor.timer ?? undefined)
        supervisor.timer = null
      }
      listeners.clear()
      const all = new Set([...owners.values(), ...staged])
      stopPromise = Promise.all([...all].map(retire)).then(async () => {
        await Promise.all([
          activationLane,
          ...recoverySupervisors.flatMap((supervisor) =>
            supervisor.running ? [supervisor.running] : [],
          ),
        ])
        await options.observers.stop?.()
      })
      return stopPromise
    },
  }
}

function observationInput(admission: ProjectAdmissionRecord): ObservationInput | null {
  if (admission.source.status !== 'ready') return null
  const value = admission.source.value
  if (
    admission.intent.ref.integration === 'local' &&
    'workspace' in value &&
    value.ref.integration === 'local'
  ) {
    if (
      value.ref.projectId !== admission.intent.ref.projectId ||
      value.connectionId !== admission.intent.connectionId
    )
      return null
    return { integration: 'local', ref: value.ref, workspace: value.workspace }
  }
  if (
    admission.intent.ref.integration === 'github' &&
    'access' in value &&
    value.ref.integration === 'github' &&
    'locator' in admission.intent
  ) {
    if (
      value.ref.projectId !== admission.intent.ref.projectId ||
      value.connectionId !== admission.intent.connectionId ||
      value.repositoryId !== admission.intent.locator.repositoryId
    )
      return null
    return { integration: 'github', ref: value.ref, source: value }
  }
  return null
}

function sourceDependency(
  admission: ProjectAdmissionRecord,
  input: ObservationInput | null,
): string {
  if (input?.integration === 'local') return JSON.stringify(['local', input.workspace.path])
  if (input?.integration === 'github') {
    return JSON.stringify([
      'github',
      input.source.connectionId,
      input.source.accountId,
      input.source.repositoryId,
    ])
  }
  const intent = admission.intent
  return JSON.stringify([
    intent.ref.integration,
    intent.connectionId,
    'locator' in intent ? intent.locator.repositoryId : intent.workspace.path,
    admission.source.status,
    admission.source.status === 'unavailable' ? admission.source.error : null,
  ])
}

function sameIntentSource(a: ProjectConfigurationIntent, b: ProjectConfigurationIntent): boolean {
  if (
    a.ref.integration !== b.ref.integration ||
    a.ref.projectId !== b.ref.projectId ||
    a.connectionId !== b.connectionId
  )
    return false
  if ('locator' in a && 'locator' in b) return a.locator.repositoryId === b.locator.repositoryId
  return !('locator' in a) && !('locator' in b) && a.workspace.path === b.workspace.path
}

function matchesOwner(owner: SourceOwner, contribution: SourceContribution): boolean {
  if (
    contribution.project.integration !== owner.project.integration ||
    contribution.project.id !== owner.project.id ||
    !owner.input
  )
    return false
  for (const attempt of contribution.attempts) {
    const provenance = attempt.provenance
    if (owner.input.integration === 'github') {
      if (
        provenance.integration !== 'github' ||
        provenance.connectionId !== owner.input.source.connectionId ||
        provenance.repositoryId !== owner.input.source.repositoryId
      )
        return false
      continue
    }
    if (provenance.integration !== 'local') return false
    const root = resolve(owner.input.workspace.path)
    const path = resolve(provenance.path)
    const suffix = relative(root, path)
    if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) return false
    switch (attempt.scope.kind) {
      case 'project':
        if (path !== root) return false
        if (
          attempt.kind === 'observed' &&
          (!('source' in attempt.value) ||
            !('integration' in attempt.value.source) ||
            attempt.value.source.integration !== 'local' ||
            resolve(attempt.value.source.path) !== root)
        )
          return false
        break
      case 'maps-membership':
        if (path !== join(root, '.wayfinder')) return false
        break
      case 'map':
        if (attempt.kind !== 'proven-absent' && path !== resolve(root, attempt.scope.map.mapId))
          return false
        break
      case 'tickets-membership': {
        const ticketsPath = join(dirname(resolve(root, attempt.scope.map.mapId)), 'tickets')
        if (
          path !== ticketsPath &&
          !(
            attempt.kind === 'failed' &&
            provenance.operation === 'read' &&
            dirname(path) === ticketsPath
          )
        )
          return false
        break
      }
      case 'ticket':
        if (
          attempt.kind !== 'proven-absent' &&
          dirname(path) !== join(dirname(resolve(root, attempt.scope.ticket.map.mapId)), 'tickets')
        )
          return false
        break
    }
  }
  return true
}

function failedContribution(
  admission: ProjectAdmissionRecord,
  attemptedAt: number,
  readSequence: number,
  startup = false,
): SourceContribution {
  const intent = admission.intent
  const project: SourceProjectKey = {
    integration: intent.ref.integration,
    id: intent.ref.projectId,
  }
  const cause = startup
    ? 'The source observer could not establish its baseline.'
    : admission.source.status === 'unavailable'
      ? admission.source.error.message
      : 'The configured source has not been verified.'
  const attempt =
    'locator' in intent
      ? failedAttempt({
          kind: 'failed',
          scope: { kind: 'project', project },
          readSequence,
          attemptedAt,
          provenance: {
            integration: 'github',
            connectionId: intent.connectionId,
            repositoryId: intent.locator.repositoryId,
            stage: startup ? 'repository' : 'credentials',
          },
          failure: admissionAccessFailure(admission, startup),
        })
      : failedAttempt({
          kind: 'failed',
          scope: { kind: 'project', project },
          readSequence,
          attemptedAt,
          provenance: {
            integration: 'local',
            path: intent.workspace.path,
            operation: 'inspect-root',
          },
          failure: {
            kind: 'filesystem',
            operation: 'inspect-root',
            code:
              admission.source.status === 'unavailable'
                ? (admission.source.error.filesystemCode ?? 'other')
                : 'other',
          },
        })
  return {
    project,
    attempts: [attempt],
    health: {
      status:
        !startup &&
        admission.source.status === 'unavailable' &&
        (admission.source.error.githubAccessFailure === 'rejected-credential' ||
          admission.source.error.githubAccessFailure === 'account-mismatch' ||
          admission.source.error.githubAccessFailure === 'authorization-required')
          ? 'authorization-required'
          : 'unavailable',
      cause,
    },
  }
}

function admissionAccessFailure(
  admission: ProjectAdmissionRecord,
  startup: boolean,
): SourceFailure {
  const failure =
    !startup && admission.source.status === 'unavailable'
      ? admission.source.error.githubAccessFailure
      : undefined
  switch (failure) {
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
    case undefined:
      return { kind: 'execution', cause: 'provider' }
  }
}

function sameAuthorization(
  a: ReadonlyMap<string, AuthorizationUsability>,
  b: ReadonlyMap<string, AuthorizationUsability>,
): boolean {
  if (a.size !== b.size) return false
  for (const [id, value] of a) {
    const other = b.get(id)
    if (!other || value.status !== other.status) return false
    if (value.status !== 'usable' && (other.status === 'usable' || value.cause !== other.cause))
      return false
  }
  return true
}
