import type { Integration, ProjectKey } from '@roadmap/contracts'

export type SourceProjectKey = ProjectKey
export interface SourceMapKey {
  readonly project: SourceProjectKey
  readonly mapId: string
}
export interface SourceTicketKey {
  readonly map: SourceMapKey
  readonly ticketId: string
}

export type SourceScope =
  | { readonly kind: 'project'; readonly project: SourceProjectKey }
  | { readonly kind: 'maps-membership'; readonly project: SourceProjectKey }
  | { readonly kind: 'map'; readonly map: SourceMapKey }
  | { readonly kind: 'tickets-membership'; readonly map: SourceMapKey }
  | { readonly kind: 'ticket'; readonly ticket: SourceTicketKey }

export type Completeness =
  | { readonly kind: 'complete' }
  | {
      readonly kind: 'incomplete'
      readonly reason: 'pagination' | 'unreadable' | 'malformed'
    }

export type SourceProvenance =
  | {
      readonly integration: 'local'
      readonly path: string
      readonly operation: 'inspect-root' | 'enumerate' | 'read'
    }
  | {
      readonly integration: 'github'
      readonly connectionId: string
      readonly repositoryId: string
      readonly stage: 'credentials' | 'repository' | 'map-list' | 'map-read'
    }

export type SourceFailure =
  | {
      readonly kind: 'filesystem'
      readonly operation: 'inspect-root' | 'enumerate' | 'read'
      readonly code: 'ENOENT' | 'EACCES' | 'other'
    }
  | { readonly kind: 'transient'; readonly cause: 'network' | 'rate-limit' | 'server' }
  | { readonly kind: 'execution'; readonly cause: 'provider' }
  | { readonly kind: 'access-unavailable' }
  | { readonly kind: 'read'; readonly cause: 'response-read' | 'malformed-response' }
  | {
      readonly kind: 'authorization'
      readonly proof:
        | 'http-401'
        | 'rejected-credential'
        | 'authorization-required'
        | 'account-mismatch'
    }
  | {
      readonly kind: 'access-ambiguous'
      readonly evidence: 'http-403' | 'http-404' | 'null-resource' | 'missing-alias'
    }
  | { readonly kind: 'identity-mismatch' }

type SourceAbsenceProof =
  | {
      readonly kind: 'complete-membership'
      readonly parent:
        | Extract<SourceScope, { kind: 'maps-membership' }>
        | Extract<SourceScope, { kind: 'tickets-membership' }>
    }
  | { readonly kind: 'provider-deletion'; readonly repositoryId: string }

type ScopedAttempt<S extends SourceScope, V> =
  | {
      readonly kind: 'observed'
      readonly scope: S
      readonly attemptedAt: number
      readonly observedAt: number
      readonly provenance: SourceProvenance
      readonly completeness: Completeness
      readonly value: V
    }
  | {
      readonly kind: 'failed'
      readonly scope: S
      readonly attemptedAt: number
      readonly provenance: SourceProvenance
      readonly failure: SourceFailure
    }

export type AbsentAttempt = {
  readonly kind: 'proven-absent'
  readonly attemptedAt: number
  readonly observedAt: number
  readonly provenance: SourceProvenance
} & (
  | {
      readonly scope: Extract<SourceScope, { kind: 'project' }>
      readonly proof: Extract<SourceAbsenceProof, { kind: 'provider-deletion' }>
    }
  | {
      readonly scope: Extract<SourceScope, { kind: 'map' }>
      readonly proof: {
        readonly kind: 'complete-membership'
        readonly parent: Extract<SourceScope, { kind: 'maps-membership' }>
      }
    }
  | {
      readonly scope: Extract<SourceScope, { kind: 'ticket' }>
      readonly proof: {
        readonly kind: 'complete-membership'
        readonly parent: Extract<SourceScope, { kind: 'tickets-membership' }>
      }
    }
)

export type ObservationAttempt =
  | Extract<
      ScopedAttempt<Extract<SourceScope, { kind: 'project' }>, SourceProjectContent>,
      { kind: 'observed' }
    >
  | Extract<
      ScopedAttempt<Extract<SourceScope, { kind: 'maps-membership' }>, MapMembership>,
      { kind: 'observed' }
    >
  | Extract<
      ScopedAttempt<Extract<SourceScope, { kind: 'map' }>, SourceMapContent>,
      { kind: 'observed' }
    >
  | Extract<
      ScopedAttempt<Extract<SourceScope, { kind: 'tickets-membership' }>, TicketMembership>,
      { kind: 'observed' }
    >
  | Extract<
      ScopedAttempt<Extract<SourceScope, { kind: 'ticket' }>, SourceTicketContent>,
      { kind: 'observed' }
    >
  | Extract<ScopedAttempt<SourceScope, never>, { kind: 'failed' }>
  | AbsentAttempt

interface MapMembership {
  readonly members: readonly SourceMapKey[]
}
interface TicketMembership {
  readonly members: readonly SourceTicketKey[]
}

type SourceDestination =
  | { readonly integration: 'local'; readonly path: string }
  | {
      readonly integration: 'github'
      readonly repositoryId: string
      readonly nameWithOwner: string
      readonly url: string
    }

export interface SourceProjectContent {
  readonly key: SourceProjectKey
  readonly name: string
  readonly source: SourceDestination
  readonly warnings: readonly string[]
}

export interface SourceMapBody {
  readonly raw: string
  readonly destination: string
  readonly notes: readonly string[]
  readonly decisions: readonly {
    readonly title: string
    readonly url: string | null
    readonly gist: string
    readonly raw: string
  }[]
  readonly notYetSpecified: readonly string[]
  readonly notYetSpecifiedNote: string
  readonly outOfScope: readonly string[]
  readonly sections: readonly {
    readonly heading: string
    readonly text: string
    readonly items: readonly string[]
  }[]
  readonly missingSections: readonly string[]
}

export interface SourceMapContent {
  readonly key: SourceMapKey
  readonly displayId?: string
  readonly title?: string
  readonly source:
    | { readonly kind: 'file'; readonly path: string }
    | { readonly kind: 'issue'; readonly url: string }
  readonly status: 'open' | 'closed' | 'unknown'
  readonly updatedAt: number
  readonly closedAt?: number
  readonly body: SourceMapBody
  readonly progress: { readonly total: number; readonly completed: number } | null
  readonly unidentifiedTickets: readonly {
    readonly sourcePath: string
    readonly raw: string
    readonly warnings: readonly string[]
  }[]
  readonly warnings: readonly string[]
}

export type SourceTicketTypeEvidence =
  | {
      readonly kind: 'recognized'
      readonly value: 'research' | 'prototype' | 'grilling' | 'task'
      readonly labels: readonly string[]
    }
  | { readonly kind: 'missing'; readonly labels: readonly [] }
  | { readonly kind: 'unknown' | 'conflicting'; readonly labels: readonly string[] }

type SourceBlockerReference =
  | { readonly kind: 'registered'; readonly project: SourceProjectKey; readonly ticketId: string }
  | {
      readonly kind: 'external'
      readonly integration: 'github'
      readonly nameWithOwner: string
      readonly ticketId: string
      readonly repositoryId?: string
    }
  | { readonly kind: 'unresolved'; readonly locator: string; readonly ticketId: string }

export interface SourceBlocker {
  readonly reference: SourceBlockerReference
  readonly displayId?: string
  readonly title?: string
  readonly url?: string
  readonly state: 'open' | 'closed' | 'unknown'
  readonly provenance: SourceProvenance
}

export interface SourceTicketContent {
  readonly key: SourceTicketKey
  readonly displayId?: string
  readonly title?: string
  readonly source:
    | { readonly kind: 'file'; readonly path: string }
    | { readonly kind: 'issue'; readonly url: string }
  readonly body: string
  readonly typeEvidence: SourceTicketTypeEvidence
  readonly status: 'open' | 'closed' | 'unknown'
  readonly isClaimed: boolean
  readonly createdAt?: number
  readonly closedAt?: number
  readonly assignees: readonly {
    readonly name: string
    readonly url?: string
    readonly avatarUrl?: string
  }[]
  readonly blockedBy: readonly SourceBlocker[]
  readonly blockersComplete: boolean
  readonly warnings: readonly string[]
}

/** Scoped reader output. Observation times belong to the attempts, not this batch. */
export interface ObservationBatch {
  readonly attempts: readonly ObservationAttempt[]
}

/**
 * Connection health is independent of resource completeness and credential usability.
 * observedAt is an actual successful scoped read selected by the source owner, or its
 * retained last successful time. No successful evidence means no observation time.
 */
export type SourceObservationHealth =
  | { readonly status: 'available'; readonly observedAt?: number }
  | { readonly status: 'degraded'; readonly cause: string; readonly observedAt: number }
  | {
      readonly status: 'authorization-required'
      readonly cause: string
      readonly observedAt?: number
    }
  | { readonly status: 'unavailable'; readonly cause: string; readonly observedAt?: number }

export interface SourceContribution extends ObservationBatch {
  readonly project: SourceProjectKey
  readonly health: SourceObservationHealth
}

export interface SourceObserver {
  /** Starts supervision and resolves after an honest scoped baseline attempt. */
  observe(): Promise<SourceContribution>
  subscribe(listener: (contribution: SourceContribution) => void): () => void
  refresh(): Promise<SourceContribution>
  stop(): Promise<void>
}

type ObservedAttempt = Extract<ObservationAttempt, { kind: 'observed' }>
type FailedAttempt = Extract<ObservationAttempt, { kind: 'failed' }>

export function sourceScopeKey(scope: SourceScope): string {
  switch (scope.kind) {
    case 'project':
    case 'maps-membership':
      return JSON.stringify([scope.kind, scope.project.integration, scope.project.id])
    case 'map':
    case 'tickets-membership':
      return JSON.stringify([
        scope.kind,
        scope.map.project.integration,
        scope.map.project.id,
        scope.map.mapId,
      ])
    case 'ticket':
      return JSON.stringify([
        scope.kind,
        scope.ticket.map.project.integration,
        scope.ticket.map.project.id,
        scope.ticket.map.mapId,
        scope.ticket.ticketId,
      ])
  }
}

export function observedAttempt(attempt: ObservedAttempt): ObservedAttempt {
  if (!isObservationAttempt(attempt)) throw new Error('Invalid observed source evidence.')
  return attempt
}

export function failedAttempt(attempt: FailedAttempt): FailedAttempt {
  if (!isObservationAttempt(attempt)) throw new Error('Invalid failed source evidence.')
  return attempt
}

export function absentAttempt(attempt: AbsentAttempt): AbsentAttempt {
  if (!isObservationAttempt(attempt)) throw new Error('Invalid source absence proof.')
  return attempt
}

export function refineObservationAttempt(input: unknown): ObservationAttempt | null {
  return isObservationAttempt(input) ? input : null
}

/** previous must be this source owner's last accepted contribution, never a pending source. */
export function refineSourceContribution(
  input: unknown,
  previous?: SourceContribution | null,
): SourceContribution | null {
  return isSourceContribution(input, previous) ? input : null
}

function isSourceContribution(
  value: unknown,
  previous?: SourceContribution | null,
): value is SourceContribution {
  if (
    !record(value) ||
    !onlyKeys(value, ['project', 'attempts', 'health']) ||
    !projectIdentity(value.project) ||
    !Array.isArray(value.attempts) ||
    !isObservationHealth(value.health)
  )
    return false
  const scopes = new Set<string>()
  let hasProjectAttempt = false
  const observedAt = value.health.observedAt
  let hasSuccessfulTime = observedAt === undefined
  if (previous && sameProject(previous.project, value.project)) {
    hasSuccessfulTime ||=
      previous.health.observedAt === observedAt ||
      previous.attempts.some(
        (attempt) => attempt.kind !== 'failed' && attempt.observedAt === observedAt,
      )
  }
  for (const attempt of value.attempts) {
    if (
      !isObservationAttempt(attempt) ||
      !sameProject(scopeProject(attempt.scope), value.project)
    ) {
      return false
    }
    const key =
      attempt.kind === 'failed' &&
      attempt.scope.kind === 'tickets-membership' &&
      attempt.provenance.integration === 'local' &&
      attempt.provenance.operation === 'read'
        ? JSON.stringify([sourceScopeKey(attempt.scope), attempt.provenance.path])
        : sourceScopeKey(attempt.scope)
    if (scopes.has(key)) return false
    scopes.add(key)
    if (attempt.scope.kind === 'project') hasProjectAttempt = true
    if (attempt.kind !== 'failed' && attempt.observedAt === observedAt) hasSuccessfulTime = true
  }
  return hasProjectAttempt && hasSuccessfulTime
}

function isObservationHealth(value: unknown): value is SourceObservationHealth {
  if (!record(value)) return false
  switch (value.status) {
    case 'available':
      return onlyKeys(value, ['status', 'observedAt']) && optionalTime(value.observedAt)
    case 'degraded':
      return (
        onlyKeys(value, ['status', 'cause', 'observedAt']) &&
        text(value.cause) &&
        finite(value.observedAt)
      )
    case 'authorization-required':
    case 'unavailable':
      return (
        onlyKeys(value, ['status', 'cause', 'observedAt']) &&
        text(value.cause) &&
        optionalTime(value.observedAt)
      )
    default:
      return false
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function text(value: unknown): value is string {
  return typeof value === 'string'
}

function identity(value: unknown): value is string {
  return text(value) && value.trim().length > 0
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalText(value: unknown): boolean {
  return value === undefined || text(value)
}

function optionalTime(value: unknown): boolean {
  return value === undefined || finite(value)
}

function strings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(text)
}

function projectIdentity(value: unknown): value is SourceProjectKey {
  return (
    record(value) &&
    onlyKeys(value, ['integration', 'id']) &&
    (value.integration === 'local' || value.integration === 'github') &&
    identity(value.id)
  )
}

function mapIdentity(value: unknown): value is SourceMapKey {
  return (
    record(value) &&
    onlyKeys(value, ['project', 'mapId']) &&
    projectIdentity(value.project) &&
    identity(value.mapId)
  )
}

function ticketIdentity(value: unknown): value is SourceTicketKey {
  return (
    record(value) &&
    onlyKeys(value, ['map', 'ticketId']) &&
    mapIdentity(value.map) &&
    identity(value.ticketId)
  )
}

function sameProject(a: SourceProjectKey, b: SourceProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}

function sameMap(a: SourceMapKey, b: SourceMapKey): boolean {
  return sameProject(a.project, b.project) && a.mapId === b.mapId
}

function sameTicket(a: SourceTicketKey, b: SourceTicketKey): boolean {
  return sameMap(a.map, b.map) && a.ticketId === b.ticketId
}

function isScope(value: unknown): value is SourceScope {
  if (!record(value)) return false
  switch (value.kind) {
    case 'project':
    case 'maps-membership':
      return onlyKeys(value, ['kind', 'project']) && projectIdentity(value.project)
    case 'map':
    case 'tickets-membership':
      return onlyKeys(value, ['kind', 'map']) && mapIdentity(value.map)
    case 'ticket':
      return onlyKeys(value, ['kind', 'ticket']) && ticketIdentity(value.ticket)
    default:
      return false
  }
}

function scopeProject(scope: SourceScope): SourceProjectKey {
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

function isProvenance(value: unknown): value is SourceProvenance {
  if (!record(value)) return false
  if (value.integration === 'local') {
    return (
      onlyKeys(value, ['integration', 'path', 'operation']) &&
      identity(value.path) &&
      (value.operation === 'inspect-root' ||
        value.operation === 'enumerate' ||
        value.operation === 'read')
    )
  }
  return (
    onlyKeys(value, ['integration', 'connectionId', 'repositoryId', 'stage']) &&
    value.integration === 'github' &&
    identity(value.connectionId) &&
    identity(value.repositoryId) &&
    (value.stage === 'credentials' ||
      value.stage === 'repository' ||
      value.stage === 'map-list' ||
      value.stage === 'map-read')
  )
}

function isFailure(value: unknown): value is SourceFailure {
  if (!record(value)) return false
  switch (value.kind) {
    case 'filesystem':
      return (
        onlyKeys(value, ['kind', 'operation', 'code']) &&
        (value.operation === 'inspect-root' ||
          value.operation === 'enumerate' ||
          value.operation === 'read') &&
        (value.code === 'ENOENT' || value.code === 'EACCES' || value.code === 'other')
      )
    case 'transient':
      return (
        onlyKeys(value, ['kind', 'cause']) &&
        (value.cause === 'network' || value.cause === 'rate-limit' || value.cause === 'server')
      )
    case 'execution':
      return onlyKeys(value, ['kind', 'cause']) && value.cause === 'provider'
    case 'read':
      return (
        onlyKeys(value, ['kind', 'cause']) &&
        (value.cause === 'response-read' || value.cause === 'malformed-response')
      )
    case 'authorization':
      return (
        onlyKeys(value, ['kind', 'proof']) &&
        (value.proof === 'http-401' ||
          value.proof === 'rejected-credential' ||
          value.proof === 'authorization-required' ||
          value.proof === 'account-mismatch')
      )
    case 'access-ambiguous':
      return (
        onlyKeys(value, ['kind', 'evidence']) &&
        (value.evidence === 'http-403' ||
          value.evidence === 'http-404' ||
          value.evidence === 'null-resource' ||
          value.evidence === 'missing-alias')
      )
    case 'access-unavailable':
    case 'identity-mismatch':
      return onlyKeys(value, ['kind'])
    default:
      return false
  }
}

function isCompleteness(value: unknown): value is Completeness {
  return (
    record(value) &&
    ((value.kind === 'complete' && onlyKeys(value, ['kind'])) ||
      (value.kind === 'incomplete' &&
        onlyKeys(value, ['kind', 'reason']) &&
        (value.reason === 'pagination' ||
          value.reason === 'unreadable' ||
          value.reason === 'malformed')))
  )
}

function isDestination(value: unknown): value is SourceDestination {
  return (
    record(value) &&
    ((value.integration === 'local' &&
      onlyKeys(value, ['integration', 'path']) &&
      identity(value.path)) ||
      (value.integration === 'github' &&
        onlyKeys(value, ['integration', 'repositoryId', 'nameWithOwner', 'url']) &&
        identity(value.repositoryId) &&
        identity(value.nameWithOwner) &&
        identity(value.url)))
  )
}

function isSource(value: unknown, integration: Integration): boolean {
  return (
    record(value) &&
    (integration === 'local'
      ? onlyKeys(value, ['kind', 'path']) && value.kind === 'file' && identity(value.path)
      : onlyKeys(value, ['kind', 'url']) && value.kind === 'issue' && identity(value.url))
  )
}

function isBody(value: unknown): value is SourceMapBody {
  return (
    record(value) &&
    onlyKeys(value, [
      'raw',
      'destination',
      'notes',
      'decisions',
      'notYetSpecified',
      'notYetSpecifiedNote',
      'outOfScope',
      'sections',
      'missingSections',
    ]) &&
    text(value.raw) &&
    text(value.destination) &&
    strings(value.notes) &&
    Array.isArray(value.decisions) &&
    value.decisions.every(
      (decision: unknown) =>
        record(decision) &&
        onlyKeys(decision, ['title', 'url', 'gist', 'raw']) &&
        text(decision.title) &&
        (decision.url === null || text(decision.url)) &&
        text(decision.gist) &&
        text(decision.raw),
    ) &&
    strings(value.notYetSpecified) &&
    text(value.notYetSpecifiedNote) &&
    strings(value.outOfScope) &&
    Array.isArray(value.sections) &&
    value.sections.every(
      (section: unknown) =>
        record(section) &&
        onlyKeys(section, ['heading', 'text', 'items']) &&
        text(section.heading) &&
        text(section.text) &&
        strings(section.items),
    ) &&
    strings(value.missingSections)
  )
}

function status(value: unknown): boolean {
  return value === 'open' || value === 'closed' || value === 'unknown'
}

function isTypeEvidence(value: unknown): value is SourceTicketTypeEvidence {
  if (
    !record(value) ||
    !onlyKeys(
      value,
      value.kind === 'recognized' ? ['kind', 'value', 'labels'] : ['kind', 'labels'],
    ) ||
    !strings(value.labels)
  )
    return false
  switch (value.kind) {
    case 'missing':
      return value.labels.length === 0
    case 'recognized':
      return (
        (value.value === 'research' ||
          value.value === 'prototype' ||
          value.value === 'grilling' ||
          value.value === 'task') &&
        value.labels.length === 1 &&
        value.labels[0] === value.value
      )
    case 'unknown':
      return (
        value.labels.length === 1 &&
        !['research', 'prototype', 'grilling', 'task'].includes(value.labels[0] ?? '')
      )
    case 'conflicting':
      return value.labels.length > 1 && new Set(value.labels).size === value.labels.length
    default:
      return false
  }
}

function isBlocker(value: unknown, integration: Integration): value is SourceBlocker {
  if (
    !record(value) ||
    !onlyKeys(value, ['reference', 'displayId', 'title', 'url', 'state', 'provenance']) ||
    !record(value.reference) ||
    !identity(value.reference.ticketId) ||
    !status(value.state) ||
    !optionalText(value.displayId) ||
    !optionalText(value.title) ||
    !optionalText(value.url) ||
    !isProvenance(value.provenance) ||
    value.provenance.integration !== integration
  )
    return false
  switch (value.reference.kind) {
    case 'registered':
      return (
        onlyKeys(value.reference, ['kind', 'project', 'ticketId']) &&
        projectIdentity(value.reference.project)
      )
    case 'external':
      return (
        onlyKeys(value.reference, [
          'kind',
          'integration',
          'nameWithOwner',
          'ticketId',
          'repositoryId',
        ]) &&
        value.reference.integration === 'github' &&
        identity(value.reference.nameWithOwner) &&
        (value.reference.repositoryId === undefined || identity(value.reference.repositoryId))
      )
    case 'unresolved':
      return (
        onlyKeys(value.reference, ['kind', 'locator', 'ticketId']) &&
        identity(value.reference.locator)
      )
    default:
      return false
  }
}

function isValue(scope: SourceScope, value: unknown, provenance: SourceProvenance): boolean {
  if (!record(value)) return false
  switch (scope.kind) {
    case 'project':
      return (
        onlyKeys(value, ['key', 'name', 'source', 'warnings']) &&
        projectIdentity(value.key) &&
        sameProject(scope.project, value.key) &&
        text(value.name) &&
        isDestination(value.source) &&
        value.source.integration === scope.project.integration &&
        (value.source.integration !== 'github' ||
          (provenance.integration === 'github' &&
            value.source.repositoryId === provenance.repositoryId)) &&
        strings(value.warnings)
      )
    case 'maps-membership': {
      if (!onlyKeys(value, ['members']) || !Array.isArray(value.members)) return false
      const ids = new Set<string>()
      for (const member of value.members) {
        if (
          !mapIdentity(member) ||
          !sameProject(member.project, scope.project) ||
          ids.has(member.mapId)
        )
          return false
        ids.add(member.mapId)
      }
      return true
    }
    case 'tickets-membership': {
      if (!onlyKeys(value, ['members']) || !Array.isArray(value.members)) return false
      const ids = new Set<string>()
      for (const member of value.members) {
        if (!ticketIdentity(member) || !sameMap(member.map, scope.map) || ids.has(member.ticketId))
          return false
        ids.add(member.ticketId)
      }
      return true
    }
    case 'map':
      return (
        onlyKeys(value, [
          'key',
          'displayId',
          'title',
          'source',
          'status',
          'updatedAt',
          'closedAt',
          'body',
          'progress',
          'unidentifiedTickets',
          'warnings',
        ]) &&
        mapIdentity(value.key) &&
        sameMap(value.key, scope.map) &&
        optionalText(value.displayId) &&
        optionalText(value.title) &&
        isSource(value.source, scope.map.project.integration) &&
        status(value.status) &&
        finite(value.updatedAt) &&
        optionalTime(value.closedAt) &&
        isBody(value.body) &&
        (value.progress === null ||
          (record(value.progress) &&
            onlyKeys(value.progress, ['total', 'completed']) &&
            typeof value.progress.total === 'number' &&
            typeof value.progress.completed === 'number' &&
            Number.isInteger(value.progress.total) &&
            Number.isInteger(value.progress.completed) &&
            value.progress.total >= 0 &&
            value.progress.completed >= 0 &&
            value.progress.completed <= value.progress.total)) &&
        Array.isArray(value.unidentifiedTickets) &&
        value.unidentifiedTickets.every(
          (ticket: unknown) =>
            record(ticket) &&
            onlyKeys(ticket, ['sourcePath', 'raw', 'warnings']) &&
            identity(ticket.sourcePath) &&
            text(ticket.raw) &&
            strings(ticket.warnings),
        ) &&
        strings(value.warnings)
      )
    case 'ticket':
      return (
        onlyKeys(value, [
          'key',
          'displayId',
          'title',
          'source',
          'body',
          'typeEvidence',
          'status',
          'isClaimed',
          'createdAt',
          'closedAt',
          'assignees',
          'blockedBy',
          'blockersComplete',
          'warnings',
        ]) &&
        ticketIdentity(value.key) &&
        sameTicket(value.key, scope.ticket) &&
        optionalText(value.displayId) &&
        optionalText(value.title) &&
        isSource(value.source, scope.ticket.map.project.integration) &&
        text(value.body) &&
        isTypeEvidence(value.typeEvidence) &&
        status(value.status) &&
        typeof value.isClaimed === 'boolean' &&
        optionalTime(value.createdAt) &&
        optionalTime(value.closedAt) &&
        Array.isArray(value.assignees) &&
        value.assignees.every(
          (assignee: unknown) =>
            record(assignee) &&
            onlyKeys(assignee, ['name', 'url', 'avatarUrl']) &&
            text(assignee.name) &&
            optionalText(assignee.url) &&
            optionalText(assignee.avatarUrl),
        ) &&
        Array.isArray(value.blockedBy) &&
        value.blockedBy.every((blocker: unknown) =>
          isBlocker(blocker, scope.ticket.map.project.integration),
        ) &&
        typeof value.blockersComplete === 'boolean' &&
        strings(value.warnings)
      )
  }
}

function isObservationAttempt(value: unknown): value is ObservationAttempt {
  if (
    !record(value) ||
    !isScope(value.scope) ||
    !finite(value.attemptedAt) ||
    !isProvenance(value.provenance) ||
    value.provenance.integration !== scopeProject(value.scope).integration
  )
    return false
  if (value.kind === 'failed') {
    return (
      onlyKeys(value, ['kind', 'scope', 'attemptedAt', 'provenance', 'failure']) &&
      isFailure(value.failure) &&
      (value.failure.kind !== 'filesystem' ||
        (value.provenance.integration === 'local' &&
          value.provenance.operation === value.failure.operation)) &&
      (value.provenance.integration !== 'local' ||
        value.failure.kind === 'filesystem' ||
        value.failure.kind === 'read') &&
      value.observedAt === undefined
    )
  }
  if (!finite(value.observedAt) || value.observedAt < value.attemptedAt) return false
  if (value.kind === 'observed')
    return (
      onlyKeys(value, [
        'kind',
        'scope',
        'attemptedAt',
        'observedAt',
        'provenance',
        'completeness',
        'value',
      ]) &&
      isCompleteness(value.completeness) &&
      isValue(value.scope, value.value, value.provenance)
    )
  if (
    value.kind !== 'proven-absent' ||
    !onlyKeys(value, ['kind', 'scope', 'attemptedAt', 'observedAt', 'provenance', 'proof']) ||
    !record(value.proof)
  )
    return false
  switch (value.scope.kind) {
    case 'project':
      return (
        onlyKeys(value.proof, ['kind', 'repositoryId']) &&
        value.proof.kind === 'provider-deletion' &&
        identity(value.proof.repositoryId) &&
        value.provenance.integration === 'github' &&
        value.provenance.repositoryId === value.proof.repositoryId
      )
    case 'map':
      return (
        onlyKeys(value.proof, ['kind', 'parent']) &&
        value.proof.kind === 'complete-membership' &&
        isScope(value.proof.parent) &&
        value.proof.parent.kind === 'maps-membership' &&
        sameProject(value.scope.map.project, value.proof.parent.project)
      )
    case 'ticket':
      return (
        onlyKeys(value.proof, ['kind', 'parent']) &&
        value.proof.kind === 'complete-membership' &&
        isScope(value.proof.parent) &&
        value.proof.parent.kind === 'tickets-membership' &&
        sameMap(value.scope.ticket.map, value.proof.parent.map)
      )
    case 'maps-membership':
    case 'tickets-membership':
      return false
  }
}
