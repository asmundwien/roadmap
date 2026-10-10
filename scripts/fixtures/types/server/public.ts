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
  SourceProvenance,
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
  provenanceSchema,
  readyApplicationStateSchema,
  serverLaunchActionSchema,
  sessionReportEvidenceSchema,
  sessionReportSchema,
  supportedIntegrationSchema,
  ticketMembershipSchema,
  ticketResourceSchema,
  ticketTypeEvidenceSchema,
  ticketTypeOf,
  timeSchema,
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
  provenanceSchema,
  timeSchema,
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
  SourceProvenance: SourceProvenance
}

import type {
  Command,
  CommandOutcome,
  CommandOutcomeFor,
  CommandResult,
  CommandResultFor,
  CommandSubjectFor,
  ConfigurationCommit,
  OperationSubject,
  ProjectOperation,
  Query,
  QueryResult,
  RefreshAttempt,
  RefreshCause,
  SafeError,
} from '@roadmap/contracts/operations'
import {
  commandOutcomeFor,
  commandOutcomeSchema,
  commandResultFor,
  commandResultSchema,
  commandSchema,
  commandSubject,
  configurationCommitSchema,
  operationSubjectSchema,
  parseCommandOutcomeFor,
  projectOperationSchema,
  queryResultSchema,
  querySchema,
  refreshAttemptSchema,
  refreshCauseSchema,
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
  projectOperationSchema,
  operationSubjectSchema,
  configurationCommitSchema,
  refreshCauseSchema,
  refreshAttemptSchema,
  commandSubject,
  commandOutcomeFor,
  parseCommandOutcomeFor,
}
export type operationsTypes = {
  Query: Query
  Command: Command
  SafeError: SafeError
  QueryResult: QueryResult
  CommandResult: CommandResult
  CommandOutcome: CommandOutcome
  CommandResultFor: CommandResultFor<Command>
  CommandOutcomeFor: CommandOutcomeFor<Command>
  ProjectOperation: ProjectOperation
  OperationSubject: OperationSubject
  ConfigurationCommit: ConfigurationCommit
  RefreshCause: RefreshCause
  RefreshAttempt: RefreshAttempt
  CommandSubjectFor: CommandSubjectFor<Command>
}

import type {
  CommandEnvelope,
  CommandResultEnvelope,
  CommandResultEnvelopeFor,
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
  CommandResultEnvelopeFor: CommandResultEnvelopeFor<Command>
  DecodeIssue: DecodeIssue
  DecodeResult: DecodeResult<unknown>
}

export const controlCorrelation = correlationIdSchema.parse('00000000-0000-4000-8000-000000000001')
export const controlProject = localProjectRefSchema.parse({
  integration: 'local',
  projectId: 'project',
})
export const controlCommand = {
  type: 'launch-project-operation',
  expectedConfigurationVersion: configurationVersionSchema.parse(0),
  project: controlProject,
  operation: 'open-workspace',
} as const satisfies Command
export const controlResult = {
  type: 'launch-project-operation',
  project: controlProject,
  operation: 'open-workspace',
  status: 'invoked',
} as const satisfies CommandResultFor<typeof controlCommand>
export const controlOutcome = {
  operation: 'launch-project-operation',
  subject: { kind: 'project', project: controlProject },
  serverEpoch: serverEpochSchema.parse('epoch'),
  stateSequence: stateSequenceSchema.parse(0),
  ok: true,
  result: controlResult,
} as const satisfies CommandOutcomeFor<typeof controlCommand>
export const controlQuery = { type: 'select-workspace' } as const satisfies Query
export const controlQueryResult = {
  operation: 'select-workspace',
  subject: { kind: 'none' },
  serverEpoch: serverEpochSchema.parse('epoch'),
  stateSequence: stateSequenceSchema.parse(0),
  ok: true,
  result: { kind: 'cancelled' },
} as const satisfies QueryResult
export const controlCommandEnvelope = {
  type: 'command',
  correlationId: controlCorrelation,
  command: controlCommand,
} satisfies CommandEnvelope
export const controlCommandResultEnvelope = {
  type: 'command-result',
  correlationId: controlCorrelation,
  outcome: controlOutcome,
} satisfies CommandResultEnvelope
export const controlQueryEnvelope = {
  type: 'query',
  correlationId: controlCorrelation,
  query: controlQuery,
} satisfies QueryEnvelope
export const controlQueryResultEnvelope = {
  type: 'query-result',
  correlationId: controlCorrelation,
  result: controlQueryResult,
} satisfies QueryResultEnvelope
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
  query: decodeQueryEnvelope(controlQueryEnvelope),
  queryResult: decodeQueryResultEnvelope(
    controlQueryResultEnvelope,
    controlQuery,
    controlCorrelation,
  ),
  command: decodeCommandEnvelope(controlCommandEnvelope),
  commandResult: decodeCommandResultEnvelope(
    controlCommandResultEnvelope,
    controlCommand,
    controlCorrelation,
  ),
  rejection: decodeRequestRejection({
    type: 'request-rejected',
    request: 'command',
    requestId: null,
    reason: 'malformed-envelope',
    message: 'Rejected.',
  }),
}

export const exactResultControls = [
  (() => {
    const request = {
      type: 'begin-github-authorization',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      name: 'GitHub',
    } as const satisfies Command
    const result = {
      type: 'begin-github-authorization',
      phase: 'waiting',
      operationId: authorizationOperationIdSchema.parse('authorization'),
      verificationUri: 'https://github.com/login/device',
      userCode: 'CODE',
      expiresAt: 1000,
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'retry-github-authorization',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      operationId: authorizationOperationIdSchema.parse('authorization'),
    } as const satisfies Command
    const result = {
      type: 'retry-github-authorization',
      phase: 'cancelled',
      operationId: authorizationOperationIdSchema.parse('authorization'),
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'cancel-github-authorization',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      operationId: authorizationOperationIdSchema.parse('authorization'),
    } as const satisfies Command
    const result = {
      type: 'cancel-github-authorization',
      phase: 'cancelled',
      operationId: authorizationOperationIdSchema.parse('authorization'),
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'rename-connection',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      connectionId: connectionIdSchema.parse('connection'),
      name: 'Renamed',
    } as const satisfies Command
    const result = {
      type: 'rename-connection',
      connectionId: connectionIdSchema.parse('connection'),
      configurationVersion: configurationVersionSchema.parse(0),
      commit: 'committed',
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'remove-connection',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      connectionId: connectionIdSchema.parse('connection'),
    } as const satisfies Command
    const result = {
      type: 'remove-connection',
      connectionId: connectionIdSchema.parse('connection'),
      configurationVersion: configurationVersionSchema.parse(0),
      commit: 'committed',
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'register-project',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      candidate: {
        integration: 'local',
        connectionId: connectionIdSchema.parse('connection'),
        workspace: { path: '/candidate' },
      },
    } as const satisfies Command
    const result = {
      type: 'register-project',
      project: controlProject,
      connectionId: connectionIdSchema.parse('connection'),
      workspacePath: '/canonical',
      configurationVersion: configurationVersionSchema.parse(0),
      commit: 'committed',
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'rename-project',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      project: controlProject,
      name: 'Renamed',
    } as const satisfies Command
    const result = {
      type: 'rename-project',
      project: controlProject,
      configurationVersion: configurationVersionSchema.parse(0),
      commit: 'committed',
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'repair-project-workspace',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      project: controlProject,
      workspace: { path: '/candidate' },
    } as const satisfies Command
    const result = {
      type: 'repair-project-workspace',
      project: controlProject,
      configurationVersion: configurationVersionSchema.parse(0),
      commit: 'committed',
      workspacePath: '/canonical',
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'remove-project',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      project: controlProject,
    } as const satisfies Command
    const result = {
      type: 'remove-project',
      project: controlProject,
      configurationVersion: configurationVersionSchema.parse(0),
      commit: 'committed',
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'set-automation-enabled',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      enabled: true,
    } as const satisfies Command
    const result = {
      type: 'set-automation-enabled',
      enabled: true,
      configurationVersion: configurationVersionSchema.parse(0),
      commit: 'committed',
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'set-project-automation-enabled',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      project: controlProject,
      enabled: true,
    } as const satisfies Command
    const result = {
      type: 'set-project-automation-enabled',
      project: controlProject,
      configurationVersion: configurationVersionSchema.parse(0),
      commit: 'committed',
      enabled: true,
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'start-automation-override',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      target: ticketRefSchema.parse({
        map: { project: controlProject, mapId: 'map' },
        ticketId: 'ticket',
      }),
      stage: 'classification',
    } as const satisfies Command
    const result = {
      type: 'start-automation-override',
      target: request.target,
      stage: 'classification',
      admission: 'override',
      status: 'admitted',
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
  (() => {
    const request = {
      type: 'reauthorize-github-connection',
      expectedConfigurationVersion: configurationVersionSchema.parse(0),
      connectionId: connectionIdSchema.parse('connection'),
    } as const satisfies Command
    const result = {
      type: 'reauthorize-github-connection',
      phase: 'granted',
      operationId: authorizationOperationIdSchema.parse('authorization'),
      connection: { connectionId: connectionIdSchema.parse('connection'), accountId: 'account' },
      configurationVersion: configurationVersionSchema.parse(0),
    } as const satisfies CommandResultFor<typeof request>
    return { request, result, matches: commandResultFor(request, result) }
  })(),
]

export const controlSubject = commandSubject(controlCommand) satisfies CommandSubjectFor<
  typeof controlCommand
>
export const scopedOutcomeControls = {
  matches: commandOutcomeFor(controlCommand, controlOutcome),
  parsed: parseCommandOutcomeFor(controlCommand, controlOutcome),
}
export const controlRefreshCommand = {
  type: 'refresh-project',
  expectedConfigurationVersion: configurationVersionSchema.parse(0),
  project: controlProject,
} as const satisfies Command
export const controlRefreshResult = {
  type: 'refresh-project',
  project: controlProject,
  attempt: {
    kind: 'observed',
    attemptedAt: 1000,
    observedAt: 1000,
    provenance: { integration: 'local', path: '/canonical', operation: 'inspect-root' },
  },
} as const satisfies CommandResultFor<typeof controlRefreshCommand>
export const controlRefreshOutcome = {
  operation: 'refresh-project',
  subject: { kind: 'project', project: controlProject },
  serverEpoch: serverEpochSchema.parse('epoch'),
  stateSequence: stateSequenceSchema.parse(0),
  ok: true,
  result: controlRefreshResult,
} as const satisfies CommandOutcomeFor<typeof controlRefreshCommand>
export const controlRefreshDecoded = decodeCommandResultEnvelope(
  { type: 'command-result', correlationId: controlCorrelation, outcome: controlRefreshOutcome },
  controlRefreshCommand,
  controlCorrelation,
)
