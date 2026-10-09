import { randomUUID } from 'node:crypto'
import type {
  ApplicationState,
  AuthorizationOperation,
  Command,
  CommandOutcome,
  CommandResult,
  GitHubConnectionIdentity,
  ProjectKey,
  Query,
  QueryResult,
  SafeError,
  SupportedIntegration,
} from '@roadmap/contracts'
import type { AutomationDatabaseDocument } from '../automation/database.ts'
import {
  type AutomationEngine,
  type AutomationLauncher,
  createAutomationEngine,
} from '../automation/engine.ts'
import { type ChangeEvent, type ChangeFeedInput, createChangeFeed } from '../change-feed.ts'
import {
  type ConfigurationDocument,
  type ConfigurationRead,
  decodeConfigurationDocument,
} from '../configuration/document.ts'
import {
  type CredentialBundle,
  GitHubConnectionError,
  type GitHubConnectionPort,
} from '../github/connections.ts'
import {
  type AuthorizationUsability,
  type CommittedObservation,
  createObservationCoordinator,
  type SourceObserverFactories,
} from '../observation/coordinator.ts'
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
import { type CredentialVault, CredentialVaultError } from './credential-vault.ts'
import type { ApplicationOperations } from './operations.ts'
import { createSourceProjection, projectApplicationState } from './projection.ts'

export interface RoadmapApplication {
  start(): Promise<void>
  current(): ApplicationState
  subscribe(listener: (state: ApplicationState) => void): () => void
  query(query: Query): Promise<QueryResult>
  execute(command: Command): Promise<CommandOutcome>
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
  const sourceProjection = createSourceProjection()
  const emptyCommitted: CommittedObservation = {
    registry: { ...EMPTY_CONFIGURATION, admissions: [] },
    observation: { committedAt: 0, attempts: [] },
    contributions: [],
    configurationValid: true,
    pendingAdmission: false,
    pendingConfigurations: [],
    admissionRevision: 0,
    authorizationUsability: new Map(),
    classification: { baselineProjects: [] },
  }
  let configurationStatus: ApplicationState['configuration'] = {
    valid: true,
    issues: [],
    notices: [],
  }
  let receivedConfigurationValid = true
  let configurationDurabilityConfirmed = true
  const pendingConfigurations = new Map<number, ProjectConfiguration>()
  let configurationReceipt = 0
  let stateSequence = 0
  let started = false
  let stopped = false
  let stopping = false
  let stopPromise: Promise<void> | null = null
  let startPromise: Promise<void> | null = null
  let unsubscribeConfiguration: (() => void) | null = null
  let mutationLane: Promise<void> = Promise.resolve()
  let credentialMutationLane: Promise<void> = Promise.resolve()
  let ownWriteDocument: ProjectConfiguration | null = null
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
        source: () => coordinator.current(),
        onEvidenceChange() {
          publish()
          void enqueue(disableInterruptedProjects).catch(() => undefined)
        },
      })
    : null
  let state = buildState()
  let stateFingerprint = semanticFingerprint(state)
  const unsubscribeObservation = coordinator.subscribe(() => {
    publish()
    automationEngine?.reconcile()
  })

  function currentConfiguration(): CommittedObservation['registry'] {
    return coordinator.current()?.registry ?? emptyCommitted.registry
  }
  function buildState(): ApplicationState {
    const committed = coordinator.current() ?? emptyCommitted
    return projectApplicationState({
      committed,
      source: sourceProjection.commit(committed),
      serverEpoch,
      stateSequence,
      supportedIntegrations,
      authorizationOperations: [...authorizationOperations.values()].map((operation) => ({
        ...operation.public,
      })),
      configuration: configurationStatus,
      automation: automationState(),
    })
  }
  function automationState(): ApplicationState['automation'] {
    const configuration = currentConfiguration()
    return {
      enabled: configuration.automation.enabled,
      enabledProjects: [...configuration.automation.enabledProjects],
      availability: automationAvailability(),
      evidence: automationEngine?.evidence() ?? [],
      overrides: automationEngine?.overrides() ?? [],
    }
  }
  function automationAvailability(): ApplicationState['automation']['availability'] {
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
    const policy = currentConfiguration().automation
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
    if (stopped) return
    const candidate = buildState()
    const committed = coordinator.current()
    const baselineProjects =
      committed && lastBaselineRegistry !== committed.registry
        ? committed.classification.baselineProjects
        : []
    if (committed) lastBaselineRegistry = committed.registry
    const fingerprint = semanticFingerprint(candidate)
    if (fingerprint !== stateFingerprint) {
      stateSequence += 1
      state = { ...candidate, stateSequence }
      stateFingerprint = fingerprint
      for (const listener of listeners) listener(state)
    }
    if (committed)
      observeNotifications({
        attempts: committed.observation.attempts,
        projects: candidate.projects.map((project) => ({ key: project.key, name: project.name })),
        baselineProjects,
        order: candidate.roadmap.projects.flatMap((project) =>
          [...project.openMaps, ...project.closedMaps].map((map) => ({
            map: { project: map.project, mapId: map.id },
            tickets: map.tickets.map((ticket) => ticket.id),
          })),
        ),
      })
  }
  function updateAdmissionValidity(): void {
    coordinator.receiveConfigurationValidity(
      receivedConfigurationValid && configurationDurabilityConfirmed && !stopping,
      pendingConfigurations.size > 0,
      [...pendingConfigurations.values()],
    )
    automationEngine?.reconcile()
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
      !automationEngine ||
      !configurationStatus.valid ||
      pendingConfigurations.size > 0 ||
      !configurationDurabilityConfirmed
    )
      return
    const interrupted = automationEngine.interruptedProjects()
    const configuration = currentConfiguration()
    const enabledProjects = configuration.automation.enabledProjects.filter(
      (project) => !interrupted.some((candidate) => sameProject(candidate, project)),
    )
    if (enabledProjects.length !== configuration.automation.enabledProjects.length)
      await persistConfiguration({
        ...configuration,
        automation: { ...configuration.automation, enabledProjects },
      })
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
    try {
      await options.credentialVault.cleanupOrphans(
        new Set(configuration.connections.map((connection) => connection.id)),
      )
    } catch (error) {
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
  }
  async function synchronizeConnection(
    connection: ConfiguredConnection,
  ): Promise<GitHubAccessFailure | null> {
    const scope = authorizationScopeKey(connection)
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
      if (
        validatedAccounts.get(scope) === connection.githubIdentity.id &&
        credentialBundles.get(scope)?.accessToken === token
      )
        return null
      const identity = await options.github.identify(token)
      if (identity.id !== connection.githubIdentity.id)
        throw new GitHubAccessError('account-mismatch')
      // Refresh may have installed a rotated bundle. Never restore its superseded predecessor.
      if (!credentialBundles.has(scope)) credentialBundles.set(scope, credentials)
      validatedAccounts.set(scope, identity.id)
      setUsability(scope, { status: 'usable' })
      return null
    } catch (error) {
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
    providerAccess.set(scope, access)
    return access
  }
  async function ensureAccessToken(connection: GitHubConnection): Promise<string> {
    const scope = authorizationScopeKey(connection)
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
    if (credentials.refreshTokenExpiresAt <= now()) {
      const error = new GitHubAccessError('authorization-required')
      applyCredentialFailure(connection, error)
      throw error
    }
    if (credentials.accessTokenExpiresAt > now() + REFRESH_LEEWAY_MS) return credentials.accessToken
    const activeRefresh = refreshes.get(scope)
    if (activeRefresh?.credentials === credentials) return activeRefresh.result
    const refresh = { credentials, result: refreshAccessToken(connection, credentials) }
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
  ): Promise<string> {
    const { github, credentialVault } = options
    if (!github || !credentialVault) throw new GitHubAccessError('unavailable')
    const scope = authorizationScopeKey(connection)
    const startingCredentials = credentialBundles.get(scope)
    try {
      const refreshed = await github.refresh(credentials.refreshToken)
      if (credentialBundles.get(scope) !== startingCredentials) return ensureAccessToken(connection)
      if ((await github.identify(refreshed.accessToken)).id !== connection.githubIdentity.id)
        throw new GitHubAccessError('account-mismatch')
      const token = await mutateCredentials(async () => {
        if (credentialBundles.get(scope) !== startingCredentials) return null
        try {
          await credentialVault.write(connection.id, refreshed)
        } catch {
          throw new GitHubAccessError('authorization-required')
        }
        if (credentialBundles.get(scope) !== startingCredentials) return null
        credentialBundles.set(scope, refreshed)
        validatedAccounts.set(scope, connection.githubIdentity.id)
        setUsability(scope, { status: 'usable' })
        return refreshed.accessToken
      })
      return token ?? ensureAccessToken(connection)
    } catch (error) {
      const superseded = await mutateCredentials(async () => {
        if (credentialBundles.get(scope) !== startingCredentials) return true
        applyCredentialFailure(connection, error)
        return false
      })
      if (superseded) return ensureAccessToken(connection)
      throw new GitHubAccessError(classifyGitHubAccessFailure(error))
    }
  }
  function applyCredentialFailure(connection: GitHubConnection, error: unknown): void {
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
    if (!options.github || !options.credentialVault) {
      return unsupported('GitHub Connections are not available.')
    }
    const name = command.name.trim()
    if (!name) return invalid('name', 'Connection name cannot be empty.')
    if (command.connectionId) {
      const connection = currentConfiguration().connections.find(
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
    clearTimeout(operation.timer ?? undefined)
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
    if (!(await stageCredentials(operation, update.connectionId, credentials, identity.id))) return

    const outcome = await persistConfiguration(update.configuration, [update.connectionId])
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
    configuration: ProjectConfiguration
    connectionId: string
    reauthorizing: boolean
  } {
    const existingId = operation.public.connectionId
    const existing = existingId
      ? currentConfiguration().connections.find((connection) => connection.id === existingId)
      : undefined
    const connectionId = existingId ?? randomUUID()
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
  ): Promise<boolean> {
    const credentialVault = options.credentialVault
    if (!credentialVault) return false
    try {
      await mutateCredentials(async () => {
        await credentialVault.write(connectionId, credentials)
        const scope = githubAuthorizationScopeKey(connectionId, accountId)
        authorizationOwners.set(scope, connectionId)
        credentialBundles.set(scope, credentials)
        validatedAccounts.set(scope, accountId)
        rejectedAuthorizations.delete(scope)
        setUsability(scope, { status: 'usable' })
      })
    } catch {
      finishAuthorization(operation, 'failed', 'GitHub authorization could not be saved.')
      return false
    }
    return true
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
    clearTimeout(operation.timer ?? undefined)
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
    if (stopping || stopped) return
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
    })
  }
  async function applyConfigurationUpdate(
    result: ConfigurationRead,
    receipt: number,
    stale: boolean,
  ): Promise<void> {
    if (stopped || stopping || !result.ok || stale) return
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
    const prepared = await registry.prepare(result.document, currentConfiguration())
    if (stopped || stopping) return
    if (receipt === configurationReceipt) {
      configurationDurabilityConfirmed = result.durability !== 'unconfirmed'
      configurationStatus = {
        valid: receivedConfigurationValid,
        issues: [],
        notices: result.notices ?? [],
      }
    }
    await coordinator.activate(prepared, () => authorizationFacts(prepared))
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
  async function start(): Promise<void> {
    if (startPromise) return startPromise
    startPromise = (async () => {
      if (stopped || stopping) throw new Error('RoadmapApplication cannot restart after stop().')
      const loaded = await options.configuration.load()
      if (stopped || stopping) return
      const configuration = loaded.ok ? loaded.document : EMPTY_CONFIGURATION
      receivedConfigurationValid = loaded.ok
      configurationDurabilityConfirmed = !loaded.ok || loaded.durability !== 'unconfirmed'
      configurationStatus = loaded.ok
        ? { valid: true, issues: [], notices: loaded.notices ?? [] }
        : { valid: false, issues: loaded.issues, notices: [] }
      updateAdmissionValidity()
      unsubscribeConfiguration = options.configuration.subscribe(receiveConfiguration)
      await cleanupOrphanCredentials(configuration)
      await synchronizeCredentials(configuration)
      if (stopped || stopping) return
      const prepared = await registry.prepare(configuration)
      if (stopped || stopping) return
      await coordinator.activate(prepared, () => authorizationFacts(prepared))
      if (stopped || stopping) return
      await automationEngine?.start()
      await mutationLane
      started = true
      publish()
    })()
    return startPromise
  }
  async function query(query: Query): Promise<QueryResult> {
    if (!started || stopping || stopped)
      return failedQuery('not-supported', 'Roadmap is not running.')
    if (!options.operations) return failedQuery('not-supported', 'This query is not available yet.')
    return options.operations.query(query)
  }
  function execute(command: Command): Promise<CommandOutcome> {
    return enqueue(() => executeCommand(command))
  }
  async function executeCommand(command: Command): Promise<CommandOutcome> {
    if (!started || stopping || stopped) return failure('not-supported', 'Roadmap is not running.')
    if (!configurationStatus.valid || !receivedConfigurationValid || pendingConfigurations.size > 0)
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
    if (!resolved.ok) return { ok: false, error: resolved.error, state }
    if ('result' in resolved) return { ok: true, result: resolved.result, state }
    const outcome = await persistConfiguration(resolved.configuration)
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
    return { ...outcome, state }
  }
  async function persistConfiguration(
    candidate: ProjectConfiguration,
    revalidateConnections: readonly string[] = [],
  ): Promise<CommandOutcome> {
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
      if (!persisted.ok)
        return failure(
          persisted.kind === 'conflict' ? 'conflict' : 'persistence-failed',
          persisted.message,
        )
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
      await synchronizeCredentials(decoded.value)
      const prepared = await registry.prepare(candidate, currentConfiguration(), {
        revalidateConnections,
      })
      await coordinator.activate({ ...decoded.value, admissions: prepared.admissions }, () =>
        authorizationFacts(decoded.value),
      )
      forgetRemovedConnections()
      if (persisted.durability === 'unconfirmed')
        return failure(
          'persistence-failed',
          persisted.message ??
            'Configuration was replaced, but its durability is unconfirmed. Automation remains inhibited.',
        )
      return {
        ok: true,
        result: {
          type: 'configuration-updated',
          configurationVersion: decoded.value.configurationVersion,
        },
        state,
      }
    } finally {
      ownWriteDocument = null
      pendingConfigurations.delete(-1)
      updateAdmissionValidity()
      publish()
    }
  }
  type CommandResolution =
    | { ok: true; result: CommandResult }
    | { ok: true; configuration: ProjectConfiguration }
    | { ok: false; error: SafeError }
  function translateMutation(mutation: RegistryMutation): CommandResolution {
    return mutation.ok
      ? { ok: true, configuration: mutation.value.configuration }
      : { ok: false, error: admissionError(mutation.error) }
  }
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
        return translateMutation(
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
          await registry.repair(
            { project: projectRef(command.project), path: command.workspace.path },
            currentConfiguration(),
          ),
        )
      }
      case 'remove-project':
        return translateMutation(
          registry.remove(projectRef(command.project), currentConfiguration()),
        )
      case 'set-automation-enabled':
        return setAutomationEnabled(command)
      case 'set-project-automation-enabled':
        return setProjectAutomationEnabled(command)
      case 'start-automation-override':
        return startAutomationOverride(command)
      case 'refresh-project':
      case 'launch-action': {
        if (!options.operations) return unsupported('This operation is not available yet.')
        let workspaceProofDependency: { ref: ProjectRef; value: string } | null = null
        function workspaceAdmissionError(project: ProjectKey): AdmissionFailure | null {
          const ref = projectRef(project)
          const expected = workspaceProofDependency
          if (
            !expected ||
            !sameRef(expected.ref, ref) ||
            !receivedConfigurationValid ||
            stopping ||
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
          async refresh(project) {
            try {
              await coordinator.refresh(project)
              return true
            } catch {
              return false
            }
          },
          async workspace(project) {
            const ref = projectRef(project)
            const before = currentConfiguration()
            if (!before.projects.some((intent) => sameRef(intent.ref, ref))) return undefined
            const workspace = await registry.resolveWorkspace(ref, before)
            workspaceProofDependency = { ref, value: workspaceDependency(before, ref) }
            const error = workspaceAdmissionError(project)
            if (error) return { status: 'unavailable', error }
            const current = currentConfiguration()
            await coordinator.activate({
              ...current,
              admissions: current.admissions.map((record) =>
                sameRef(record.intent.ref, ref) ? { ...record, workspace } : record,
              ),
            })
            return workspace
          },
        })
      }
    }
  }
  async function startAutomationOverride(
    command: Extract<Command, { type: 'start-automation-override' }>,
  ): Promise<CommandResolution> {
    if (!automationEngine) return unsupported('Automation is not available.')
    const outcome = await automationEngine.startOverride(command.target, command.stage)
    return outcome.ok
      ? {
          ok: true,
          result: {
            type: 'automation-override-started',
            target: command.target,
            stage: command.stage,
          },
        }
      : outcome
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
          dependentProjects: dependents.map((project) => ({
            integration: project.ref.integration,
            id: project.ref.projectId,
          })),
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
    }
  }
  function setAutomationEnabled(
    command: Extract<Command, { type: 'set-automation-enabled' }>,
  ): CommandResolution {
    const availability = automationAvailability()
    if (command.enabled && availability.status === 'unavailable')
      return invalid('enabled', availability.cause)
    const configuration = currentConfiguration()
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
    if (
      !currentConfiguration().projects.some((project) =>
        sameRef(project.ref, projectRef(command.project)),
      )
    )
      return invalid('project', 'Project does not exist.')
    if (command.enabled && automationEngine) {
      const acknowledged = await automationEngine.acknowledgeProjectInterruption(command.project)
      if (!acknowledged.ok) return acknowledged
    }
    const configuration = currentConfiguration()
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
      updateAdmissionValidity()
      stopPromise = (async () => {
        for (const operation of authorizationOperations.values()) {
          clearTimeout(operation.timer ?? undefined)
          operation.timer = null
        }
        unsubscribeConfiguration?.()
        await automationEngine?.stop()
        await startPromise
        await mutationLane
        stopped = true
        unsubscribeObservation()
        await coordinator.stop()
        changeFeed.stop()
        await options.configuration.stop()
      })()
      return stopPromise
    },
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
function projectRef(project: ProjectKey): ProjectRef {
  return { integration: project.integration, projectId: project.id }
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
function failedQuery(code: SafeError['code'], message: string): QueryResult {
  return { ok: false, error: { code, message } }
}
function safeAuthorizationMessage(error: unknown): string {
  return error instanceof GitHubConnectionError ||
    error instanceof CredentialVaultError ||
    error instanceof GitHubAccessError
    ? error.message
    : 'GitHub authorization is temporarily unavailable.'
}
