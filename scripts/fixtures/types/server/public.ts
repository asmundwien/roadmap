import type {
  ActionId,
  AuthorizationOperationId,
  ConfigurationVersion,
  ConnectionId,
  CorrelationId,
  GitHubProjectRef,
  Integration,
  LocalProjectRef,
  MapId,
  MapRef,
  ProjectId,
  ProjectRef,
  ServerEpoch,
  StateSequence,
  TicketId,
  TicketRef,
} from '@roadmap/contracts/identity'
import {
  actionIdSchema,
  authorizationOperationIdSchema,
  configurationVersionSchema,
  connectionIdSchema,
  correlationIdSchema,
  githubProjectRefSchema,
  integrationSchema,
  localProjectRefSchema,
  mapIdSchema,
  mapRefSchema,
  projectIdSchema,
  projectRefSchema,
  serverEpochSchema,
  stateSequenceSchema,
  ticketIdSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
export const identityValues = {
  integrationSchema,
  connectionIdSchema,
  projectIdSchema,
  mapIdSchema,
  ticketIdSchema,
  authorizationOperationIdSchema,
  actionIdSchema,
  serverEpochSchema,
  stateSequenceSchema,
  configurationVersionSchema,
  correlationIdSchema,
  localProjectRefSchema,
  githubProjectRefSchema,
  projectRefSchema,
  mapRefSchema,
  ticketRefSchema,
}
export type identityTypes = {
  Integration: Integration
  ConnectionId: ConnectionId
  ProjectId: ProjectId
  MapId: MapId
  TicketId: TicketId
  AuthorizationOperationId: AuthorizationOperationId
  ActionId: ActionId
  ServerEpoch: ServerEpoch
  StateSequence: StateSequence
  ConfigurationVersion: ConfigurationVersion
  CorrelationId: CorrelationId
  ProjectRef: ProjectRef
  LocalProjectRef: LocalProjectRef
  GitHubProjectRef: GitHubProjectRef
  MapRef: MapRef
  TicketRef: TicketRef
}

import type {
  ActiveMapResult,
  ApplicationState,
  Assignee,
  AuthorizationOperation,
  AutomationAdmission,
  AutomationAvailability,
  AutomationEvidence,
  AutomationOverrideAvailability,
  AutomationOverrideControl,
  AutomationOverrideStage,
  AutomationProcessResult,
  AutomationState,
  Blocker,
  BlockerState,
  ClassificationAttempt,
  ClassificationVerdict,
  ConfigurationIssue,
  ConfigurationStatus,
  Connection,
  ConnectionAvailability,
  Decision,
  GitHubConnection,
  GitHubConnectionIdentity,
  LinkAction,
  LocalConnection,
  MapBody,
  MapMembershipResult,
  MapProgress,
  MapResource,
  MapResourceResult,
  MapResourceValue,
  MapSection,
  Project,
  ProjectAction,
  ProjectResourceResult,
  ProjectResourceValue,
  ReadyApplicationState,
  RecognizedTicketType,
  ServerLaunchAction,
  SessionReport,
  SessionReportEvidence,
  SupportedIntegration,
  TicketMembershipResult,
  TicketResource,
  TicketResourceResult,
  TicketResourceValue,
  TicketState,
  TicketType,
  TicketTypeEvidence,
  UnavailableEvidence,
  WayfinderSession,
} from '@roadmap/contracts/state'
import {
  activeMapSchema,
  applicationStateSchema,
  authorizationOperationSchema,
  automationAdmissionSchema,
  automationAvailabilitySchema,
  automationEvidenceSchema,
  automationOverrideAvailabilitySchema,
  automationOverrideControlSchema,
  automationOverrideStageSchema,
  automationProcessResultSchema,
  automationStateSchema,
  blockerSchema,
  classificationAttemptSchema,
  classificationVerdictSchema,
  configurationIssueSchema,
  configurationStatusSchema,
  connectionAvailabilitySchema,
  connectionSchema,
  githubConnectionIdentitySchema,
  githubConnectionSchema,
  linkActionSchema,
  localConnectionSchema,
  mapMembershipSchema,
  mapResourceSchema,
  projectActionSchema,
  projectResourceSchema,
  projectSchema,
  readyApplicationStateSchema,
  serverLaunchActionSchema,
  sessionReportEvidenceSchema,
  sessionReportSchema,
  supportedIntegrationSchema,
  ticketMembershipSchema,
  ticketResourceSchema,
  ticketTypeEvidenceSchema,
  ticketTypeOf,
  wayfinderSessionSchema,
} from '@roadmap/contracts/state'
export const stateValues = {
  ticketTypeEvidenceSchema,
  projectResourceSchema,
  mapResourceSchema,
  ticketResourceSchema,
  mapMembershipSchema,
  ticketMembershipSchema,
  activeMapSchema,
  projectSchema,
  blockerSchema,
  projectActionSchema,
  linkActionSchema,
  serverLaunchActionSchema,
  connectionAvailabilitySchema,
  githubConnectionIdentitySchema,
  localConnectionSchema,
  githubConnectionSchema,
  connectionSchema,
  supportedIntegrationSchema,
  authorizationOperationSchema,
  configurationIssueSchema,
  configurationStatusSchema,
  automationAdmissionSchema,
  automationOverrideStageSchema,
  automationOverrideAvailabilitySchema,
  automationOverrideControlSchema,
  automationProcessResultSchema,
  classificationVerdictSchema,
  classificationAttemptSchema,
  sessionReportSchema,
  sessionReportEvidenceSchema,
  wayfinderSessionSchema,
  automationEvidenceSchema,
  automationAvailabilitySchema,
  automationStateSchema,
  readyApplicationStateSchema,
  applicationStateSchema,
  ticketTypeOf,
}
export type stateTypes = {
  ProjectResourceResult: ProjectResourceResult
  MapResourceResult: MapResourceResult
  TicketResourceResult: TicketResourceResult
  MapMembershipResult: MapMembershipResult
  TicketMembershipResult: TicketMembershipResult
  ActiveMapResult: ActiveMapResult
  MapResource: MapResource
  TicketResource: TicketResource
  ProjectResourceValue: ProjectResourceValue
  MapResourceValue: MapResourceValue
  TicketResourceValue: TicketResourceValue
  UnavailableEvidence: UnavailableEvidence
  TicketTypeEvidence: TicketTypeEvidence
  TicketState: TicketState
  Assignee: Assignee
  Decision: Decision
  MapSection: MapSection
  MapBody: MapBody
  MapProgress: MapProgress
  Project: Project
  Blocker: Blocker
  BlockerState: BlockerState
  ProjectAction: ProjectAction
  LinkAction: LinkAction
  ServerLaunchAction: ServerLaunchAction
  ConnectionAvailability: ConnectionAvailability
  GitHubConnectionIdentity: GitHubConnectionIdentity
  Connection: Connection
  LocalConnection: LocalConnection
  GitHubConnection: GitHubConnection
  SupportedIntegration: SupportedIntegration
  AuthorizationOperation: AuthorizationOperation
  ConfigurationIssue: ConfigurationIssue
  ConfigurationStatus: ConfigurationStatus
  AutomationAdmission: AutomationAdmission
  AutomationOverrideStage: AutomationOverrideStage
  AutomationOverrideAvailability: AutomationOverrideAvailability
  AutomationOverrideControl: AutomationOverrideControl
  AutomationProcessResult: AutomationProcessResult
  ClassificationVerdict: ClassificationVerdict
  ClassificationAttempt: ClassificationAttempt
  SessionReport: SessionReport
  SessionReportEvidence: SessionReportEvidence
  WayfinderSession: WayfinderSession
  AutomationEvidence: AutomationEvidence
  AutomationAvailability: AutomationAvailability
  AutomationState: AutomationState
  ReadyApplicationState: ReadyApplicationState
  ApplicationState: ApplicationState
  RecognizedTicketType: RecognizedTicketType
  TicketType: TicketType
}

import type {
  Command,
  CommandOutcome,
  CommandResult,
  CommandResultFor,
  Query,
  QueryResult,
  SafeError,
} from '@roadmap/contracts/operations'
import {
  commandOutcomeSchema,
  commandResultFor,
  commandResultSchema,
  commandSchema,
  queryResultSchema,
  querySchema,
  safeErrorSchema,
} from '@roadmap/contracts/operations'
export const operationsValues = {
  querySchema,
  commandSchema,
  safeErrorSchema,
  queryResultSchema,
  commandResultSchema,
  commandOutcomeSchema,
  commandResultFor,
}
export type operationsTypes = {
  Query: Query
  Command: Command
  SafeError: SafeError
  QueryResult: QueryResult
  CommandResult: CommandResult
  CommandOutcome: CommandOutcome
  CommandResultFor: CommandResultFor<Command>
}

import type {
  CommandEnvelope,
  CommandResultEnvelope,
  DecodeIssue,
  DecodeResult,
  QueryEnvelope,
  QueryResultEnvelope,
  RequestRejection,
  StateEnvelope,
} from '@roadmap/contracts/wire'
import {
  commandEnvelopeSchema,
  commandResultEnvelopeSchema,
  decodeApplicationState,
  decodeCommandEnvelope,
  decodeCommandResultEnvelope,
  decodeQueryEnvelope,
  decodeQueryResultEnvelope,
  decodeRequestRejection,
  decodeStateEnvelope,
  queryEnvelopeSchema,
  queryResultEnvelopeSchema,
  REQUEST_ID_HEADER,
  requestIdSchema,
  requestRejectionSchema,
  requestRejectionStatus,
  stateEnvelopeSchema,
} from '@roadmap/contracts/wire'
export const wireValues = {
  REQUEST_ID_HEADER,
  requestIdSchema,
  queryEnvelopeSchema,
  commandEnvelopeSchema,
  stateEnvelopeSchema,
  queryResultEnvelopeSchema,
  commandResultEnvelopeSchema,
  requestRejectionSchema,
  decodeQueryEnvelope,
  decodeCommandEnvelope,
  decodeRequestRejection,
  decodeApplicationState,
  decodeStateEnvelope,
  decodeQueryResultEnvelope,
  decodeCommandResultEnvelope,
  requestRejectionStatus,
}
export type wireTypes = {
  QueryEnvelope: QueryEnvelope
  CommandEnvelope: CommandEnvelope
  RequestRejection: RequestRejection
  StateEnvelope: StateEnvelope
  QueryResultEnvelope: QueryResultEnvelope
  CommandResultEnvelope: CommandResultEnvelope
  DecodeIssue: DecodeIssue
  DecodeResult: DecodeResult<unknown>
}

export const decoderControls = {
  state: decodeApplicationState({
    phase: 'idle',
    serverEpoch: 'epoch',
    stateSequence: 0,
    capturedAt: 0,
  }),
  stateEnvelope: decodeStateEnvelope({
    type: 'state',
    state: { phase: 'idle', serverEpoch: 'epoch', stateSequence: 0, capturedAt: 0 },
  }),
  query: decodeQueryEnvelope({ type: 'query', query: { type: 'select-workspace' } }),
  queryResult: decodeQueryResultEnvelope({
    type: 'query-result',
    result: { ok: true, type: 'workspace-selection' },
  }),
  command: decodeCommandEnvelope({
    type: 'command',
    command: {
      type: 'refresh-project',
      expectedConfigurationVersion: 0,
      project: { integration: 'local', projectId: 'project' },
    },
  }),
  commandResult: decodeCommandResultEnvelope({
    type: 'command-result',
    outcome: {
      ok: true,
      result: {
        type: 'project-refreshed',
        project: { integration: 'local', projectId: 'project' },
      },
      state: { phase: 'idle', serverEpoch: 'epoch', stateSequence: 0, capturedAt: 0 },
    },
  }),
  rejection: decodeRequestRejection({
    type: 'request-rejected',
    request: 'command',
    requestId: null,
    reason: 'malformed-envelope',
    message: 'Rejected.',
  }),
}
