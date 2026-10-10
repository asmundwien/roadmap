import {
  type AuthorizationOperationId,
  type ConfigurationVersion,
  type ConnectionId,
  correlationIdSchema,
  type ProjectRef,
} from '@roadmap/contracts/identity'
import {
  type Command,
  type CommandOutcome,
  type CommandResult,
  commandOutcomeFor,
  type OperationSubject,
  type ProjectOperation,
  type QueryResult,
  type SafeError,
} from '@roadmap/contracts/operations'
import type {
  ApplicationState,
  AuthorizationOperation,
  ReadyApplicationState,
} from '@roadmap/contracts/state'
import type { RequestRejection } from '@roadmap/contracts/wire'
import { connectionPath, projectSettingsPath, routePaths } from '../router.ts'

export type WorkflowOperation = Command['type'] | 'select-workspace'
export type WorkflowScope = Extract<OperationSubject, { kind: 'project' | 'registration' }>
const attemptIdSchema = correlationIdSchema.brand<'WorkflowAttemptId'>()
export type WorkflowAttemptId = ReturnType<typeof attemptIdSchema.parse>
type CommandFor<O extends Command['type']> = Extract<Command, { type: O }>
type AttemptBase<O extends WorkflowOperation> = {
  readonly id: WorkflowAttemptId
  readonly operation: O
  readonly subject: OperationSubject
  readonly owner?: WorkflowScope
  readonly nativeOperation?: ProjectOperation
  readonly authorizationConnectionId?: ConnectionId
  readonly dismissed: boolean
}
type CapturedVersion<O extends WorkflowOperation> = O extends Command['type']
  ? { readonly configurationVersion: ConfigurationVersion }
  : { readonly configurationVersion?: never }
type FailureFeedback = {
  readonly error: SafeError
  readonly fields: Readonly<Record<string, string>>
  readonly message: string
}
type LocalAttempt<O extends WorkflowOperation> = AttemptBase<O> &
  FailureFeedback & {
    readonly kind: 'not-dispatched'
    readonly configurationVersion?: never
  }
type DeliveredFailure<O extends WorkflowOperation> = AttemptBase<O> &
  CapturedVersion<O> &
  FailureFeedback &
  (
    | { readonly kind: 'not-admitted'; readonly rejection: RequestRejection }
    | { readonly kind: 'completion-unknown'; readonly reason: 'protocol' | 'delivery' }
  )
type SettledOutcome<A extends CommandOutcome | QueryResult> = A extends CommandOutcome | QueryResult
  ? AttemptBase<A['operation']> &
      CapturedVersion<A['operation']> &
      (A extends { ok: true; result: unknown }
        ? {
            readonly kind: 'acknowledged'
            readonly outcome: A
            readonly result: A['result']
            readonly canonicalSubject: OperationSubject
            readonly destination: string | null
            readonly message: string
            readonly authorization?: AuthorizationResultFeedback
          }
        : { readonly kind: 'rejected'; readonly outcome: A } & FailureFeedback)
  : never
type AttemptUnion<O extends WorkflowOperation = WorkflowOperation> = O extends WorkflowOperation
  ? LocalAttempt<O> | DeliveredFailure<O>
  : never
type SettledUnion = AttemptUnion | SettledOutcome<CommandOutcome | QueryResult>
export type WorkflowSettledAttempt<O extends WorkflowOperation = WorkflowOperation> = Extract<
  SettledUnion,
  { operation: O }
>
type PendingUnion<O extends WorkflowOperation = WorkflowOperation> = O extends WorkflowOperation
  ? AttemptBase<O> & CapturedVersion<O> & { readonly kind: 'pending' }
  : never
export type WorkflowAttempt<O extends WorkflowOperation = WorkflowOperation> = Extract<
  SettledUnion | PendingUnion,
  { operation: O }
>
export type AuthorizationPhaseResult = Extract<
  CommandResult,
  {
    type:
      | 'begin-github-authorization'
      | 'reauthorize-github-connection'
      | 'retry-github-authorization'
      | 'cancel-github-authorization'
  }
>
export type AuthorizationResultFeedback = {
  readonly result: AuthorizationPhaseResult
  readonly previous: AuthorizationOperation | undefined
  readonly consumed: boolean
}
export type WorkflowLifecycle =
  | Readonly<Pick<Extract<ApplicationState, { phase: 'ready' }>, 'phase' | 'mode'>>
  | Readonly<Pick<Extract<ApplicationState, { phase: 'failed' }>, 'phase' | 'cause'>>
  | Readonly<Pick<Exclude<ApplicationState, { phase: 'ready' | 'failed' }>, 'phase'>>
export interface WorkflowPolicy {
  readonly synchronization: 'not-ready' | 'synchronized' | 'retained'
  readonly lifecycle: WorkflowLifecycle | null
  readonly state: Readonly<ApplicationState> | null
}
export interface WorkflowSnapshot {
  readonly attempts: readonly WorkflowAttempt[]
  readonly policy: WorkflowPolicy
}
export interface WorkflowFeedbackResult {
  readonly current: WorkflowAttempt | null
  readonly pending: boolean
  readonly blocked: boolean
  readonly fields: Readonly<Record<string, string>>
  readonly error: SafeError | null
  readonly message: string | null
  readonly destination: string | null
  readonly unknown: readonly Extract<WorkflowAttempt, { kind: 'completion-unknown' }>[]
}
export interface RoadmapWorkflows {
  beginAuthorization(input: {
    name: string
  }): Promise<WorkflowSettledAttempt<'begin-github-authorization'>>
  reauthorizeConnection(input: {
    connectionId: ConnectionId
  }): Promise<WorkflowSettledAttempt<'reauthorize-github-connection'>>
  retryAuthorization(input: {
    operationId: AuthorizationOperationId
  }): Promise<WorkflowSettledAttempt<'retry-github-authorization'>>
  cancelAuthorization(input: {
    operationId: AuthorizationOperationId
  }): Promise<WorkflowSettledAttempt<'cancel-github-authorization'>>
  renameConnection(input: {
    connectionId: ConnectionId
    name: string
  }): Promise<WorkflowSettledAttempt<'rename-connection'>>
  removeConnection(input: {
    connectionId: ConnectionId
  }): Promise<WorkflowSettledAttempt<'remove-connection'>>
  registerProject(input: {
    candidate: CommandFor<'register-project'>['candidate']
  }): Promise<WorkflowSettledAttempt<'register-project'>>
  renameProject(input: {
    project: ProjectRef
    name: string
  }): Promise<WorkflowSettledAttempt<'rename-project'>>
  repairWorkspace(input: {
    project: ProjectRef
    path: string
  }): Promise<WorkflowSettledAttempt<'repair-project-workspace'>>
  removeProject(input: { project: ProjectRef }): Promise<WorkflowSettledAttempt<'remove-project'>>
  setAutomationEnabled(input: {
    enabled: boolean
  }): Promise<WorkflowSettledAttempt<'set-automation-enabled'>>
  setProjectAutomationEnabled(input: {
    project: ProjectRef
    enabled: boolean
  }): Promise<WorkflowSettledAttempt<'set-project-automation-enabled'>>
  startOverride(
    input: Pick<CommandFor<'start-automation-override'>, 'target' | 'stage'>,
  ): Promise<WorkflowSettledAttempt<'start-automation-override'>>
  refreshProject(input: { project: ProjectRef }): Promise<WorkflowSettledAttempt<'refresh-project'>>
  launchProject(input: {
    project: ProjectRef
    operation: ProjectOperation
  }): Promise<WorkflowSettledAttempt<'launch-project-operation'>>
  selectWorkspace(input: {
    owner: WorkflowScope
  }): Promise<WorkflowSettledAttempt<'select-workspace'>>
  dismiss(input: { attemptId: WorkflowAttemptId }): void
}

export interface WorkflowRequestNotAdmitted {
  readonly kind: 'not-admitted'
  readonly ok: false
  readonly rejection: RequestRejection
  readonly error: SafeError
}
export interface WorkflowCompletionUnknown {
  readonly kind: 'completion-unknown'
  readonly reason: 'protocol' | 'delivery'
  readonly ok: false
  readonly error: SafeError
}
type WorkflowCommandDelivery =
  | CommandOutcome
  | WorkflowRequestNotAdmitted
  | WorkflowCompletionUnknown
export type WorkflowQueryDelivery =
  | QueryResult
  | WorkflowRequestNotAdmitted
  | WorkflowCompletionUnknown
export interface RoadmapWorkflowOptions {
  read(): WorkflowPolicy
  dispatch(command: Command, onDispatch: () => void): Promise<WorkflowCommandDelivery>
  query(onDispatch: () => void): Promise<WorkflowQueryDelivery>
  publish(snapshot: WorkflowSnapshot): void
}

const EMPTY_FIELDS: Readonly<Record<string, string>> = Object.freeze({})

function sameProject(left: ProjectRef, right: ProjectRef): boolean {
  return left.integration === right.integration && left.projectId === right.projectId
}

function sameSubject(left: OperationSubject, right: OperationSubject): boolean {
  switch (left.kind) {
    case 'none':
    case 'automation':
      return left.kind === right.kind
    case 'connection':
      return right.kind === 'connection' && left.connectionId === right.connectionId
    case 'project':
      return right.kind === 'project' && sameProject(left.project, right.project)
    case 'registration':
      return (
        right.kind === 'registration' &&
        left.integration === right.integration &&
        left.connectionId === right.connectionId
      )
    case 'authorization':
      return right.kind === 'authorization' && left.operationId === right.operationId
    case 'ticket':
      return (
        right.kind === 'ticket' &&
        left.stage === right.stage &&
        sameProject(left.target.map.project, right.target.map.project) &&
        left.target.map.mapId === right.target.map.mapId &&
        left.target.ticketId === right.target.ticketId
      )
  }
}

function acceptedReady(policy: WorkflowPolicy): Readonly<ReadyApplicationState> | null {
  return policy.state?.phase === 'ready' ? policy.state : null
}

function readyError(policy: WorkflowPolicy, selection: boolean): SafeError | null {
  if (policy.synchronization !== 'synchronized' || policy.lifecycle?.phase !== 'ready') {
    return {
      code: 'not-supported',
      message: 'Roadmap is not synchronized and ready. This attempt was not dispatched.',
    }
  }
  if (selection) return null
  const read = acceptedReady(policy)
  if (read === null || policy.lifecycle.mode !== 'mutable' || !read.configuration.valid) {
    return {
      code: 'configuration-invalid',
      message:
        'Repair the current configuration before making this change. This attempt was not dispatched.',
    }
  }
  return null
}

function scopedConflict(
  operation: WorkflowOperation,
  subject: OperationSubject,
  attempt: WorkflowAttempt,
): boolean {
  if (attempt.kind !== 'pending') return false
  if (operation === 'select-workspace') return attempt.operation === 'select-workspace'
  if (operation === 'refresh-project' || operation === 'launch-project-operation') {
    return (
      (attempt.operation === 'refresh-project' ||
        attempt.operation === 'launch-project-operation') &&
      sameSubject(subject, attempt.subject)
    )
  }
  if (operation === 'start-automation-override') {
    if (
      subject.kind !== 'ticket' ||
      attempt.operation !== operation ||
      attempt.subject.kind !== 'ticket'
    )
      return false
    return subject.stage === 'classification'
      ? attempt.subject.stage === 'classification'
      : attempt.subject.stage === 'wayfinder' &&
          sameProject(subject.target.map.project, attempt.subject.target.map.project)
  }
  return (
    attempt.operation !== 'select-workspace' &&
    attempt.operation !== 'refresh-project' &&
    attempt.operation !== 'launch-project-operation' &&
    attempt.operation !== 'start-automation-override'
  )
}

function policyError(
  state: WorkflowSnapshot,
  operation: WorkflowOperation,
  subject: OperationSubject,
  nativeOperation?: ProjectOperation,
  enabled?: boolean,
): SafeError | null {
  const readiness = readyError(state.policy, operation === 'select-workspace')
  if (readiness !== null) return readiness
  if (state.attempts.some((attempt) => scopedConflict(operation, subject, attempt))) {
    return {
      code: 'conflict',
      message:
        'Another attempt in this scope is pending. This attempt was not dispatched and will not be queued.',
    }
  }
  if (operation === 'select-workspace') return null
  const read = acceptedReady(state.policy)
  if (read === null) return { code: 'not-supported', message: 'Roadmap is not ready.' }
  const connectionError = connectionPolicy(read, operation, subject)
  if (connectionError !== null) return connectionError
  if (subject.kind === 'project')
    return projectPolicy(read, operation, subject, nativeOperation, enabled)
  if (subject.kind === 'authorization') return authorizationPolicy(state, read, operation, subject)
  if (subject.kind === 'ticket' && operation === 'start-automation-override')
    return overridePolicy(read, subject)
  if (operation === 'set-automation-enabled') return enablementPolicy(read, enabled)
  return null
}

function connectionPolicy(
  read: Readonly<ReadyApplicationState>,
  operation: WorkflowOperation,
  subject: OperationSubject,
): SafeError | null {
  if (
    (operation === 'begin-github-authorization' || operation === 'reauthorize-github-connection') &&
    !read.supportedIntegrations.some((integration) => integration.integration === 'github')
  ) {
    return { code: 'not-supported', message: 'GitHub Connections are not available.' }
  }
  if (subject.kind !== 'connection' && subject.kind !== 'registration') return null
  const connection = read.connections.find((entry) => entry.id === subject.connectionId)
  if (connection === undefined)
    return { code: 'validation', field: 'connectionId', message: 'Connection does not exist.' }
  if (subject.kind === 'registration' && connection.integration !== subject.integration)
    return {
      code: 'validation',
      field: 'connectionId',
      message: 'The selected Connection integration changed.',
    }
  if (operation === 'rename-connection' && connection.builtIn)
    return {
      code: 'validation',
      field: 'connectionId',
      message: 'The built-in Connection cannot be renamed.',
    }
  if (operation === 'remove-connection') return removalPolicy(read, connection)
  if (operation === 'reauthorize-github-connection') {
    if (connection.integration !== 'github')
      return {
        code: 'validation',
        field: 'connectionId',
        message: 'GitHub Connection does not exist.',
      }
    if (
      read.authorizationOperations.some(
        (entry) => entry.status === 'waiting' && entry.connectionId === connection.id,
      )
    )
      return {
        code: 'validation',
        field: 'connectionId',
        message: 'Authorization is already in progress for this Connection.',
      }
  }
  return null
}

function removalPolicy(
  read: Readonly<ReadyApplicationState>,
  connection: ReadyApplicationState['connections'][number],
): SafeError | null {
  if (connection.builtIn)
    return {
      code: 'validation',
      field: 'connectionId',
      message: 'The built-in Connection cannot be removed.',
    }
  const dependents = read.projects.filter((project) => project.connectionId === connection.id)
  return dependents.length > 0
    ? {
        code: 'dependency',
        message: 'Remove every dependent Project before removing this Connection.',
        dependentProjects: dependents.map((project) => project.ref),
      }
    : null
}

function projectPolicy(
  read: Readonly<ReadyApplicationState>,
  operation: WorkflowOperation,
  subject: Extract<OperationSubject, { kind: 'project' }>,
  nativeOperation: ProjectOperation | undefined,
  enabled: boolean | undefined,
): SafeError | null {
  const project = read.projects.find((entry) => sameProject(entry.ref, subject.project))
  if (project === undefined)
    return { code: 'validation', field: 'project', message: 'Project does not exist.' }
  if (
    operation === 'launch-project-operation' &&
    !project.actions.some(
      (action) =>
        action.kind === 'server-launch' &&
        sameProject(action.project, subject.project) &&
        (nativeOperation === undefined || action.operation === nativeOperation),
    )
  )
    return {
      code: 'not-supported',
      message: 'This native action is not currently available for this Project.',
    }
  return operation === 'set-project-automation-enabled' ? enablementPolicy(read, enabled) : null
}

function enablementPolicy(
  read: Readonly<ReadyApplicationState>,
  enabled: boolean | undefined,
): SafeError | null {
  return enabled && read.automation.availability.status === 'unavailable'
    ? { code: 'validation', field: 'enabled', message: read.automation.availability.cause }
    : null
}

function overridePolicy(
  read: Readonly<ReadyApplicationState>,
  subject: Extract<OperationSubject, { kind: 'ticket' }>,
): SafeError | null {
  const control = read.automation.overrides.find((entry) =>
    sameSubject({ kind: 'ticket', target: entry.target, stage: subject.stage }, subject),
  )?.[subject.stage]
  if (control === undefined)
    return {
      code: 'not-supported',
      message: 'Automation overrides are unavailable for this ticket.',
    }
  return control.status === 'ineligible' ? { code: 'dependency', message: control.reason } : null
}

function authorizationPolicy(
  state: WorkflowSnapshot,
  read: Readonly<ReadyApplicationState>,
  operation: WorkflowOperation,
  subject: Extract<OperationSubject, { kind: 'authorization' }>,
): SafeError | null {
  const accepted = read.authorizationOperations.find((entry) => entry.id === subject.operationId)
  const returned = authorizationFeedback(state, subject.operationId)
  if (accepted === undefined && (returned === null || returned.consumed))
    return {
      code: 'validation',
      field: 'operationId',
      message: 'Authorization operation does not exist.',
    }
  if (operation !== 'retry-github-authorization') return null
  const phase = returned !== null && !returned.consumed ? returned.result.phase : accepted?.status
  if (phase === 'waiting' || phase === 'granted')
    return {
      code: 'validation',
      field: 'operationId',
      message:
        phase === 'waiting'
          ? 'Authorization is already in progress.'
          : 'Authorization has already been granted.',
    }
  const connectionId = authorizationConnection(accepted)
  if (
    connectionId !== undefined &&
    !read.connections.some(
      (connection) => connection.id === connectionId && connection.integration === 'github',
    )
  )
    return {
      code: 'validation',
      field: 'connectionId',
      message: 'The authorization Connection no longer exists.',
    }
  return null
}

function feedbackFor(
  state: WorkflowSnapshot,
  operation: WorkflowOperation,
  subject: OperationSubject,
  owner: WorkflowScope | undefined,
  nativeOperation: ProjectOperation | undefined,
  enabled: boolean | undefined,
): WorkflowFeedbackResult {
  const matching = state.attempts.filter(
    (attempt) =>
      attempt.operation === operation &&
      sameSubject(attempt.subject, subject) &&
      (owner === undefined
        ? attempt.owner === undefined
        : attempt.owner !== undefined && sameSubject(attempt.owner, owner)) &&
      (nativeOperation === undefined || attempt.nativeOperation === nativeOperation),
  )
  const current = matching.at(-1) ?? null
  const visible =
    current !== null &&
    !current.dismissed &&
    !(current.kind === 'acknowledged' && current.authorization?.consumed)
      ? current
      : null
  const failure =
    visible !== null && visible.kind !== 'pending' && visible.kind !== 'acknowledged'
      ? visible
      : null
  return Object.freeze({
    current,
    pending: matching.some((attempt) => attempt.kind === 'pending'),
    blocked: policyError(state, operation, subject, nativeOperation, enabled) !== null,
    fields: failure?.fields ?? EMPTY_FIELDS,
    error: failure?.error ?? null,
    message:
      visible === null
        ? null
        : visible.kind === 'pending'
          ? pendingMessage(operation)
          : visible.message,
    destination: visible?.kind === 'acknowledged' ? visible.destination : null,
    unknown: Object.freeze(matching.filter((attempt) => attempt.kind === 'completion-unknown')),
  })
}

function pendingMessage(operation: WorkflowOperation): string {
  switch (operation) {
    case 'begin-github-authorization':
      return 'Starting GitHub authorization. The result is pending.'
    case 'reauthorize-github-connection':
      return 'Starting Connection reauthorization. The result is pending.'
    case 'retry-github-authorization':
      return 'Retrying GitHub authorization. The result is pending.'
    case 'cancel-github-authorization':
      return 'Cancelling GitHub authorization. The result is pending.'
    case 'rename-connection':
      return 'Renaming the Connection. The result is pending.'
    case 'remove-connection':
      return 'Removing the Connection. Current configuration does not confirm this pending attempt.'
    case 'register-project':
      return 'Registering the Project. The result is pending.'
    case 'rename-project':
      return 'Renaming the Project. The result is pending.'
    case 'repair-project-workspace':
      return 'Repairing the Project Workspace. The result is pending.'
    case 'remove-project':
      return 'Removing the Project. Current configuration does not confirm this pending attempt.'
    case 'set-automation-enabled':
      return 'Updating Automation enablement. The result is pending.'
    case 'set-project-automation-enabled':
      return 'Updating Project Automation enablement. The result is pending.'
    case 'start-automation-override':
      return 'Requesting the Automation override. The admission result is pending.'
    case 'refresh-project':
      return 'Refreshing the Project source. The result is pending.'
    case 'launch-project-operation':
      return 'Invoking the native action. The result is pending.'
    case 'select-workspace':
      return 'Waiting for Workspace selection.'
  }
}

export function workflowFeedback(
  state: WorkflowSnapshot,
  operation: WorkflowOperation,
  subject: OperationSubject,
  owner?: WorkflowScope,
): WorkflowFeedbackResult {
  const read = acceptedReady(state.policy)
  const enabled =
    operation === 'set-automation-enabled'
      ? !read?.automation.enabled
      : operation === 'set-project-automation-enabled' && subject.kind === 'project'
        ? !read?.automation.enabledProjects.some((project) => sameProject(project, subject.project))
        : undefined
  return feedbackFor(state, operation, subject, owner, undefined, enabled)
}

export function nativeOperationFeedback(
  state: WorkflowSnapshot,
  input: { project: ProjectRef; operation: ProjectOperation },
): WorkflowFeedbackResult {
  return feedbackFor(
    state,
    'launch-project-operation',
    { kind: 'project', project: input.project },
    undefined,
    input.operation,
    undefined,
  )
}

export function automationEnablementFeedback(
  state: WorkflowSnapshot,
  input: { enabled: boolean; project?: ProjectRef },
): WorkflowFeedbackResult {
  return feedbackFor(
    state,
    input.project === undefined ? 'set-automation-enabled' : 'set-project-automation-enabled',
    input.project === undefined
      ? { kind: 'automation' }
      : { kind: 'project', project: input.project },
    undefined,
    undefined,
    input.enabled,
  )
}

export function authorizationPhaseStatus(phase: AuthorizationPhaseResult['phase']): string {
  switch (phase) {
    case 'waiting':
      return 'Waiting for GitHub'
    case 'granted':
      return 'Authorized'
    case 'denied':
      return 'Authorization denied'
    case 'expired':
      return 'Authorization expired'
    case 'cancelled':
      return 'Authorization cancelled'
    case 'failed':
      return 'Authorization failed'
  }
}

export function authorizationFeedback(
  state: WorkflowSnapshot,
  operationId: AuthorizationOperationId,
): AuthorizationResultFeedback | null {
  for (let index = state.attempts.length - 1; index >= 0; index -= 1) {
    const attempt = state.attempts[index]
    if (
      attempt?.kind === 'acknowledged' &&
      attempt.authorization?.result.operationId === operationId
    )
      return attempt.authorization
  }
  return null
}

export function unpublishedAuthorizationFeedback(
  state: WorkflowSnapshot,
): readonly AuthorizationResultFeedback[] {
  const read = acceptedReady(state.policy)
  const results: AuthorizationResultFeedback[] = []
  const seen = new Set<AuthorizationOperationId>()
  for (let index = state.attempts.length - 1; index >= 0; index -= 1) {
    const attempt = state.attempts[index]
    if (attempt?.kind !== 'acknowledged' || attempt.authorization === undefined) continue
    const feedback = attempt.authorization
    if (seen.has(feedback.result.operationId)) continue
    seen.add(feedback.result.operationId)
    if (
      !feedback.consumed &&
      !read?.authorizationOperations.some(
        (operation) => operation.id === feedback.result.operationId,
      )
    )
      results.unshift(feedback)
  }
  return Object.freeze(results)
}

export function connectionAuthorizationFeedback(
  state: WorkflowSnapshot,
  connectionId: ConnectionId,
): readonly WorkflowFeedbackResult[] {
  const operationIds = new Set<AuthorizationOperationId>()
  for (const attempt of state.attempts) {
    if (attempt.authorizationConnectionId !== connectionId) continue
    if (attempt.subject.kind === 'authorization') operationIds.add(attempt.subject.operationId)
    if (attempt.kind === 'acknowledged' && attempt.authorization !== undefined)
      operationIds.add(attempt.authorization.result.operationId)
  }
  const feedback = [
    workflowFeedback(state, 'reauthorize-github-connection', { kind: 'connection', connectionId }),
  ]
  for (const operationId of operationIds) {
    feedback.push(
      workflowFeedback(state, 'retry-github-authorization', { kind: 'authorization', operationId }),
      workflowFeedback(state, 'cancel-github-authorization', {
        kind: 'authorization',
        operationId,
      }),
    )
  }
  return Object.freeze(feedback)
}

function fieldFeedback(operation: WorkflowOperation, error: SafeError): FailureFeedback {
  const field = error.field
  const fields: Record<string, string> = {}
  if (field !== undefined) {
    if (operation === 'register-project' && field === 'connectionId')
      fields.connection = error.message
    else if (field.startsWith('workspace')) {
      fields.workspace = error.message
      fields.folder = error.message
    } else fields[field] = error.message
  }
  return { error, fields: Object.freeze(fields), message: error.message }
}

function sameAuthorization(
  current: AuthorizationOperation,
  previous: AuthorizationOperation | undefined,
): boolean {
  if (previous === undefined || current.id !== previous.id) return false
  switch (current.status) {
    case 'waiting':
      return (
        previous.status === 'waiting' &&
        current.verificationUri === previous.verificationUri &&
        current.userCode === previous.userCode &&
        current.expiresAt === previous.expiresAt &&
        current.connectionId === previous.connectionId
      )
    case 'granted':
      return (
        previous.status === 'granted' &&
        current.connection.kind === previous.connection.kind &&
        current.connection.id === previous.connection.id &&
        current.connection.accountId === previous.connection.accountId
      )
    case 'terminal':
      return (
        previous.status === 'terminal' &&
        current.outcome === previous.outcome &&
        current.connectionId === previous.connectionId &&
        ('cause' in current ? current.cause : undefined) ===
          ('cause' in previous ? previous.cause : undefined)
      )
  }
}

function freezeWorkflow<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeWorkflow(child)
    Object.freeze(value)
  }
  return value
}

type WorkflowIntent = Command extends infer C
  ? C extends Command
    ? Omit<C, 'expectedConfigurationVersion'>
    : never
  : never
type DispatchCapture = {
  readonly id: WorkflowAttemptId
  readonly subject: OperationSubject
  readonly configurationVersion: ConfigurationVersion
  readonly nativeOperation?: ProjectOperation
  readonly authorizationConnectionId?: ConnectionId
  readonly previous: AuthorizationOperation | undefined
  authorizationConsumed: boolean
  readonly removalDestination: string | null
}

function authorizationConnection(
  operation: AuthorizationOperation | undefined,
): ConnectionId | undefined {
  return operation?.status === 'granted' ? operation.connection.id : operation?.connectionId
}

function acknowledgement(
  result: CommandResult,
  removalDestination: string | null,
): { message: string; destination: string | null; canonicalSubject: OperationSubject } {
  switch (result.type) {
    case 'begin-github-authorization':
    case 'reauthorize-github-connection':
    case 'retry-github-authorization':
    case 'cancel-github-authorization':
      return {
        canonicalSubject:
          result.phase === 'granted'
            ? { kind: 'connection', connectionId: result.connection.connectionId }
            : { kind: 'authorization', operationId: result.operationId },
        destination:
          result.phase === 'granted' ? connectionPath(result.connection.connectionId) : null,
        message:
          result.phase === 'granted'
            ? `Connection ${result.connection.connectionId} authorized for account ${result.connection.accountId} at configuration version ${result.configurationVersion}.`
            : result.phase === 'failed' || result.phase === 'denied'
              ? result.error.message
              : `${authorizationPhaseStatus(result.phase)}.`,
      }
    case 'rename-connection':
      return {
        canonicalSubject: { kind: 'connection', connectionId: result.connectionId },
        destination: null,
        message: commitMessage(result, `Connection ${result.connectionId} renamed`),
      }
    case 'remove-connection':
      return {
        canonicalSubject: { kind: 'connection', connectionId: result.connectionId },
        destination: result.commit === 'committed' ? routePaths.connections : null,
        message: `${commitMessage(result, `Connection ${result.connectionId} removed`)} External GitHub authorization and repositories remain unchanged.`,
      }
    case 'register-project':
      return {
        canonicalSubject: { kind: 'project', project: result.project },
        destination: result.commit === 'committed' ? projectSettingsPath(result.project) : null,
        message: `${commitMessage(result, `Project ${result.project.integration}/${result.project.projectId} registered through Connection ${result.connectionId}`)} Workspace: ${result.workspacePath}.`,
      }
    case 'rename-project':
      return {
        canonicalSubject: { kind: 'project', project: result.project },
        destination: null,
        message: commitMessage(result, `Project ${result.project.projectId} renamed`),
      }
    case 'repair-project-workspace':
      return {
        canonicalSubject: { kind: 'project', project: result.project },
        destination: result.commit === 'committed' ? projectSettingsPath(result.project) : null,
        message: `${commitMessage(result, `Project ${result.project.projectId} Workspace repaired`)} Workspace: ${result.workspacePath}.`,
      }
    case 'remove-project':
      return {
        canonicalSubject: { kind: 'project', project: result.project },
        destination: result.commit === 'committed' ? removalDestination : null,
        message: `${commitMessage(result, `Project ${result.project.projectId} removed`)} Workspace files remain unchanged.`,
      }
    case 'set-automation-enabled':
      return {
        canonicalSubject: { kind: 'automation' },
        destination: null,
        message: commitMessage(result, `Automation ${result.enabled ? 'enabled' : 'disabled'}`),
      }
    case 'set-project-automation-enabled':
      return {
        canonicalSubject: { kind: 'project', project: result.project },
        destination: null,
        message: commitMessage(
          result,
          `Project ${result.project.projectId} Automation ${result.enabled ? 'enabled' : 'disabled'}`,
        ),
      }
    case 'start-automation-override':
      return {
        canonicalSubject: { kind: 'ticket', target: result.target, stage: result.stage },
        destination: null,
        message: `${result.stage === 'classification' ? 'Classification' : 'Wayfinder'} override admitted for ticket ${result.target.ticketId}. This does not confirm a Process or Session result.`,
      }
    case 'refresh-project': {
      const attempt = result.attempt
      const message =
        attempt.kind === 'observed'
          ? `Project ${result.project.projectId} source observed at ${attempt.observedAt}.`
          : attempt.kind === 'proven-absent'
            ? `Project ${result.project.projectId} source absence proven at ${attempt.observedAt}.`
            : attempt.kind === 'degraded'
              ? `Project ${result.project.projectId} refresh completed with degraded source evidence. ${attempt.cause}`
              : `Project ${result.project.projectId} refresh failed. ${attempt.cause}`
      return {
        canonicalSubject: { kind: 'project', project: result.project },
        destination: null,
        message,
      }
    }
    case 'launch-project-operation':
      return {
        canonicalSubject: { kind: 'project', project: result.project },
        destination: null,
        message: `Host action invoked for ${result.project.projectId}. This does not confirm a Session or Process result.`,
      }
  }
}

function commitMessage(
  result: {
    configurationVersion: ConfigurationVersion
    commit: 'committed' | 'committed-unconfirmed'
  },
  action: string,
): string {
  return result.commit === 'committed'
    ? `${action} at configuration version ${result.configurationVersion}.`
    : `${action} committed at configuration version ${result.configurationVersion}, but durability is unconfirmed.`
}

function commandAuthorizationFeedback(
  result: CommandResult,
  capture: DispatchCapture,
): AuthorizationResultFeedback | undefined {
  switch (result.type) {
    case 'begin-github-authorization':
    case 'reauthorize-github-connection':
    case 'retry-github-authorization':
    case 'cancel-github-authorization':
      return { result, previous: capture.previous, consumed: capture.authorizationConsumed }
    default:
      return undefined
  }
}

function acknowledged<A extends Extract<CommandOutcome, { ok: true }>>(
  outcome: A,
  capture: DispatchCapture,
): AttemptBase<A['operation']> &
  CapturedVersion<Command['type']> & {
    readonly kind: 'acknowledged'
    readonly outcome: A
    readonly result: A['result']
    readonly authorization?: AuthorizationResultFeedback
  } & ReturnType<typeof acknowledgement> {
  const result: A['result'] = outcome.result
  const authorization = commandAuthorizationFeedback(result, capture)
  return {
    id: capture.id,
    operation: outcome.operation,
    subject: capture.subject,
    configurationVersion: capture.configurationVersion,
    dismissed: false,
    ...(capture.nativeOperation === undefined ? {} : { nativeOperation: capture.nativeOperation }),
    ...(capture.authorizationConnectionId === undefined
      ? {}
      : { authorizationConnectionId: capture.authorizationConnectionId }),
    kind: 'acknowledged',
    outcome,
    result,
    ...acknowledgement(result, capture.removalDestination),
    ...(authorization === undefined ? {} : { authorization }),
  }
}

function rejected<A extends Extract<CommandOutcome, { ok: false }>>(
  outcome: A,
  capture: DispatchCapture,
): AttemptBase<A['operation']> &
  CapturedVersion<Command['type']> & {
    readonly kind: 'rejected'
    readonly outcome: A
  } & FailureFeedback {
  return {
    id: capture.id,
    operation: outcome.operation,
    subject: capture.subject,
    configurationVersion: capture.configurationVersion,
    dismissed: false,
    ...(capture.nativeOperation === undefined ? {} : { nativeOperation: capture.nativeOperation }),
    ...(capture.authorizationConnectionId === undefined
      ? {}
      : { authorizationConnectionId: capture.authorizationConnectionId }),
    kind: 'rejected',
    outcome,
    ...fieldFeedback(outcome.operation, outcome.error),
  }
}

function settleOutcome(outcome: CommandOutcome, capture: DispatchCapture): WorkflowSettledAttempt {
  switch (outcome.operation) {
    case 'begin-github-authorization':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'reauthorize-github-connection':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'retry-github-authorization':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'cancel-github-authorization':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'rename-connection':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'remove-connection':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'register-project':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'rename-project':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'repair-project-workspace':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'remove-project':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'set-automation-enabled':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'set-project-automation-enabled':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'start-automation-override':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'refresh-project':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
    case 'launch-project-operation':
      return outcome.ok ? acknowledged(outcome, capture) : rejected(outcome, capture)
  }
}

function isOperationAttempt<O extends WorkflowOperation>(
  attempt: WorkflowSettledAttempt,
  operation: O,
): attempt is WorkflowSettledAttempt<O> {
  return attempt.operation === operation
}

async function operationAttempt<O extends WorkflowOperation>(
  settled: Promise<WorkflowSettledAttempt>,
  operation: O,
): Promise<WorkflowSettledAttempt<O>> {
  const attempt = await settled
  if (!isOperationAttempt(attempt, operation))
    throw new Error('Workflow settlement does not match its initiating operation.')
  return attempt
}

/** Owns browser dispatch policy and immutable attempt evidence, never accepted server facts. */
export function createRoadmapWorkflows(options: RoadmapWorkflowOptions): {
  readonly workflows: RoadmapWorkflows
  getSnapshot(): WorkflowSnapshot
  synchronize(policy: WorkflowPolicy): void
} {
  function readPolicy(policy: WorkflowPolicy = options.read()): WorkflowPolicy {
    return {
      synchronization: policy.synchronization,
      lifecycle: policy.lifecycle,
      state: policy.state,
    }
  }
  let state: WorkflowSnapshot = freezeWorkflow({ attempts: [], policy: readPolicy() })
  const captures = new Map<WorkflowAttemptId, DispatchCapture>()

  function reconcile(next: WorkflowSnapshot): WorkflowSnapshot {
    const read = acceptedReady(next.policy)
    for (const capture of captures.values()) {
      if (capture.authorizationConsumed || capture.previous === undefined) continue
      const current = read?.authorizationOperations.find(
        (operation) => operation.id === capture.previous?.id,
      )
      if (current !== undefined && !sameAuthorization(current, capture.previous))
        capture.authorizationConsumed = true
    }
    let changed = false
    const attempts = next.attempts.map((attempt, index) => {
      if (
        attempt.kind !== 'acknowledged' ||
        attempt.authorization === undefined ||
        attempt.authorization.consumed
      )
        return attempt
      const feedback = attempt.authorization
      const accepted = read?.authorizationOperations.find(
        (operation) => operation.id === feedback.result.operationId,
      )
      const superseded = next.attempts.slice(index + 1).some((later) => {
        if (later.kind !== 'acknowledged' || later.authorization === undefined) return false
        if (
          later.operation !== 'begin-github-authorization' &&
          later.operation !== 'reauthorize-github-connection' &&
          later.operation !== 'retry-github-authorization' &&
          later.operation !== 'cancel-github-authorization'
        )
          return false
        return (
          (later.subject.kind === 'authorization' &&
            later.subject.operationId === feedback.result.operationId) ||
          later.authorization.result.operationId === feedback.result.operationId ||
          (attempt.authorizationConnectionId !== undefined &&
            later.authorizationConnectionId === attempt.authorizationConnectionId) ||
          (attempt.operation === 'begin-github-authorization' &&
            later.operation === 'begin-github-authorization')
        )
      })
      if (!superseded && (accepted === undefined || sameAuthorization(accepted, feedback.previous)))
        return attempt
      changed = true
      return { ...attempt, authorization: { ...feedback, consumed: true } }
    })
    return changed ? { ...next, attempts } : next
  }

  function publish(next: WorkflowSnapshot): void {
    state = freezeWorkflow(reconcile(next))
    options.publish(state)
  }

  function replace(attempt: WorkflowAttempt): void {
    const index = state.attempts.findIndex((current) => current.id === attempt.id)
    const existing = state.attempts[index]
    const retained =
      existing?.dismissed && !attempt.dismissed ? { ...attempt, dismissed: true } : attempt
    publish({
      ...state,
      policy: readPolicy(),
      attempts:
        index < 0
          ? [...state.attempts, retained]
          : state.attempts.map((current, position) => (position === index ? retained : current)),
    })
  }

  function currentPolicy(): WorkflowSnapshot {
    state = freezeWorkflow(reconcile({ ...state, policy: readPolicy() }))
    return state
  }

  async function run(
    intent: WorkflowIntent,
    validation?: SafeError,
  ): Promise<WorkflowSettledAttempt> {
    const id = attemptIdSchema.parse(crypto.randomUUID())
    const current = currentPolicy()
    const read = acceptedReady(current.policy)
    const subject = intentSubject(intent)
    const nativeOperation =
      intent.type === 'launch-project-operation' ? intent.operation : undefined
    const enabled =
      intent.type === 'set-automation-enabled' || intent.type === 'set-project-automation-enabled'
        ? intent.enabled
        : undefined
    const previous =
      subject.kind === 'authorization'
        ? read?.authorizationOperations.find((operation) => operation.id === subject.operationId)
        : intent.type === 'reauthorize-github-connection'
          ? read?.authorizationOperations.findLast(
              (operation) => authorizationConnection(operation) === intent.connectionId,
            )
          : undefined
    const returned =
      subject.kind === 'authorization' ? authorizationFeedback(current, subject.operationId) : null
    const authorizationConnectionId =
      subject.kind === 'connection' && intent.type === 'reauthorize-github-connection'
        ? subject.connectionId
        : (authorizationConnection(previous) ??
          (returned?.result.phase === 'granted'
            ? returned.result.connection.connectionId
            : undefined) ??
          current.attempts.findLast(
            (attempt) =>
              attempt.kind === 'acknowledged' &&
              attempt.authorization?.result.operationId ===
                (subject.kind === 'authorization' ? subject.operationId : undefined),
          )?.authorizationConnectionId)
    const common = {
      id,
      operation: intent.type,
      subject,
      dismissed: false,
      ...(nativeOperation === undefined ? {} : { nativeOperation }),
      ...(authorizationConnectionId === undefined ? {} : { authorizationConnectionId }),
    }
    const error = validation ?? policyError(current, intent.type, subject, nativeOperation, enabled)
    if ((error !== null && error !== undefined) || read === null) {
      const attempt = localAttempt(
        common,
        error ?? { code: 'not-supported', message: 'Roadmap is not ready.' },
      )
      replace(attempt)
      return attempt
    }
    const command: Command = { ...intent, expectedConfigurationVersion: read.configurationVersion }
    const capture: DispatchCapture = {
      id,
      subject,
      configurationVersion: read.configurationVersion,
      ...(nativeOperation === undefined ? {} : { nativeOperation }),
      ...(authorizationConnectionId === undefined ? {} : { authorizationConnectionId }),
      previous,
      authorizationConsumed: false,
      removalDestination:
        intent.type === 'remove-project'
          ? (() => {
              const project = read.projects.find((entry) => sameProject(entry.ref, intent.project))
              return project === undefined ? null : connectionPath(project.connectionId)
            })()
          : null,
    }
    const pending = pendingAttempt(common, read.configurationVersion)
    captures.set(id, capture)
    // Reserve synchronously, but do not notify until transport has invoked fetch under request-start authority.
    state = freezeWorkflow({ ...state, attempts: [...state.attempts, pending] })
    let delivery = await options.dispatch(command, () =>
      publish({ ...state, policy: readPolicy() }),
    )
    if (!('kind' in delivery) && !commandOutcomeFor(command, delivery)) {
      delivery = {
        kind: 'completion-unknown',
        reason: 'protocol',
        ok: false,
        error: {
          code: 'transport-failed',
          message: 'The command result did not match this attempt. Its completion is unknown.',
        },
      }
    }
    const attempt =
      'kind' in delivery
        ? deliveredFailure(common, capture.configurationVersion, delivery)
        : settleOutcome(delivery, capture)
    replace(attempt)
    captures.delete(id)
    const published = state.attempts.find((current) => current.id === id)
    return published !== undefined && published.kind !== 'pending' ? published : attempt
  }

  const actions: RoadmapWorkflows = {
    beginAuthorization({ name }) {
      const trimmed = name.trim()
      return operationAttempt(
        run(
          { type: 'begin-github-authorization', name: trimmed },
          trimmed
            ? undefined
            : { code: 'validation', field: 'name', message: 'Connection name cannot be empty.' },
        ),
        'begin-github-authorization',
      )
    },
    reauthorizeConnection({ connectionId }) {
      return operationAttempt(
        run({ type: 'reauthorize-github-connection', connectionId }),
        'reauthorize-github-connection',
      )
    },
    retryAuthorization({ operationId }) {
      return operationAttempt(
        run({ type: 'retry-github-authorization', operationId }),
        'retry-github-authorization',
      )
    },
    cancelAuthorization({ operationId }) {
      return operationAttempt(
        run({ type: 'cancel-github-authorization', operationId }),
        'cancel-github-authorization',
      )
    },
    renameConnection({ connectionId, name }) {
      const trimmed = name.trim()
      return operationAttempt(
        run(
          { type: 'rename-connection', connectionId, name: trimmed },
          trimmed
            ? undefined
            : { code: 'validation', field: 'name', message: 'Connection name cannot be empty.' },
        ),
        'rename-connection',
      )
    },
    removeConnection({ connectionId }) {
      return operationAttempt(run({ type: 'remove-connection', connectionId }), 'remove-connection')
    },
    registerProject({ candidate }) {
      const displayName = candidate.displayName?.trim()
      const normalized = {
        integration: candidate.integration,
        connectionId: candidate.connectionId,
        workspace: { path: candidate.workspace.path },
        ...(displayName ? { displayName } : {}),
      }
      return operationAttempt(
        run(
          { type: 'register-project', candidate: normalized },
          candidate.workspace.path.trim()
            ? undefined
            : {
                code: 'validation',
                field: candidate.integration === 'github' ? 'workspace' : 'folder',
                message: 'Choose a readable Workspace folder.',
              },
        ),
        'register-project',
      )
    },
    renameProject({ project, name }) {
      const trimmed = name.trim()
      return operationAttempt(
        run(
          { type: 'rename-project', project, name: trimmed },
          trimmed
            ? undefined
            : { code: 'validation', field: 'name', message: 'Project name cannot be empty.' },
        ),
        'rename-project',
      )
    },
    repairWorkspace({ project, path }) {
      return operationAttempt(
        run(
          { type: 'repair-project-workspace', project, workspace: { path } },
          path.trim()
            ? undefined
            : {
                code: 'validation',
                field: 'workspace',
                message: 'Choose a readable Workspace folder.',
              },
        ),
        'repair-project-workspace',
      )
    },
    removeProject({ project }) {
      return operationAttempt(run({ type: 'remove-project', project }), 'remove-project')
    },
    setAutomationEnabled({ enabled }) {
      return operationAttempt(
        run({ type: 'set-automation-enabled', enabled }),
        'set-automation-enabled',
      )
    },
    setProjectAutomationEnabled({ project, enabled }) {
      return operationAttempt(
        run({ type: 'set-project-automation-enabled', project, enabled }),
        'set-project-automation-enabled',
      )
    },
    startOverride({ target, stage }) {
      return operationAttempt(
        run({ type: 'start-automation-override', target, stage }),
        'start-automation-override',
      )
    },
    refreshProject({ project }) {
      return operationAttempt(run({ type: 'refresh-project', project }), 'refresh-project')
    },
    launchProject({ project, operation }) {
      return operationAttempt(
        run({ type: 'launch-project-operation', project, operation }),
        'launch-project-operation',
      )
    },
    async selectWorkspace({ owner }) {
      const id = attemptIdSchema.parse(crypto.randomUUID())
      const common = {
        id,
        operation: 'select-workspace',
        subject: { kind: 'none' },
        owner,
        dismissed: false,
      } satisfies AttemptBase<'select-workspace'>
      const current = currentPolicy()
      const error = policyError(current, 'select-workspace', common.subject)
      if (error !== null) {
        const attempt = {
          ...common,
          kind: 'not-dispatched',
          ...fieldFeedback('select-workspace', error),
        } satisfies WorkflowSettledAttempt<'select-workspace'>
        replace(attempt)
        return attempt
      }
      const pending = { ...common, kind: 'pending' } satisfies WorkflowAttempt<'select-workspace'>
      state = freezeWorkflow({ ...state, attempts: [...state.attempts, pending] })
      const delivery = await options.query(() => publish({ ...state, policy: readPolicy() }))
      const attempt =
        'kind' in delivery
          ? ({
              ...common,
              ...fieldFeedback('select-workspace', delivery.error),
              ...(delivery.kind === 'not-admitted'
                ? { kind: 'not-admitted', rejection: delivery.rejection }
                : { kind: 'completion-unknown', reason: delivery.reason }),
            } satisfies WorkflowSettledAttempt<'select-workspace'>)
          : delivery.ok
            ? ({
                ...common,
                kind: 'acknowledged',
                outcome: delivery,
                result: delivery.result,
                canonicalSubject: delivery.subject,
                destination: null,
                message:
                  delivery.result.kind === 'selected'
                    ? `Workspace selected: ${delivery.result.path}.`
                    : 'Workspace selection cancelled.',
              } satisfies WorkflowSettledAttempt<'select-workspace'>)
            : ({
                ...common,
                kind: 'rejected',
                outcome: delivery,
                ...fieldFeedback('select-workspace', delivery.error),
              } satisfies WorkflowSettledAttempt<'select-workspace'>)
      replace(attempt)
      const published = state.attempts.find((current) => current.id === id)
      return operationAttempt(
        Promise.resolve(
          published !== undefined && published.kind !== 'pending' ? published : attempt,
        ),
        'select-workspace',
      )
    },
    dismiss({ attemptId }) {
      const attempt = state.attempts.find((current) => current.id === attemptId)
      if (attempt !== undefined && !attempt.dismissed) replace({ ...attempt, dismissed: true })
    },
  }
  const workflows = Object.freeze(actions)
  return {
    workflows,
    getSnapshot: () => state,
    synchronize(policy) {
      state = freezeWorkflow(reconcile({ ...state, policy: readPolicy(policy) }))
    },
  }
}

function intentSubject(intent: WorkflowIntent): OperationSubject {
  switch (intent.type) {
    case 'begin-github-authorization':
      return { kind: 'none' }
    case 'reauthorize-github-connection':
    case 'rename-connection':
    case 'remove-connection':
      return { kind: 'connection', connectionId: intent.connectionId }
    case 'retry-github-authorization':
    case 'cancel-github-authorization':
      return { kind: 'authorization', operationId: intent.operationId }
    case 'register-project':
      return {
        kind: 'registration',
        integration: intent.candidate.integration,
        connectionId: intent.candidate.connectionId,
      }
    case 'set-automation-enabled':
      return { kind: 'automation' }
    case 'start-automation-override':
      return { kind: 'ticket', target: intent.target, stage: intent.stage }
    case 'rename-project':
    case 'repair-project-workspace':
    case 'remove-project':
    case 'set-project-automation-enabled':
    case 'refresh-project':
    case 'launch-project-operation':
      return { kind: 'project', project: intent.project }
  }
}

type CommandEvidence = AttemptBase<Command['type']> &
  (
    | { readonly kind: 'pending'; readonly configurationVersion: ConfigurationVersion }
    | ({ readonly kind: 'not-dispatched' } & FailureFeedback)
    | ({ readonly configurationVersion: ConfigurationVersion } & FailureFeedback &
        (
          | { readonly kind: 'not-admitted'; readonly rejection: RequestRejection }
          | { readonly kind: 'completion-unknown'; readonly reason: 'protocol' | 'delivery' }
        ))
  )

function commandEvidence(evidence: CommandEvidence): WorkflowAttempt {
  // Expand the actual operation discriminant rather than casting a union to a generic result.
  switch (evidence.operation) {
    case 'begin-github-authorization':
      return { ...evidence, operation: 'begin-github-authorization' }
    case 'reauthorize-github-connection':
      return { ...evidence, operation: 'reauthorize-github-connection' }
    case 'retry-github-authorization':
      return { ...evidence, operation: 'retry-github-authorization' }
    case 'cancel-github-authorization':
      return { ...evidence, operation: 'cancel-github-authorization' }
    case 'rename-connection':
      return { ...evidence, operation: 'rename-connection' }
    case 'remove-connection':
      return { ...evidence, operation: 'remove-connection' }
    case 'register-project':
      return { ...evidence, operation: 'register-project' }
    case 'rename-project':
      return { ...evidence, operation: 'rename-project' }
    case 'repair-project-workspace':
      return { ...evidence, operation: 'repair-project-workspace' }
    case 'remove-project':
      return { ...evidence, operation: 'remove-project' }
    case 'set-automation-enabled':
      return { ...evidence, operation: 'set-automation-enabled' }
    case 'set-project-automation-enabled':
      return { ...evidence, operation: 'set-project-automation-enabled' }
    case 'start-automation-override':
      return { ...evidence, operation: 'start-automation-override' }
    case 'refresh-project':
      return { ...evidence, operation: 'refresh-project' }
    case 'launch-project-operation':
      return { ...evidence, operation: 'launch-project-operation' }
  }
}

function localAttempt(
  common: AttemptBase<Command['type']>,
  error: SafeError,
): WorkflowSettledAttempt {
  const attempt = commandEvidence({
    ...common,
    kind: 'not-dispatched',
    ...fieldFeedback(common.operation, error),
  })
  if (attempt.kind === 'pending')
    throw new Error('Local validation cannot publish pending evidence.')
  return attempt
}

function pendingAttempt(
  common: AttemptBase<Command['type']>,
  configurationVersion: ConfigurationVersion,
): WorkflowAttempt {
  return commandEvidence({ ...common, configurationVersion, kind: 'pending' })
}

function deliveredFailure(
  common: AttemptBase<Command['type']>,
  configurationVersion: ConfigurationVersion,
  delivery: WorkflowRequestNotAdmitted | WorkflowCompletionUnknown,
): WorkflowSettledAttempt {
  const attempt = commandEvidence({
    ...common,
    configurationVersion,
    ...fieldFeedback(common.operation, delivery.error),
    ...(delivery.kind === 'not-admitted'
      ? { kind: 'not-admitted', rejection: delivery.rejection }
      : { kind: 'completion-unknown', reason: delivery.reason }),
  })
  if (attempt.kind === 'pending')
    throw new Error('Delivery failure cannot publish pending evidence.')
  return attempt
}
