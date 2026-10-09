import type { Blocker } from './blocker.ts'
import type { RegisteredProject, TicketTypeEvidence } from './resources.ts'

export type { Blocker } from './blocker.ts'
export type { Command, Query } from './operations.ts'
export type {
  ActiveMapResult,
  Assignee,
  Decision,
  MapBody,
  MapMembershipResult,
  MapProgress,
  MapResource,
  MapResourceResult,
  MapResourceValue,
  MapSection,
  ProjectResourceResult,
  ProjectResourceValue,
  RegisteredProject,
  TicketMembershipResult,
  TicketResource,
  TicketResourceResult,
  TicketResourceValue,
  TicketState,
  TicketTypeEvidence,
  UnavailableEvidence,
} from './resources.ts'

export type RecognizedTicketType = 'research' | 'prototype' | 'grilling' | 'task'

/** The displayable ticket type; `untyped` represents every malformed evidence variant. */
export type TicketType = RecognizedTicketType | 'untyped'

export function ticketTypeOf(evidence: TicketTypeEvidence): TicketType {
  return evidence.kind === 'recognized' ? evidence.value : 'untyped'
}

/** The integration a project reaches roadmap through. */
export type Integration = 'github' | 'local'

/** A project's scoped identity on the roadmap wire. */
export interface ProjectKey {
  integration: Integration
  id: string
}

export type BlockerState = Blocker['state']

export type ConnectionId = string

export type ConnectionAvailability =
  | { status: 'available'; observedAt?: number }
  | { status: 'degraded'; cause: string; observedAt: number }
  | { status: 'authorization-required'; cause: string; observedAt?: number }
  | { status: 'unavailable'; cause: string; observedAt?: number }

export interface GitHubConnectionIdentity {
  /** Durable numeric GitHub user id, serialized as text to avoid precision assumptions. */
  id: string
  /** Current presentation login; unlike id, this may change. */
  login: string
}

/** One configured instance of an Integration. Credentials are deliberately unrepresentable. */
export interface Connection {
  id: ConnectionId
  integration: Integration
  name: string
  builtIn: boolean
  githubIdentity?: GitHubConnectionIdentity
  availability: ConnectionAvailability
}

export type ProjectLocator =
  | { integration: 'github'; repositoryId: string; nameWithOwner: string }
  | { integration: 'local'; path: string }

export interface Workspace {
  path: string
  gitIdentity?: string
}
/** The browser-selected facts from which admission derives the durable Project identity. */
export interface ProjectRegistrationCandidate {
  integration: Integration
  connectionId: ConnectionId
  workspace: Pick<Workspace, 'path'>
  displayName?: string
}

/** The durable, immutable binding admitted before a Project enters Roadmap. */
export interface ProjectRegistration {
  key: ProjectKey
  connectionId: ConnectionId
  locator: ProjectLocator
  workspace: Workspace
  displayName?: string
}

export interface ProjectAction {
  id: string
  label: string
  kind: 'roadmap' | 'external-link' | 'server-launch'
  href?: string
}

export type SupportedIntegration =
  | {
      integration: 'local'
      name: string
      connectionKind: 'built-in'
    }
  | {
      integration: 'github'
      name: string
      connectionKind: 'device-authorization'
      newInstallationUrl: string
      installationsUrl: string
      authorizationsUrl: string
    }

export interface AuthorizationOperation {
  id: string
  connectionId?: ConnectionId
  status: 'waiting' | 'granted' | 'denied' | 'expired' | 'cancelled' | 'failed'
  verificationUri?: string
  userCode?: string
  expiresAt?: number
  cause?: string
}

export interface ConfigurationIssue {
  path: string
  message: string
}

export interface ConfigurationStatus {
  valid: boolean
  issues: ConfigurationIssue[]
  notices: string[]
}
export type AutomationAdmission = 'automatic' | 'override'

export interface AutomationTarget {
  project: ProjectKey
  mapId: string
  ticketId: string
}
export type AutomationOverrideStage = 'classification' | 'wayfinder'

export type AutomationOverrideAvailability =
  | { status: 'eligible' }
  | { status: 'ineligible'; reason: string }

export interface AutomationOverrideControl {
  target: AutomationTarget
  classification: AutomationOverrideAvailability
  wayfinder: AutomationOverrideAvailability
}

export type AutomationProcessResult =
  | { status: 'exited'; code: number }
  | { status: 'signaled'; signal: string }
  | { status: 'unavailable'; reason: string }

export interface ClassificationVerdict {
  value: 'afk' | 'hitl' | 'unable'
  reason: string
}

export type ClassificationAttempt =
  | { status: 'running'; admission: AutomationAdmission }
  | {
      status: 'completed'
      admission: AutomationAdmission
      processResult: AutomationProcessResult
      verdict: ClassificationVerdict
    }
  | {
      status: 'failed'
      admission: AutomationAdmission
      processResult: AutomationProcessResult
      reason: string
    }
  | { status: 'launch-failed'; admission: AutomationAdmission; reason: string }
  | { status: 'outcome-unknown'; admission: AutomationAdmission; reason: string }

export interface SessionReport {
  outcome: 'completed' | 'stopped' | 'failed'
  reason: string
}

export type SessionReportEvidence =
  | { status: 'received'; report: SessionReport }
  | { status: 'missing'; reason: string }
  | { status: 'invalid'; reason: string }

export type WayfinderSession =
  | { status: 'queued' }
  | { status: 'launching'; admission: AutomationAdmission }
  | { status: 'running'; admission: AutomationAdmission }
  | {
      status: 'finished'
      admission: AutomationAdmission
      processResult: AutomationProcessResult
      report: SessionReportEvidence
    }
  | { status: 'launch-failed'; admission: AutomationAdmission; reason: string }
  | {
      status: 'outcome-unknown'
      admission: AutomationAdmission
      reason: string
      acknowledged: boolean
    }

export interface AutomationEvidence {
  target: AutomationTarget
  classification: ClassificationAttempt
  wayfinder?: WayfinderSession
}

export type AutomationAvailability = { status: 'ready' } | { status: 'unavailable'; cause: string }

/** Browser-safe Automation controls; Harness Commands remain private configuration. */
export interface AutomationState {
  enabled: boolean
  enabledProjects: ProjectKey[]
  availability: AutomationAvailability
  evidence: AutomationEvidence[]
  overrides: AutomationOverrideControl[]
}

/** The sole authoritative read model owned by the server application Module. */
export interface ApplicationState {
  serverEpoch: string
  stateSequence: number
  configurationVersion: number
  supportedIntegrations: SupportedIntegration[]
  connections: Connection[]
  registrations: ProjectRegistration[]
  projects: RegisteredProject[]
  authorizationOperations: AuthorizationOperation[]
  configuration: ConfigurationStatus
  automation: AutomationState
  roadmap: { capturedAt: number }
}

export interface SafeError {
  code:
    | 'conflict'
    | 'configuration-invalid'
    | 'validation'
    | 'dependency'
    | 'admission-failed'
    | 'authorization-failed'
    | 'persistence-failed'
    | 'launch-failed'
    | 'selection-failed'
    | 'not-supported'
    | 'transport-failed'
  message: string
  field?: string
  dependentProjects?: ProjectKey[]
}

export type QueryResult =
  | { ok: true; type: 'workspace-selection'; path?: string }
  | { ok: false; error: SafeError }

export type CommandResult =
  | { type: 'configuration-updated'; configurationVersion: number }
  | { type: 'authorization-started'; operationId: string }
  | { type: 'authorization-cancelled'; operationId: string }
  | { type: 'project-refreshed'; project: ProjectKey }
  | { type: 'action-launched'; actionId: string }
  | {
      type: 'automation-override-started'
      target: AutomationTarget
      stage: AutomationOverrideStage
    }

export type CommandOutcome =
  | { ok: true; result: CommandResult; state: ApplicationState }
  | { ok: false; error: SafeError; state: ApplicationState }

/** A runtime decoder for data crossing a process or network seam. */
export interface RuntimeCodec<T> {
  decode(input: unknown): { ok: true; value: T } | { ok: false; issues: ConfigurationIssue[] }
}
