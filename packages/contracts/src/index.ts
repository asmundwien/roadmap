export type RecognizedTicketType = 'research' | 'prototype' | 'grilling' | 'task'

/** The displayable ticket type; `untyped` represents every malformed evidence variant. */
export type TicketType = RecognizedTicketType | 'untyped'

/** Normalized evidence retained from every `wayfinder:*` label on the ticket. */
export type TicketTypeEvidence =
  | { kind: 'recognized'; value: RecognizedTicketType; labels: string[] }
  | { kind: 'missing'; labels: [] }
  | { kind: 'unknown'; labels: string[] }
  | { kind: 'conflicting'; labels: string[] }

export function ticketTypeOf(evidence: TicketTypeEvidence): TicketType {
  return evidence.kind === 'recognized' ? evidence.value : 'untyped'
}

/**
 * A ticket's position relative to the frontier.
 *
 * - `closed` — resolved; its answer is on the map.
 * - `blocked` — open, but at least one blocker is still open or unknown.
 * - `claimed` — open and unblocked, but a session has assigned it to itself.
 * - `frontier` — open, unblocked, unclaimed: the edge of the known, and the only takeable state.
 */
export type TicketState = 'closed' | 'blocked' | 'claimed' | 'frontier'

/** The integration a project reaches roadmap through. */
export type Integration = 'github' | 'local'

/** A project's scoped identity on the roadmap wire. */
export interface ProjectKey {
  integration: Integration
  id: string
}

export interface Assignee {
  name: string
  url?: string
  avatarUrl?: string
}

export type BlockerState = 'open' | 'closed' | 'unknown'

/** One end of a blocked-by edge, scoped to the project the blocker lives in. */
export interface Blocker {
  project: ProjectKey
  ticketId: string
  displayId?: string
  title?: string
  url?: string
  state: BlockerState
}

export interface Ticket {
  id: string
  displayId?: string
  title?: string
  url?: string
  /** The ticket body as written — markdown, unrendered; empty when the source has none. */
  body: string
  typeEvidence: TicketTypeEvidence
  state: TicketState
  /** Independent of `state`, which collapses them: a ticket can be blocked *and* claimed. */
  isClaimed: boolean
  isBlocked: boolean
  /** When the ticket was created, ms since epoch — absent when the source records no chronology. */
  createdAt?: number
  /** When the ticket closed, ms since epoch — absent when the source records no closure time. */
  closedAt?: number
  assignees: Assignee[]
  blockedBy: Blocker[]
  /** False when some blocker targets are missing or drifted out of parseable shape. */
  blockersComplete: boolean
  /** Human drift signals for the ticket itself. */
  warnings: string[]
  /** Source file or issue context for later link handling. */
  sourcePath?: string
}

/** One entry in the map's Decisions-so-far index: a gist plus a pointer to the ticket holding it. */
export interface Decision {
  title: string
  url: string | null
  gist: string
  /** The bullet as written, so a line that defies parsing is still rendered faithfully. */
  raw: string
}

/** A `##` block of the map body, kept verbatim alongside the parse so drift stays inspectable. */
export interface MapSection {
  heading: string
  text: string
  items: string[]
}

/**
 * The map body parsed against the wayfinder template — tolerantly. Every field degrades to empty
 * rather than throwing, unrecognised headings survive in `sections`, and the raw body is kept.
 */
export interface MapBody {
  raw: string
  destination: string
  notes: string[]
  decisions: Decision[]
  /** Fog patches — bullets only. Prose in this section is commentary, not a patch. */
  notYetSpecified: string[]
  /** Prose in Not-yet-specified when it carries no bullets — usually "no fog remains". */
  notYetSpecifiedNote: string
  outOfScope: string[]
  /** Every `##` section in document order, recognised or not. */
  sections: MapSection[]
  /** Template sections that were absent — the drift signal a view may want to surface. */
  missingSections: string[]
}

export interface MapProgress {
  total: number
  completed: number
}

export interface WayfinderMap {
  project: ProjectKey
  id: string
  displayId?: string
  title?: string
  url?: string
  isOpen: boolean
  /** Latest relevant source activity, ms since epoch — recency picks a project's active map. */
  updatedAt: number
  /** When the map closed, ms since epoch — absent when the source keeps it open or records none. */
  closedAt?: number
  body: MapBody
  tickets: Ticket[]
  /** Open, unblocked, unclaimed tickets in map order — what a session can take right now. */
  frontier: Ticket[]
  progress: MapProgress
  /** False when some ticket records were omitted or a ticket directory drifted out of shape. */
  ticketsComplete: boolean
  /** Human drift signals for the map itself. */
  warnings: string[]
  /** Source file or issue context for later link handling. */
  sourcePath?: string
}

/**
 * One project and its maps. A project can hold several: open ones live, closed ones as history.
 * `openMaps` is ordered most recently updated first — the head is the **active map**, any others
 * are live but secondary. `closedMaps` is ordered most recently closed first.
 */
export interface Project {
  key: ProjectKey
  name: string
  visibility?: 'public' | 'private'
  openMaps: WayfinderMap[]
  closedMaps: WayfinderMap[]
  /** Human drift signals for the project itself. */
  warnings: string[]
  /** The source location the adapter read this project from, when that is a real fact. */
  sourcePath?: string
  /** Current external source URL when the Integration can name one. */
  sourceUrl?: string
}

/** A source entry the adapter could name but not currently materialize into a live map. */
export interface Unreachable {
  integration: Integration
  project: ProjectKey
  projectName?: string
  mapId?: string
  mapDisplayId?: string
  mapTitle?: string
  reason: string
}

/**
 * The whole roadmap state at an instant — what the server owns and broadcasts. Full-snapshot
 * replace: the wire never carries patches; diffing is the server's internal concern.
 */
export interface Snapshot {
  /** When the server assembled this snapshot, ms since epoch. */
  capturedAt: number
  projects: Project[]
  unreachable: Unreachable[]
}

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

export type ProjectAvailability =
  | { status: 'available'; observedAt: number }
  | { status: 'unavailable'; cause: string; observedAt?: number }

export interface ProjectAction {
  id: string
  label: string
  kind: 'roadmap' | 'external-link' | 'server-launch'
  href?: string
}

/** A committed registration projected with its current or last-known roadmap state. */
export interface RegisteredProject extends ProjectRegistration {
  name: string
  availability: ProjectAvailability
  openMaps: WayfinderMap[]
  closedMaps: WayfinderMap[]
  warnings: string[]
  actions: ProjectAction[]
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
export type AutomationAvailability = { status: 'ready' } | { status: 'unavailable'; cause: string }

/** Browser-safe Automation controls; Harness Commands remain private configuration. */
export interface AutomationState {
  enabled: boolean
  enabledProjects: ProjectKey[]
  availability: AutomationAvailability
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
  roadmap: Snapshot
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

export type Query = { type: 'select-workspace' }

export type QueryResult =
  | { ok: true; type: 'workspace-selection'; path?: string }
  | { ok: false; error: SafeError }

interface VersionedCommand {
  expectedConfigurationVersion: number
}

export type Command =
  | (VersionedCommand & {
      type: 'begin-github-authorization'
      name: string
      /** Present only when reauthorizing an existing Connection. */
      connectionId?: ConnectionId
    })
  | (VersionedCommand & { type: 'cancel-github-authorization'; operationId: string })
  | (VersionedCommand & { type: 'retry-github-authorization'; operationId: string })
  | (VersionedCommand & { type: 'rename-connection'; connectionId: ConnectionId; name: string })
  | (VersionedCommand & { type: 'remove-connection'; connectionId: ConnectionId })
  | (VersionedCommand & { type: 'register-project'; candidate: ProjectRegistrationCandidate })
  | (VersionedCommand & { type: 'rename-project'; project: ProjectKey; name: string })
  | (VersionedCommand & {
      type: 'repair-project-workspace'
      project: ProjectKey
      workspace: Workspace
    })
  | (VersionedCommand & { type: 'remove-project'; project: ProjectKey })
  | (VersionedCommand & { type: 'set-automation-enabled'; enabled: boolean })
  | (VersionedCommand & {
      type: 'set-project-automation-enabled'
      project: ProjectKey
      enabled: boolean
    })
  | (VersionedCommand & { type: 'refresh-project'; project: ProjectKey })
  | (VersionedCommand & { type: 'launch-action'; actionId: string; project?: ProjectKey })

export type CommandResult =
  | { type: 'configuration-updated'; configurationVersion: number }
  | { type: 'authorization-started'; operationId: string }
  | { type: 'authorization-cancelled'; operationId: string }
  | { type: 'project-refreshed'; project: ProjectKey }
  | { type: 'action-launched'; actionId: string }

export type CommandOutcome =
  | { ok: true; result: CommandResult; state: ApplicationState }
  | { ok: false; error: SafeError; state: ApplicationState }

/** A runtime decoder for data crossing a process or network seam. */
export interface RuntimeCodec<T> {
  decode(input: unknown): { ok: true; value: T } | { ok: false; issues: ConfigurationIssue[] }
}
