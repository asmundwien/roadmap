import {
  authorizationOperationIdSchema,
  type ConfigurationVersion,
  configurationVersionSchema,
  connectionIdSchema,
  type ProjectRef as PublicProjectRef,
  projectRefSchema,
  stateSequenceSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import {
  type Command,
  type CommandOutcomeFor,
  type CommandResult,
  commandSubject,
  parseCommandOutcomeFor,
  type Query,
  type QueryResult,
  queryResultSchema,
  type SafeError,
} from '@roadmap/contracts/operations'
import {
  type ApplicationState,
  applicationStateSchema,
  type ReadyApplicationState,
  type SupportedIntegration,
} from '@roadmap/contracts/state'
import type { AuthorizationFact, GitHubConnectionIdentity } from '../authorization/contracts.ts'
import {
  type CredentialBundle,
  type CredentialVault,
  CredentialVaultError,
  GitHubConnectionError,
  type GitHubConnectionPort,
} from '../authorization/contracts.ts'
import type { AutomationDatabaseDocument } from '../automation/database.ts'
import {
  type AutomationEngine,
  type AutomationLauncher,
  createAutomationEngine,
} from '../automation/engine.ts'
import type { AutomationFailure } from '../automation/model.ts'
import { type ChangeEvent, type ChangeFeedInput, createChangeFeed } from '../change-feed.ts'
import {
  type ConfigurationDocument,
  type ConfigurationRead,
  type ConfigurationWrite,
  decodeConfigurationDocument,
} from '../configuration/document.ts'
import {
  type AuthorizationUsability,
  type CommittedObservation,
  createObservationCoordinator,
  type SourceObserverFactories,
} from '../observation/coordinator.ts'
import type { SourceProjectKey as ProjectKey } from '../observation/source.ts'
import {
  type AdmissionFailure,
  type ConfiguredConnection,
  createProjectRegistry,
  GitHubAccessError,
  type GitHubAccessFailure,
  type GitHubConnection,
  type GitHubConnectionAccess,
  type GitHubProviderRead,
  type ProjectAdmission,
  type ProjectConfiguration,
  type ProjectRef,
  type RegistryMutation,
} from '../projects/registry.ts'
import { ResourceCatalog } from '../resources/catalog.ts'
import { type ApplicationOperations, translateRefreshOutcome } from './operations.ts'
import { projectApplicationState, projectResourceCounts } from './projection.ts'

type ApplicationLifecycle =
  | { readonly phase: 'idle' | 'starting' | 'stopping' | 'stopped' }
  | { readonly phase: 'ready'; readonly mode: 'mutable' | 'read-only' }
  | { readonly phase: 'failed'; readonly cause: string }

interface ApplicationDiagnostics extends Readonly<ReturnType<typeof projectResourceCounts>> {
  readonly lifecycle: ApplicationLifecycle
}

export interface RoadmapApplication {
  start(): Promise<void>
  current(): ApplicationState
  diagnostics(): ApplicationDiagnostics
  subscribe(listener: (state: ApplicationState) => void): () => void
  query(query: Query): Promise<QueryResult>
  execute<C extends Command>(command: C): Promise<CommandOutcomeFor<C>>
  stop(): Promise<void>
}
export interface RoadmapApplicationOptions {
  configuration: ConfigurationDocument
  observers: SourceObserverFactories
  admissions: Partial<Record<'local' | 'github', ProjectAdmission>>
  providerRead?: (accessToken: () => Promise<string>) => GitHubProviderRead
  supportedIntegrations?: readonly SupportedIntegration[]
  credentialVault?: CredentialVault
  github?: GitHubConnectionPort
  operations?: ApplicationOperations
  onChangeEvents?: (events: ChangeEvent[]) => void
  serverEpoch?: string
  now?: () => number
  automation?: { database: AutomationDatabaseDocument; launcher: AutomationLauncher }
}
const REFRESH_LEEWAY_MS = 5 * 60_000
const SLOW_DOWN_MS = 5_000
const EMPTY_CONFIGURATION: ProjectConfiguration = {
  schemaVersion: 6,
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
interface ActiveAuthorization {
  fact: AuthorizationFact
  attempt: symbol | null
  requestedAccountId: string | null
  name: string
  deviceCode: string
  intervalMs: number
  timer: ReturnType<typeof setTimeout> | null
}

export function createRoadmapApplication(options: RoadmapApplicationOptions): RoadmapApplication {
  const now = options.now ?? Date.now
  const serverEpoch = options.serverEpoch ?? crypto.randomUUID()
  const supportedIntegrations = [
    ...(options.supportedIntegrations ?? [LOCAL_INTEGRATION]),
    ...(options.supportedIntegrations || !options.github ? [] : [options.github.integration]),
  ]
  const listeners = new Set<(state: ApplicationState) => void>()
  const authorizationOwners = new Map<string, string>()
  const credentialBundles = new Map<string, CredentialBundle>()
  const validatedAccounts = new Map<string, string>()
  const rejectedAuthorizations = new Map<
    string,
    { accountId: string; failure: 'rejected-credential' | 'account-mismatch' }
  >()
  const authorizationUsability = new Map<string, AuthorizationUsability>()
  const providerAccess = new Map<string, GitHubConnectionAccess>()
  const refreshes = new Map<string, { credentials: CredentialBundle; result: Promise<string> }>()
  const authorizationOperations = new Map<string, ActiveAuthorization>()
  const coordinator = createObservationCoordinator({
    observers: options.observers,
    now,
    revalidateSources: (configuration, connectionIds) =>
      registry.prepare(configuration, configuration, { revalidateConnections: connectionIds }),
    scheduleRecovery: (recover) => enqueue(recover),
  })
  const registry = createProjectRegistry({
    admissions: options.admissions,
    runtime: { github: resolveGitHubAccess },
  })
  const catalog = new ResourceCatalog()
  const emptyCommitted: CommittedObservation = {
    registry: { ...EMPTY_CONFIGURATION, admissions: [] },
    observation: { committedAt: 0, attempts: [] },
    contributions: [],
    sourceBindings: new Map(),
    configurationValid: true,
    pendingAdmission: false,
    pendingConfigurations: [],
    admissionRevision: 0,
    authorizationUsability: new Map(),
    classification: { baselineProjects: [] },
  }
  let configurationStatus: ReadyApplicationState['configuration'] = {
    valid: true,
    issues: [],
    notices: [],
  }
  let receivedConfigurationValid = true
  let configurationDurabilityConfirmed = true
  const pendingConfigurations = new Map<number, ProjectConfiguration>()
  let configurationReceipt = 0
  let stateSequence = 0
  let lifecycle: ApplicationLifecycle = { phase: 'idle' }
  let stopPromise: Promise<void> | null = null
  let startPromise: Promise<void> | null = null
  let cleanupPromise: Promise<void> | null = null
  const tasks = new Set<Promise<unknown>>()
  let unsubscribeConfiguration: (() => void) | null = null
  let mutationLane: Promise<void> = Promise.resolve()
  let credentialMutationLane: Promise<void> = Promise.resolve()
  let ownWriteDocument: ProjectConfiguration | null = null
  let retainShutdownWrite:
    | ((document: ProjectConfiguration, persisted: ConfigurationWrite) => void)
    | null = null
  let lastBaselineRegistry: CommittedObservation['registry'] | null = null
  let observeNotifications: (input: ChangeFeedInput) => void = () => undefined
  const changeFeed = createChangeFeed({
    onChange(listener) {
      observeNotifications = listener
      return () => {
        observeNotifications = () => undefined
      }
    },
  })
  if (options.onChangeEvents) changeFeed.onEvent(options.onChangeEvents)
  const automationEngine: AutomationEngine | null = options.automation
    ? createAutomationEngine({
        database: options.automation.database,
        launcher: options.automation.launcher,
        resources: () => catalog.current(),
        onEvidenceChange() {
          if (!ownsEffects()) return
          publish()
          void enqueue(disableInterruptedProjects).catch(() => undefined)
        },
      })
    : null
  let retainedState: ReadyApplicationState | null = null
  let state = buildState()
  let stateFingerprint = semanticFingerprint(state)
  const unsubscribeObservation = coordinator.subscribe((committed) => {
    if (!ownsEffects()) return
    catalog.commit(committed)
    publish()
    automationEngine?.reconcile()
  })

  function currentConfiguration(): CommittedObservation['registry'] {
    return coordinator.current()?.registry ?? emptyCommitted.registry
  }
  function buildState(intent: ProjectConfiguration = currentConfiguration()): ApplicationState {
    const marker = { serverEpoch, stateSequence, capturedAt: now() }
    if (lifecycle.phase === 'idle' || lifecycle.phase === 'starting')
      return applicationStateSchema.parse({ ...marker, phase: lifecycle.phase })
    const resources = catalog.current() ?? { committed: emptyCommitted, projects: [] }
    const projection = () =>
      projectApplicationState({
        resources,
        intent,
        retainedConnections: retainedState?.connections ?? null,
        sourceLifetimeOwned: ownsEffects(),
        ...marker,
        mode: lifecycle.phase === 'ready' ? lifecycle.mode : (retainedState?.mode ?? 'read-only'),
        supportedIntegrations,
        authorizationOperations: ownsEffects()
          ? [...authorizationOperations.values()].map((operation) => ({ ...operation.fact }))
          : (retainedState?.authorizationOperations ?? []),
        configuration: configurationStatus,
        automation: automationState(intent),
      })
    if (lifecycle.phase === 'ready') return projection()
    return applicationStateSchema.parse({
      ...marker,
      phase: lifecycle.phase,
      ...(lifecycle.phase === 'failed' ? { cause: lifecycle.cause } : {}),
      retained: retainedState === null ? null : projection(),
    })
  }
  function automationState(configuration: ProjectConfiguration = currentConfiguration()) {
    return {
      enabled: configuration.automation.enabled,
      enabledProjects: [...configuration.automation.enabledProjects],
      availability: automationAvailability(configuration),
      evidence: automationEngine?.evidence() ?? [],
      overrides: ownsEffects() ? (automationEngine?.overrides() ?? []) : [],
    }
  }
  function automationAvailability(
    configuration: ProjectConfiguration,
  ): ReadyApplicationState['automation']['availability'] {
    if (!ownsEffects()) return { status: 'unavailable', cause: 'Roadmap is not running.' }
    if (
      !configurationStatus.valid ||
      !configurationDurabilityConfirmed ||
      pendingConfigurations.size > 0
    )
      return {
        status: 'unavailable',
        cause: !configurationDurabilityConfirmed
          ? 'Configuration durability is unconfirmed; Automation cannot launch.'
          : pendingConfigurations.size > 0
            ? 'An admission-affecting configuration update is pending.'
            : 'roadmap.config.json is invalid; repair it before enabling Automation.',
      }
    const policy = configuration.automation
    const missing = [
      policy.classificationCommand ? null : 'Classification Harness Command',
      policy.wayfinderCommand ? null : 'Wayfinder Session Command',
    ].filter((name): name is string => name !== null)
    return missing.length > 0
      ? {
          status: 'unavailable',
          cause: `Configure ${missing.join(' and ')} in roadmap.config.json.`,
        }
      : { status: 'ready' }
  }
  function publish(): void {
    if (lifecycle.phase !== 'ready') return
    const candidate = buildState()
    if (candidate.phase !== 'ready') return
    const committed = coordinator.current()
    const baselineProjects =
      committed && lastBaselineRegistry !== committed.registry
        ? committed.classification.baselineProjects
        : []
    if (committed && lifecycle.phase === 'ready') lastBaselineRegistry = committed.registry
    const fingerprint = semanticFingerprint(candidate)
    if (fingerprint !== stateFingerprint) {
      stateSequence += 1
      state = { ...candidate, stateSequence: stateSequenceSchema.parse(stateSequence) }
      stateFingerprint = fingerprint
      for (const listener of listeners) {
        if (lifecycle.phase !== 'ready') break
        listener(state)
      }
    }
    if (committed && lifecycle.phase === 'ready')
      observeNotifications({
        attempts: committed.observation.attempts,
        projects: candidate.projects.map((project) => ({
          key: { integration: project.ref.integration, id: project.ref.projectId },
          name: project.name,
        })),
        baselineProjects,
        order: candidate.projects.flatMap((project) =>
          [...project.displayOrder.open, ...project.displayOrder.closed].flatMap((mapId) => {
            const map = project.maps.find((resource) => resource.ref.mapId === mapId.mapId)
            return map
              ? [
                  {
                    map: {
                      project: { integration: project.ref.integration, id: project.ref.projectId },
                      mapId: map.ref.mapId,
                    },
                    tickets: map.tickets.map((ticket) => ticket.ref.ticketId),
                  },
                ]
              : []
          }),
        ),
      })
  }
  function updateAdmissionValidity(): void {
    if (lifecycle.phase === 'ready')
      lifecycle = {
        phase: 'ready',
        mode: receivedConfigurationValid ? 'mutable' : 'read-only',
      }
    coordinator.receiveConfigurationValidity(
      receivedConfigurationValid && configurationDurabilityConfirmed && ownsEffects(),
      pendingConfigurations.size > 0,
      [...pendingConfigurations.values()],
    )
    automationEngine?.reconcile()
  }
  function ownsEffects(): boolean {
    return lifecycle.phase === 'starting' || lifecycle.phase === 'ready'
  }
  function requireOwnership(): void {
    if (!ownsEffects()) throw new Error('RoadmapApplication ownership has been revoked.')
  }
  function ownTask<T>(operation: () => Promise<T>): Promise<T> {
    const task = Promise.resolve().then(operation)
    tasks.add(task)
    void task.then(
      () => tasks.delete(task),
      () => tasks.delete(task),
    )
    return task
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = mutationLane.then(operation, operation)
    mutationLane = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  function mutateCredentials<T>(operation: () => Promise<T>): Promise<T> {
    const run = credentialMutationLane.then(operation, operation)
    credentialMutationLane = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  async function disableInterruptedProjects(): Promise<void> {
    if (
      !ownsEffects() ||
      !automationEngine ||
      !configurationStatus.valid ||
      pendingConfigurations.size > 0 ||
      !configurationDurabilityConfirmed
    )
      return
    const next = configurationWithoutInterruptedProjects(currentConfiguration())
    if (next) await persistConfiguration(next)
  }
  function configurationWithoutInterruptedProjects(
    configuration: ProjectConfiguration,
  ): ProjectConfiguration | null {
    const interrupted = automationEngine?.interruptedProjects() ?? []
    const enabledProjects = configuration.automation.enabledProjects.filter(
      (project) => !interrupted.some((candidate) => sameProject(candidate, project)),
    )
    return enabledProjects.length === configuration.automation.enabledProjects.length
      ? null
      : { ...configuration, automation: { ...configuration.automation, enabledProjects } }
  }
  function authorizationFacts(
    configuration: ProjectConfiguration,
  ): ReadonlyMap<string, AuthorizationUsability> {
    const facts = new Map<string, AuthorizationUsability>()
    for (const connection of configuration.connections) {
      const usability = authorizationUsability.get(authorizationScopeKey(connection))
      if (usability) facts.set(connection.id, usability)
    }
    return facts
  }
  function publishAuthorizationFacts(): void {
    coordinator.updateAuthorizationUsability(authorizationFacts(currentConfiguration()))
  }
  function setUsability(scope: string, usability: AuthorizationUsability): void {
    authorizationUsability.set(scope, usability)
    publishAuthorizationFacts()
  }
  async function cleanupOrphanCredentials(configuration: ProjectConfiguration): Promise<void> {
    if (!options.credentialVault) return
    if (!ownsEffects()) return
    try {
      await options.credentialVault.cleanupOrphans(
        new Set(configuration.connections.map((connection) => connection.id)),
      )
      if (!ownsEffects()) return
    } catch (error) {
      if (!ownsEffects()) return
      const notice = safeAuthorizationMessage(error)
      if (!configurationStatus.notices.includes(notice))
        configurationStatus = {
          ...configurationStatus,
          notices: [...configurationStatus.notices, notice],
        }
    }
  }
  function forgetRemovedConnections(): void {
    const knownScopes = new Set(
      [currentConfiguration(), ...pendingConfigurations.values()].flatMap((configuration) =>
        configuration.connections.map(authorizationScopeKey),
      ),
    )
    for (const [scope] of authorizationOwners) {
      if (knownScopes.has(scope)) continue
      authorizationOwners.delete(scope)
      credentialBundles.delete(scope)
      validatedAccounts.delete(scope)
      providerAccess.delete(scope)
      authorizationUsability.delete(scope)
      rejectedAuthorizations.delete(scope)
    }
    publishAuthorizationFacts()
  }
  async function synchronizeCredentials(configuration: ProjectConfiguration): Promise<void> {
    for (const connection of configuration.connections) await synchronizeConnection(connection)
    requireOwnership()
  }
  async function synchronizeConnection(
    connection: ConfiguredConnection,
  ): Promise<GitHubAccessFailure | null> {
    const scope = authorizationScopeKey(connection)
    requireOwnership()
    authorizationOwners.set(scope, connection.id)
    if (connection.integration === 'local') {
      setUsability(scope, { status: 'usable' })
      return null
    }
    if (
      validatedAccounts.get(scope) === connection.githubIdentity.id &&
      credentialBundles.has(scope) &&
      authorizationUsability.get(scope)?.status === 'usable'
    )
      return null
    const rejected = rejectedAuthorizations.get(scope)
    if (rejected) {
      setUsability(scope, {
        status: 'authorization-required',
        cause: 'GitHub authorization must be renewed for this Connection.',
      })
      return rejected.failure
    }
    if (!options.github || !options.credentialVault) {
      setUsability(scope, {
        status: 'unavailable',
        cause: 'GitHub access is not configured.',
      })
      return 'unavailable'
    }
    try {
      const credentials =
        credentialBundles.get(scope) ?? (await options.credentialVault.read(connection.id))
      requireOwnership()
      if (!credentials || credentials.refreshTokenExpiresAt <= now())
        throw new GitHubAccessError('authorization-required')
      // A bundle already identified for another account cannot become this candidate's credential.
      for (const [knownScope, knownCredentials] of credentialBundles) {
        if (
          authorizationOwners.get(knownScope) === connection.id &&
          validatedAccounts.has(knownScope) &&
          validatedAccounts.get(knownScope) !== connection.githubIdentity.id &&
          knownCredentials.accessToken === credentials.accessToken &&
          knownCredentials.refreshToken === credentials.refreshToken
        )
          throw new GitHubAccessError('account-mismatch')
      }
      const token = await tokenFromCredentials(connection, credentials)
      requireOwnership()
      if (
        validatedAccounts.get(scope) === connection.githubIdentity.id &&
        credentialBundles.get(scope)?.accessToken === token
      )
        return null
      const identity = await options.github.identify(token)
      requireOwnership()
      if (identity.id !== connection.githubIdentity.id)
        throw new GitHubAccessError('account-mismatch')
      // Refresh may have installed a rotated bundle. Never restore its superseded predecessor.
      if (!credentialBundles.has(scope)) credentialBundles.set(scope, credentials)
      validatedAccounts.set(scope, identity.id)
      setUsability(scope, { status: 'usable' })
      return null
    } catch (error) {
      requireOwnership()
      const failure = classifyGitHubAccessFailure(error)
      if (failure === 'rejected-credential' || failure === 'account-mismatch')
        rejectedAuthorizations.set(scope, { accountId: connection.githubIdentity.id, failure })
      credentialBundles.delete(scope)
      validatedAccounts.delete(scope)
      providerAccess.delete(scope)
      applyCredentialFailure(connection, error)
      return failure
    }
  }
  async function resolveGitHubAccess(
    connection: GitHubConnection,
  ): Promise<GitHubConnectionAccess> {
    const failure = await synchronizeConnection(connection)
    requireOwnership()
    if (failure) throw new GitHubAccessError(failure)
    if (!options.providerRead) throw new GitHubAccessError('unavailable')
    const scope = authorizationScopeKey(connection)
    const existing = providerAccess.get(scope)
    if (existing) return existing
    const access: GitHubConnectionAccess = {
      connectionId: connection.id,
      accountId: connection.githubIdentity.id,
      access: options.providerRead(() => ensureAccessToken(connection)),
    }
    requireOwnership()
    providerAccess.set(scope, access)
    return access
  }
  async function ensureAccessToken(connection: GitHubConnection): Promise<string> {
    const scope = authorizationScopeKey(connection)
    requireOwnership()
    const credentials = credentialBundles.get(scope)
    if (
      !credentials ||
      validatedAccounts.get(scope) !== connection.githubIdentity.id ||
      authorizationUsability.get(scope)?.status === 'authorization-required'
    )
      throw new GitHubAccessError(
        rejectedAuthorizations.get(scope)?.failure ??
          (authorizationUsability.get(scope)?.status === 'authorization-required'
            ? 'authorization-required'
            : 'unavailable'),
      )
    return tokenFromCredentials(connection, credentials)
  }
  async function tokenFromCredentials(
    connection: GitHubConnection,
    credentials: CredentialBundle,
  ): Promise<string> {
    const scope = authorizationScopeKey(connection)
    requireOwnership()
    if (credentials.refreshTokenExpiresAt <= now()) {
      const error = new GitHubAccessError('authorization-required')
      applyCredentialFailure(connection, error)
      throw error
    }
    if (credentials.accessTokenExpiresAt > now() + REFRESH_LEEWAY_MS) return credentials.accessToken
    const activeRefresh = refreshes.get(scope)
    if (activeRefresh?.credentials === credentials) return activeRefresh.result
    const startingCredentials = credentialBundles.get(scope)
    const refresh = {
      credentials,
      result: ownTask(() => refreshAccessToken(connection, credentials, startingCredentials)),
    }
    refreshes.set(scope, refresh)
    try {
      return await refresh.result
    } finally {
      if (refreshes.get(scope) === refresh) refreshes.delete(scope)
    }
  }
  async function refreshAccessToken(
    connection: GitHubConnection,
    credentials: CredentialBundle,
    startingCredentials: CredentialBundle | undefined,
  ): Promise<string> {
    const { github, credentialVault } = options
    if (!github || !credentialVault) throw new GitHubAccessError('unavailable')
    requireOwnership()
    const scope = authorizationScopeKey(connection)
    if (credentialBundles.get(scope) !== startingCredentials) return ensureAccessToken(connection)
    try {
      const refreshed = await github.refresh(credentials.refreshToken)
      requireOwnership()
      if (credentialBundles.get(scope) !== startingCredentials) return ensureAccessToken(connection)
      const identity = await github.identify(refreshed.accessToken)
      requireOwnership()
      if (identity.id !== connection.githubIdentity.id)
        throw new GitHubAccessError('account-mismatch')
      const token = await mutateCredentials(async () => {
        requireOwnership()
        if (credentialBundles.get(scope) !== startingCredentials) return null
        try {
          await credentialVault.write(connection.id, refreshed)
        } catch {
          throw new GitHubAccessError('authorization-required')
        }
        requireOwnership()
        if (credentialBundles.get(scope) !== startingCredentials) return null
        credentialBundles.set(scope, refreshed)
        validatedAccounts.set(scope, connection.githubIdentity.id)
        setUsability(scope, { status: 'usable' })
        return refreshed.accessToken
      })
      return token ?? ensureAccessToken(connection)
    } catch (error) {
      requireOwnership()
      const superseded = await mutateCredentials(async () => {
        requireOwnership()
        if (credentialBundles.get(scope) !== startingCredentials) return true
        applyCredentialFailure(connection, error)
        return false
      })
      if (superseded) return ensureAccessToken(connection)
      throw new GitHubAccessError(classifyGitHubAccessFailure(error))
    }
  }
  function applyCredentialFailure(connection: GitHubConnection, error: unknown): void {
    if (!ownsEffects()) return
    const scope = authorizationScopeKey(connection)
    const failure = classifyGitHubAccessFailure(error)
    if (
      failure === 'rejected-credential' ||
      failure === 'account-mismatch' ||
      failure === 'authorization-required'
    ) {
      if (failure === 'rejected-credential' || failure === 'account-mismatch')
        rejectedAuthorizations.set(scope, { accountId: connection.githubIdentity.id, failure })
      credentialBundles.delete(scope)
      validatedAccounts.delete(scope)
      providerAccess.delete(scope)
      setUsability(scope, {
        status: 'authorization-required',
        cause: new GitHubAccessError(failure).message,
      })
      return
    }
    if (authorizationUsability.get(scope)?.status !== 'usable')
      setUsability(scope, { status: 'unavailable', cause: new GitHubAccessError(failure).message })
  }
  async function beginAuthorization(
    command: Extract<Command, { type: 'begin-github-authorization' }>,
  ): Promise<CommandResolution> {
    const name = command.name.trim()
    if (!name) return invalid('name', 'Connection name cannot be empty.')
    return beginAuthorizationAttempt(command.type, name, null)
  }

  async function reauthorizeConnection(
    command: Extract<Command, { type: 'reauthorize-github-connection' }>,
  ): Promise<CommandResolution> {
    const connection = currentConfiguration().connections.find(
      (candidate) => candidate.id === command.connectionId,
    )
    if (connection?.integration !== 'github')
      return invalid('connectionId', 'GitHub Connection does not exist.')
    if (
      [...authorizationOperations.values()].some(
        (operation) =>
          (operation.fact.status === 'starting' || operation.fact.status === 'waiting') &&
          operation.fact.connectionId === connection.id,
      )
    )
      return invalid('connectionId', 'Authorization is already in progress for this Connection.')
    return beginAuthorizationAttempt(command.type, connection.name, connection)
  }

  async function beginAuthorizationAttempt(
    type: 'begin-github-authorization' | 'reauthorize-github-connection',
    name: string,
    connection: GitHubConnection | null,
  ): Promise<CommandResolution> {
    if (!options.github || !options.credentialVault)
      return unsupported('GitHub Connections are not available.')
    const operation: ActiveAuthorization = {
      requestedAccountId: connection?.githubIdentity.id ?? null,
      attempt: null,
      fact: {
        id: crypto.randomUUID(),
        ...(connection === null ? {} : { connectionId: connection.id }),
        status: 'starting',
      },
      name,
      deviceCode: '',
      intervalMs: 0,
      timer: null,
    }
    authorizationOperations.set(operation.fact.id, operation)
    await restartAuthorization(operation)
    if (!ownsEffects()) return unsupported('Roadmap is not running.')
    return authorizationResolution(type, operation.fact)
  }

  async function retryAuthorization(
    command: Extract<Command, { type: 'retry-github-authorization' }>,
  ): Promise<CommandResolution> {
    const operation = authorizationOperations.get(command.operationId)
    if (!operation) return invalid('operationId', 'Authorization operation does not exist.')
    if (operation.fact.status === 'starting' || operation.fact.status === 'waiting')
      return invalid('operationId', 'Authorization is already in progress.')
    if (operation.fact.status === 'granted')
      return invalid('operationId', 'Authorization has already been granted.')
    if (operation.fact.connectionId !== undefined) {
      const connection = currentConfiguration().connections.find(
        (candidate) => candidate.id === operation.fact.connectionId,
      )
      if (connection?.integration !== 'github')
        return invalid('connectionId', 'The authorization Connection no longer exists.')
      operation.requestedAccountId = connection.githubIdentity.id
    }
    await restartAuthorization(operation)
    if (!ownsEffects()) return unsupported('Roadmap is not running.')
    return authorizationResolution(command.type, operation.fact)
  }

  async function restartAuthorization(operation: ActiveAuthorization): Promise<void> {
    if (!options.github) return
    clearTimeout(operation.timer ?? undefined)
    operation.timer = null
    const attempt = Symbol('GitHubAuthorizationAttempt')
    operation.attempt = attempt
    try {
      const device = await options.github.beginDeviceAuthorization()
      if (!ownsEffects() || operation.attempt !== attempt) return
      if (operation.fact.connectionId !== undefined) {
        const connection = currentConfiguration().connections.find(
          (candidate) => candidate.id === operation.fact.connectionId,
        )
        if (
          connection?.integration !== 'github' ||
          connection.githubIdentity.id !== operation.requestedAccountId
        ) {
          finishAuthorization(
            operation,
            'cancelled',
            'GitHub authorization was cancelled because its configured Connection changed.',
          )
          return
        }
      }
      operation.deviceCode = device.deviceCode
      operation.intervalMs = device.intervalMs
      operation.fact = {
        id: operation.fact.id,
        ...(operation.fact.connectionId ? { connectionId: operation.fact.connectionId } : {}),
        status: 'waiting',
        verificationUri: device.verificationUri,
        userCode: device.userCode,
        expiresAt: device.expiresAt,
      }
      publish()
      scheduleAuthorizationPoll(operation)
    } catch (error) {
      if (operation.attempt === attempt)
        finishAuthorization(operation, 'failed', safeAuthorizationMessage(error))
    }
  }

  function scheduleAuthorizationPoll(operation: ActiveAuthorization): void {
    if (
      lifecycle.phase !== 'ready' ||
      operation.fact.status !== 'waiting' ||
      operation.attempt === null
    )
      return
    const attempt = operation.attempt
    operation.timer = setTimeout(() => {
      operation.timer = null
      void ownTask(() => pollAuthorization(operation.fact.id, attempt)).catch(() => undefined)
    }, operation.intervalMs)
  }

  function ownsAuthorizationAttempt(operation: ActiveAuthorization, attempt: symbol): boolean {
    return ownsEffects() && operation.attempt === attempt && operation.fact.status === 'waiting'
  }

  async function pollAuthorization(operationId: string, attempt: symbol): Promise<void> {
    const operation = authorizationOperations.get(operationId)
    if (
      !ownsEffects() ||
      operation?.fact.status !== 'waiting' ||
      operation.attempt !== attempt ||
      !options.github
    )
      return
    if ((operation.fact.expiresAt ?? 0) <= now()) {
      finishAuthorization(operation, 'expired', 'GitHub authorization expired.')
      return
    }
    try {
      const result = await options.github.pollDeviceAuthorization(operation.deviceCode)
      if (!ownsAuthorizationAttempt(operation, attempt)) return
      await enqueue(async () => {
        if (!ownsAuthorizationAttempt(operation, attempt)) return
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
            await completeAuthorization(operation, result.credentials, attempt)
        }
      })
    } catch (error) {
      await enqueue(async () => {
        if (ownsAuthorizationAttempt(operation, attempt)) {
          finishAuthorization(operation, 'failed', safeAuthorizationMessage(error))
        }
      })
    }
  }

  async function completeAuthorization(
    operation: ActiveAuthorization,
    credentials: CredentialBundle,
    attempt: symbol,
  ): Promise<void> {
    const identity = await identifyAuthorization(operation, credentials, attempt)
    if (!ownsAuthorizationAttempt(operation, attempt) || !identity || !options.credentialVault)
      return
    if (!authorizationIdentityIsValid(operation, identity)) return

    const update = configurationWithAuthorizedConnection(operation, identity)
    if (
      !(await stageCredentials(operation, update.connectionId, credentials, identity.id, attempt))
    )
      return
    if (!ownsAuthorizationAttempt(operation, attempt)) return

    const outcome = await persistConfiguration(update.configuration, [update.connectionId])
    if (!ownsAuthorizationAttempt(operation, attempt)) return
    if (!outcome.ok) {
      if (
        !update.reauthorizing &&
        !currentConfiguration().connections.some(
          (connection) => connection.id === update.connectionId,
        )
      )
        await discardStagedCredentials(update.connectionId)
      finishAuthorization(operation, 'failed', outcome.error.message)
      return
    }
    if (outcome.kind === 'committed-unconfirmed') {
      finishAuthorization(operation, 'failed', outcome.message)
      return
    }
    operation.attempt = null
    operation.requestedAccountId = identity.id
    operation.fact = {
      id: operation.fact.id,
      connectionId: update.connectionId,
      accountId: identity.id,
      status: 'granted',
      configurationVersion: outcome.configurationVersion,
    }
    publish()
  }

  function configurationWithAuthorizedConnection(
    operation: ActiveAuthorization,
    identity: GitHubConnectionIdentity,
  ): {
    configuration: ProjectConfiguration
    connectionId: string
    reauthorizing: boolean
  } {
    const existingId = operation.fact.connectionId
    const existing = existingId
      ? currentConfiguration().connections.find((connection) => connection.id === existingId)
      : undefined
    const connectionId = existingId ?? crypto.randomUUID()
    const nextConnection: GitHubConnection = {
      id: connectionId,
      integration: 'github',
      name: existing?.name ?? operation.name,
      builtIn: false,
      githubIdentity: identity,
    }
    return {
      configuration: {
        ...currentConfiguration(),
        connections: existing
          ? currentConfiguration().connections.map((connection) =>
              connection.id === connectionId ? nextConnection : connection,
            )
          : [...currentConfiguration().connections, nextConnection],
      },
      connectionId,
      reauthorizing: existing !== undefined,
    }
  }

  async function identifyAuthorization(
    operation: ActiveAuthorization,
    credentials: CredentialBundle,
    attempt: symbol,
  ): Promise<GitHubConnectionIdentity | null> {
    if (!options.github) return null
    try {
      return await options.github.identify(credentials.accessToken)
    } catch (error) {
      if (ownsAuthorizationAttempt(operation, attempt))
        finishAuthorization(operation, 'failed', safeAuthorizationMessage(error))
      return null
    }
  }

  function authorizationIdentityIsValid(
    operation: ActiveAuthorization,
    identity: GitHubConnectionIdentity,
  ): boolean {
    const existingId = operation.fact.connectionId
    const existing = existingId
      ? currentConfiguration().connections.find((connection) => connection.id === existingId)
      : undefined
    if (existingId && existing?.integration !== 'github') {
      finishAuthorization(operation, 'failed', 'GitHub Connection no longer exists.')
      return false
    }
    if (existing?.integration === 'github' && existing.githubIdentity.id !== identity.id) {
      finishAuthorization(
        operation,
        'failed',
        `Authorize the same GitHub user (${existing.githubIdentity.login}) to repair this Connection.`,
      )
      return false
    }
    const duplicate = currentConfiguration().connections.some(
      (connection) =>
        connection.integration === 'github' &&
        connection.githubIdentity.id === identity.id &&
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
    accountId: string,
    attempt: symbol,
  ): Promise<boolean> {
    const credentialVault = options.credentialVault
    if (!credentialVault) return false
    try {
      return await mutateCredentials(async () => {
        if (!ownsAuthorizationAttempt(operation, attempt)) return false
        await credentialVault.write(connectionId, credentials)
        if (!ownsAuthorizationAttempt(operation, attempt)) return false
        const scope = githubAuthorizationScopeKey(connectionId, accountId)
        authorizationOwners.set(scope, connectionId)
        credentialBundles.set(scope, credentials)
        validatedAccounts.set(scope, accountId)
        rejectedAuthorizations.delete(scope)
        setUsability(scope, { status: 'usable' })
        return true
      })
    } catch {
      if (ownsAuthorizationAttempt(operation, attempt))
        finishAuthorization(operation, 'failed', 'GitHub authorization could not be saved.')
      return false
    }
  }
  async function discardStagedCredentials(connectionId: string): Promise<void> {
    for (const [scope, ownerId] of authorizationOwners) {
      if (ownerId !== connectionId) continue
      authorizationOwners.delete(scope)
      credentialBundles.delete(scope)
      authorizationUsability.delete(scope)
      validatedAccounts.delete(scope)
      rejectedAuthorizations.delete(scope)
      providerAccess.delete(scope)
    }
    publishAuthorizationFacts()
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
    if (operation.fact.status === 'starting' || operation.fact.status === 'waiting')
      finishAuthorization(operation, 'cancelled', 'GitHub authorization was cancelled.')
    return authorizationResolution(command.type, operation.fact)
  }

  function authorizationResolution(
    type: Extract<
      Command,
      | { operationId: unknown }
      | { type: 'begin-github-authorization' | 'reauthorize-github-connection' }
    >['type'],
    fact: AuthorizationFact,
  ): CommandResolution {
    const operationId = authorizationOperationIdSchema.parse(fact.id)
    switch (fact.status) {
      case 'starting':
        return unsupported('GitHub authorization has not completed its device-flow request.')
      case 'waiting':
        return {
          ok: true,
          result: {
            type,
            operationId,
            phase: 'waiting',
            verificationUri: fact.verificationUri,
            userCode: fact.userCode,
            expiresAt: fact.expiresAt,
          },
        }
      case 'granted':
        return {
          ok: true,
          result: {
            type,
            operationId,
            phase: 'granted',
            connection: {
              connectionId: connectionIdSchema.parse(fact.connectionId),
              accountId: fact.accountId,
            },
            configurationVersion: configurationVersionSchema.parse(fact.configurationVersion),
          },
        }
      case 'denied':
      case 'failed':
        return {
          ok: true,
          result: {
            type,
            operationId,
            phase: fact.status,
            error: { code: 'authorization-failed', message: fact.cause },
          },
        }
      case 'expired':
      case 'cancelled':
        return { ok: true, result: { type, operationId, phase: fact.status } }
    }
  }

  function finishAuthorization(
    operation: ActiveAuthorization,
    status: 'denied' | 'expired' | 'cancelled' | 'failed',
    cause: string,
  ): void {
    if (!ownsEffects()) return
    clearTimeout(operation.timer ?? undefined)
    operation.timer = null
    operation.deviceCode = ''
    operation.attempt = null
    operation.fact = {
      id: operation.fact.id,
      ...(operation.fact.connectionId ? { connectionId: operation.fact.connectionId } : {}),
      status,
      cause,
    }
    publish()
  }
  function cancelUnboundAuthorizations(configuration: ProjectConfiguration): void {
    const cancelled = new Set<string>()
    for (const operation of authorizationOperations.values()) {
      const fact = operation.fact
      if (
        fact.connectionId === undefined ||
        (fact.status !== 'waiting' && operation.attempt === null)
      )
        continue
      const connection = configuration.connections.find(
        (candidate) => candidate.id === fact.connectionId,
      )
      if (
        connection?.integration === 'github' &&
        connection.githubIdentity.id === operation.requestedAccountId
      )
        continue
      clearTimeout(operation.timer ?? undefined)
      operation.timer = null
      operation.deviceCode = ''
      operation.attempt = null
      operation.fact = {
        id: fact.id,
        connectionId: fact.connectionId,
        status: 'cancelled',
        cause: 'GitHub authorization was cancelled because its configured Connection changed.',
      }
      cancelled.add(fact.id)
    }
    if (retainedState && cancelled.size > 0)
      retainedState = {
        ...retainedState,
        authorizationOperations: retainedState.authorizationOperations.map(
          (operation): ReadyApplicationState['authorizationOperations'][number] =>
            operation.status === 'waiting' && cancelled.has(operation.id)
              ? {
                  id: operation.id,
                  status: 'terminal',
                  outcome: 'cancelled',
                  ...(operation.connectionId === undefined
                    ? {}
                    : { connectionId: operation.connectionId }),
                }
              : operation,
        ),
      }
  }

  function receiveConfiguration(result: ConfigurationRead): void {
    if (!ownsEffects()) return
    if (
      result.ok &&
      ownWriteDocument &&
      result.document.configurationVersion === ownWriteDocument.configurationVersion &&
      compareConfigurations(ownWriteDocument, result.document) === 'same'
    )
      return
    const receipt = ++configurationReceipt
    const different =
      result.ok && compareConfigurations(currentConfiguration(), result.document) !== 'same'
    const stale =
      result.ok &&
      different &&
      result.document.configurationVersion <= currentConfiguration().configurationVersion
    const relevant =
      result.ok &&
      [currentConfiguration(), ...pendingConfigurations.values()].some(
        (configuration) =>
          admissionConfigurationKey(configuration) !== admissionConfigurationKey(result.document),
      )
    if (
      result.ok &&
      !stale &&
      result.document.configurationVersion > currentConfiguration().configurationVersion
    )
      cancelUnboundAuthorizations(result.document)
    receivedConfigurationValid = result.ok && !stale
    if (!result.ok) configurationStatus = { valid: false, issues: result.issues, notices: [] }
    else if (stale) rejectStaleConfiguration()
    else if (!configurationStatus.valid)
      configurationStatus = {
        ...configurationStatus,
        valid: true,
        issues: [],
        notices: result.notices ?? [],
      }
    if (relevant && !stale && result.ok) pendingConfigurations.set(receipt, result.document)
    updateAdmissionValidity()
    publish()
    void enqueue(async () => {
      try {
        await applyConfigurationUpdate(result, receipt, stale)
      } finally {
        pendingConfigurations.delete(receipt)
        updateAdmissionValidity()
        publish()
      }
    }).catch(() => undefined)
  }
  async function applyConfigurationUpdate(
    result: ConfigurationRead,
    receipt: number,
    stale: boolean,
  ): Promise<void> {
    if (!ownsEffects() || !result.ok || stale) return
    if (
      compareConfigurations(currentConfiguration(), result.document) === 'same' &&
      result.document.configurationVersion <= currentConfiguration().configurationVersion
    ) {
      if (receipt === configurationReceipt)
        configurationStatus = {
          valid: receivedConfigurationValid,
          issues: [],
          notices: result.notices ?? [],
        }
      return
    }
    if (result.document.configurationVersion <= currentConfiguration().configurationVersion) {
      if (receipt === configurationReceipt) {
        receivedConfigurationValid = false
        rejectStaleConfiguration()
      }
      return
    }
    await synchronizeCredentials(result.document)
    if (!ownsEffects()) return
    const prepared = await registry.prepare(result.document, currentConfiguration())
    if (!ownsEffects()) return
    if (receipt === configurationReceipt) {
      configurationDurabilityConfirmed = result.durability !== 'unconfirmed'
      configurationStatus = {
        valid: receivedConfigurationValid,
        issues: [],
        notices: result.notices ?? [],
      }
    }
    await coordinator.activate(prepared, () => authorizationFacts(prepared))
    if (!ownsEffects()) return
    forgetRemovedConnections()
    await disableInterruptedProjects()
    await cleanupOrphanCredentials(result.document)
  }
  function rejectStaleConfiguration(): void {
    configurationStatus = {
      valid: false,
      issues: [
        {
          path: '$.configurationVersion',
          message: `Must be greater than ${currentConfiguration().configurationVersion} for a semantic edit.`,
        },
      ],
      notices: [],
    }
  }
  function start(): Promise<void> {
    switch (lifecycle.phase) {
      case 'starting':
      case 'ready':
        if (startPromise) return startPromise
        throw new Error('RoadmapApplication startup task is missing.')
      case 'stopping':
      case 'stopped':
      case 'failed':
        return Promise.reject(
          new Error('RoadmapApplication cannot restart after terminal shutdown.'),
        )
      case 'idle':
        lifecycle = { phase: 'starting' }
        state = buildState()
        startPromise = Promise.resolve().then(initialize)
        return startPromise
    }
  }
  async function initialize(): Promise<void> {
    try {
      requireOwnership()
      const loaded = await options.configuration.load()
      requireOwnership()
      const configuration = loaded.ok ? loaded.document : EMPTY_CONFIGURATION
      receivedConfigurationValid = loaded.ok
      configurationDurabilityConfirmed = !loaded.ok || loaded.durability !== 'unconfirmed'
      configurationStatus = loaded.ok
        ? { valid: true, issues: [], notices: loaded.notices ?? [] }
        : { valid: false, issues: loaded.issues, notices: [] }
      updateAdmissionValidity()
      const unsubscribe = options.configuration.subscribe(receiveConfiguration)
      if (!ownsEffects()) {
        unsubscribe()
        requireOwnership()
      }
      unsubscribeConfiguration = unsubscribe
      await cleanupOrphanCredentials(configuration)
      requireOwnership()
      await synchronizeCredentials(configuration)
      requireOwnership()
      const prepared = await registry.prepare(configuration)
      requireOwnership()
      await coordinator.activate(prepared, () => authorizationFacts(prepared))
      requireOwnership()
      await automationEngine?.start()
      requireOwnership()
      await mutationLane
      requireOwnership()
      lifecycle = {
        phase: 'ready',
        mode: receivedConfigurationValid ? 'mutable' : 'read-only',
      }
      const before = stateSequence
      publish()
      requireOwnership()
      if (stateSequence === before) {
        stateSequence += 1
        state = { ...state, stateSequence: stateSequenceSchema.parse(stateSequence) }
        for (const listener of listeners) {
          if (lifecycle.phase !== 'ready') break
          listener(state)
        }
      }
      requireOwnership()
    } catch (error) {
      if (lifecycle.phase === 'starting') {
        lifecycle = { phase: 'failed', cause: 'RoadmapApplication startup failed.' }
        state = buildState()
        try {
          await cleanup(null)
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'RoadmapApplication startup and cleanup failed.',
          )
        }
      }
      throw error
    }
  }
  function query(query: Query): Promise<QueryResult> {
    const outcome = (resolution: Awaited<ReturnType<ApplicationOperations['query']>>) =>
      queryResultSchema.parse({
        operation: query.type,
        subject: { kind: 'none' },
        serverEpoch: state.serverEpoch,
        stateSequence: state.stateSequence,
        ...resolution,
      })
    if (lifecycle.phase !== 'ready')
      return Promise.resolve(outcome(unsupported('Roadmap is not running.')))
    const operations = options.operations
    if (!operations)
      return Promise.resolve(outcome(unsupported('This query is not available yet.')))
    return ownTask(async () => {
      if (lifecycle.phase !== 'ready') return outcome(unsupported('Roadmap is not running.'))
      return outcome(await operations.query(query))
    })
  }
  function execute<C extends Command>(command: C): Promise<CommandOutcomeFor<C>> {
    const run = async () =>
      parseCommandOutcomeFor(command, {
        ...(await executeCommand(command)),
        operation: command.type,
        subject: commandSubject(command),
        serverEpoch: state.serverEpoch,
        stateSequence: state.stateSequence,
      })
    return command.type === 'refresh-project' ? ownTask(run) : enqueue(run)
  }
  async function executeCommand(command: Command): Promise<OperationResolution> {
    if (lifecycle.phase !== 'ready') return failure('not-supported', 'Roadmap is not running.')
    if (
      !configurationStatus.valid ||
      !receivedConfigurationValid ||
      (command.type !== 'refresh-project' && pendingConfigurations.size > 0)
    )
      return failure(
        'configuration-invalid',
        'roadmap.config.json is invalid or an admission-affecting update is pending; repair it before making in-app changes.',
      )
    if (command.expectedConfigurationVersion !== currentConfiguration().configurationVersion)
      return failure(
        'conflict',
        `Configuration changed to version ${currentConfiguration().configurationVersion}; retry from current state.`,
      )
    const resolved = await resolveCommand(command)
    if (!resolved.ok) return resolved
    if ('result' in resolved) return resolved
    const outcome = await persistConfiguration(resolved.configuration)
    if (!outcome.ok) return outcome
    const result = resolved.committed(outcome.configurationVersion, outcome.kind)
    if (!ownsEffects()) return { ok: true, result }
    if (
      command.type === 'remove-connection' &&
      !currentConfiguration().connections.some(
        (connection) => connection.id === command.connectionId,
      )
    ) {
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
    }
    return { ok: true, result }
  }
  async function persistConfiguration(
    candidate: ProjectConfiguration,
    revalidateConnections: readonly string[] = [],
  ): Promise<ConfigurationPersistence> {
    if (!ownsEffects()) return failure('not-supported', 'Roadmap is not running.')
    if (!receivedConfigurationValid || pendingConfigurations.size > 0)
      return failure('configuration-invalid', 'Current configuration no longer permits this write.')
    const decoded = decodeConfigurationDocument({
      schemaVersion: 6,
      configurationVersion: currentConfiguration().configurationVersion + 1,
      connections: candidate.connections,
      projects: candidate.projects,
      automation: candidate.automation,
    })
    if (!decoded.ok)
      return failure(
        'validation',
        decoded.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' '),
      )
    ownWriteDocument = decoded.value
    if (
      admissionConfigurationKey(currentConfiguration()) !== admissionConfigurationKey(decoded.value)
    )
      pendingConfigurations.set(-1, decoded.value)
    updateAdmissionValidity()
    try {
      const persisted = await options.configuration.write(decoded.value)
      if (!persisted.ok) {
        if (!ownsEffects()) retainShutdownWrite?.(decoded.value, persisted)
        return failure(
          persisted.kind === 'conflict' ? 'conflict' : 'persistence-failed',
          persisted.message,
        )
      }
      cancelUnboundAuthorizations(decoded.value)
      if (!ownsEffects()) return persistedConfigurationOutcome(persisted, decoded.value)
      configurationDurabilityConfirmed = persisted.durability === 'confirmed'
      if (receivedConfigurationValid)
        configurationStatus = {
          valid: true,
          issues: [],
          notices:
            persisted.durability === 'unconfirmed'
              ? [
                  persisted.message ??
                    'Configuration was replaced, but its durability is unconfirmed.',
                ]
              : [],
        }
      updateAdmissionValidity()
      try {
        await synchronizeCredentials(decoded.value)
        if (!ownsEffects()) return persistedConfigurationOutcome(persisted, decoded.value)
        const prepared = await registry.prepare(candidate, currentConfiguration(), {
          revalidateConnections,
        })
        if (!ownsEffects()) return persistedConfigurationOutcome(persisted, decoded.value)
        await coordinator.activate({ ...decoded.value, admissions: prepared.admissions }, () =>
          authorizationFacts(decoded.value),
        )
        if (!ownsEffects()) return persistedConfigurationOutcome(persisted, decoded.value)
      } catch (error) {
        if (!ownsEffects()) return persistedConfigurationOutcome(persisted, decoded.value)
        throw error
      }
      forgetRemovedConnections()
      return configurationPersistence(persisted, decoded.value)
    } finally {
      ownWriteDocument = null
      pendingConfigurations.delete(-1)
      updateAdmissionValidity()
      publish()
    }
  }
  function persistedConfigurationOutcome(
    persisted: Extract<ConfigurationWrite, { ok: true }>,
    document: ProjectConfiguration,
  ): ConfigurationPersistence {
    retainShutdownWrite?.(document, persisted)
    return configurationPersistence(persisted, document)
  }

  function configurationPersistence(
    persisted: Extract<ConfigurationWrite, { ok: true }>,
    document: ProjectConfiguration,
  ): Extract<ConfigurationPersistence, { ok: true }> {
    const configurationVersion = configurationVersionSchema.parse(document.configurationVersion)
    return persisted.durability === 'confirmed'
      ? { ok: true, kind: 'committed', configurationVersion }
      : {
          ok: true,
          kind: 'committed-unconfirmed',
          configurationVersion,
          message:
            'Configuration was replaced, but its durability is unconfirmed. Automation remains inhibited.',
        }
  }
  type ConfigurationCommit = 'committed' | 'committed-unconfirmed'
  type ConfigurationPersistence =
    | { ok: false; error: SafeError }
    | { ok: true; kind: 'committed'; configurationVersion: ConfigurationVersion }
    | {
        ok: true
        kind: 'committed-unconfirmed'
        configurationVersion: ConfigurationVersion
        message: string
      }
  type OperationResolution = { ok: true; result: CommandResult } | { ok: false; error: SafeError }
  type ConfigurationResult = Extract<CommandResult, { commit: ConfigurationCommit }>
  type CommandResolution =
    | OperationResolution
    | {
        ok: true
        configuration: ProjectConfiguration
        committed(
          configurationVersion: ConfigurationVersion,
          commit: ConfigurationCommit,
        ): ConfigurationResult
      }
  function translateMutation(
    type: 'register-project' | 'rename-project' | 'repair-project-workspace' | 'remove-project',
    mutation: RegistryMutation,
  ): CommandResolution {
    if (!mutation.ok) return { ok: false, error: admissionError(mutation.error) }
    const { configuration, project: canonical } = mutation.value
    const project = projectRefSchema.parse(canonical)
    switch (type) {
      case 'register-project':
      case 'repair-project-workspace': {
        const intent = configuration.projects.find((intent) => sameRef(intent.ref, canonical))
        if (!intent)
          return invalid('project', 'The canonical Project is missing from its mutation.')
        const workspacePath = intent.workspace.path
        const connectionId = connectionIdSchema.parse(intent.connectionId)
        return {
          ok: true,
          configuration,
          committed: (configurationVersion, commit) =>
            type === 'register-project'
              ? { type, project, connectionId, workspacePath, configurationVersion, commit }
              : { type, project, workspacePath, configurationVersion, commit },
        }
      }
      case 'rename-project':
      case 'remove-project':
        return {
          ok: true,
          configuration,
          committed: (configurationVersion, commit) => ({
            type,
            project,
            configurationVersion,
            commit,
          }),
        }
    }
  }
  async function resolveCommand(command: Command): Promise<CommandResolution> {
    switch (command.type) {
      case 'begin-github-authorization':
        return beginAuthorization(command)
      case 'reauthorize-github-connection':
        return reauthorizeConnection(command)
      case 'cancel-github-authorization':
        return cancelAuthorization(command)
      case 'retry-github-authorization':
        return retryAuthorization(command)
      case 'rename-connection':
        return renameConnection(command)
      case 'remove-connection':
        return removeConnection(command)
      case 'register-project':
        return translateMutation(
          command.type,
          await registry.admit(
            {
              integration: command.candidate.integration,
              connectionId: command.candidate.connectionId,
              path: command.candidate.workspace.path,
              ...(command.candidate.displayName === undefined
                ? {}
                : { displayName: command.candidate.displayName }),
            },
            currentConfiguration(),
          ),
        )
      case 'rename-project':
        return translateMutation(
          command.type,
          registry.rename(
            { project: projectRef(command.project), displayName: command.name },
            currentConfiguration(),
          ),
        )
      case 'repair-project-workspace': {
        const record = currentConfiguration().admissions.find((record) =>
          sameRef(record.intent.ref, projectRef(command.project)),
        )
        if (!record) return invalid('project', 'Project does not exist.')
        return translateMutation(
          command.type,
          await registry.repair(
            { project: projectRef(command.project), path: command.workspace.path },
            currentConfiguration(),
          ),
        )
      }
      case 'remove-project':
        return translateMutation(
          command.type,
          registry.remove(projectRef(command.project), currentConfiguration()),
        )
      case 'set-automation-enabled':
        return setAutomationEnabled(command)
      case 'set-project-automation-enabled':
        return setProjectAutomationEnabled(command)
      case 'start-automation-override':
        return startAutomationOverride(command)
      case 'refresh-project':
        return refreshProject(command)
      case 'launch-project-operation': {
        if (!options.operations) return unsupported('This operation is not available yet.')
        let workspaceProofDependency: { ref: ProjectRef; value: string } | null = null
        function workspaceAdmissionError(project: PublicProjectRef): AdmissionFailure | null {
          const ref = projectRef(project)
          const expected = workspaceProofDependency
          if (
            !expected ||
            !sameRef(expected.ref, ref) ||
            !receivedConfigurationValid ||
            !ownsEffects() ||
            workspaceDependency(currentConfiguration(), ref) !== expected.value ||
            [...pendingConfigurations.values()].some(
              (pending) => workspaceDependency(pending, ref) !== expected.value,
            )
          )
            return {
              code: 'admission-failed',
              field: 'workspace.path',
              message: 'Current configuration no longer admits this Workspace operation.',
            }
          return null
        }
        return options.operations.execute(command, {
          workspaceAdmissionError,
          async workspace(project) {
            const ref = projectRef(project)
            const before = currentConfiguration()
            if (!before.projects.some((intent) => sameRef(intent.ref, ref))) return undefined
            const workspace = await registry.resolveWorkspace(ref, before)
            workspaceProofDependency = { ref, value: workspaceDependency(before, ref) }
            const error = workspaceAdmissionError(project)
            if (error) return { status: 'unavailable', error }
            const current = currentConfiguration()
            try {
              await coordinator.activate({
                ...current,
                admissions: current.admissions.map((record) =>
                  sameRef(record.intent.ref, ref) ? { ...record, workspace } : record,
                ),
              })
            } catch (error) {
              const revoked = workspaceAdmissionError(project)
              if (revoked) return { status: 'unavailable', error: revoked }
              throw error
            }
            return workspace
          },
        })
      }
    }
  }
  async function refreshProject(
    command: Extract<Command, { type: 'refresh-project' }>,
  ): Promise<OperationResolution> {
    const project = catalog
      .current()
      ?.projects.find((candidate) => sameProject(candidate.key, sourceProject(command.project)))
    if (!project) return invalid('project', 'Project does not exist.')
    const resource = project.resource
    const previousObservedAt =
      resource.kind === 'current-readable'
        ? resource.observation.observedAt
        : resource.kind === 'retained-unavailable'
          ? resource.lastSuccessful.observedAt
          : resource.kind === 'proven-absent' && resource.trace.kind === 'last-successful-trace'
            ? resource.trace.lastSuccessful.observedAt
            : null
    try {
      const contribution = await coordinator.refresh(project.key)
      return translateRefreshOutcome({
        project: projectRefSchema.parse(project.intent.ref),
        contribution,
        previousObservedAt,
      })
    } catch {
      return translateRefreshOutcome(null)
    }
  }
  async function startAutomationOverride(
    command: Extract<Command, { type: 'start-automation-override' }>,
  ): Promise<CommandResolution> {
    if (!automationEngine) return unsupported('Automation is not available.')
    const outcome = await automationEngine.startOverride(
      {
        project: sourceProject(command.target.map.project),
        mapId: command.target.map.mapId,
        ticketId: command.target.ticketId,
      },
      command.stage,
    )
    return outcome.ok
      ? {
          ok: true,
          result: {
            type: command.type,
            target: ticketRefSchema.parse({
              map: {
                project: {
                  integration: outcome.target.project.integration,
                  projectId: outcome.target.project.id,
                },
                mapId: outcome.target.mapId,
              },
              ticketId: outcome.target.ticketId,
            }),
            stage: outcome.stage,
            admission: outcome.admission,
            status: outcome.status,
          },
        }
      : { ok: false, error: automationError(outcome.error) }
  }
  function renameConnection(
    command: Extract<Command, { type: 'rename-connection' }>,
  ): CommandResolution {
    const name = command.name.trim()
    if (!name) return invalid('name', 'Connection name cannot be empty.')
    const configuration = currentConfiguration()
    if (!configuration.connections.some((connection) => connection.id === command.connectionId))
      return invalid('connectionId', 'Connection does not exist.')
    return {
      ok: true,
      configuration: {
        ...configuration,
        connections: configuration.connections.map((connection) =>
          connection.id === command.connectionId ? { ...connection, name } : connection,
        ),
      },
      committed: (configurationVersion, commit) => ({
        type: command.type,
        connectionId: command.connectionId,
        configurationVersion,
        commit,
      }),
    }
  }
  function removeConnection(
    command: Extract<Command, { type: 'remove-connection' }>,
  ): CommandResolution {
    const configuration = currentConfiguration()
    const connection = configuration.connections.find(
      (connection) => connection.id === command.connectionId,
    )
    if (!connection) return invalid('connectionId', 'Connection does not exist.')
    if (connection.builtIn)
      return invalid('connectionId', 'The built-in Connection cannot be removed.')
    const dependents = configuration.projects.filter(
      (project) => project.connectionId === command.connectionId,
    )
    if (dependents.length > 0)
      return {
        ok: false,
        error: {
          code: 'dependency',
          message: 'Remove every dependent Project before removing this Connection.',
          dependentProjects: dependents.map((project) => projectRefSchema.parse(project.ref)),
        },
      }
    return {
      ok: true,
      configuration: {
        ...configuration,
        connections: configuration.connections.filter(
          (connection) => connection.id !== command.connectionId,
        ),
      },
      committed: (configurationVersion, commit) => ({
        type: command.type,
        connectionId: connectionIdSchema.parse(connection.id),
        configurationVersion,
        commit,
      }),
    }
  }
  function setAutomationEnabled(
    command: Extract<Command, { type: 'set-automation-enabled' }>,
  ): CommandResolution {
    const configuration = currentConfiguration()
    const availability = automationAvailability(configuration)
    if (command.enabled && availability.status === 'unavailable')
      return invalid('enabled', availability.cause)
    return {
      ok: true,
      configuration: {
        ...configuration,
        automation: { ...configuration.automation, enabled: command.enabled },
      },
      committed: (configurationVersion, commit) => ({
        type: command.type,
        enabled: command.enabled,
        configurationVersion,
        commit,
      }),
    }
  }
  async function setProjectAutomationEnabled(
    command: Extract<Command, { type: 'set-project-automation-enabled' }>,
  ): Promise<CommandResolution> {
    if (
      !currentConfiguration().projects.some((project) =>
        sameRef(project.ref, projectRef(command.project)),
      )
    )
      return invalid('project', 'Project does not exist.')
    if (command.enabled && automationEngine) {
      const acknowledged = await automationEngine.acknowledgeProjectInterruption(
        sourceProject(command.project),
      )
      if (!acknowledged.ok) return { ok: false, error: automationError(acknowledged.error) }
    }
    const configuration = currentConfiguration()
    const retained = configuration.automation.enabledProjects.filter(
      (project) => !sameProject(project, sourceProject(command.project)),
    )
    return {
      ok: true,
      configuration: {
        ...configuration,
        automation: {
          ...configuration.automation,
          enabledProjects: command.enabled
            ? [...retained, sourceProject(command.project)]
            : retained,
        },
      },
      committed: (configurationVersion, commit) => ({
        type: command.type,
        project: command.project,
        enabled: command.enabled,
        configurationVersion,
        commit,
      }),
    }
  }
  function failure(code: SafeError['code'], message: string): { ok: false; error: SafeError } {
    return { ok: false, error: { code, message } }
  }
  function diagnostics(): ApplicationDiagnostics {
    return { lifecycle: { ...lifecycle }, ...projectResourceCounts(catalog.current()) }
  }
  function cleanup(startup: Promise<void> | null): Promise<void> {
    if (cleanupPromise) return cleanupPromise
    retainedState = state.phase === 'ready' ? state : retainedState
    state = buildState()
    const completion = Promise.withResolvers<void>()
    cleanupPromise = completion.promise
    const errors: unknown[] = []
    // Only this cleanup retains begun disk writes; stopped source owners never reactivate.
    let shutdownConfiguration: ProjectConfiguration = currentConfiguration()
    let shutdownWriteSafe =
      configurationStatus.valid &&
      receivedConfigurationValid &&
      configurationDurabilityConfirmed &&
      [...pendingConfigurations.keys()].every((receipt) => receipt === -1)
    const retainNotice = (message: string) => {
      if (!configurationStatus.notices.includes(message))
        configurationStatus = {
          ...configurationStatus,
          notices: [...configurationStatus.notices, message],
        }
    }
    retainShutdownWrite = (document, persisted) => {
      if (!persisted.ok) {
        if (persisted.kind === 'conflict') shutdownWriteSafe = false
        retainNotice(persisted.message)
      } else {
        cancelUnboundAuthorizations(document)
        shutdownConfiguration = document
        configurationDurabilityConfirmed = persisted.durability === 'confirmed'
        if (!configurationDurabilityConfirmed) {
          shutdownWriteSafe = false
          retainNotice(
            persisted.message ?? 'Configuration was replaced, but its durability is unconfirmed.',
          )
        }
      }
      state = buildState(shutdownConfiguration)
    }
    for (const operation of authorizationOperations.values()) {
      operation.attempt = null
      clearTimeout(operation.timer ?? undefined)
      operation.timer = null
    }
    try {
      unsubscribeConfiguration?.()
    } catch (error) {
      errors.push(error)
    }
    unsubscribeConfiguration = null
    unsubscribeObservation()
    changeFeed.stop()
    const sources = coordinator.stop()
    const automation = automationEngine?.stop() ?? Promise.resolve()
    const owners = Promise.allSettled([sources, automation])
    void Promise.resolve()
      .then(async () => {
        await startup?.catch(() => undefined)
        await mutationLane
        while (tasks.size > 0) await Promise.allSettled([...tasks])
        await credentialMutationLane
        for (const result of await owners)
          if (result.status === 'rejected') errors.push(result.reason)
        try {
          const candidate = configurationWithoutInterruptedProjects(shutdownConfiguration)
          if (candidate) {
            if (!shutdownWriteSafe)
              throw new Error(
                'Interrupted Project Automation could not be disabled because configuration is invalid, pending, or its durability is unconfirmed.',
              )
            const decoded = decodeConfigurationDocument({
              schemaVersion: 6,
              configurationVersion: shutdownConfiguration.configurationVersion + 1,
              connections: candidate.connections,
              projects: candidate.projects,
              automation: candidate.automation,
            })
            if (!decoded.ok)
              throw new Error('Interrupted Project Automation configuration is invalid.')
            const persisted = await options.configuration.write(decoded.value)
            retainShutdownWrite?.(decoded.value, persisted)
            if (!persisted.ok) throw new Error(persisted.message)
            if (persisted.durability === 'unconfirmed')
              throw new Error(
                persisted.message ??
                  'Configuration was replaced, but its durability is unconfirmed.',
              )
          }
        } catch (error) {
          retainNotice(
            'Interrupted Project Automation could not be durably disabled during shutdown.',
          )
          errors.push(error)
        }
        retainShutdownWrite = null
        try {
          await options.configuration.stop()
        } catch (error) {
          errors.push(error)
        }
        state = buildState(shutdownConfiguration)
        listeners.clear()
        if (errors.length === 1) throw errors[0]
        if (errors.length > 1)
          throw new AggregateError(errors, 'RoadmapApplication cleanup failed.')
      })
      .then(completion.resolve, completion.reject)
    return cleanupPromise
  }
  function recordStoppedState(): void {
    lifecycle = { phase: 'stopped' }
    const retained =
      state.phase === 'ready'
        ? state
        : state.phase === 'idle' || state.phase === 'starting'
          ? null
          : state.retained
    state = applicationStateSchema.parse({
      phase: 'stopped',
      serverEpoch: state.serverEpoch,
      stateSequence: state.stateSequence,
      capturedAt: state.capturedAt,
      retained,
    })
  }
  return {
    start,
    current: () => state,
    diagnostics,
    subscribe(listener) {
      if (!ownsEffects() && lifecycle.phase !== 'idle') return () => undefined
      listeners.add(listener)
      if (lifecycle.phase === 'ready') listener(state)
      return () => listeners.delete(listener)
    },
    query,
    execute,
    stop() {
      if (stopPromise) return stopPromise
      const completion = Promise.withResolvers<void>()
      stopPromise = completion.promise
      lifecycle = { phase: 'stopping' }
      updateAdmissionValidity()
      void cleanup(startPromise).then(
        () => {
          recordStoppedState()

          completion.resolve()
        },
        (error: unknown) => {
          recordStoppedState()

          completion.reject(error)
        },
      )
      return stopPromise
    },
  }
}

function semanticFingerprint(state: ApplicationState): string {
  const { serverEpoch: _epoch, stateSequence: _sequence, capturedAt: _capturedAt, ...facts } = state
  return JSON.stringify(facts)
}
function compareConfigurations(
  current: ProjectConfiguration,
  candidate: ProjectConfiguration,
): 'same' | 'different' {
  const facts = (value: ProjectConfiguration) => ({
    schemaVersion: value.schemaVersion,
    connections: value.connections,
    projects: value.projects,
    automation: value.automation,
  })
  return JSON.stringify(facts(current)) === JSON.stringify(facts(candidate)) ? 'same' : 'different'
}
function authorizationScopeKey(connection: ConfiguredConnection): string {
  return connection.integration === 'github'
    ? githubAuthorizationScopeKey(connection.id, connection.githubIdentity.id)
    : JSON.stringify([connection.id, 'local'])
}
function githubAuthorizationScopeKey(connectionId: string, accountId: string): string {
  return JSON.stringify([connectionId, 'github', accountId])
}
function admissionConfigurationKey(configuration: ProjectConfiguration): string {
  return JSON.stringify({
    connections: configuration.connections.map((connection) => ({
      id: connection.id,
      integration: connection.integration,
      ...(connection.integration === 'github' ? { account: connection.githubIdentity.id } : {}),
    })),
    projects: configuration.projects.map((project) => ({
      ref: project.ref,
      connectionId: project.connectionId,
      workspace: project.workspace,
      ...('locator' in project ? { repositoryId: project.locator.repositoryId } : {}),
    })),
    automation: configuration.automation,
  })
}
function workspaceDependency(configuration: ProjectConfiguration, ref: ProjectRef): string {
  return JSON.stringify({
    project: ref,
    projects: configuration.projects.map((intent) => ({
      ref: intent.ref,
      connectionId: intent.connectionId,
      workspace: intent.workspace,
      ...('locator' in intent ? { repositoryId: intent.locator.repositoryId } : {}),
    })),
    connections: configuration.connections.map((connection) => ({
      id: connection.id,
      integration: connection.integration,
      ...(connection.integration === 'github' ? { accountId: connection.githubIdentity.id } : {}),
    })),
  })
}
function projectRef(project: PublicProjectRef): ProjectRef {
  return { integration: project.integration, projectId: project.projectId }
}
function sourceProject(project: PublicProjectRef): ProjectKey {
  return { integration: project.integration, id: project.projectId }
}
function sameRef(a: ProjectRef, b: ProjectRef): boolean {
  return a.integration === b.integration && a.projectId === b.projectId
}
function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
function classifyGitHubAccessFailure(error: unknown): GitHubAccessFailure {
  if (error instanceof GitHubAccessError) return error.failure
  if (error instanceof GitHubConnectionError) {
    switch (error.kind) {
      case 'network':
        return 'network'
      case 'invalid-response':
        return 'malformed-response'
      case 'unauthorized':
      case 'bad-refresh-token':
        return 'rejected-credential'
    }
  }
  if (error instanceof CredentialVaultError && error.kind === 'invalid')
    return 'authorization-required'
  return 'unavailable'
}

function automationError(error: AutomationFailure): SafeError {
  return {
    code:
      error.kind === 'not-ready'
        ? 'not-supported'
        : error.kind === 'ineligible'
          ? 'validation'
          : 'persistence-failed',
    field: 'target',
    message: error.reason,
  }
}
function admissionError(error: AdmissionFailure): SafeError {
  return {
    code: error.code,
    message: error.message,
    ...(error.field === undefined ? {} : { field: error.field }),
  }
}
function invalid(field: string, message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'validation', field, message } }
}
function unsupported(message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'not-supported', message } }
}
function safeAuthorizationMessage(error: unknown): string {
  return error instanceof GitHubConnectionError ||
    error instanceof CredentialVaultError ||
    error instanceof GitHubAccessError
    ? error.message
    : 'GitHub authorization is temporarily unavailable.'
}
