import type {
  ConnectionId,
  Integration,
  MapRef,
  ProjectRef,
  TicketRef,
} from '@roadmap/contracts/identity'
import type {
  AuthorizationOperation,
  AutomationAdmission,
  AutomationProcessResult,
  Blocker,
  ClassificationAttempt,
  ClassificationVerdict,
  Connection,
  ConnectionAvailability,
  MapResource,
  MapResourceResult,
  MapResourceValue,
  Project,
  ProjectAction,
  ProjectResourceResult,
  ReadyApplicationState,
  SessionReportEvidence,
  TicketResource,
  TicketResourceResult,
  TicketResourceValue,
  TicketState,
  TicketType,
  WayfinderSession,
} from '@roadmap/contracts/state'
import { ticketTypeOf } from '@roadmap/contracts/state'
import { stripInlineMarkdown } from '@/views/shared/gist'

export type ConsumerRead = Readonly<
  Pick<
    ReadyApplicationState,
    | 'projects'
    | 'connections'
    | 'automation'
    | 'configuration'
    | 'supportedIntegrations'
    | 'authorizationOperations'
  >
>
export type SourceDestination =
  | { kind: 'link'; href: string }
  | { kind: 'file'; path: string }
  | { kind: 'absent' }
type ResourceResult = ProjectResourceResult | MapResourceResult | TicketResourceResult
type ResourceAvailability<R extends ResourceResult = ResourceResult> = R & {
  message: string
  label: string
  variant: 'info' | 'warning' | 'muted'
  observedAt: number | null
}
type EvidenceFact = { term: string; value: string; detail?: string }
type AdmissionResult =
  | { kind: 'admitted'; admission: AutomationAdmission; label: string }
  | { kind: 'none'; label: 'No launch admission' }
type ClassificationResult = {
  admission: Extract<AdmissionResult, { kind: 'admitted' }>
  facts: EvidenceFact[]
} & (
  | { status: 'running' }
  | { status: 'completed'; processResult: AutomationProcessResult; verdict: ClassificationVerdict }
  | { status: 'failed'; processResult: AutomationProcessResult; reason: string }
  | { status: 'launch-failed' | 'outcome-unknown'; reason: string }
)
export type SessionResult =
  | {
      status: 'queued'
      admission: Extract<AdmissionResult, { kind: 'none' }>
      facts: EvidenceFact[]
    }
  | {
      status: 'launching' | 'running'
      admission: Extract<AdmissionResult, { kind: 'admitted' }>
      facts: EvidenceFact[]
    }
  | {
      status: 'finished'
      admission: Extract<AdmissionResult, { kind: 'admitted' }>
      processResult: AutomationProcessResult
      report: SessionReportEvidence
      facts: EvidenceFact[]
    }
  | {
      status: 'launch-failed'
      admission: Extract<AdmissionResult, { kind: 'admitted' }>
      reason: string
      facts: EvidenceFact[]
    }
  | {
      status: 'outcome-unknown'
      admission: Extract<AdmissionResult, { kind: 'admitted' }>
      reason: string
      acknowledged: boolean
      facts: EvidenceFact[]
    }
type AutomationEvidenceResult = {
  target: TicketRef
  classification: ClassificationResult
  session: SessionResult | null
}
export type AutomationControlResult =
  | { status: 'eligible'; label: string; hint: string }
  | { status: 'ineligible'; label: string; reason: string }
  | { status: 'absent'; label: string; reason: string }
type TargetKnowledge =
  | { kind: 'missing'; message: string }
  | { kind: 'known'; message: string; availability: ResourceResult['kind'] }
type InterruptionResult = {
  target: TicketRef
  reason: string
  navigation: { project: ProjectRef; map: MapRef; ticket: TicketRef }
  project: TargetKnowledge
  map: TargetKnowledge
  ticket: TargetKnowledge
  evidence: AutomationEvidenceResult
}
export type AutomationResult = {
  enabled: boolean
  availability: ReadyApplicationState['automation']['availability']
  availabilityLabel: string
  availabilityCause: string | null
  interruptions: InterruptionResult[]
  historicalEvidence: InterruptionResult[]
  evidence: AutomationEvidenceResult[]
  reviewRequired: boolean
}
type ProjectAutomationResult = AutomationResult & { projectEnabled: boolean }
type TicketAutomationResult = {
  evidence: AutomationEvidenceResult | null
  controls: { classification: AutomationControlResult; wayfinder: AutomationControlResult }
  fallbackReason: string
}
type TrackerResult = {
  state: TicketState
  type: TicketType
  label: string
  variant: 'muted' | 'success' | 'info' | 'danger'
  typeLabel: string
  typeAccent: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'
  isBlocked: boolean
  isClaimed: boolean
  blockedLabel: string | null
  claimedLabel: string | null
}
export type BlockerResult = {
  key: string
  title: string
  displayId: string
  scope: string
  state: Blocker['state']
  stateLabel: string
  scopeLabel: string
  graphStateLabel: string
  graphMessage: string | null
  source: SourceDestination
  target: TicketRef | null
  local: boolean
  tracker: TrackerResult | null
  availability: ResourceAvailability<TicketResourceResult> | null
  message: string | null
}
export type MapSummary = {
  ref: MapRef
  key: string
  title: string
  displayId: string
  statusLabel: string
  availability: ResourceAvailability<MapResourceResult>
  source: SourceDestination
  progress: MapResourceValue['progress']
  progressLabel: string
  active: boolean
}
export type MapResult =
  | {
      kind: 'missing'
      ref: MapRef
      title: string
      message: string
      navigation: { map: MapRef }
      resource: null
    }
  | (MapSummary & {
      kind: 'known'
      resource: MapResource
      content: MapResourceValue | null
      navigation: { map: MapRef }
      tickets: TicketResult[]
      blockers: BlockerResult[]
      membershipMessage: string | null
      warnings: string[]
      graphWarnings: string[]
      knownTicketCount: number
      knownClosedTicketCount: number
    })
export type TicketResult = {
  ref: TicketRef
  key: string
  title: string
  displayId: string
  navigation: { ticket: TicketRef; map: MapRef }
  automation: TicketAutomationResult
  unknownBlocker: boolean
} & (
  | {
      kind: 'missing'
      message: string
      content: null
      availability: null
      source: Extract<SourceDestination, { kind: 'absent' }>
      tracker: null
      decisionGist: null
      blockers: []
      membershipMessage: string | null
    }
  | {
      kind: 'known'
      message: string
      content: TicketResourceValue | null
      availability: ResourceAvailability<TicketResourceResult>
      source: SourceDestination
      tracker: TrackerResult | null
      decisionGist: string | null
      blockers: BlockerResult[]
      membershipMessage: string | null
    }
)
export type ConnectionSummary = {
  kind: 'known'
  id: ConnectionId
  name: string
  integration: Integration
  builtIn: boolean
  login: string | null
  health: {
    status: ConnectionAvailability['status']
    label: string
    cause: string | null
    observedAt: number | null
  }
}
type ProjectJourney = 'active' | 'resting' | 'waiting' | 'uncertain'
export type KnownProjectResult = {
  kind: 'known'
  ref: ProjectRef
  key: string
  name: string
  integration: Integration
  connectionId: ConnectionId
  connection: ConnectionSummary | null
  locator: string
  workspacePath: string
  displayName: string | null
  source: SourceDestination
  observedSource: SourceDestination
  availability: ResourceAvailability<ProjectResourceResult>
  warnings: string[]
  mapState: string
  description: string
  orderWarning: string | null
  membershipMessage: string | null
  journey: ProjectJourney
  journeyLabel: string
  journeyVariant: 'info' | 'danger' | 'neutral'
  membershipTitle: string | null
  navigation: {
    project: ProjectRef
    settings: ProjectRef
    open: MapSummary[]
    closed: MapSummary[]
    unplaced: MapSummary[]
  }
  maps: MapSummary[]
  currentMap: MapSummary | null
  destination: string
  mapCount: number | null
  decisions: number | null
  openTickets: number | null
  hasFog: boolean
  priorities: string[]
  activity: { kind: 'known'; at: number } | { kind: 'unknown' }
  capabilities: {
    actions: ProjectAction[]
    repairOffered: boolean
    roadmap: Extract<ProjectAction, { kind: 'roadmap' }> | null
  }
  automation: ProjectAutomationResult
}
export type ProjectResult =
  | KnownProjectResult
  | {
      kind: 'missing'
      ref: ProjectRef
      key: string
      name: string
      message: string
      description: string
      navigation: { project: ProjectRef; settings: ProjectRef }
      automation: ProjectAutomationResult
    }
export type SelectionRequest = { project: ProjectRef; map: MapRef | null; ticket: TicketRef | null }
export type SelectionResult = {
  kind: 'pinned' | 'default-current' | 'default-closed' | 'no-trustworthy-default' | 'known-empty'
  project: ProjectResult
  map: MapResult | null
  ticket: TicketResult | null
  message: string
}
export type AuthorizationResult = {
  id: AuthorizationOperation['id']
  label: string
  connectionId: ConnectionId | null
} & (
  | { kind: 'waiting'; verificationUri: string; userCode: string; expiresAt: number; cause: null }
  | {
      kind: 'granted-current'
      accountId: string
      navigation: { connection: ConnectionId }
      cause: null
    }
  | { kind: 'granted-historical'; accountId: string; message: string; cause: null }
  | {
      kind: 'terminal'
      outcome: Extract<AuthorizationOperation, { status: 'terminal' }>['outcome']
      cause: string | null
    }
)
type RegistrationContext = {
  identity: Pick<Connection, 'id' | 'integration'>
  integration: Integration
  folderLabel: string
  description: string
  newInstallation: SourceDestination
  installations: SourceDestination
  authorizations: SourceDestination
}
export type ConnectionResult =
  | { kind: 'missing'; id: ConnectionId; message: string }
  | (ConnectionSummary & {
      projects: KnownProjectResult[]
      projectCount: number
      authorizations: AuthorizationResult[]
      currentAuthorization: AuthorizationResult | null
      registration: RegistrationContext
    })
export type AttentionItem =
  | { kind: 'configuration'; key: string; title: string; detail: string }
  | { kind: 'connection'; key: string; title: string; detail: string; connectionId: ConnectionId }
  | { kind: 'project'; key: string; title: string; detail: string; project: ProjectRef }
export type ProjectPortfolio = {
  projects: KnownProjectResult[]
  active: KnownProjectResult[]
  resting: KnownProjectResult[]
  waiting: KnownProjectResult[]
  uncertain: KnownProjectResult[]
  attention: AttentionItem[]
  automation: AutomationResult
}
export type ConnectionPortfolio = {
  connections: Extract<ConnectionResult, { kind: 'known' }>[]
  githubSetup: Omit<RegistrationContext, 'identity'> | null
  looseAuthorizations: AuthorizationResult[]
}

type ProjectObservation = Extract<
  ProjectResourceResult,
  { kind: 'current-readable' }
>['observation']
type MapObservation = Extract<MapResourceResult, { kind: 'current-readable' }>['observation']
type TicketObservation = Extract<TicketResourceResult, { kind: 'current-readable' }>['observation']

export function resourceObservation(result: ProjectResourceResult): ProjectObservation | null
export function resourceObservation(result: MapResourceResult): MapObservation | null
export function resourceObservation(result: TicketResourceResult): TicketObservation | null
export function resourceObservation(
  result: ResourceResult,
): ProjectObservation | MapObservation | TicketObservation | null
export function resourceObservation(result: ResourceResult) {
  switch (result.kind) {
    case 'current-readable':
      return result.observation
    case 'retained-unavailable':
      return result.lastSuccessful
    case 'proven-absent':
      return result.trace.kind === 'last-successful-trace' ? result.trace.lastSuccessful : null
    case 'never-observed':
      return null
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

function provenanceMessage(provenance: ProjectObservation['provenance']): string {
  return provenance.integration === 'local'
    ? `Local ${provenance.operation} at ${provenance.path}`
    : `GitHub ${provenance.stage}, Connection ${provenance.connectionId}, repository ${provenance.repositoryId}`
}
function successMessage(
  observation: ProjectObservation | MapObservation | TicketObservation,
): string {
  const completeness =
    observation.completeness.kind === 'incomplete'
      ? ` Content is incomplete (${observation.completeness.reason}).`
      : ''
  return `Source read ${new Date(observation.observedAt).toISOString()}. ${provenanceMessage(observation.provenance)}.${completeness}`
}
function unavailableMessage(
  unavailable: Extract<ResourceResult, { kind: 'retained-unavailable' }>['unavailable'],
): string {
  if (unavailable.kind === 'no-current-evidence') return unavailable.cause
  return `${unavailable.cause} ${unavailable.scope.kind} attempted ${new Date(unavailable.attemptedAt).toISOString()}. ${provenanceMessage(unavailable.provenance)}.`
}
function absenceProofMessage(
  proof: Extract<ResourceResult, { kind: 'proven-absent' }>['absence']['proof'],
): string {
  return proof.kind === 'provider-deletion'
    ? `Provider deletion proof for repository ${proof.repositoryId}.`
    : `Complete ${proof.parent.kind} established absence.`
}
function resourceMessage(result: ResourceResult): string {
  switch (result.kind) {
    case 'current-readable':
      return `Current readable content. ${successMessage(result.observation)}`
    case 'retained-unavailable':
      return `Currently unavailable. Showing the last successful content. ${successMessage(result.lastSuccessful)} ${unavailableMessage(result.unavailable)}`
    case 'proven-absent':
      return `Proven absent from its source scope at ${new Date(result.absence.observedAt).toISOString()}. ${absenceProofMessage(result.absence.proof)} ${provenanceMessage(result.absence.provenance)}. ${result.trace.kind === 'last-successful-trace' ? `Historical trace. ${successMessage(result.trace.lastSuccessful)}` : 'No previously read content is known.'}`
    case 'never-observed':
      return `This resource has never been read. No source content is known.${result.current === null ? '' : ` ${unavailableMessage(result.current)}`}`
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}
function orderedMaps(project: Pick<Project, 'maps' | 'displayOrder'>): {
  open: MapResource[]
  closed: MapResource[]
  unplaced: MapResource[]
} {
  const byId = new Map(project.maps.map((map) => [map.ref.mapId, map]))
  const placed = new Set(
    [...project.displayOrder.open, ...project.displayOrder.closed].map((ref) => ref.mapId),
  )
  const resolve = (refs: Project['displayOrder']['open']) =>
    refs.flatMap((ref) => {
      const map = byId.get(ref.mapId)
      return map === undefined ? [] : [map]
    })
  return {
    open: resolve(project.displayOrder.open),
    closed: resolve(project.displayOrder.closed),
    unplaced: project.maps.filter((map) => !placed.has(map.ref.mapId)),
  }
}

function availability<R extends ResourceResult>(resource: R): ResourceAvailability<R> {
  const label =
    resource.kind === 'current-readable'
      ? resource.observation.completeness.kind === 'complete'
        ? 'Current readable'
        : 'Incomplete readable'
      : resource.kind === 'retained-unavailable'
        ? 'Retained unavailable'
        : resource.kind === 'proven-absent'
          ? 'Historical trace'
          : 'Never observed'
  return {
    ...resource,
    message: resourceMessage(resource),
    label,
    variant:
      resource.kind === 'current-readable'
        ? 'info'
        : resource.kind === 'proven-absent'
          ? 'muted'
          : 'warning',
    observedAt: resourceObservation(resource)?.observedAt ?? null,
  }
}
function sameProject(left: ProjectRef, right: ProjectRef): boolean {
  return left.integration === right.integration && left.projectId === right.projectId
}
function sameMap(left: MapRef, right: MapRef): boolean {
  return sameProject(left.project, right.project) && left.mapId === right.mapId
}
function sameTicket(left: TicketRef, right: TicketRef): boolean {
  return sameMap(left.map, right.map) && left.ticketId === right.ticketId
}
function projectKey(ref: ProjectRef): string {
  return JSON.stringify([ref.integration, ref.projectId])
}
function mapKey(ref: MapRef): string {
  return JSON.stringify([ref.project.integration, ref.project.projectId, ref.mapId])
}
function ticketKey(ref: TicketRef): string {
  return JSON.stringify([
    ref.map.project.integration,
    ref.map.project.projectId,
    ref.map.mapId,
    ref.ticketId,
  ])
}
function findProject(read: ConsumerRead, ref: ProjectRef): Project | undefined {
  return read.projects.find((project) => sameProject(project.ref, ref))
}
function findMap(read: ConsumerRead, ref: MapRef): MapResource | undefined {
  return findProject(read, ref.project)?.maps.find((map) => sameMap(map.ref, ref))
}
function findTicket(read: ConsumerRead, ref: TicketRef) {
  return findMap(read, ref.map)?.tickets.find((ticket) => sameTicket(ticket.ref, ref))
}
function sourceDestination(
  source: MapResourceValue['source'] | Project['source'] | undefined,
): SourceDestination {
  if (source === undefined) return { kind: 'absent' }
  if ('integration' in source)
    return source.integration === 'local'
      ? { kind: 'file', path: source.path }
      : { kind: 'link', href: source.url }
  return source.kind === 'file'
    ? { kind: 'file', path: source.path }
    : { kind: 'link', href: source.url }
}
function tracker(content: TicketResourceValue): TrackerResult {
  const typeEvidence = content.typeEvidence
  let typeLabel: string
  switch (typeEvidence.kind) {
    case 'recognized':
      typeLabel = typeEvidence.value
      break
    case 'missing':
      typeLabel = 'Type missing'
      break
    case 'unknown':
      typeLabel = `Unknown type: ${typeEvidence.labels[0]}`
      break
    case 'conflicting':
      typeLabel = `Conflicting types: ${typeEvidence.labels.join(', ')}`
      break
    default: {
      const exhaustive: never = typeEvidence
      return exhaustive
    }
  }
  const states = {
    closed: { label: 'Decided', variant: 'muted' },
    blocked: { label: 'Blocked', variant: 'danger' },
    claimed: { label: 'Claimed', variant: 'info' },
    frontier: { label: 'Takeable', variant: 'success' },
  } satisfies Record<TicketState, Pick<TrackerResult, 'label' | 'variant'>>
  const type = ticketTypeOf(content.typeEvidence)
  const typeAccent = {
    untyped: 'neutral',
    research: 'success',
    prototype: 'warning',
    grilling: 'danger',
    task: 'accent',
  } satisfies Record<TicketType, TrackerResult['typeAccent']>
  return {
    state: content.state,
    type,
    typeLabel,
    typeAccent: typeAccent[type],
    ...states[content.state],
    label:
      content.state !== 'closed' && content.isBlocked && content.isClaimed
        ? 'Blocked + claimed'
        : states[content.state].label,
    isBlocked: content.isBlocked,
    isClaimed: content.isClaimed,
    blockedLabel: content.isBlocked ? 'Blocked' : null,
    claimedLabel: content.isClaimed ? 'Claimed' : null,
  }
}

function admitted(admission: AutomationAdmission): Extract<AdmissionResult, { kind: 'admitted' }> {
  return {
    kind: 'admitted',
    admission,
    label: admission === 'automatic' ? 'Automatic' : 'Override',
  }
}
function processFact(result: AutomationProcessResult): EvidenceFact {
  switch (result.status) {
    case 'exited':
      return { term: 'Process result', value: `Exited ${result.code}` }
    case 'signaled':
      return { term: 'Process result', value: `Ended by ${result.signal}` }
    case 'unavailable':
      return { term: 'Process result', value: 'Unavailable', detail: result.reason }
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}
function reportFact(report: SessionReportEvidence): EvidenceFact {
  switch (report.status) {
    case 'received':
      return {
        term: 'Session report',
        value: sentenceCase(report.report.outcome),
        detail: report.report.reason,
      }
    case 'missing':
      return { term: 'Session report', value: 'Missing', detail: report.reason }
    case 'invalid':
      return { term: 'Session report', value: 'Invalid', detail: report.reason }
    default: {
      const exhaustive: never = report
      return exhaustive
    }
  }
}
function sentenceCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}
function stageLabel(status: ClassificationAttempt['status'] | WayfinderSession['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'launching':
      return 'Launching'
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'finished':
      return 'Finished'
    case 'failed':
      return 'Failed'
    case 'launch-failed':
      return 'Launch failed'
    case 'outcome-unknown':
      return 'Outcome unknown'
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}
function classificationResult(attempt: ClassificationAttempt): ClassificationResult {
  const admission = admitted(attempt.admission)
  const facts: EvidenceFact[] = [
    { term: 'State', value: stageLabel(attempt.status) },
    { term: 'Admission', value: admission.label },
  ]
  switch (attempt.status) {
    case 'running':
      return { status: attempt.status, admission, facts }
    case 'completed':
      facts.push(processFact(attempt.processResult), {
        term: 'Verdict',
        value: attempt.verdict.value.toUpperCase(),
        detail: attempt.verdict.reason,
      })
      return {
        status: attempt.status,
        admission,
        facts,
        processResult: attempt.processResult,
        verdict: attempt.verdict,
      }
    case 'failed':
      facts.push(processFact(attempt.processResult), { term: 'Reason', value: attempt.reason })
      return {
        status: attempt.status,
        admission,
        facts,
        processResult: attempt.processResult,
        reason: attempt.reason,
      }
    case 'launch-failed':
    case 'outcome-unknown':
      facts.push({ term: 'Reason', value: attempt.reason })
      return { status: attempt.status, admission, facts, reason: attempt.reason }
    default: {
      const exhaustive: never = attempt
      return exhaustive
    }
  }
}
function sessionResult(session: WayfinderSession): SessionResult {
  if (session.status === 'queued') {
    const admission = { kind: 'none', label: 'No launch admission' } satisfies AdmissionResult
    return {
      status: 'queued',
      admission,
      facts: [
        { term: 'State', value: 'Queued' },
        { term: 'Admission', value: admission.label },
      ],
    }
  }
  const admission = admitted(session.admission)
  const facts: EvidenceFact[] = [
    { term: 'State', value: stageLabel(session.status) },
    { term: 'Admission', value: admission.label },
  ]
  switch (session.status) {
    case 'launching':
    case 'running':
      return { status: session.status, admission, facts }
    case 'finished':
      facts.push(processFact(session.processResult), reportFact(session.report))
      return {
        status: session.status,
        admission,
        facts,
        processResult: session.processResult,
        report: session.report,
      }
    case 'launch-failed':
      facts.push({ term: 'Reason', value: session.reason })
      return { status: session.status, admission, facts, reason: session.reason }
    case 'outcome-unknown':
      facts.push(
        { term: 'Reason', value: session.reason },
        { term: 'Acknowledgement', value: session.acknowledged ? 'Acknowledged' : 'Required' },
      )
      return {
        status: session.status,
        admission,
        acknowledged: session.acknowledged,
        reason: session.reason,
        facts,
      }
    default: {
      const exhaustive: never = session
      return exhaustive
    }
  }
}
function evidenceResult(
  evidence: ConsumerRead['automation']['evidence'][number],
): AutomationEvidenceResult {
  return {
    target: evidence.target,
    classification: classificationResult(evidence.classification),
    session: evidence.wayfinder === undefined ? null : sessionResult(evidence.wayfinder),
  }
}
function targetKnowledge(resource: ResourceResult | undefined, message: string): TargetKnowledge {
  return resource === undefined
    ? { kind: 'missing', message }
    : { kind: 'known', availability: resource.kind, message: resourceMessage(resource) }
}
function interruptionResult(
  read: ConsumerRead,
  evidence: ConsumerRead['automation']['evidence'][number],
  presentation: AutomationEvidenceResult,
): InterruptionResult {
  const target = evidence.target
  const project = findProject(read, target.map.project)
  const map = findMap(read, target.map)
  const ticket = findTicket(read, target)
  return {
    target,
    reason:
      evidence.wayfinder?.status === 'outcome-unknown'
        ? evidence.wayfinder.reason
        : evidence.classification.status === 'outcome-unknown'
          ? evidence.classification.reason
          : '',
    navigation: { project: target.map.project, map: target.map, ticket: target },
    evidence: presentation,
    project: targetKnowledge(
      project?.resource,
      `Project ${target.map.project.projectId} is not registered in the current Roadmap state.`,
    ),
    map: targetKnowledge(
      map?.resource,
      `Map ${target.map.mapId} has no known resource in this Project. No other map has been selected.`,
    ),
    ticket: targetKnowledge(
      ticket?.resource,
      `Ticket ${target.ticketId} has no known resource in this map. No other ticket has been selected.`,
    ),
  }
}
export function presentAutomation(read: ConsumerRead): AutomationResult {
  const evidence: AutomationEvidenceResult[] = []
  const interruptions: InterruptionResult[] = []
  const historicalEvidence: InterruptionResult[] = []
  read.automation.evidence.forEach((item) => {
    const presentation = evidenceResult(item)
    evidence.push(presentation)
    const needsReview = item.wayfinder?.status === 'outcome-unknown' && !item.wayfinder.acknowledged
    const historical =
      item.classification.status === 'outcome-unknown' ||
      (item.wayfinder?.status === 'outcome-unknown' && item.wayfinder.acknowledged)
    if (!needsReview && !historical) return
    const interruption = interruptionResult(read, item, presentation)
    if (needsReview) interruptions.push(interruption)
    if (historical) historicalEvidence.push(interruption)
  })
  return {
    enabled: read.automation.enabled,
    availability: read.automation.availability,
    availabilityLabel: read.automation.availability.status === 'ready' ? 'Ready' : 'Unavailable',
    availabilityCause:
      read.automation.availability.status === 'unavailable'
        ? read.automation.availability.cause
        : null,
    evidence,
    interruptions,
    historicalEvidence,
    reviewRequired: interruptions.length > 0,
  }
}
function projectAutomation(
  read: ConsumerRead,
  ref: ProjectRef,
  global: AutomationResult,
): ProjectAutomationResult {
  const scoped = global.interruptions.filter((item) => sameProject(item.target.map.project, ref))
  return {
    ...global,
    projectEnabled: read.automation.enabledProjects.some((candidate) =>
      sameProject(candidate, ref),
    ),
    evidence: global.evidence.filter((item) => sameProject(item.target.map.project, ref)),
    historicalEvidence: global.historicalEvidence.filter((item) =>
      sameProject(item.target.map.project, ref),
    ),
    interruptions: scoped,
    reviewRequired: scoped.length > 0,
  }
}
function ticketAutomation(read: ConsumerRead, ref: TicketRef): TicketAutomationResult {
  const evidence = read.automation.evidence.find((item) => sameTicket(item.target, ref))
  const control = read.automation.overrides.find((item) => sameTicket(item.target, ref))
  const fallbackReason =
    read.automation.availability.status === 'unavailable'
      ? read.automation.availability.cause
      : 'Automation overrides are unavailable for this ticket.'
  const presentControl = (
    available: NonNullable<typeof control>['classification'] | undefined,
    label: string,
    hint: string,
  ): AutomationControlResult =>
    available === undefined
      ? { status: 'absent', label, reason: fallbackReason }
      : available.status === 'ineligible'
        ? { status: 'ineligible', label, reason: available.reason }
        : { status: 'eligible', label, hint }
  return {
    evidence: evidence === undefined ? null : evidenceResult(evidence),
    fallbackReason,
    controls: {
      classification: presentControl(
        control?.classification,
        'Run Classification',
        'Classify this ticket once.',
      ),
      wayfinder: presentControl(
        control?.wayfinder,
        'Start Wayfinder Session',
        'Start the AFK-approved ticket once.',
      ),
    },
  }
}

export type TicketResourcePresentation = {
  title: string
  displayId: string
  tracker: TrackerResult | null
  availability: ResourceAvailability<TicketResourceResult>
  unknownBlocker: boolean
}
export function presentTicketResource(ticket: TicketResource): TicketResourcePresentation {
  const content = resourceObservation(ticket.resource)?.value
  return {
    title: content?.title ?? content?.displayId ?? ticket.ref.ticketId,
    displayId: content?.displayId ?? ticket.ref.ticketId,
    tracker: content === undefined ? null : tracker(content),
    availability: availability(ticket.resource),
    unknownBlocker: content?.blockedBy.some((blocker) => blocker.state === 'unknown') ?? false,
  }
}
export function presentBlockerResource(
  blocker: Blocker,
  currentMap?: MapRef,
  context?: {
    scope?: 'external' | 'missing' | 'unresolved'
    target?: Pick<BlockerResult, 'tracker' | 'availability'>
  },
): BlockerResult {
  const reference = blocker.reference
  const target = reference.kind === 'registered' ? reference.ticket : null
  const scope =
    reference.kind === 'registered'
      ? `${reference.ticket.map.project.integration}:${reference.ticket.map.project.projectId}`
      : reference.kind === 'external'
        ? `${reference.integration}:${reference.nameWithOwner}`
        : reference.locator
  const displayId =
    blocker.displayId ??
    (reference.kind === 'registered' ? reference.ticket.ticketId : reference.ticketId)
  const local = target !== null && currentMap !== undefined && sameMap(target.map, currentMap)
  const blockerMessage = blocker.state === 'unknown' ? 'Blocker state is unknown.' : null
  const targetAvailability = context?.target?.availability ?? null
  const targetMessage =
    targetAvailability !== null && targetAvailability.kind !== 'current-readable'
      ? targetAvailability.message
      : null
  return {
    key: JSON.stringify(reference),
    title: blocker.title ?? displayId,
    displayId,
    scope,
    state: blocker.state,
    scopeLabel:
      context?.scope === 'unresolved' || reference.kind === 'unresolved'
        ? 'Unresolved blocker'
        : reference.kind === 'external'
          ? 'External blocker'
          : context?.scope === 'external' || (context?.scope === undefined && !local)
            ? 'Registered outside map'
            : 'Missing from map',
    graphStateLabel:
      blocker.state === 'unknown'
        ? 'State unknown'
        : blocker.state === 'closed'
          ? 'Closed blocker'
          : 'Open blocker',
    graphMessage: blocker.state === 'unknown' ? 'Unknown blocker state.' : null,
    stateLabel: sentenceCase(blocker.state),
    source: blocker.url === undefined ? { kind: 'absent' } : { kind: 'link', href: blocker.url },
    target,
    local,
    tracker: context?.target?.tracker ?? null,
    availability: targetAvailability,
    message:
      [blockerMessage, targetMessage].filter((message) => message !== null).join(' ') || null,
  }
}
function resolveBlocker(read: ConsumerRead, blocker: Blocker, currentMap: MapRef): BlockerResult {
  const result = presentBlockerResource(blocker, currentMap)
  if (result.target === null) return result
  const ticket = findTicket(read, result.target)
  if (ticket === undefined)
    return {
      ...result,
      message: `Ticket ${result.target.ticketId} has no known resource in its scoped map. No other ticket has been selected.${result.message === null ? '' : ` ${result.message}`}`,
    }
  const presentation = presentTicketResource(ticket)
  return {
    ...presentBlockerResource(blocker, currentMap, { target: presentation }),
    title: result.local ? presentation.title : result.title,
  }
}
function mapSummary(project: Project, map: MapResource): MapSummary {
  const content = resourceObservation(map.resource)?.value
  const active =
    project.activeMap.kind === 'known-current' && sameMap(project.activeMap.ref, map.ref)
  const statusLabel =
    map.resource.kind === 'proven-absent'
      ? 'Historical map'
      : active
        ? 'Active map'
        : content?.status === 'open'
          ? 'Open map'
          : content?.status === 'closed'
            ? 'Closed map'
            : 'Map status unknown'
  return {
    ref: map.ref,
    key: mapKey(map.ref),
    title: content?.title ?? content?.displayId ?? map.ref.mapId,
    displayId: content?.displayId ?? map.ref.mapId,
    statusLabel,
    active,
    availability: availability(map.resource),
    source: sourceDestination(content?.source),
    progress: content?.progress ?? null,
    progressLabel:
      content === undefined || content.progress === null
        ? 'Closed ticket count unknown'
        : `${content.progress.completed} closed tickets`,
  }
}
function resolveTicket(
  read: ConsumerRead,
  ref: TicketRef,
  map: MapResource | undefined,
): TicketResult {
  const ticket = map?.tickets.find((item) => sameTicket(item.ref, ref))
  const base = {
    ref,
    key: ticketKey(ref),
    title: ref.ticketId,
    displayId: ref.ticketId,
    navigation: { ticket: ref, map: ref.map },
    automation: ticketAutomation(read, ref),
    unknownBlocker: false,
  }
  const membershipMessage =
    map === undefined || map.ticketsMembership.kind === 'current-complete'
      ? null
      : 'Current ticket membership is not complete. Known traces do not prove current presence.'
  if (ticket === undefined)
    return {
      ...base,
      kind: 'missing',
      message: `Ticket ${ref.ticketId} has no known resource in this map. No other ticket has been selected.`,
      content: null,
      availability: null,
      source: { kind: 'absent' },
      tracker: null,
      decisionGist: null,
      blockers: [],
      membershipMessage,
    }
  const content = resourceObservation(ticket.resource)?.value ?? null
  const mapContent = map === undefined ? null : resourceObservation(map.resource)?.value
  const decisionGist =
    content === null
      ? null
      : (mapContent?.body.decisions.find((decision) => decision.title === content.title)?.gist ??
        null)
  return {
    ...base,
    ...presentTicketResource(ticket),
    kind: 'known',
    message: resourceMessage(ticket.resource),
    content,
    source: sourceDestination(content?.source),
    decisionGist,
    blockers: content?.blockedBy.map((blocker) => resolveBlocker(read, blocker, ref.map)) ?? [],
    membershipMessage,
  }
}
function resolveMap(read: ConsumerRead, ref: MapRef, project: Project | undefined): MapResult {
  const map = project?.maps.find((item) => sameMap(item.ref, ref))
  if (map === undefined || project === undefined)
    return {
      kind: 'missing',
      ref,
      title: ref.mapId,
      message: `The requested map "${ref.mapId}" has no known resource in this project. No other map has been selected.`,
      navigation: { map: ref },
      resource: null,
    }
  const content = resourceObservation(map.resource)?.value ?? null
  const tickets = map.tickets.map((ticket) => resolveTicket(read, ticket.ref, map))
  const blockers = tickets.flatMap((ticket) => ticket.blockers)
  const membershipMessage =
    map.ticketsMembership.kind === 'current-complete'
      ? null
      : 'Current ticket membership is not complete. Known traces do not prove current presence.'
  const graphWarnings = [...(content?.warnings ?? [])]
  if (membershipMessage !== null) graphWarnings.push(membershipMessage)
  if (content !== null && content.body.missingSections.length > 0)
    graphWarnings.push(`Missing map sections: ${content.body.missingSections.join(', ')}.`)
  return {
    ...mapSummary(project, map),
    kind: 'known',
    resource: map,
    content,
    navigation: { map: ref },
    tickets,
    blockers,
    membershipMessage,
    warnings: content?.warnings ?? [],
    graphWarnings,
    knownTicketCount: tickets.filter((ticket) => ticket.content !== null).length,
    knownClosedTicketCount: tickets.filter((ticket) => ticket.tracker?.state === 'closed').length,
  }
}
export function resolveSelection(read: ConsumerRead, request: SelectionRequest): SelectionResult {
  const sourceProject = findProject(read, request.project)
  const project = resolveProject(read, request.project)
  let kind: SelectionResult['kind']
  let selected = request.map
  if (selected !== null || request.ticket !== null) {
    kind = 'pinned'
    selected ??= request.ticket?.map ?? null
  } else if (sourceProject?.activeMap.kind === 'known-current') {
    kind = 'default-current'
    selected = sourceProject.activeMap.ref
  } else if (sourceProject?.activeMap.kind === 'known-empty') {
    const closed = sourceProject.displayOrder.closed[0]
    kind = closed === undefined ? 'known-empty' : 'default-closed'
    selected = closed ?? null
  } else kind = 'no-trustworthy-default'
  const map = selected === null ? null : resolveMap(read, selected, sourceProject)
  const requestedTicket = request.ticket
  const ticketMap =
    requestedTicket === null
      ? undefined
      : sourceProject?.maps.find((item) => sameMap(item.ref, requestedTicket.map))
  const ticket = requestedTicket === null ? null : resolveTicket(read, requestedTicket, ticketMap)
  const message =
    map?.kind === 'missing'
      ? map.message
      : kind === 'no-trustworthy-default'
        ? 'Current map ordering is uncertain. Choose a known map explicitly to inspect its source evidence.'
        : kind === 'known-empty'
          ? 'This project has no current open map. Historical maps remain available in navigation.'
          : ''
  return { kind, project, map, ticket, message }
}

function connectionSummary(connection: Connection): ConnectionSummary {
  const labels = {
    available: 'Available',
    degraded: 'Observation degraded',
    'authorization-required': 'Authorization required',
    unavailable: 'Unavailable',
  } satisfies Record<ConnectionAvailability['status'], string>
  return {
    kind: 'known',
    id: connection.id,
    name: connection.name,
    integration: connection.integration,
    builtIn: connection.builtIn,
    login: connection.integration === 'github' ? connection.githubIdentity.login : null,
    health: {
      status: connection.availability.status,
      label: labels[connection.availability.status],
      cause: connection.availability.status === 'available' ? null : connection.availability.cause,
      observedAt: connection.availability.observedAt ?? null,
    },
  }
}
function knownProject(
  read: ConsumerRead,
  project: Project,
  automation: ProjectAutomationResult,
): KnownProjectResult {
  const ordered = orderedMaps(project)
  const summarize = (map: MapResource) => mapSummary(project, map)
  const activeRef = project.activeMap.kind === 'known-current' ? project.activeMap.ref : null
  const currentMap =
    activeRef === null ? undefined : project.maps.find((map) => sameMap(map.ref, activeRef))
  const active =
    currentMap === undefined ? undefined : resourceObservation(currentMap.resource)?.value
  const latestClosed = ordered.closed[0]
  const closed =
    latestClosed === undefined ? undefined : resourceObservation(latestClosed.resource)?.value
  const membership = project.mapsMembership
  const currentMaps =
    membership.kind === 'current-complete'
      ? membership.observation.value.members.map((ref) =>
          project.maps.find((map) => sameMap(map.ref, ref)),
        )
      : null
  const mapCount = currentMaps?.length ?? null
  const decisions =
    currentMaps?.reduce<number | null>((sum, map) => {
      if (sum === null || map === undefined || map.resource.kind !== 'current-readable') return null
      if (map.resource.observation.completeness.kind !== 'complete') return null
      const progress = map.resource.observation.value.progress
      return progress === null ? null : sum + progress.completed
    }, 0) ?? null
  const journey: ProjectJourney =
    project.activeMap.kind === 'uncertain'
      ? 'uncertain'
      : currentMap !== undefined
        ? 'active'
        : currentMaps?.length === 0
          ? 'waiting'
          : 'resting'
  const observation = resourceObservation(project.resource)
  const sourceWarnings = observation?.value.warnings ?? []
  const warnings = [...new Set([...sourceWarnings, ...project.managementWarnings])]
  const connection = read.connections.find((connection) => connection.id === project.connectionId)
  const activityAt = active?.updatedAt ?? closed?.closedAt ?? closed?.updatedAt
  const orderWarning =
    project.activeMap.kind === 'uncertain'
      ? `${project.activeMap.cause} The last trustworthy map order is retained. No map is promoted to active.`
      : null
  const membershipMessage =
    project.activeMap.kind === 'uncertain'
      ? `${project.activeMap.cause} ${membership.kind !== 'current-complete' ? 'Current map membership is unknown.' : 'Known maps remain available for explicit inspection.'}`
      : membership.kind !== 'current-complete'
        ? 'Current map membership is unknown.'
        : currentMaps?.length === 0
          ? 'No current Wayfinder maps.'
          : null
  const incomplete = project.maps.some(
    (map) =>
      map.resource.kind === 'current-readable' &&
      map.resource.observation.completeness.kind === 'incomplete',
  )
  const mapState =
    project.activeMap.kind === 'uncertain'
      ? project.activeMap.cause
      : (membershipMessage ??
        `${ordered.open.length} open · ${ordered.closed.length} closed${incomplete ? ' · incomplete source content' : ''}`)
  const roadmap = project.actions.find((action) => action.kind === 'roadmap') ?? null
  return {
    kind: 'known',
    ref: project.ref,
    key: projectKey(project.ref),
    name: project.name,
    integration: project.integration,
    connectionId: project.connectionId,
    connection: connection === undefined ? null : connectionSummary(connection),
    locator: project.integration === 'local' ? project.source.path : project.source.nameWithOwner,
    workspacePath:
      project.integration === 'local' ? project.source.path : project.management.workspacePath,
    displayName: project.management.displayName ?? null,
    source: sourceDestination(project.source),
    observedSource: sourceDestination(observation?.value.source),
    availability: availability(project.resource),
    warnings,
    mapState,
    description:
      journey === 'uncertain'
        ? 'Active map is uncertain'
        : journey === 'active'
          ? 'Current active map established'
          : journey === 'resting'
            ? `All ${mapCount === null ? 'known' : mapCount} maps closed`
            : 'No current open map',
    orderWarning,
    membershipMessage,
    membershipTitle:
      project.activeMap.kind === 'uncertain' ? 'Active map is uncertain.' : membershipMessage,
    journey,
    journeyLabel:
      journey === 'uncertain'
        ? 'Active map uncertain'
        : journey === 'waiting'
          ? 'Known empty'
          : journey === 'resting'
            ? 'Resting'
            : 'Active',
    journeyVariant: journey === 'uncertain' ? 'danger' : journey === 'active' ? 'info' : 'neutral',
    navigation: {
      project: project.ref,
      settings: project.ref,
      open: ordered.open.map(summarize),
      closed: ordered.closed.map(summarize),
      unplaced: ordered.unplaced.map(summarize),
    },
    maps: project.maps.map(summarize),
    currentMap: currentMap === undefined ? null : summarize(currentMap),
    destination:
      active === undefined
        ? ''
        : stripInlineMarkdown(active.body.destination) || active.title || 'Untitled map',
    mapCount,
    decisions,
    openTickets:
      active === undefined
        ? project.activeMap.kind === 'known-empty'
          ? 0
          : null
        : active.progress === null
          ? null
          : active.progress.total - active.progress.completed,
    hasFog:
      active !== undefined &&
      (active.body.notYetSpecified.length > 0 || active.body.notYetSpecifiedNote !== ''),
    priorities:
      currentMap?.frontier.flatMap((ref) => {
        const ticket = currentMap.tickets.find((ticket) => sameTicket(ticket.ref, ref))
        if (ticket?.resource.kind !== 'current-readable') return []
        const value = ticket.resource.observation.value
        return [value.title ?? value.displayId ?? `Ticket ${ref.ticketId}`]
      }) ?? [],
    activity: activityAt === undefined ? { kind: 'unknown' } : { kind: 'known', at: activityAt },
    capabilities: {
      actions: project.actions,
      repairOffered: !project.actions.some(
        (action) => action.kind === 'server-launch' && action.operation === 'open-workspace',
      ),
      roadmap,
    },
    automation,
  }
}
export function resolveProject(read: ConsumerRead, ref: ProjectRef): ProjectResult {
  const project = findProject(read, ref)
  const scopedRead = {
    ...read,
    automation: {
      ...read.automation,
      evidence: read.automation.evidence.filter((item) =>
        sameProject(item.target.map.project, ref),
      ),
    },
  }
  const automation = projectAutomation(read, ref, presentAutomation(scopedRead))
  return project === undefined
    ? {
        kind: 'missing',
        ref,
        key: projectKey(ref),
        name: ref.projectId,
        message: 'This project is not registered in the current Roadmap state.',
        description: 'Project map',
        navigation: { project: ref, settings: ref },
        automation,
      }
    : knownProject(read, project, automation)
}
export function presentProjects(read: ConsumerRead): ProjectPortfolio {
  const automation = presentAutomation(read)
  const projects = read.projects.map((project) =>
    knownProject(read, project, projectAutomation(read, project.ref, automation)),
  )
  const active = projects
    .filter((project) => project.journey === 'active')
    .sort((left, right) => {
      if (left.activity.kind === 'unknown') return right.activity.kind === 'unknown' ? 0 : 1
      if (right.activity.kind === 'unknown') return -1
      return right.activity.at - left.activity.at
    })
  const attention: AttentionItem[] = []
  if (!read.configuration.valid)
    attention.push({
      kind: 'configuration',
      key: 'configuration',
      title: 'Configuration needs attention',
      detail:
        read.configuration.issues.map((issue) => issue.message).join(' ') ||
        'Roadmap is keeping the last valid configuration until this is repaired.',
    })
  for (const connection of read.connections) {
    if (connection.availability.status === 'available') continue
    const dependents = projects
      .filter((project) => project.connectionId === connection.id)
      .map((project) => project.name)
    const dependencyDetail =
      dependents.length === 0
        ? 'No registered Projects currently depend on it.'
        : `Associated Projects: ${dependents.join(', ')}. Their source observations are reported independently.`
    const title =
      connection.availability.status === 'authorization-required'
        ? `${connection.name} needs authorization`
        : connection.availability.status === 'degraded'
          ? `${connection.name} observations are stale`
          : `${connection.name} is unavailable`
    attention.push({
      kind: 'connection',
      key: `connection:${connection.id}`,
      title,
      detail: `${connection.availability.cause} ${dependencyDetail}`,
      connectionId: connection.id,
    })
  }
  for (const project of projects) {
    if (project.availability.kind !== 'current-readable' || project.journey === 'uncertain')
      attention.push({
        kind: 'project',
        key: JSON.stringify([project.ref.integration, project.ref.projectId, 'source']),
        title: `${project.name} source needs attention`,
        detail: `${project.availability.message}${project.orderWarning === null ? '' : ` ${project.orderWarning}`}`,
        project: project.ref,
      })
    if (project.warnings.length > 0)
      attention.push({
        kind: 'project',
        key: JSON.stringify([project.ref.integration, project.ref.projectId, 'warnings']),
        title: `${project.name} has warnings`,
        detail: project.warnings.join(' '),
        project: project.ref,
      })
  }
  return {
    projects,
    active,
    resting: projects.filter((project) => project.journey === 'resting'),
    waiting: projects.filter((project) => project.journey === 'waiting'),
    uncertain: projects.filter((project) => project.journey === 'uncertain'),
    attention,
    automation,
  }
}
export function resolveAuthorization(
  _read: ConsumerRead,
  operation: AuthorizationOperation,
): AuthorizationResult {
  switch (operation.status) {
    case 'waiting':
      return {
        kind: 'waiting',
        id: operation.id,
        label: 'Waiting for GitHub',
        connectionId: operation.connectionId ?? null,
        verificationUri: operation.verificationUri,
        userCode: operation.userCode,
        expiresAt: operation.expiresAt,
        cause: null,
      }
    case 'granted':
      return operation.connection.kind === 'current'
        ? {
            kind: 'granted-current',
            id: operation.id,
            label: 'Authorized',
            accountId: operation.connection.accountId,
            connectionId: operation.connection.id,
            navigation: { connection: operation.connection.id },
            cause: null,
          }
        : {
            kind: 'granted-historical',
            id: operation.id,
            label: 'Authorized',
            accountId: operation.connection.accountId,
            connectionId: operation.connection.id,
            message:
              'This grant is historical. Its account has no matching current configured Connection.',
            cause: null,
          }
    case 'terminal': {
      const labels = {
        cancelled: 'Authorization cancelled',
        expired: 'Authorization expired',
        denied: 'Authorization denied',
        failed: 'Authorization failed',
      } satisfies Record<typeof operation.outcome, string>
      return {
        kind: 'terminal',
        id: operation.id,
        label: labels[operation.outcome],
        connectionId: operation.connectionId ?? null,
        outcome: operation.outcome,
        cause: 'cause' in operation ? operation.cause : null,
      }
    }
    default: {
      const exhaustive: never = operation
      return exhaustive
    }
  }
}
function integrationContext(
  read: ConsumerRead,
  integration: Integration,
): Omit<RegistrationContext, 'identity'> {
  const support = read.supportedIntegrations.find((entry) => entry.integration === integration)
  const github = support?.integration === 'github' ? support : null
  return {
    integration,
    folderLabel: integration === 'local' ? 'Workspace folder' : 'GitHub Workspace folder',
    description:
      integration === 'local'
        ? 'Choose a local folder containing Wayfinder maps.'
        : 'Choose a Workspace for a GitHub repository available through this Connection.',
    newInstallation:
      github === null ? { kind: 'absent' } : { kind: 'link', href: github.newInstallationUrl },
    installations:
      github === null ? { kind: 'absent' } : { kind: 'link', href: github.installationsUrl },
    authorizations:
      github === null ? { kind: 'absent' } : { kind: 'link', href: github.authorizationsUrl },
  }
}
function knownConnection(
  read: ConsumerRead,
  connection: Connection,
  automation: AutomationResult,
): Extract<ConnectionResult, { kind: 'known' }> {
  const projects = read.projects
    .filter((project) => project.connectionId === connection.id)
    .map((project) => knownProject(read, project, projectAutomation(read, project.ref, automation)))
  const authorizations = read.authorizationOperations
    .filter((operation) =>
      operation.status === 'granted'
        ? operation.connection.id === connection.id
        : operation.connectionId === connection.id,
    )
    .map((operation) => resolveAuthorization(read, operation))
  return {
    ...connectionSummary(connection),
    projects,
    projectCount: projects.length,
    authorizations,
    currentAuthorization:
      authorizations.findLast((operation) => operation.kind === 'waiting') ??
      authorizations.at(-1) ??
      null,
    registration: {
      ...integrationContext(read, connection.integration),
      identity: { id: connection.id, integration: connection.integration },
    },
  }
}
export function resolveConnection(read: ConsumerRead, id: ConnectionId): ConnectionResult {
  const connection = read.connections.find((connection) => connection.id === id)
  return connection === undefined
    ? {
        kind: 'missing',
        id,
        message: 'This Connection is not configured in the current Roadmap state.',
      }
    : knownConnection(read, connection, presentAutomation(read))
}
export function presentConnections(read: ConsumerRead): ConnectionPortfolio {
  const automation = presentAutomation(read)
  return {
    connections: read.connections.map((connection) =>
      knownConnection(read, connection, automation),
    ),
    githubSetup: read.supportedIntegrations.some((entry) => entry.integration === 'github')
      ? integrationContext(read, 'github')
      : null,
    looseAuthorizations: read.authorizationOperations
      .filter(
        (operation) =>
          operation.status !== 'granted' &&
          operation.connectionId === undefined &&
          !(operation.status === 'terminal' && operation.outcome === 'cancelled'),
      )
      .map((operation) => resolveAuthorization(read, operation)),
  }
}
