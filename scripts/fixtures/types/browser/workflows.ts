import type {
  AuthorizationOperationId,
  ConfigurationVersion,
  ConnectionId,
  ProjectRef,
  TicketRef,
} from '@roadmap/contracts/identity'
import type {
  Command,
  CommandOutcomeFor,
  CommandResultFor,
  QueryResult,
  SafeError,
} from '@roadmap/contracts/operations'
import { type RoadmapViewState, useRoadmap } from '@/store/roadmap-provider'
import type { RoadmapStore, RoadmapStoreSnapshot } from '@/store/roadmap-store'
import {
  type AuthorizationResultFeedback,
  authorizationFeedback,
  authorizationPhaseStatus,
  automationEnablementFeedback,
  nativeOperationFeedback,
  unpublishedAuthorizationFeedback,
  workflowFeedback,
} from '@/workflows/workflows'

type Workflows = RoadmapViewState['workflows']
type Attempts = RoadmapViewState['workflowState']['attempts']
type Attempt = Attempts[number]
type SelectionOwner = Parameters<Workflows['selectWorkspace']>[0]['owner']

declare const workflows: Workflows
declare const store: RoadmapStore
declare const snapshot: RoadmapStoreSnapshot
declare const project: ProjectRef
declare const connectionId: ConnectionId
declare const operationId: AuthorizationOperationId
declare const target: TicketRef
declare const candidate: Extract<Command, { type: 'register-project' }>['candidate']
declare const attemptId: Attempt['id']

export const registrationOwner: SelectionOwner = {
  kind: 'registration',
  integration: 'local',
  connectionId,
}
export const repairOwner: SelectionOwner = { kind: 'project', project }
export const stableWorkflows: Workflows = store.workflows
export const immutableSnapshotAttempts: Attempts = snapshot.workflows.attempts

export function selectedWorkflow() {
  return useRoadmap((read) => ({
    workflows: read.workflows,
    feedback: workflowFeedback(read.workflowState, 'rename-project', { kind: 'project', project }),
    folder: workflowFeedback(read.workflowState, 'select-workspace', { kind: 'none' }, repairOwner),
    attempts: read.workflowState.attempts,
    authorization: authorizationFeedback(read.workflowState, operationId),
    unpublishedAuthorization: unpublishedAuthorizationFeedback(read.workflowState),
    native: nativeOperationFeedback(read.workflowState, { project, operation: 'open-workspace' }),
    automation: automationEnablementFeedback(read.workflowState, { project, enabled: true }),
  }))
}

export function selectedFeedback() {
  const selected = selectedWorkflow()
  const current: Attempt | null = selected.feedback.current
  const pending: boolean = selected.feedback.pending
  const blocked: boolean = selected.feedback.blocked
  const fields: Readonly<Record<string, string>> = selected.feedback.fields
  const error: SafeError | null = selected.feedback.error
  const message: string | null = selected.feedback.message
  const destination: string | null = selected.feedback.destination
  const unknown: readonly Attempt[] = selected.feedback.unknown
  const browserDestination: URL | null =
    destination === null ? null : new URL(destination, window.location.href)
  void browserDestination
  return { current, pending, blocked, fields, error, message, destination, unknown }
}

export function effectiveAuthorization() {
  const selected = selectedWorkflow()
  const authorization: AuthorizationResultFeedback | null = selected.authorization
  const unpublished: readonly AuthorizationResultFeedback[] = selected.unpublishedAuthorization
  if (authorization === null) return unpublished
  const result = authorization.result
  const status: string = authorizationPhaseStatus(result.phase)
  const consumed: boolean = authorization.consumed
  switch (result.phase) {
    case 'waiting': {
      const verificationUri: string = result.verificationUri
      const userCode: string = result.userCode
      const expiresAt: number = result.expiresAt
      return { status, consumed, verificationUri, userCode, expiresAt }
    }
    case 'granted': {
      const connection: ConnectionId = result.connection.connectionId
      const committedVersion: ConfigurationVersion = result.configurationVersion
      return { status, consumed, connection, committedVersion }
    }
    case 'denied':
    case 'failed': {
      const error: SafeError = result.error
      return { status, consumed, error }
    }
    case 'expired':
    case 'cancelled':
      return { status, consumed }
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

export async function legitimateNamedCalls() {
  const begin = await workflows.beginAuthorization({ name: 'Personal GitHub' })
  if (begin.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'begin-github-authorization' }>> =
      begin.result
    void result
  }
  const reauthorize = await workflows.reauthorizeConnection({ connectionId })
  if (reauthorize.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'reauthorize-github-connection' }>> =
      reauthorize.result
    void result
  }
  const retry = await workflows.retryAuthorization({ operationId })
  if (retry.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'retry-github-authorization' }>> =
      retry.result
    void result
  }
  const cancel = await workflows.cancelAuthorization({ operationId })
  if (cancel.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'cancel-github-authorization' }>> =
      cancel.result
    void result
  }
  const renameConnection = await workflows.renameConnection({ connectionId, name: 'Work GitHub' })
  if (renameConnection.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'rename-connection' }>> =
      renameConnection.result
    void result
  }
  const removeConnection = await workflows.removeConnection({ connectionId })
  if (removeConnection.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'remove-connection' }>> =
      removeConnection.result
    void result
  }
  const register = await workflows.registerProject({ candidate })
  if (register.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'register-project' }>> = register.result
    const canonical: ProjectRef = result.project
    const workspace: string = result.workspacePath
    const destination: string | null = register.destination
    void canonical
    void workspace
    void destination
  }
  const rename = await workflows.renameProject({ project, name: 'Renamed project' })
  const settledRename: Exclude<Attempt, { kind: 'pending' }> = rename
  void settledRename
  if (rename.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'rename-project' }>> = rename.result
    const outcome: Extract<
      CommandOutcomeFor<Extract<Command, { type: 'rename-project' }>>,
      { ok: true }
    > = rename.outcome
    void result
    void outcome
  }
  const repair = await workflows.repairWorkspace({ project, path: '/workspace/candidate' })
  if (repair.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'repair-project-workspace' }>> =
      repair.result
    const canonical: ProjectRef = result.project
    const workspace: string = result.workspacePath
    void canonical
    void workspace
  }
  const remove = await workflows.removeProject({ project })
  if (remove.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'remove-project' }>> = remove.result
    void result
  }
  const globalAutomation = await workflows.setAutomationEnabled({ enabled: true })
  if (globalAutomation.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'set-automation-enabled' }>> =
      globalAutomation.result
    void result
  }
  const projectAutomation = await workflows.setProjectAutomationEnabled({ project, enabled: false })
  if (projectAutomation.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'set-project-automation-enabled' }>> =
      projectAutomation.result
    void result
  }
  const override = await workflows.startOverride({ target, stage: 'classification' })
  if (override.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'start-automation-override' }>> =
      override.result
    void result
  }
  const wayfinder = await workflows.startOverride({ target, stage: 'wayfinder' })
  void wayfinder
  const refresh = await workflows.refreshProject({ project })
  if (refresh.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'refresh-project' }>> = refresh.result
    void result
  }
  const launch = await workflows.launchProject({ project, operation: 'open-workspace' })
  if (launch.kind === 'acknowledged') {
    const result: CommandResultFor<Extract<Command, { type: 'launch-project-operation' }>> =
      launch.result
    void result
  }
  const select = await workflows.selectWorkspace({ owner: registrationOwner })
  if (select.kind === 'acknowledged') {
    const outcome: Extract<QueryResult, { ok: true }> = select.outcome
    if (select.result.kind === 'selected') {
      const path: string = select.result.path
      void path
    } else {
      const cancelled: 'cancelled' = select.result.kind
      void cancelled
    }
    void outcome
  }
  const settledSelection: Exclude<Attempt, { kind: 'pending' }> = select
  void settledSelection
  workflows.dismiss({ attemptId })
}

export function operationNarrowing(attempt: Attempt) {
  if (attempt.kind === 'acknowledged' && attempt.operation === 'rename-project') {
    const result: CommandResultFor<Extract<Command, { type: 'rename-project' }>> = attempt.result
    return result
  }
  if (attempt.kind === 'pending' && attempt.operation === 'rename-project') {
    const captured: ConfigurationVersion = attempt.configurationVersion
    return captured
  }
  return null
}

// Invalid constructions.
import type { MapRef, ProjectId } from '@roadmap/contracts/identity'
import type { OperationSubject } from '@roadmap/contracts/operations'

type RenameSettled = Awaited<ReturnType<Workflows['renameProject']>>
type RenameAcknowledged = Extract<RenameSettled, { kind: 'acknowledged' }>
type RenamePending = Extract<Attempt, { operation: 'rename-project'; kind: 'pending' }>
type RenameUnknown = Extract<RenameSettled, { kind: 'completion-unknown' }>
type RenameNotDispatched = Extract<RenameSettled, { kind: 'not-dispatched' }>
type FolderSettled = Awaited<ReturnType<Workflows['selectWorkspace']>>
type FolderAcknowledged = Extract<FolderSettled, { kind: 'acknowledged' }>
type FolderPending = Extract<Attempt, { operation: 'select-workspace'; kind: 'pending' }>

declare const view: RoadmapViewState
declare const projectId: ProjectId
declare const map: MapRef
declare const version: ConfigurationVersion
declare const renameAcknowledged: RenameAcknowledged
declare const renamePending: RenamePending
declare const renameUnknown: RenameUnknown
declare const renameNotDispatched: RenameNotDispatched
declare const folderAcknowledged: FolderAcknowledged
declare const folderPending: FolderPending
declare const safeError: SafeError
declare const authorizationResult: AuthorizationResultFeedback
declare const refreshResult: CommandResultFor<Extract<Command, { type: 'refresh-project' }>>
declare const refreshOutcome: Extract<
  CommandOutcomeFor<Extract<Command, { type: 'refresh-project' }>>,
  { ok: true }
>
declare const rejectedRenameOutcome: Extract<
  CommandOutcomeFor<Extract<Command, { type: 'rename-project' }>>,
  { ok: false }
>

export const invalidRawProject = workflows.renameProject({ project: 'project', name: 'Name' })
export const invalidProjectIdBrand = workflows.removeProject({
  project: { integration: 'local', projectId: connectionId },
})
export const invalidConnectionIdBrand = workflows.renameConnection({
  connectionId: operationId,
  name: 'Name',
})
export const invalidAuthorizationIdBrand = workflows.retryAuthorization({
  operationId: connectionId,
})
export const invalidProjectAsConnection = workflows.removeConnection({ connectionId: projectId })
export const invalidProjectScope = workflows.refreshProject({ project: { projectId } })
export const invalidOverrideScope = workflows.startOverride({ target: map, stage: 'wayfinder' })
export const invalidMissingSelectorOwner = workflows.selectWorkspace({})
export const invalidSelectorOwnerKind: SelectionOwner = { kind: 'none' }
export const invalidRegistrationOwner: SelectionOwner = {
  kind: 'registration',
  integration: 'local',
}
export const invalidProjectOwner: SelectionOwner = { kind: 'project' }
export const invalidBeginVersion = workflows.beginAuthorization({
  name: 'Name',
  expectedConfigurationVersion: version,
})
export const invalidReauthorizeVersion = workflows.reauthorizeConnection({
  connectionId,
  expectedConfigurationVersion: version,
})
export const invalidRetryVersion = workflows.retryAuthorization({
  operationId,
  expectedConfigurationVersion: version,
})
export const invalidCancelVersion = workflows.cancelAuthorization({
  operationId,
  expectedConfigurationVersion: version,
})
export const invalidRenameConnectionVersion = workflows.renameConnection({
  connectionId,
  name: 'Name',
  expectedConfigurationVersion: version,
})
export const invalidRemoveConnectionVersion = workflows.removeConnection({
  connectionId,
  expectedConfigurationVersion: version,
})
export const invalidRegisterVersion = workflows.registerProject({
  candidate,
  expectedConfigurationVersion: version,
})
export const invalidRenameProjectVersion = workflows.renameProject({
  project,
  name: 'Name',
  expectedConfigurationVersion: version,
})
export const invalidRepairVersion = workflows.repairWorkspace({
  project,
  path: '/workspace',
  expectedConfigurationVersion: version,
})
export const invalidRemoveProjectVersion = workflows.removeProject({
  project,
  expectedConfigurationVersion: version,
})
export const invalidGlobalAutomationVersion = workflows.setAutomationEnabled({
  enabled: true,
  expectedConfigurationVersion: version,
})
export const invalidProjectAutomationVersion = workflows.setProjectAutomationEnabled({
  project,
  enabled: true,
  expectedConfigurationVersion: version,
})
export const invalidOverrideVersion = workflows.startOverride({
  target,
  stage: 'classification',
  expectedConfigurationVersion: version,
})
export const invalidRefreshVersion = workflows.refreshProject({
  project,
  expectedConfigurationVersion: version,
})
export const invalidLaunchVersion = workflows.launchProject({
  project,
  operation: 'open-workspace',
  expectedConfigurationVersion: version,
})
export const invalidSelectorVersion = workflows.selectWorkspace({
  owner: repairOwner,
  expectedConfigurationVersion: version,
})
export const invalidWrongResultFamily: RenameAcknowledged = {
  ...renameAcknowledged,
  result: refreshResult,
}
export const invalidWrongOutcomeFamily: RenameAcknowledged = {
  ...renameAcknowledged,
  outcome: refreshOutcome,
}
export const invalidAcknowledgedRejectedOutcome: RenameAcknowledged = {
  ...renameAcknowledged,
  outcome: rejectedRenameOutcome,
}
export const invalidPendingResult: RenamePending = {
  ...renamePending,
  result: renameAcknowledged.result,
}
export const invalidPendingError: RenamePending = { ...renamePending, error: safeError }
export const invalidPendingOutcome: RenamePending = {
  ...renamePending,
  outcome: renameAcknowledged.outcome,
}
export const invalidPendingMissingVersion: RenamePending = {
  id: attemptId,
  operation: 'rename-project',
  subject: { kind: 'project', project },
  dismissed: false,
  kind: 'pending',
}
export const invalidUnknownResult: RenameUnknown = {
  ...renameUnknown,
  result: renameAcknowledged.result,
}
export const invalidUnknownOutcome: RenameUnknown = {
  ...renameUnknown,
  outcome: renameAcknowledged.outcome,
}
export const invalidUnknownCanonicalSubject: RenameUnknown = {
  ...renameUnknown,
  canonicalSubject: { kind: 'project', project },
}
export const invalidAcknowledgedError: RenameAcknowledged = {
  ...renameAcknowledged,
  error: safeError,
}
export const invalidFolderPendingVersion: FolderPending = {
  ...folderPending,
  configurationVersion: version,
}
export const invalidNotDispatchedVersion: RenameNotDispatched = {
  ...renameNotDispatched,
  configurationVersion: version,
}
export const invalidFolderCommandResult: FolderAcknowledged = {
  ...folderAcknowledged,
  result: refreshResult,
}
export const invalidFolderSelectedWithoutPath: FolderAcknowledged = {
  ...folderAcknowledged,
  result: { kind: 'selected' },
}
export const invalidFolderCancelledPath: FolderAcknowledged = {
  ...folderAcknowledged,
  result: { kind: 'cancelled', path: '/workspace' },
}
export const invalidRawAttemptId = workflows.dismiss({ attemptId: 'attempt' })
export const invalidMutableAttempts: Attempt[] = view.workflowState.attempts
export const invalidMutableAttempt = () => {
  renameAcknowledged.dismissed = true
}
export const invalidExecuteFacade = view.execute
export const invalidQueryFacade = view.query
export const invalidAggregateFacade = view.command
export const invalidWorkflowExecute = workflows.execute
export const invalidWorkflowQuery = workflows.query
export const invalidOperationSubject: OperationSubject = { kind: 'project', project: connectionId }
export const invalidAuthorizationWaitingPayload: AuthorizationResultFeedback = {
  ...authorizationResult,
  result: { type: 'begin-github-authorization', operationId, phase: 'waiting' },
}
export const invalidAuthorizationGrantedPayload: AuthorizationResultFeedback = {
  ...authorizationResult,
  result: { type: 'retry-github-authorization', operationId, phase: 'granted' },
}
export const invalidAuthorizationCancelledError: AuthorizationResultFeedback = {
  ...authorizationResult,
  result: {
    type: 'cancel-github-authorization',
    operationId,
    phase: 'cancelled',
    error: safeError,
  },
}
export const invalidAuthorizationFeedbackId = authorizationFeedback(
  view.workflowState,
  connectionId,
)
