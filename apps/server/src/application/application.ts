import { randomUUID } from 'node:crypto'
import type {
  ApplicationState,
  AuthorizationOperation,
  Blocker,
  Command,
  CommandOutcome,
  CommandResult,
  ConnectionAvailability,
  GitHubConnectionIdentity,
  Project,
  ProjectKey,
  ProjectRegistration,
  ProjectRegistrationCandidate,
  Query,
  QueryResult,
  RegisteredProject,
  SafeError,
  Snapshot,
  SupportedIntegration,
  Ticket,
  Unreachable,
  WayfinderMap,
} from '@roadmap/contracts'
import { type ChangeEvent, createChangeFeed } from '../change-feed.ts'
import {
  type CredentialBundle,
  GitHubConnectionError,
  type GitHubConnectionPort,
} from '../github/connections.ts'
import {
  type ObservationAttempt,
  type SourceBlocker,
  type SourceFailure,
  type SourceMapContent,
  type SourceMapKey,
  type SourceScope,
  type SourceSnapshot,
  type SourceTicketContent,
  sourceScopeKey,
  type WayfinderAdapter,
} from '../observation/source.ts'
import { createSnapshotStore, type SnapshotStore } from '../store.ts'
import { type AutomationLauncher, type AutomationLoop, createAutomationLoop } from './automation.ts'
import type { AutomationDatabaseDocument } from './automation-database.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  RoadmapConfiguration,
} from './configuration.ts'
import { roadmapConfigurationCodec } from './configuration.ts'
import { type CredentialVault, CredentialVaultError } from './credential-vault.ts'

export interface RoadmapApplication {
  start(): Promise<void>
  current(): ApplicationState
  subscribe(listener: (state: ApplicationState) => void): () => void
  query(query: Query): Promise<QueryResult>
  execute(command: Command): Promise<CommandOutcome>
  stop(): Promise<void>
}

const REFRESH_LEEWAY_MS = 5 * 60_000
const SLOW_DOWN_MS = 5_000

interface AdmissionRuntime {
  accessToken(connectionId: string): Promise<string>
}

export interface AdmissionPort {
  admit(
    candidate: ProjectRegistrationCandidate,
    configuration: RoadmapConfiguration,
    runtime: AdmissionRuntime,
  ): Promise<
    | { ok: true; registration: ProjectRegistration }
    | {
        ok: false
        error: SafeError
      }
  >
  repair(
    command: Extract<Command, { type: 'repair-project-workspace' }>,
    configuration: RoadmapConfiguration,
    runtime: AdmissionRuntime,
  ): Promise<
    | { ok: true; workspace: Extract<Command, { type: 'repair-project-workspace' }>['workspace'] }
    | { ok: false; error: SafeError }
  >
}

export interface AdapterRuntime {
  accessToken(connectionId: string): Promise<string>
  setConnectionAvailability(connectionId: string, availability: ConnectionAvailability): void
}

export interface ApplicationOperations {
  query(query: Query, state: ApplicationState): Promise<QueryResult>
  execute(
    command: Exclude<
      Command,
      | { type: 'begin-github-authorization' }
      | { type: 'cancel-github-authorization' }
      | { type: 'retry-github-authorization' }
      | { type: 'rename-connection' }
      | { type: 'remove-connection' }
      | { type: 'register-project' }
      | { type: 'rename-project' }
      | { type: 'repair-project-workspace' }
      | { type: 'remove-project' }
      | { type: 'start-automation-override' }
    >,
    state: ApplicationState,
  ): Promise<{ ok: true; result: CommandResult } | { ok: false; error: SafeError }>
}

export interface RoadmapApplicationOptions {
  configuration: ConfigurationDocument
  createAdapters(
    configuration: RoadmapConfiguration,
    runtime: AdapterRuntime,
  ): readonly WayfinderAdapter[]
  supportedIntegrations?: readonly SupportedIntegration[]
  credentialVault?: CredentialVault
  github?: GitHubConnectionPort
  admission?: AdmissionPort
  operations?: ApplicationOperations
  onChangeEvents?: (events: ChangeEvent[]) => void
  serverEpoch?: string
  now?: () => number
  automation?: {
    database: AutomationDatabaseDocument
    launcher: AutomationLauncher
  }
}

const EMPTY_SNAPSHOT: Snapshot = { capturedAt: 0, projects: [], unreachable: [] }
const EMPTY_CONFIGURATION: RoadmapConfiguration = {
  schemaVersion: 5,
  configurationVersion: 0,
  connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
  projects: [],
  automation: { enabled: false, enabledProjects: [] },
}
const LOCAL_INTEGRATION: SupportedIntegration = {
  integration: 'local',
  name: 'Local',
  connectionKind: 'built-in',
}

interface ActiveGeneration {
  id: number
  store: SnapshotStore
  unsubscribe: () => void
}

interface ActiveAuthorization {
  public: AuthorizationOperation
  name: string
  deviceCode: string
  intervalMs: number
  timer: ReturnType<typeof setTimeout> | null
}

export function createRoadmapApplication(options: RoadmapApplicationOptions): RoadmapApplication {
  const now = options.now ?? Date.now
  const serverEpoch = options.serverEpoch ?? randomUUID()
  const supportedIntegrations = [
    ...(options.supportedIntegrations ?? [LOCAL_INTEGRATION]),
    ...(options.supportedIntegrations || !options.github ? [] : [options.github.integration]),
  ]
  const listeners = new Set<(state: ApplicationState) => void>()
  let observedAt = now()
  let observeRoadmap: (snapshot: Snapshot) => void = () => undefined
  const changeFeed = createChangeFeed({
    onChange(listener) {
      observeRoadmap = listener
      return () => {
        observeRoadmap = () => undefined
      }
    },
  })
  if (options.onChangeEvents) changeFeed.onEvent(options.onChangeEvents)
  let configuration = EMPTY_CONFIGURATION
  let configurationStatus: ApplicationState['configuration'] = {
    valid: true,
    issues: [],
    notices: [],
  }
  let roadmap = EMPTY_SNAPSHOT
  const successfulScopes = new Map<string, Extract<ObservationAttempt, { kind: 'observed' }>>()
  let currentScopes = new Map<string, ObservationAttempt>()
  const mapMembers = new Map<string, readonly SourceMapKey[]>()
  const ticketMembers = new Map<string, readonly SourceTicketContent['key'][]>()
  const successfulProjectTimes = new Map<string, number>()
  const retainedMapOrder = new Map<string, readonly string[]>()
  const projectedProjects = new Map<string, { trace: Project; available: boolean; cause: string }>()
  const connectionAvailability = new Map<string, ConnectionAvailability>()
  const credentialBundles = new Map<string, CredentialBundle>()
  const refreshes = new Map<string, Promise<string>>()
  const authorizationOperations = new Map<string, ActiveAuthorization>()
  const automationLoop: AutomationLoop | null = options.automation
    ? createAutomationLoop({
        database: options.automation.database,
        launcher: options.automation.launcher,
        source: () => ({ configuration, projects: registeredProjects() }),
        onEvidenceChange() {
          publish()
          void enqueue(disableInterruptedProjects).catch(() => undefined)
        },
      })
    : null
  let stateSequence = 0
  let state = buildState()
  let stateFingerprint = semanticFingerprint(state)
  let active: ActiveGeneration | null = null
  let nextGeneration = 0
  let started = false
  let stopped = false
  let stopping = false
  let stopPromise: Promise<void> | null = null
  let startPromise: Promise<void> | null = null
  let unsubscribeConfiguration: (() => void) | null = null
  let mutationLane: Promise<void> = Promise.resolve()
  let ownWriteVersion: number | null = null

  function buildState(): ApplicationState {
    return {
      serverEpoch,
      stateSequence,
      configurationVersion: configuration.configurationVersion,
      supportedIntegrations: [...supportedIntegrations],
      connections: configuration.connections.map((connection) => ({
        ...connection,
        availability:
          connectionAvailability.get(connection.id) ??
          (connection.integration === 'local'
            ? { status: 'available' as const, observedAt }
            : { status: 'authorization-required' as const, cause: 'Authorization is required.' }),
      })),
      registrations: configuration.projects,
      projects: registeredProjects(),
      authorizationOperations: [...authorizationOperations.values()].map((operation) => ({
        ...operation.public,
      })),
      configuration: configurationStatus,
      automation: automationState(),
      roadmap,
    }
  }
  function automationState(): ApplicationState['automation'] {
    return {
      enabled: configuration.automation.enabled,
      enabledProjects: [...configuration.automation.enabledProjects],
      availability: automationAvailability(),
      evidence: automationLoop?.evidence() ?? [],
      overrides: automationLoop?.overrides() ?? [],
    }
  }

  function automationAvailability(): ApplicationState['automation']['availability'] {
    if (!configurationStatus.valid) {
      const commandIssue = configurationStatus.issues.find(
        (issue) =>
          issue.path.startsWith('$.automation.classificationCommand') ||
          issue.path.startsWith('$.automation.wayfinderCommand'),
      )
      return {
        status: 'unavailable',
        cause: commandIssue
          ? `Harness Command is invalid: ${commandIssue.path} ${commandIssue.message}`
          : 'roadmap.config.json is invalid; repair it before enabling Automation.',
      }
    }
    const missing = [
      configuration.automation.classificationCommand ? null : 'Classification Harness Command',
      configuration.automation.wayfinderCommand ? null : 'Wayfinder Session Command',
    ].filter((name): name is string => name !== null)
    if (missing.length > 0) {
      return {
        status: 'unavailable',
        cause: `Configure ${missing.join(' and ')} in roadmap.config.json.`,
      }
    }
    return { status: 'ready' }
  }

  function registeredProjects(): RegisteredProject[] {
    return configuration.projects.map((registration) => {
      const key = projectKey(registration.key)
      const projected = projectedProjects.get(key)
      const known = projected?.trace
      const observed = successfulProjectTimes.get(key)
      return {
        ...registration,
        name: registration.displayName ?? known?.name ?? registration.key.id,
        availability:
          projected?.available && observed !== undefined
            ? { status: 'available' as const, observedAt: observed }
            : {
                status: 'unavailable' as const,
                cause: projected?.cause ?? 'Project has no current successful source observation.',
                ...(observed === undefined ? {} : { observedAt: observed }),
              },
        openMaps: known?.openMaps ?? [],
        closedMaps: known?.closedMaps ?? [],
        warnings: known?.warnings ?? [],
        actions: projectActions(registration, known),
      }
    })
  }

  function retainObservation(attempt: ObservationAttempt): void {
    if (attempt.kind !== 'observed') return
    const key = sourceScopeKey(attempt.scope)
    successfulScopes.set(key, attempt)
    const maps = observedMaps(attempt)
    if (maps)
      mapMembers.set(
        key,
        mergeMembers(
          mapMembers.get(key) ?? [],
          maps.value.members,
          maps.completeness.kind === 'complete',
          (map) => map.mapId,
        ),
      )
    const tickets = observedTickets(attempt)
    if (tickets)
      ticketMembers.set(
        key,
        mergeMembers(
          ticketMembers.get(key) ?? [],
          tickets.value.members,
          tickets.completeness.kind === 'complete',
          (ticket) => ticket.ticketId,
        ),
      )
  }

  function acceptSnapshot(snapshot: SourceSnapshot): void {
    currentScopes = new Map(
      snapshot.attempts.map((attempt) => [sourceScopeKey(attempt.scope), attempt]),
    )
    for (const attempt of snapshot.attempts) retainObservation(attempt)
    const projects: Project[] = []
    const unreachable: Unreachable[] = []
    projectedProjects.clear()
    const sourceProjects = new Map<string, ProjectKey>()
    for (const attempt of successfulScopes.values()) {
      const project = sourceProject(attempt.scope)
      sourceProjects.set(projectKey(project), project)
    }
    for (const attempt of snapshot.attempts) {
      const project = sourceProject(attempt.scope)
      sourceProjects.set(projectKey(project), project)
    }
    for (const registration of configuration.projects)
      sourceProjects.set(projectKey(registration.key), registration.key)
    for (const project of sourceProjects.values()) {
      const result = projectSource(project)
      projectedProjects.set(projectKey(project), result)
      if (result.current) projects.push(result.current)
      unreachable.push(...result.unreachable)
    }
    projects.sort(
      (a, b) =>
        Number(b.openMaps.length > 0) - Number(a.openMaps.length > 0) ||
        a.name.localeCompare(b.name),
    )
    unreachable.sort(
      (a, b) =>
        projectKey(a.project).localeCompare(projectKey(b.project)) ||
        (a.mapId ?? '').localeCompare(b.mapId ?? '') ||
        a.reason.localeCompare(b.reason),
    )
    roadmap = { capturedAt: snapshot.capturedAt, projects, unreachable }
    automationLoop?.reconcile()
  }

  function projectTickets(map: SourceMapKey) {
    const membershipScope: SourceScope = { kind: 'tickets-membership', map }
    const membership = observedTickets(currentScopes.get(sourceScopeKey(membershipScope)))
    const retainedKeys = new Map<string, SourceTicketContent['key']>()
    for (const ticket of ticketMembers.get(sourceScopeKey(membershipScope)) ?? [])
      retainedKeys.set(ticket.ticketId, ticket)
    for (const attempt of successfulScopes.values()) {
      if (attempt.scope.kind === 'ticket' && sameSourceMap(attempt.scope.ticket.map, map))
        retainedKeys.set(attempt.scope.ticket.ticketId, attempt.scope.ticket)
    }
    const trace: Ticket[] = []
    const current: Ticket[] = []
    let valid = membership?.completeness.kind === 'complete'
    const currentIds = new Set(membership?.value.members.map((ticket) => ticket.ticketId) ?? [])
    for (const ticket of retainedKeys.values()) {
      const scope: SourceScope = { kind: 'ticket', ticket }
      const retained = observedTicket(successfulScopes.get(sourceScopeKey(scope)))
      const live = observedTicket(currentScopes.get(sourceScopeKey(scope)))
      const included =
        !!membership &&
        (membership.completeness.kind !== 'complete' || currentIds.has(ticket.ticketId))
      const ticketValid =
        !!live &&
        live.completeness.kind === 'complete' &&
        live.value.status !== 'unknown' &&
        live.value.blockersComplete
      if (retained) trace.push(projectTicket(retained.value, included && ticketValid))
      if (live && included) current.push(projectTicket(live.value, ticketValid))
      if (
        (included && !ticketValid) ||
        (retained && !included && retained.value.status !== 'closed')
      )
        valid = false
    }
    return { trace, current, valid }
  }

  function projectScopedMap(map: SourceMapKey, included: boolean, absent: boolean) {
    const scope: SourceScope = { kind: 'map', map }
    const retained = observedMap(successfulScopes.get(sourceScopeKey(scope)))
    const latest = currentScopes.get(sourceScopeKey(scope))
    const live = observedMap(latest)
    const tickets = projectTickets(map)
    const valid =
      !!live &&
      included &&
      live.completeness.kind === 'complete' &&
      live.value.status !== 'unknown' &&
      live.value.progress !== null &&
      tickets.valid
    const ticketScope: SourceScope = { kind: 'tickets-membership', map }
    const ticketAttempt = currentScopes.get(sourceScopeKey(ticketScope))
    const failedTicket = [...currentScopes.values()].find(
      (attempt) =>
        attempt.kind === 'failed' &&
        attempt.scope.kind === 'ticket' &&
        sameSourceMap(attempt.scope.ticket.map, map),
    )
    let reason: string | undefined
    if (absent || latest?.kind === 'proven-absent')
      reason = 'Map is absent from the complete current source membership.'
    else if (latest?.kind === 'failed') reason = sourceFailureMessage(latest.failure)
    else if (ticketAttempt?.kind === 'failed') reason = sourceFailureMessage(ticketAttempt.failure)
    else if (failedTicket?.kind === 'failed') reason = sourceFailureMessage(failedTicket.failure)
    else if (!live && retained) reason = 'Map has no current successful source observation.'
    else if (!valid) reason = 'Map source evidence is incomplete.'
    return {
      valid,
      reason,
      retained,
      trace: retained ? projectMap(retained.value, tickets.trace, valid) : undefined,
      current: live && included ? projectMap(live.value, tickets.current, valid) : undefined,
    }
  }

  function projectMaps(
    project: ProjectKey,
    projectName: string | undefined,
    membership: ReturnType<typeof observedMaps>,
  ) {
    const membershipKey = sourceScopeKey({ kind: 'maps-membership', project })
    const known = new Map<string, SourceMapKey>()
    for (const map of mapMembers.get(membershipKey) ?? []) known.set(map.mapId, map)
    for (const attempt of successfulScopes.values()) {
      if (attempt.scope.kind === 'map' && sameProject(attempt.scope.map.project, project))
        known.set(attempt.scope.map.mapId, attempt.scope.map)
    }
    const trace: WayfinderMap[] = []
    const current: WayfinderMap[] = []
    const failures: Unreachable[] = []
    let complete = membership?.completeness.kind === 'complete'
    const currentIds = new Set(membership?.value.members.map((map) => map.mapId) ?? [])
    for (const map of known.values()) {
      const absent = membership?.completeness.kind === 'complete' && !currentIds.has(map.mapId)
      const result = projectScopedMap(map, !!membership && !absent, absent)
      if (!result.valid) complete = false
      if (result.trace) trace.push(result.trace)
      if (result.current) current.push(result.current)
      if (result.reason)
        failures.push({
          integration: project.integration,
          project,
          projectName,
          mapId: map.mapId,
          ...(result.retained?.value.displayId === undefined
            ? {}
            : { mapDisplayId: result.retained.value.displayId }),
          ...(result.retained?.value.title === undefined
            ? {}
            : { mapTitle: result.retained.value.title }),
          reason: result.reason,
        })
    }
    return { trace, current, complete, failures, currentIds }
  }

  function orderRetainedMaps(key: string, maps: WayfinderMap[], complete: boolean): WayfinderMap[] {
    const open = maps.filter((map) => map.isOpen)
    if (complete) {
      open.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      retainedMapOrder.set(
        key,
        open.map((map) => map.id),
      )
    } else {
      const positions = new Map((retainedMapOrder.get(key) ?? []).map((id, index) => [id, index]))
      open.sort(
        (a, b) =>
          (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
          b.updatedAt - a.updatedAt ||
          a.id.localeCompare(b.id),
      )
    }
    return open
  }

  function projectSource(project: ProjectKey): {
    trace: Project
    current?: Project
    available: boolean
    cause: string
    unreachable: Unreachable[]
  } {
    const key = projectKey(project)
    const projectScope: SourceScope = { kind: 'project', project }
    const listScope: SourceScope = { kind: 'maps-membership', project }
    const metadata = observedProject(successfulScopes.get(sourceScopeKey(projectScope)))
    const liveMetadata = observedProject(currentScopes.get(sourceScopeKey(projectScope)))
    const liveList = observedMaps(currentScopes.get(sourceScopeKey(listScope)))
    const membershipKey = sourceScopeKey(listScope)
    const maps = projectMaps(project, metadata?.value.name, liveList)
    const { trace: traceMaps, current: currentMaps, failures, currentIds } = maps
    const complete = liveMetadata?.completeness.kind === 'complete' && maps.complete
    const projectAttempt = currentScopes.get(sourceScopeKey(projectScope))
    const listAttempt = currentScopes.get(membershipKey)
    const projectCause = projectEvidenceCause(projectAttempt, listAttempt, complete)
    if (
      !liveMetadata ||
      !liveList ||
      liveMetadata.completeness.kind !== 'complete' ||
      liveList.completeness.kind !== 'complete'
    ) {
      failures.push({
        integration: project.integration,
        project,
        projectName: metadata?.value.name,
        reason: projectCause || 'Project source membership is incomplete.',
      })
    }
    const open = orderRetainedMaps(key, traceMaps, complete)
    if (complete && liveMetadata && liveList)
      successfulProjectTimes.set(key, Math.max(liveMetadata.observedAt, liveList.observedAt))
    const trace = projectTrace(
      project,
      metadata,
      traceMaps,
      open,
      liveList?.completeness.kind === 'complete' && currentIds.size === 0,
    )
    const current =
      liveMetadata && liveList
        ? {
            ...trace,
            openMaps: orderCurrentMaps(
              currentMaps.filter((map) => map.isOpen),
              open.map((map) => map.id),
            ),
            closedMaps: currentMaps
              .filter((map) => !map.isOpen)
              .sort(
                (a, b) =>
                  (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt) ||
                  a.id.localeCompare(b.id),
              ),
          }
        : undefined
    return {
      trace,
      ...(current ? { current } : {}),
      available: complete,
      cause: projectCause,
      unreachable: failures,
    }
  }

  function publish(observe = true): void {
    const candidate = buildState()
    const fingerprint = semanticFingerprint(candidate)
    if (fingerprint === stateFingerprint) return
    stateSequence += 1
    state = { ...candidate, stateSequence }
    stateFingerprint = fingerprint
    for (const listener of listeners) listener(state)
    if (observe) observeRoadmap(roadmap)
  }

  async function installGeneration(nextConfiguration: RoadmapConfiguration): Promise<void> {
    const id = ++nextGeneration
    const runtime: AdapterRuntime = {
      accessToken: ensureAccessToken,
      setConnectionAvailability(connectionId, availability) {
        if (id !== nextGeneration) return
        setAvailability(connectionId, availability)
        if (active?.id === id) publish()
      },
    }
    const store = createSnapshotStore(options.createAdapters(nextConfiguration, runtime))
    await store.start()
    if (stopped || id !== nextGeneration) {
      await store.stop()
      return
    }

    observedAt = now()
    const previous = active
    configuration = nextConfiguration
    acceptSnapshot(store.snapshot())
    changeFeed.reset(roadmap)
    active = { id, store, unsubscribe: () => undefined }
    active.unsubscribe = store.onChange((snapshot) => {
      if (active?.id !== id) return
      acceptSnapshot(snapshot)
      publish()
    })
    previous?.unsubscribe()
    await previous?.store.stop()
    publish()
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = mutationLane.then(operation, operation)
    mutationLane = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function disableInterruptedProjects(): Promise<void> {
    if (!automationLoop || !configurationStatus.valid) return
    const interrupted = automationLoop.interruptedProjects()
    if (interrupted.length === 0) return
    const enabledProjects = configuration.automation.enabledProjects.filter(
      (project) => !interrupted.some((candidate) => sameProject(candidate, project)),
    )
    if (enabledProjects.length === configuration.automation.enabledProjects.length) return
    await persistConfiguration({
      ...configuration,
      automation: { ...configuration.automation, enabledProjects },
    })
  }

  function setAvailability(connectionId: string, availability: ConnectionAvailability): void {
    connectionAvailability.set(connectionId, availability)
  }

  async function cleanupOrphanCredentials(nextConfiguration: RoadmapConfiguration): Promise<void> {
    if (!options.credentialVault) return
    try {
      await options.credentialVault.cleanupOrphans(
        new Set(nextConfiguration.connections.map((connection) => connection.id)),
      )
    } catch (error) {
      const notice = safeAuthorizationMessage(error)
      if (!configurationStatus.notices.includes(notice)) {
        configurationStatus = {
          ...configurationStatus,
          notices: [...configurationStatus.notices, notice],
        }
      }
    }
  }

  async function synchronizeCredentials(nextConfiguration: RoadmapConfiguration): Promise<void> {
    const knownIds = new Set(nextConfiguration.connections.map((connection) => connection.id))
    forgetRemovedConnections(knownIds)
    for (const connection of nextConfiguration.connections) {
      await synchronizeConnection(connection)
    }
  }

  function forgetRemovedConnections(knownIds: ReadonlySet<string>): void {
    for (const connectionId of connectionAvailability.keys()) {
      if (!knownIds.has(connectionId)) connectionAvailability.delete(connectionId)
    }
    for (const connectionId of credentialBundles.keys()) {
      if (!knownIds.has(connectionId)) credentialBundles.delete(connectionId)
    }
  }

  async function synchronizeConnection(
    connection: RoadmapConfiguration['connections'][number],
  ): Promise<void> {
    if (connection.integration === 'local') {
      setAvailability(connection.id, { status: 'available', observedAt })
      return
    }
    const github = options.github
    const credentialVault = options.credentialVault
    if (!github || !credentialVault) {
      setAvailability(connection.id, {
        status: 'authorization-required',
        cause: 'GitHub authorization is not configured.',
      })
      return
    }
    if (credentialBundles.has(connection.id)) return

    try {
      const credentials = await credentialVault.read(connection.id)
      if (!credentials || credentials.refreshTokenExpiresAt <= now()) {
        setAvailability(connection.id, {
          status: 'authorization-required',
          cause: 'GitHub authorization must be renewed.',
        })
        return
      }
      credentialBundles.set(connection.id, credentials)
      const accessToken = await ensureAccessToken(connection.id)
      const identity = await github.identify(accessToken)
      if (identity.id !== connection.githubIdentity?.id) {
        credentialBundles.delete(connection.id)
        setAvailability(connection.id, {
          status: 'authorization-required',
          cause: 'Stored GitHub authorization does not match this Connection.',
        })
        return
      }
      setAvailability(connection.id, { status: 'available', observedAt: now() })
    } catch (error) {
      applyCredentialFailure(connection.id, error)
    }
  }

  async function ensureAccessToken(connectionId: string): Promise<string> {
    const cached = credentialBundles.get(connectionId)
    const credentials = cached ?? (await options.credentialVault?.read(connectionId))
    if (!credentials) {
      setAvailability(connectionId, {
        status: 'authorization-required',
        cause: 'GitHub authorization is required.',
      })
      throw new GitHubConnectionError('unauthorized', 'GitHub authorization is required.')
    }
    credentialBundles.set(connectionId, credentials)
    if (credentials.refreshTokenExpiresAt <= now()) {
      credentialBundles.delete(connectionId)
      setAvailability(connectionId, {
        status: 'authorization-required',
        cause: 'GitHub authorization must be renewed.',
      })
      throw new GitHubConnectionError('bad-refresh-token', 'GitHub authorization must be renewed.')
    }
    if (credentials.accessTokenExpiresAt > now() + REFRESH_LEEWAY_MS) {
      return credentials.accessToken
    }

    const activeRefresh = refreshes.get(connectionId)
    if (activeRefresh) return activeRefresh
    const refresh = refreshAccessToken(connectionId, credentials)
    refreshes.set(connectionId, refresh)
    try {
      return await refresh
    } finally {
      refreshes.delete(connectionId)
    }
  }

  async function refreshAccessToken(
    connectionId: string,
    credentials: CredentialBundle,
  ): Promise<string> {
    if (!options.github || !options.credentialVault) {
      throw new GitHubConnectionError('unauthorized', 'GitHub authorization is not configured.')
    }
    try {
      const refreshed = await options.github.refresh(credentials.refreshToken)
      try {
        await options.credentialVault.write(connectionId, refreshed)
      } catch {
        credentialBundles.delete(connectionId)
        setAvailability(connectionId, {
          status: 'authorization-required',
          cause: 'Refreshed GitHub authorization could not be saved; authorize again.',
        })
        publish()
        throw new GitHubConnectionError(
          'bad-refresh-token',
          'Refreshed GitHub authorization could not be saved; authorize again.',
        )
      }
      credentialBundles.set(connectionId, refreshed)
      setAvailability(connectionId, { status: 'available', observedAt: now() })
      publish()
      return refreshed.accessToken
    } catch (error) {
      applyCredentialFailure(connectionId, error)
      publish()
      throw error
    }
  }

  function applyCredentialFailure(connectionId: string, error: unknown): void {
    if (
      (error instanceof GitHubConnectionError &&
        (error.kind === 'unauthorized' || error.kind === 'bad-refresh-token')) ||
      (error instanceof CredentialVaultError && error.kind === 'invalid')
    ) {
      credentialBundles.delete(connectionId)
      setAvailability(connectionId, {
        status: 'authorization-required',
        cause: error.message,
        observedAt: now(),
      })
      return
    }
    const previous = connectionAvailability.get(connectionId)
    if (previous?.status === 'available' || previous?.status === 'degraded') return
    setAvailability(connectionId, {
      status: 'unavailable',
      cause: safeAuthorizationMessage(error),
      observedAt: now(),
    })
  }

  async function beginAuthorization(
    command: Extract<Command, { type: 'begin-github-authorization' }>,
  ): Promise<CommandResolution> {
    if (!options.github || !options.credentialVault) {
      return unsupported('GitHub Connections are not available.')
    }
    const name = command.name.trim()
    if (!name) return invalid('name', 'Connection name cannot be empty.')
    if (command.connectionId) {
      const connection = configuration.connections.find(
        (candidate) => candidate.id === command.connectionId,
      )
      if (connection?.integration !== 'github') {
        return invalid('connectionId', 'GitHub Connection does not exist.')
      }
      if (
        [...authorizationOperations.values()].some(
          (operation) =>
            operation.public.status === 'waiting' &&
            operation.public.connectionId === command.connectionId,
        )
      ) {
        return invalid('connectionId', 'Authorization is already in progress for this Connection.')
      }
    }

    const operation: ActiveAuthorization = {
      public: {
        id: randomUUID(),
        ...(command.connectionId ? { connectionId: command.connectionId } : {}),
        status: 'failed',
        cause: 'Authorization has not started.',
      },
      name,
      deviceCode: '',
      intervalMs: 0,
      timer: null,
    }
    authorizationOperations.set(operation.public.id, operation)
    await restartAuthorization(operation)
    return {
      ok: true,
      result: { type: 'authorization-started', operationId: operation.public.id },
    }
  }

  async function retryAuthorization(
    command: Extract<Command, { type: 'retry-github-authorization' }>,
  ): Promise<CommandResolution> {
    const operation = authorizationOperations.get(command.operationId)
    if (!operation) return invalid('operationId', 'Authorization operation does not exist.')
    if (operation.public.status === 'waiting') {
      return invalid('operationId', 'Authorization is already in progress.')
    }
    await restartAuthorization(operation)
    return {
      ok: true,
      result: { type: 'authorization-started', operationId: operation.public.id },
    }
  }

  async function restartAuthorization(operation: ActiveAuthorization): Promise<void> {
    if (!options.github) return
    if (operation.timer) clearTimeout(operation.timer)
    operation.timer = null
    try {
      const device = await options.github.beginDeviceAuthorization()
      operation.deviceCode = device.deviceCode
      operation.intervalMs = device.intervalMs
      operation.public = {
        id: operation.public.id,
        ...(operation.public.connectionId ? { connectionId: operation.public.connectionId } : {}),
        status: 'waiting',
        verificationUri: device.verificationUri,
        userCode: device.userCode,
        expiresAt: device.expiresAt,
      }
      publish()
      scheduleAuthorizationPoll(operation)
    } catch (error) {
      finishAuthorization(operation, 'failed', safeAuthorizationMessage(error))
    }
  }

  function scheduleAuthorizationPoll(operation: ActiveAuthorization): void {
    if (stopped || operation.public.status !== 'waiting') return
    operation.timer = setTimeout(() => {
      operation.timer = null
      void pollAuthorization(operation.public.id)
    }, operation.intervalMs)
  }

  async function pollAuthorization(operationId: string): Promise<void> {
    const operation = authorizationOperations.get(operationId)
    if (operation?.public.status !== 'waiting' || !options.github) return
    if ((operation.public.expiresAt ?? 0) <= now()) {
      finishAuthorization(operation, 'expired', 'GitHub authorization expired.')
      return
    }
    try {
      const result = await options.github.pollDeviceAuthorization(operation.deviceCode)
      await enqueue(async () => {
        if (stopped || operation.public.status !== 'waiting') return
        switch (result.status) {
          case 'pending':
            scheduleAuthorizationPoll(operation)
            return
          case 'slow-down':
            operation.intervalMs += SLOW_DOWN_MS
            scheduleAuthorizationPoll(operation)
            return
          case 'denied':
            finishAuthorization(operation, 'denied', 'GitHub authorization was denied.')
            return
          case 'expired':
            finishAuthorization(operation, 'expired', 'GitHub authorization expired.')
            return
          case 'granted':
            await completeAuthorization(operation, result.credentials)
        }
      })
    } catch (error) {
      await enqueue(async () => {
        if (operation.public.status === 'waiting') {
          finishAuthorization(operation, 'failed', safeAuthorizationMessage(error))
        }
      })
    }
  }

  async function completeAuthorization(
    operation: ActiveAuthorization,
    credentials: CredentialBundle,
  ): Promise<void> {
    const identity = await identifyAuthorization(operation, credentials)
    if (!identity || !options.credentialVault) return
    if (!authorizationIdentityIsValid(operation, identity)) return

    const update = configurationWithAuthorizedConnection(operation, identity)
    if (!(await stageCredentials(operation, update.connectionId, credentials))) return

    const outcome = await persistConfiguration(update.configuration)
    if (!outcome.ok) {
      if (!update.reauthorizing) await discardStagedCredentials(update.connectionId)
      finishAuthorization(operation, 'failed', outcome.error.message)
      return
    }
    operation.public = {
      id: operation.public.id,
      connectionId: update.connectionId,
      status: 'granted',
    }
    publish()
  }

  function configurationWithAuthorizedConnection(
    operation: ActiveAuthorization,
    identity: GitHubConnectionIdentity,
  ): {
    configuration: RoadmapConfiguration
    connectionId: string
    reauthorizing: boolean
  } {
    const existingId = operation.public.connectionId
    const existing = existingId
      ? configuration.connections.find((connection) => connection.id === existingId)
      : undefined
    const connectionId = existingId ?? randomUUID()
    const nextConnection = {
      id: connectionId,
      integration: 'github' as const,
      name: existing?.name ?? operation.name,
      builtIn: false,
      githubIdentity: identity,
    }
    return {
      configuration: {
        ...configuration,
        connections: existing
          ? configuration.connections.map((connection) =>
              connection.id === connectionId ? nextConnection : connection,
            )
          : [...configuration.connections, nextConnection],
      },
      connectionId,
      reauthorizing: existing !== undefined,
    }
  }

  async function identifyAuthorization(
    operation: ActiveAuthorization,
    credentials: CredentialBundle,
  ): Promise<GitHubConnectionIdentity | null> {
    if (!options.github) return null
    try {
      return await options.github.identify(credentials.accessToken)
    } catch (error) {
      finishAuthorization(operation, 'failed', safeAuthorizationMessage(error))
      return null
    }
  }

  function authorizationIdentityIsValid(
    operation: ActiveAuthorization,
    identity: GitHubConnectionIdentity,
  ): boolean {
    const existingId = operation.public.connectionId
    const existing = existingId
      ? configuration.connections.find((connection) => connection.id === existingId)
      : undefined
    if (existingId && existing?.integration !== 'github') {
      finishAuthorization(operation, 'failed', 'GitHub Connection no longer exists.')
      return false
    }
    if (existing?.githubIdentity?.id !== undefined && existing.githubIdentity.id !== identity.id) {
      finishAuthorization(
        operation,
        'failed',
        `Authorize the same GitHub user (${existing.githubIdentity.login}) to repair this Connection.`,
      )
      return false
    }
    const duplicate = configuration.connections.some(
      (connection) =>
        connection.integration === 'github' &&
        connection.githubIdentity?.id === identity.id &&
        connection.id !== existingId,
    )
    if (!duplicate) return true
    finishAuthorization(
      operation,
      'failed',
      `GitHub user ${identity.login} already has a Connection.`,
    )
    return false
  }

  async function stageCredentials(
    operation: ActiveAuthorization,
    connectionId: string,
    credentials: CredentialBundle,
  ): Promise<boolean> {
    if (!options.credentialVault) return false
    try {
      await options.credentialVault.write(connectionId, credentials)
    } catch {
      finishAuthorization(operation, 'failed', 'GitHub authorization could not be saved.')
      return false
    }
    credentialBundles.set(connectionId, credentials)
    setAvailability(connectionId, { status: 'available', observedAt: now() })
    return true
  }

  async function discardStagedCredentials(connectionId: string): Promise<void> {
    credentialBundles.delete(connectionId)
    connectionAvailability.delete(connectionId)
    try {
      await options.credentialVault?.delete(connectionId)
    } catch {
      // Startup orphan cleanup retries this app-owned record.
    }
  }

  function cancelAuthorization(
    command: Extract<Command, { type: 'cancel-github-authorization' }>,
  ): CommandResolution {
    const operation = authorizationOperations.get(command.operationId)
    if (!operation) return invalid('operationId', 'Authorization operation does not exist.')
    if (operation.public.status !== 'waiting') {
      return invalid('operationId', 'Authorization operation is not waiting.')
    }
    finishAuthorization(operation, 'cancelled', 'GitHub authorization was cancelled.')
    return {
      ok: true,
      result: { type: 'authorization-cancelled', operationId: operation.public.id },
    }
  }

  function finishAuthorization(
    operation: ActiveAuthorization,
    status: Exclude<AuthorizationOperation['status'], 'waiting' | 'granted'>,
    cause: string,
  ): void {
    if (operation.timer) clearTimeout(operation.timer)
    operation.timer = null
    operation.deviceCode = ''
    operation.public = {
      id: operation.public.id,
      ...(operation.public.connectionId ? { connectionId: operation.public.connectionId } : {}),
      status,
      cause,
    }
    publish()
  }

  function receiveConfiguration(result: ConfigurationRead): void {
    void enqueue(() => applyConfigurationUpdate(result))
  }

  async function applyConfigurationUpdate(result: ConfigurationRead): Promise<void> {
    if (stopped) return
    if (!result.ok) {
      configurationStatus = { valid: false, issues: result.issues, notices: [] }
      publish()
      return
    }
    if (result.document.configurationVersion === ownWriteVersion) {
      ownWriteVersion = null
      return
    }
    if (compareConfigurations(configuration, result.document) === 'same') {
      configurationStatus = { valid: true, issues: [], notices: result.notices ?? [] }
      publish()
      return
    }
    if (result.document.configurationVersion <= configuration.configurationVersion) {
      rejectStaleConfiguration()
      return
    }

    configurationStatus = { valid: true, issues: [], notices: result.notices ?? [] }
    await synchronizeCredentials(result.document)
    await installGeneration(result.document)
    await disableInterruptedProjects()
    await cleanupOrphanCredentials(result.document)
  }

  function rejectStaleConfiguration(): void {
    configurationStatus = {
      valid: false,
      issues: [
        {
          path: '$.configurationVersion',
          message: `Must be greater than ${configuration.configurationVersion} for a semantic edit.`,
        },
      ],
      notices: [],
    }
    publish()
  }

  async function start(): Promise<void> {
    if (startPromise) return startPromise
    startPromise = (async () => {
      if (stopped) throw new Error('RoadmapApplication cannot restart after stop().')
      const loaded = await options.configuration.load()
      if (loaded.ok) {
        configuration = loaded.document
        configurationStatus = { valid: true, issues: [], notices: loaded.notices ?? [] }
      } else configurationStatus = { valid: false, issues: loaded.issues, notices: [] }
      unsubscribeConfiguration = options.configuration.subscribe(receiveConfiguration)
      await cleanupOrphanCredentials(configuration)
      await synchronizeCredentials(configuration)
      await installGeneration(configuration)
      await automationLoop?.start()
      await mutationLane
      started = true
    })()
    return startPromise
  }

  async function query(query: Query): Promise<QueryResult> {
    if (!started || stopped) return failedQuery('not-supported', 'Roadmap is not running.')
    if (!options.operations) return failedQuery('not-supported', 'This query is not available yet.')
    return options.operations.query(query, state)
  }

  function execute(command: Command): Promise<CommandOutcome> {
    return enqueue(() => executeCommand(command))
  }

  async function executeCommand(command: Command): Promise<CommandOutcome> {
    if (!started || stopping || stopped) return failure('not-supported', 'Roadmap is not running.')
    if (!configurationStatus.valid) {
      return failure(
        'configuration-invalid',
        'roadmap.config.json is invalid; repair it before making in-app changes.',
      )
    }
    if (command.expectedConfigurationVersion !== configuration.configurationVersion) {
      return failure(
        'conflict',
        `Configuration changed to version ${configuration.configurationVersion}; retry from current state.`,
      )
    }

    const resolved = await resolveCommand(command)
    if (!resolved.ok) return { ok: false, error: resolved.error, state }
    if ('result' in resolved) return { ok: true, result: resolved.result, state }

    const outcome = await persistConfiguration(resolved.configuration)
    return finalizePersistedCommand(command, outcome)
  }

  async function finalizePersistedCommand(
    command: Command,
    outcome: CommandOutcome,
  ): Promise<CommandOutcome> {
    if (!outcome.ok || command.type !== 'remove-connection') return outcome
    credentialBundles.delete(command.connectionId)
    connectionAvailability.delete(command.connectionId)
    try {
      await options.credentialVault?.delete(command.connectionId)
    } catch {
      configurationStatus = {
        ...configurationStatus,
        notices: [
          ...configurationStatus.notices,
          'The removed Connection credential will be cleaned from Keychain on next startup.',
        ],
      }
      publish()
    }
    return outcome
  }

  async function persistConfiguration(candidate: RoadmapConfiguration): Promise<CommandOutcome> {
    const decoded = roadmapConfigurationCodec.decode({
      ...candidate,
      configurationVersion: configuration.configurationVersion + 1,
    })
    if (!decoded.ok) {
      return {
        ok: false,
        error: {
          code: 'validation',
          message: decoded.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' '),
        },
        state,
      }
    }

    ownWriteVersion = decoded.value.configurationVersion
    const persisted = await options.configuration.write(decoded.value)
    if (!persisted.ok) {
      ownWriteVersion = null
      return failure(
        persisted.kind === 'conflict' ? 'conflict' : 'persistence-failed',
        persisted.message,
      )
    }
    configurationStatus = { valid: true, issues: [], notices: [] }
    await installGeneration(decoded.value)
    return {
      ok: true,
      result: {
        type: 'configuration-updated',
        configurationVersion: decoded.value.configurationVersion,
      },
      state,
    }
  }

  type CommandResolution =
    | { ok: true; result: CommandResult }
    | { ok: true; configuration: RoadmapConfiguration }
    | { ok: false; error: SafeError }

  async function resolveCommand(command: Command): Promise<CommandResolution> {
    switch (command.type) {
      case 'begin-github-authorization':
        return beginAuthorization(command)
      case 'cancel-github-authorization':
        return cancelAuthorization(command)
      case 'retry-github-authorization':
        return retryAuthorization(command)
      case 'rename-connection':
        return renameConnection(command)
      case 'remove-connection':
        return removeConnection(command)
      case 'register-project':
        return registerProject(command)
      case 'rename-project':
        return renameProject(command)
      case 'repair-project-workspace':
        return repairProjectWorkspace(command)
      case 'remove-project':
        return removeProject(command)
      case 'set-automation-enabled':
        return setAutomationEnabled(command)
      case 'set-project-automation-enabled':
        return setProjectAutomationEnabled(command)
      case 'start-automation-override':
        return startAutomationOverride(command)
      default:
        if (!options.operations) return unsupported('This operation is not available yet.')
        return options.operations.execute(command, state)
    }
  }

  async function startAutomationOverride(
    command: Extract<Command, { type: 'start-automation-override' }>,
  ): Promise<CommandResolution> {
    if (!automationLoop) return unsupported('Automation is not available.')
    const outcome = await automationLoop.startOverride(command.target, command.stage)
    if (!outcome.ok) return outcome
    return {
      ok: true,
      result: {
        type: 'automation-override-started',
        target: command.target,
        stage: command.stage,
      },
    }
  }

  function renameConnection(
    command: Extract<Command, { type: 'rename-connection' }>,
  ): CommandResolution {
    const name = command.name.trim()
    if (!name) return invalid('name', 'Connection name cannot be empty.')
    const found = configuration.connections.some(
      (connection) => connection.id === command.connectionId,
    )
    if (!found) return invalid('connectionId', 'Connection does not exist.')
    return {
      ok: true,
      configuration: {
        ...configuration,
        connections: configuration.connections.map((connection) =>
          connection.id === command.connectionId ? { ...connection, name } : connection,
        ),
      },
    }
  }

  function removeConnection(
    command: Extract<Command, { type: 'remove-connection' }>,
  ): CommandResolution {
    const connection = configuration.connections.find(
      (candidate) => candidate.id === command.connectionId,
    )
    if (!connection) return invalid('connectionId', 'Connection does not exist.')
    if (connection.builtIn)
      return invalid('connectionId', 'The built-in Connection cannot be removed.')
    const dependents = configuration.projects.filter(
      (project) => project.connectionId === command.connectionId,
    )
    if (dependents.length > 0) {
      return {
        ok: false,
        error: {
          code: 'dependency',
          message: 'Remove every dependent Project before removing this Connection.',
          dependentProjects: dependents.map((project) => project.key),
        },
      }
    }
    return {
      ok: true,
      configuration: {
        ...configuration,
        connections: configuration.connections.filter(
          (candidate) => candidate.id !== command.connectionId,
        ),
      },
    }
  }

  async function registerProject(
    command: Extract<Command, { type: 'register-project' }>,
  ): Promise<CommandResolution> {
    if (!options.admission) return unsupported('Project admission is not available yet.')
    const admitted = await options.admission.admit(command.candidate, configuration, {
      accessToken: ensureAccessToken,
    })
    if (!admitted.ok) return admitted
    return {
      ok: true,
      configuration: {
        ...configuration,
        projects: [...configuration.projects, admitted.registration],
      },
    }
  }

  function renameProject(command: Extract<Command, { type: 'rename-project' }>): CommandResolution {
    const name = command.name.trim()
    if (!name) return invalid('name', 'Project name cannot be empty.')
    if (!hasProject(configuration, command.project)) {
      return invalid('project', 'Project does not exist.')
    }
    return {
      ok: true,
      configuration: {
        ...configuration,
        projects: configuration.projects.map((project) =>
          sameProject(project.key, command.project) ? { ...project, displayName: name } : project,
        ),
      },
    }
  }

  async function repairProjectWorkspace(
    command: Extract<Command, { type: 'repair-project-workspace' }>,
  ): Promise<CommandResolution> {
    if (!options.admission) return unsupported('Workspace repair is not available yet.')
    const projected = state.projects.find((project) => sameProject(project.key, command.project))
    if (!projected) return invalid('project', 'Project does not exist.')
    if (projected.availability.status !== 'unavailable') {
      return invalid(
        'project',
        'Workspace repair is available only while the Project is unavailable.',
      )
    }
    const repaired = await options.admission.repair(command, configuration, {
      accessToken: ensureAccessToken,
    })
    if (!repaired.ok) return repaired
    return {
      ok: true,
      configuration: {
        ...configuration,
        projects: configuration.projects.map((project) => {
          if (!sameProject(project.key, command.project)) return project
          return project.locator.integration === 'local'
            ? {
                ...project,
                locator: { integration: 'local' as const, path: repaired.workspace.path },
                workspace: repaired.workspace,
              }
            : { ...project, workspace: repaired.workspace }
        }),
      },
    }
  }

  function removeProject(command: Extract<Command, { type: 'remove-project' }>): CommandResolution {
    if (!hasProject(configuration, command.project)) {
      return invalid('project', 'Project does not exist.')
    }
    return {
      ok: true,
      configuration: {
        ...configuration,
        projects: configuration.projects.filter(
          (project) => !sameProject(project.key, command.project),
        ),
        automation: {
          ...configuration.automation,
          enabledProjects: configuration.automation.enabledProjects.filter(
            (project) => !sameProject(project, command.project),
          ),
        },
      },
    }
  }

  function setAutomationEnabled(
    command: Extract<Command, { type: 'set-automation-enabled' }>,
  ): CommandResolution {
    const availability = automationAvailability()
    if (command.enabled && availability.status === 'unavailable') {
      return invalid('enabled', availability.cause)
    }
    return {
      ok: true,
      configuration: {
        ...configuration,
        automation: { ...configuration.automation, enabled: command.enabled },
      },
    }
  }

  async function setProjectAutomationEnabled(
    command: Extract<Command, { type: 'set-project-automation-enabled' }>,
  ): Promise<CommandResolution> {
    if (!hasProject(configuration, command.project)) {
      return invalid('project', 'Project does not exist.')
    }
    if (command.enabled && automationLoop) {
      const acknowledged = await automationLoop.acknowledgeProjectInterruption(command.project)
      if (!acknowledged.ok) return acknowledged
    }
    const retained = configuration.automation.enabledProjects.filter(
      (project) => !sameProject(project, command.project),
    )
    return {
      ok: true,
      configuration: {
        ...configuration,
        automation: {
          ...configuration.automation,
          enabledProjects: command.enabled ? [...retained, command.project] : retained,
        },
      },
    }
  }

  function failure(code: SafeError['code'], message: string): CommandOutcome {
    return { ok: false, error: { code, message }, state }
  }

  return {
    start,
    current: () => state,
    subscribe(listener) {
      listeners.add(listener)
      if (started) listener(state)
      return () => listeners.delete(listener)
    },
    query,
    execute,
    stop() {
      if (stopPromise) return stopPromise
      stopping = true
      stopPromise = (async () => {
        nextGeneration += 1
        for (const operation of authorizationOperations.values()) {
          if (operation.timer) clearTimeout(operation.timer)
          operation.timer = null
        }
        unsubscribeConfiguration?.()
        await automationLoop?.stop()
        await mutationLane
        stopped = true
        active?.unsubscribe()
        await active?.store.stop()
        await options.configuration.stop()
      })()
      return stopPromise
    },
  }
}

function projectEvidenceCause(
  project: ObservationAttempt | undefined,
  membership: ObservationAttempt | undefined,
  complete: boolean,
): string {
  if (project?.kind === 'failed') return sourceFailureMessage(project.failure)
  if (membership?.kind === 'failed') return sourceFailureMessage(membership.failure)
  if (project?.kind !== 'observed' || membership?.kind !== 'observed')
    return 'Project has no current successful source observation.'
  return complete ? '' : 'Project source ordering or active map evidence is incomplete.'
}

function projectTrace(
  project: ProjectKey,
  metadata: ReturnType<typeof observedProject>,
  maps: WayfinderMap[],
  openMaps: WayfinderMap[],
  emptyMembership: boolean,
): Project {
  const details = metadata?.value
  const warnings = [...(details?.warnings ?? [])]
  if (emptyMembership) warnings.push('No maps found for this project.')
  return {
    key: project,
    name: details?.name ?? project.id,
    openMaps,
    closedMaps: maps
      .filter((map) => !map.isOpen)
      .sort(
        (a, b) =>
          (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt) || a.id.localeCompare(b.id),
      ),
    warnings,
    ...(details?.source.integration === 'local' ? { sourcePath: details.source.path } : {}),
    ...(details?.source.integration === 'github' ? { sourceUrl: details.source.url } : {}),
  }
}

type ObservedSource = Extract<ObservationAttempt, { kind: 'observed' }>

function isObservedScope<K extends SourceScope['kind']>(
  attempt: ObservationAttempt | undefined,
  kind: K,
): attempt is Extract<ObservedSource, { scope: { kind: K } }> {
  return attempt?.kind === 'observed' && attempt.scope.kind === kind
}

function observedProject(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'project') ? attempt : undefined
}

function observedMaps(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'maps-membership') ? attempt : undefined
}

function observedMap(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'map') ? attempt : undefined
}

function observedTickets(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'tickets-membership') ? attempt : undefined
}

function observedTicket(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'ticket') ? attempt : undefined
}

function sourceProject(scope: SourceScope): ProjectKey {
  switch (scope.kind) {
    case 'project':
    case 'maps-membership':
      return scope.project
    case 'map':
    case 'tickets-membership':
      return scope.map.project
    case 'ticket':
      return scope.ticket.map.project
  }
}

function sameSourceMap(a: SourceMapKey, b: SourceMapKey): boolean {
  return sameProject(a.project, b.project) && a.mapId === b.mapId
}

function mergeMembers<T>(
  previous: readonly T[],
  next: readonly T[],
  complete: boolean,
  identity: (member: T) => string,
): readonly T[] {
  if (complete) return next
  const members = new Map(previous.map((member) => [identity(member), member]))
  for (const member of next) members.set(identity(member), member)
  return [...members.values()]
}

function orderCurrentMaps(maps: WayfinderMap[], order: readonly string[]): WayfinderMap[] {
  const positions = new Map(order.map((id, index) => [id, index]))
  return maps.sort(
    (a, b) =>
      (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )
}

function projectBlocker(blocker: SourceBlocker): Blocker {
  const { ticketId, ...reference } = blocker.reference
  return {
    reference,
    ticketId,
    state: blocker.state,
    ...(blocker.displayId === undefined ? {} : { displayId: blocker.displayId }),
    ...(blocker.title === undefined ? {} : { title: blocker.title }),
    ...(blocker.url === undefined ? {} : { url: blocker.url }),
  }
}

function projectTicket(ticket: SourceTicketContent, current: boolean): Ticket {
  const blockedBy = ticket.blockedBy.map(projectBlocker)
  const blockersComplete = current && ticket.status !== 'unknown' && ticket.blockersComplete
  const isBlocked = !blockersComplete || blockedBy.some((blocker) => blocker.state !== 'closed')
  const state =
    ticket.status === 'closed'
      ? 'closed'
      : isBlocked
        ? 'blocked'
        : ticket.isClaimed
          ? 'claimed'
          : 'frontier'
  const typeEvidence: Ticket['typeEvidence'] =
    ticket.typeEvidence.kind === 'missing'
      ? { kind: 'missing', labels: [] }
      : ticket.typeEvidence.kind === 'recognized'
        ? {
            kind: 'recognized',
            value: ticket.typeEvidence.value,
            labels: [...ticket.typeEvidence.labels],
          }
        : { kind: ticket.typeEvidence.kind, labels: [...ticket.typeEvidence.labels] }
  return {
    id: ticket.key.ticketId,
    ...(ticket.displayId === undefined ? {} : { displayId: ticket.displayId }),
    ...(ticket.title === undefined ? {} : { title: ticket.title }),
    ...(ticket.source.kind === 'issue'
      ? { url: ticket.source.url }
      : { sourcePath: ticket.source.path }),
    body: ticket.body,
    typeEvidence,
    state,
    isClaimed: ticket.isClaimed,
    isBlocked,
    ...(ticket.createdAt === undefined ? {} : { createdAt: ticket.createdAt }),
    ...(ticket.closedAt === undefined ? {} : { closedAt: ticket.closedAt }),
    assignees: ticket.assignees.map((assignee) => ({ ...assignee })),
    blockedBy,
    blockersComplete,
    warnings: [...ticket.warnings],
  }
}

function projectMap(map: SourceMapContent, tickets: Ticket[], current: boolean): WayfinderMap {
  return {
    project: map.key.project,
    id: map.key.mapId,
    ...(map.displayId === undefined ? {} : { displayId: map.displayId }),
    ...(map.title === undefined ? {} : { title: map.title }),
    ...(map.source.kind === 'issue' ? { url: map.source.url } : { sourcePath: map.source.path }),
    isOpen: map.status !== 'closed',
    updatedAt: map.updatedAt,
    ...(map.closedAt === undefined ? {} : { closedAt: map.closedAt }),
    body: {
      ...map.body,
      notes: [...map.body.notes],
      decisions: map.body.decisions.map((decision) => ({ ...decision })),
      notYetSpecified: [...map.body.notYetSpecified],
      outOfScope: [...map.body.outOfScope],
      sections: map.body.sections.map((section) => ({ ...section, items: [...section.items] })),
      missingSections: [...map.body.missingSections],
    },
    tickets,
    frontier: current ? tickets.filter((ticket) => ticket.state === 'frontier') : [],
    progress: map.progress === null ? null : { ...map.progress },
    ticketsComplete: current,
    warnings: [...map.warnings, ...map.unidentifiedTickets.flatMap((ticket) => ticket.warnings)],
  }
}

function sourceFailureMessage(failure: SourceFailure): string {
  switch (failure.kind) {
    case 'filesystem':
      if (failure.operation === 'inspect-root')
        return failure.code === 'EACCES'
          ? 'Workspace read permission was denied.'
          : 'Workspace cannot be read.'
      return failure.code === 'ENOENT'
        ? 'Source path is currently missing.'
        : failure.code === 'EACCES'
          ? 'Source read permission was denied.'
          : 'Source path cannot be read.'
    case 'transient':
      return failure.cause === 'rate-limit'
        ? 'GitHub rate limit prevents this read.'
        : 'GitHub is temporarily unreachable.'
    case 'execution':
      return 'GitHub could not execute this source read.'
    case 'read':
      return failure.cause === 'response-read'
        ? 'GitHub response could not be read.'
        : 'Source response is malformed.'
    case 'authorization':
      return 'GitHub authorization is required.'
    case 'access-ambiguous':
      return 'GitHub source is inaccessible; absence is not proven.'
    case 'identity-mismatch':
      return 'GitHub repository identity does not match the admitted Project.'
  }
}

function semanticFingerprint(state: ApplicationState): string {
  return JSON.stringify({
    configurationVersion: state.configurationVersion,
    supportedIntegrations: state.supportedIntegrations,
    connections: state.connections,
    registrations: state.registrations,
    projects: state.projects,
    authorizationOperations: state.authorizationOperations,
    configuration: state.configuration,
    automation: state.automation,
    roadmap: { projects: state.roadmap.projects, unreachable: state.roadmap.unreachable },
  })
}

function compareConfigurations(
  current: RoadmapConfiguration,
  candidate: RoadmapConfiguration,
): 'same' | 'different' {
  const withoutVersion = (value: RoadmapConfiguration) => ({
    schemaVersion: value.schemaVersion,
    connections: value.connections,
    projects: value.projects,
    automation: value.automation,
  })
  return JSON.stringify(withoutVersion(current)) === JSON.stringify(withoutVersion(candidate))
    ? 'same'
    : 'different'
}

function projectActions(registration: RoadmapConfiguration['projects'][number], known?: Project) {
  const roadmapHref = `/projects/${registration.key.integration}/${encodeURIComponent(registration.key.id)}`
  const actions: RegisteredProject['actions'] = [
    { id: 'open-roadmap', label: 'Open in Roadmap', kind: 'roadmap', href: roadmapHref },
    { id: 'open-workspace', label: 'Open in VS Code', kind: 'server-launch' },
    { id: 'open-terminal', label: 'Open Terminal', kind: 'server-launch' },
  ]
  actions.push({ id: 'reveal-source', label: 'View source folder', kind: 'server-launch' })
  if (registration.locator.integration === 'github') {
    actions.push({
      id: 'open-source',
      label: 'Open on GitHub',
      kind: 'external-link',
      href: known?.sourceUrl ?? `https://github.com/${registration.locator.nameWithOwner}`,
    })
  }
  return actions
}

function hasProject(configuration: RoadmapConfiguration, key: ProjectKey): boolean {
  return configuration.projects.some((project) => sameProject(project.key, key))
}

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}

function projectKey(project: ProjectKey): string {
  return `${project.integration}:${project.id}`
}

function invalid(field: string, message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'validation', field, message } }
}

function unsupported(message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'not-supported', message } }
}

function failedQuery(code: SafeError['code'], message: string): QueryResult {
  return { ok: false, error: { code, message } }
}

function safeAuthorizationMessage(error: unknown): string {
  return error instanceof GitHubConnectionError || error instanceof CredentialVaultError
    ? error.message
    : 'GitHub authorization is temporarily unavailable.'
}
