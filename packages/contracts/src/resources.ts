import { z } from 'zod'
import { blockerSchema } from './blocker.ts'
import { arrayDataSchema, requestDataSchema } from './internal/request-data.ts'

const timeSchema = z.number().nonnegative().max(8_640_000_000_000_000)
const identitySchema = z.string()
const projectKeySchema = requestDataSchema.pipe(
  z.strictObject({
    integration: z.enum(['local', 'github']),
    id: identitySchema,
  }),
)
const mapKeySchema = requestDataSchema.pipe(
  z.strictObject({ project: projectKeySchema, mapId: identitySchema }),
)
const ticketKeySchema = requestDataSchema.pipe(
  z.strictObject({ map: mapKeySchema, ticketId: identitySchema }),
)
// Keep raw options for Zod's discriminator lookup; guard each standalone boundary.
const projectScopeObjectSchema = z.strictObject({
  kind: z.literal('project'),
  project: projectKeySchema,
})
const mapScopeObjectSchema = z.strictObject({ kind: z.literal('map'), map: mapKeySchema })
const ticketScopeObjectSchema = z.strictObject({
  kind: z.literal('ticket'),
  ticket: ticketKeySchema,
})
const mapsScopeObjectSchema = z.strictObject({
  kind: z.literal('maps-membership'),
  project: projectKeySchema,
})
const ticketsScopeObjectSchema = z.strictObject({
  kind: z.literal('tickets-membership'),
  map: mapKeySchema,
})
const projectScopeSchema = requestDataSchema.pipe(projectScopeObjectSchema)
const mapScopeSchema = requestDataSchema.pipe(mapScopeObjectSchema)
const ticketScopeSchema = requestDataSchema.pipe(ticketScopeObjectSchema)
const mapsScopeSchema = requestDataSchema.pipe(mapsScopeObjectSchema)
const ticketsScopeSchema = requestDataSchema.pipe(ticketsScopeObjectSchema)
const scopeSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    projectScopeObjectSchema,
    mapScopeObjectSchema,
    ticketScopeObjectSchema,
    mapsScopeObjectSchema,
    ticketsScopeObjectSchema,
  ]),
)
const provenanceSchema = requestDataSchema.pipe(
  z.discriminatedUnion('integration', [
    z.strictObject({
      integration: z.literal('local'),
      path: z.string(),
      operation: z.enum(['inspect-root', 'enumerate', 'read']),
    }),
    z.strictObject({
      integration: z.literal('github'),
      connectionId: z.string(),
      repositoryId: z.string(),
      stage: z.enum(['credentials', 'repository', 'map-list', 'map-read']),
    }),
  ]),
)
const completeObjectSchema = z.strictObject({ kind: z.literal('complete') })
const incompleteObjectSchema = z.strictObject({
  kind: z.literal('incomplete'),
  reason: z.enum(['pagination', 'unreadable', 'malformed']),
})
const completeSchema = requestDataSchema.pipe(completeObjectSchema)
const incompleteSchema = requestDataSchema.pipe(incompleteObjectSchema)
const completenessSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [completeObjectSchema, incompleteObjectSchema]),
)
const failureSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('filesystem'),
      operation: z.enum(['inspect-root', 'enumerate', 'read']),
      code: z.enum(['ENOENT', 'EACCES', 'other']),
    }),
    z.strictObject({
      kind: z.literal('transient'),
      cause: z.enum(['network', 'rate-limit', 'server']),
    }),
    z.strictObject({ kind: z.literal('execution'), cause: z.literal('provider') }),
    z.strictObject({ kind: z.literal('access-unavailable') }),
    z.strictObject({
      kind: z.literal('read'),
      cause: z.enum(['response-read', 'malformed-response']),
    }),
    z.strictObject({
      kind: z.literal('authorization'),
      proof: z.enum([
        'http-401',
        'rejected-credential',
        'authorization-required',
        'account-mismatch',
      ]),
    }),
    z.strictObject({
      kind: z.literal('access-ambiguous'),
      evidence: z.enum(['http-403', 'http-404', 'null-resource', 'missing-alias']),
    }),
    z.strictObject({ kind: z.literal('identity-mismatch') }),
  ]),
)

type Scope = z.output<typeof scopeSchema>
type Provenance = z.output<typeof provenanceSchema>
type ProjectKey = z.output<typeof projectKeySchema>
type MapKey = z.output<typeof mapKeySchema>
type TicketKey = z.output<typeof ticketKeySchema>

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
function sameMap(a: MapKey, b: MapKey): boolean {
  return sameProject(a.project, b.project) && a.mapId === b.mapId
}
function sameTicket(a: TicketKey, b: TicketKey): boolean {
  return sameMap(a.map, b.map) && a.ticketId === b.ticketId
}
function scopeProject(scope: Scope): ProjectKey {
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
function sameScope(a: Scope, b: Scope): boolean {
  switch (a.kind) {
    case 'project':
    case 'maps-membership':
      return b.kind === a.kind && sameProject(a.project, b.project)
    case 'map':
    case 'tickets-membership':
      return b.kind === a.kind && sameMap(a.map, b.map)
    case 'ticket':
      return b.kind === 'ticket' && sameTicket(a.ticket, b.ticket)
  }
}
function applicableScope(ancestor: Scope, own: Scope): boolean {
  if (!sameProject(scopeProject(ancestor), scopeProject(own))) return false
  if (sameScope(ancestor, own) || ancestor.kind === 'project') return true
  if (ancestor.kind === 'maps-membership')
    return own.kind === 'map' || own.kind === 'tickets-membership' || own.kind === 'ticket'
  if (ancestor.kind === 'map')
    return (
      (own.kind === 'tickets-membership' && sameMap(ancestor.map, own.map)) ||
      (own.kind === 'ticket' && sameMap(ancestor.map, own.ticket.map))
    )
  return (
    ancestor.kind === 'tickets-membership' &&
    own.kind === 'ticket' &&
    sameMap(ancestor.map, own.ticket.map)
  )
}
function issue(ctx: z.RefinementCtx, path: PropertyKey[], message: string): void {
  ctx.addIssue({ code: 'custom', path, message })
}
function refineMetadata(
  value: { scope: Scope; provenance: Provenance; attemptedAt: number; observedAt?: number },
  ctx: z.RefinementCtx,
): void {
  if (value.provenance.integration !== scopeProject(value.scope).integration)
    issue(ctx, ['provenance'], 'Provenance must match the scoped Integration.')
  if (value.observedAt !== undefined && value.observedAt < value.attemptedAt)
    issue(ctx, ['observedAt'], 'Successful observation cannot precede its attempt.')
}
function failureCause(failure: z.output<typeof failureSchema>): string {
  switch (failure.kind) {
    case 'filesystem':
      if (failure.operation === 'inspect-root')
        return failure.code === 'EACCES'
          ? 'Workspace read permission was denied.'
          : 'Workspace cannot be read.'
      return failure.code === 'ENOENT'
        ? 'Source path is currently missing.'
        : failure.code === 'EACCES'
          ? 'Source read permission was denied.'
          : 'Source path cannot be read.'
    case 'transient':
      return failure.cause === 'rate-limit'
        ? 'GitHub rate limit prevents this read.'
        : 'GitHub is temporarily unreachable.'
    case 'execution':
      return 'GitHub could not execute this source read.'
    case 'read':
      return failure.cause === 'response-read'
        ? 'GitHub response could not be read.'
        : 'Source response is malformed.'
    case 'access-unavailable':
      return 'GitHub access is currently unavailable.'
    case 'authorization':
      return 'GitHub authorization is required.'
    case 'access-ambiguous':
      return 'GitHub source is inaccessible; absence is not proven.'
    case 'identity-mismatch':
      return 'GitHub repository identity does not match the admitted Project.'
  }
}
const unavailableSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    z
      .strictObject({
        kind: z.literal('source-failure'),
        scope: scopeSchema,
        attemptedAt: timeSchema,
        provenance: provenanceSchema,
        failure: failureSchema,
        cause: z.string(),
      })
      .superRefine((value, ctx) => {
        refineMetadata(value, ctx)
        if (value.cause !== failureCause(value.failure))
          issue(ctx, ['cause'], 'Failure cause must be the fixed safe description.')
        if (
          value.failure.kind === 'filesystem' &&
          (value.provenance.integration !== 'local' ||
            value.provenance.operation !== value.failure.operation)
        )
          issue(ctx, ['failure'], 'Filesystem failure must match its actual Local operation.')
        if (
          value.provenance.integration === 'local' &&
          value.failure.kind !== 'filesystem' &&
          value.failure.kind !== 'read'
        )
          issue(ctx, ['failure'], 'Failure category does not apply to Local source evidence.')
      }),
    z
      .strictObject({
        kind: z.literal('incomplete-ancestor'),
        scope: scopeSchema,
        attemptedAt: timeSchema,
        observedAt: timeSchema,
        provenance: provenanceSchema,
        completeness: incompleteSchema,
        cause: z.literal('Current ancestor source evidence is incomplete.'),
      })
      .superRefine(refineMetadata),
    z.strictObject({
      kind: z.literal('no-current-evidence'),
      scope: scopeSchema,
      cause: z.literal('No current source observation is available.'),
    }),
  ]),
)

const ticketTypeEvidenceSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('recognized'),
      value: z.enum(['research', 'prototype', 'grilling', 'task']),
      labels: arrayDataSchema.pipe(z.array(z.string())),
    }),
    z.strictObject({ kind: z.literal('missing'), labels: arrayDataSchema.pipe(z.tuple([])) }),
    z.strictObject({
      kind: z.literal('unknown'),
      labels: arrayDataSchema.pipe(z.array(z.string())),
    }),
    z.strictObject({
      kind: z.literal('conflicting'),
      labels: arrayDataSchema.pipe(z.array(z.string())),
    }),
  ]),
)
const ticketStateSchema = z.enum(['closed', 'blocked', 'claimed', 'frontier'])
const assigneeSchema = requestDataSchema.pipe(
  z.strictObject({
    name: z.string(),
    url: z.string().optional(),
    avatarUrl: z.string().optional(),
  }),
)
const decisionSchema = requestDataSchema.pipe(
  z.strictObject({
    title: z.string(),
    url: z.string().nullable(),
    gist: z.string(),
    raw: z.string(),
  }),
)
const mapSectionSchema = requestDataSchema.pipe(
  z.strictObject({
    heading: z.string(),
    text: z.string(),
    items: arrayDataSchema.pipe(z.array(z.string())),
  }),
)
const mapBodySchema = requestDataSchema.pipe(
  z.strictObject({
    raw: z.string(),
    destination: z.string(),
    notes: arrayDataSchema.pipe(z.array(z.string())),
    decisions: arrayDataSchema.pipe(z.array(decisionSchema)),
    notYetSpecified: arrayDataSchema.pipe(z.array(z.string())),
    notYetSpecifiedNote: z.string(),
    outOfScope: arrayDataSchema.pipe(z.array(z.string())),
    sections: arrayDataSchema.pipe(z.array(mapSectionSchema)),
    missingSections: arrayDataSchema.pipe(z.array(z.string())),
  }),
)
const mapProgressSchema = requestDataSchema
  .pipe(
    z.strictObject({
      total: z.number().int().nonnegative().safe(),
      completed: z.number().int().nonnegative().safe(),
    }),
  )
  .refine((value) => value.completed <= value.total, {
    message: 'Completed counts cannot exceed total counts.',
    path: ['completed'],
  })
const projectSourceSchema = requestDataSchema.pipe(
  z.discriminatedUnion('integration', [
    z.strictObject({ integration: z.literal('local'), path: z.string() }),
    z.strictObject({
      integration: z.literal('github'),
      repositoryId: z.string(),
      nameWithOwner: z.string(),
      url: z.string(),
    }),
  ]),
)
const contentSourceSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('file'), path: z.string() }),
    z.strictObject({ kind: z.literal('issue'), url: z.string() }),
  ]),
)
const projectResourceValueSchema = requestDataSchema.pipe(
  z.strictObject({
    name: z.string(),
    source: projectSourceSchema,
    warnings: arrayDataSchema.pipe(z.array(z.string())),
  }),
)
const mapResourceValueSchema = requestDataSchema.pipe(
  z.strictObject({
    displayId: z.string().optional(),
    title: z.string().optional(),
    source: contentSourceSchema,
    status: z.enum(['open', 'closed', 'unknown']),
    updatedAt: timeSchema,
    closedAt: timeSchema.optional(),
    body: mapBodySchema,
    progress: mapProgressSchema.nullable(),
    warnings: arrayDataSchema.pipe(z.array(z.string())),
  }),
)
const ticketResourceValueSchema = requestDataSchema.pipe(
  z.strictObject({
    displayId: z.string().optional(),
    title: z.string().optional(),
    source: contentSourceSchema,
    status: z.enum(['open', 'closed', 'unknown']),
    body: z.string(),
    typeEvidence: ticketTypeEvidenceSchema,
    state: ticketStateSchema,
    isClaimed: z.boolean(),
    isBlocked: z.boolean(),
    createdAt: timeSchema.optional(),
    closedAt: timeSchema.optional(),
    assignees: arrayDataSchema.pipe(z.array(assigneeSchema)),
    blockedBy: arrayDataSchema.pipe(z.array(blockerSchema)),
    blockersComplete: z.boolean(),
    warnings: arrayDataSchema.pipe(z.array(z.string())),
  }),
)

function observationSchema<S extends z.ZodType, V extends z.ZodType, C extends z.ZodType>(
  scope: S,
  value: V,
  completeness: C,
) {
  return requestDataSchema.pipe(
    z.strictObject({
      scope,
      attemptedAt: timeSchema,
      observedAt: timeSchema,
      provenance: provenanceSchema,
      completeness,
      value,
    }),
  )
}
const projectObservationSchema = observationSchema(
  projectScopeSchema,
  projectResourceValueSchema,
  completenessSchema,
).superRefine((value, ctx) => {
  refineMetadata(value, ctx)
  const source = value.value.source
  if (source.integration !== value.scope.project.integration)
    issue(ctx, ['value', 'source'], 'Source must match Project Integration.')
  if (
    source.integration === 'github' &&
    (value.provenance.integration !== 'github' ||
      source.repositoryId !== value.provenance.repositoryId)
  )
    issue(ctx, ['value', 'source'], 'Repository must match its own actual provenance.')
  if (
    source.integration === 'local' &&
    (value.provenance.integration !== 'local' || source.path !== value.provenance.path)
  )
    issue(ctx, ['value', 'source'], 'Local source must match its own actual provenance.')
})
function refineContentSource(
  value: {
    scope: Scope
    provenance: Provenance
    attemptedAt: number
    observedAt: number
    value: { source: z.output<typeof contentSourceSchema> }
  },
  ctx: z.RefinementCtx,
): void {
  refineMetadata(value, ctx)
  const source = value.value.source
  if (
    scopeProject(value.scope).integration === 'local'
      ? source.kind !== 'file'
      : source.kind !== 'issue'
  )
    issue(ctx, ['value', 'source'], 'Content source must match scoped Integration.')
  if (
    source.kind === 'file' &&
    (value.provenance.integration !== 'local' || source.path !== value.provenance.path)
  )
    issue(ctx, ['value', 'source'], 'Content path must match its own actual provenance.')
}
const mapObservationSchema = observationSchema(
  mapScopeSchema,
  mapResourceValueSchema,
  completenessSchema,
).superRefine(refineContentSource)
const ticketObservationSchema = observationSchema(
  ticketScopeSchema,
  ticketResourceValueSchema,
  completenessSchema,
).superRefine(refineContentSource)
const projectAbsenceSchema = requestDataSchema
  .pipe(
    z.strictObject({
      scope: projectScopeSchema,
      attemptedAt: timeSchema,
      observedAt: timeSchema,
      provenance: provenanceSchema,
      proof: requestDataSchema.pipe(
        z.strictObject({ kind: z.literal('provider-deletion'), repositoryId: z.string() }),
      ),
    }),
  )
  .superRefine((value, ctx) => {
    refineMetadata(value, ctx)
    if (
      value.provenance.integration !== 'github' ||
      value.proof.repositoryId !== value.provenance.repositoryId
    )
      issue(
        ctx,
        ['proof'],
        'Provider deletion requires matching actual GitHub repository provenance.',
      )
  })
const mapAbsenceSchema = requestDataSchema
  .pipe(
    z.strictObject({
      scope: mapScopeSchema,
      attemptedAt: timeSchema,
      observedAt: timeSchema,
      provenance: provenanceSchema,
      proof: requestDataSchema.pipe(
        z.strictObject({ kind: z.literal('complete-membership'), parent: mapsScopeSchema }),
      ),
    }),
  )
  .superRefine((value, ctx) => {
    refineMetadata(value, ctx)
    if (!sameProject(value.scope.map.project, value.proof.parent.project))
      issue(ctx, ['proof', 'parent'], 'Absence proof must name the actual parent membership.')
  })
const ticketAbsenceSchema = requestDataSchema
  .pipe(
    z.strictObject({
      scope: ticketScopeSchema,
      attemptedAt: timeSchema,
      observedAt: timeSchema,
      provenance: provenanceSchema,
      proof: requestDataSchema.pipe(
        z.strictObject({ kind: z.literal('complete-membership'), parent: ticketsScopeSchema }),
      ),
    }),
  )
  .superRefine((value, ctx) => {
    refineMetadata(value, ctx)
    if (!sameMap(value.scope.ticket.map, value.proof.parent.map))
      issue(ctx, ['proof', 'parent'], 'Absence proof must name the actual parent membership.')
  })
function resourceSchema<S extends z.ZodType, O extends z.ZodType, A extends z.ZodType>(
  scope: S,
  observation: O,
  absence: A,
) {
  return requestDataSchema.pipe(
    z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('never-observed'),
        scope,
        current: unavailableSchema.nullable(),
      }),
      z.strictObject({ kind: z.literal('current-readable'), observation }),
      z.strictObject({
        kind: z.literal('retained-unavailable'),
        lastSuccessful: observation,
        unavailable: unavailableSchema,
      }),
      z.strictObject({
        kind: z.literal('proven-absent'),
        absence,
        trace: requestDataSchema.pipe(
          z.discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('no-known-trace') }),
            z.strictObject({
              kind: z.literal('last-successful-trace'),
              lastSuccessful: observation,
            }),
          ]),
        ),
      }),
    ]),
  )
}
function refineResource(
  value:
    | z.output<
        ReturnType<
          typeof resourceSchema<
            typeof projectScopeSchema,
            typeof projectObservationSchema,
            typeof projectAbsenceSchema
          >
        >
      >
    | z.output<
        ReturnType<
          typeof resourceSchema<
            typeof mapScopeSchema,
            typeof mapObservationSchema,
            typeof mapAbsenceSchema
          >
        >
      >
    | z.output<
        ReturnType<
          typeof resourceSchema<
            typeof ticketScopeSchema,
            typeof ticketObservationSchema,
            typeof ticketAbsenceSchema
          >
        >
      >,
  ctx: z.RefinementCtx,
): void {
  const scope =
    value.kind === 'never-observed'
      ? value.scope
      : value.kind === 'current-readable'
        ? value.observation.scope
        : value.kind === 'retained-unavailable'
          ? value.lastSuccessful.scope
          : value.absence.scope
  const unavailable =
    value.kind === 'never-observed'
      ? value.current
      : value.kind === 'retained-unavailable'
        ? value.unavailable
        : null
  if (unavailable && !applicableScope(unavailable.scope, scope))
    issue(
      ctx,
      [value.kind === 'never-observed' ? 'current' : 'unavailable', 'scope'],
      'Unavailable evidence must name this resource or an applicable ancestor.',
    )
  if (
    value.kind === 'proven-absent' &&
    value.trace.kind === 'last-successful-trace' &&
    !sameScope(scope, value.trace.lastSuccessful.scope)
  )
    issue(
      ctx,
      ['trace', 'lastSuccessful', 'scope'],
      'Historical trace must belong to the absent resource.',
    )
}
export const projectResourceSchema = resourceSchema(
  projectScopeSchema,
  projectObservationSchema,
  projectAbsenceSchema,
).superRefine(refineResource)
export const mapResourceSchema = resourceSchema(
  mapScopeSchema,
  mapObservationSchema,
  mapAbsenceSchema,
).superRefine(refineResource)
export const ticketResourceSchema = resourceSchema(
  ticketScopeSchema,
  ticketObservationSchema,
  ticketAbsenceSchema,
).superRefine(refineResource)

const mapsValueSchema = requestDataSchema.pipe(
  z.strictObject({ members: arrayDataSchema.pipe(z.array(mapKeySchema)) }),
)
const ticketsValueSchema = requestDataSchema.pipe(
  z.strictObject({ members: arrayDataSchema.pipe(z.array(ticketKeySchema)) }),
)
function refineMapsObservation(
  value: {
    scope: z.output<typeof mapsScopeSchema>
    attemptedAt: number
    observedAt: number
    provenance: Provenance
    value: z.output<typeof mapsValueSchema>
  },
  ctx: z.RefinementCtx,
): void {
  refineMetadata(value, ctx)
  const ids = new Set<string>()
  for (const [index, member] of value.value.members.entries()) {
    if (!sameProject(value.scope.project, member.project) || ids.has(member.mapId))
      issue(
        ctx,
        ['value', 'members', index],
        'Membership identities must be unique and belong to this Project.',
      )
    ids.add(member.mapId)
  }
}
function refineTicketsObservation(
  value: {
    scope: z.output<typeof ticketsScopeSchema>
    attemptedAt: number
    observedAt: number
    provenance: Provenance
    value: z.output<typeof ticketsValueSchema>
  },
  ctx: z.RefinementCtx,
): void {
  refineMetadata(value, ctx)
  const ids = new Set<string>()
  for (const [index, member] of value.value.members.entries()) {
    if (!sameMap(value.scope.map, member.map) || ids.has(member.ticketId))
      issue(
        ctx,
        ['value', 'members', index],
        'Membership identities must be unique and belong to this map.',
      )
    ids.add(member.ticketId)
  }
}
const completeMapsObservationSchema = observationSchema(
  mapsScopeSchema,
  mapsValueSchema,
  completeSchema,
).superRefine(refineMapsObservation)
const incompleteMapsObservationSchema = observationSchema(
  mapsScopeSchema,
  mapsValueSchema,
  incompleteSchema,
).superRefine(refineMapsObservation)
const completeTicketsObservationSchema = observationSchema(
  ticketsScopeSchema,
  ticketsValueSchema,
  completeSchema,
).superRefine(refineTicketsObservation)
const incompleteTicketsObservationSchema = observationSchema(
  ticketsScopeSchema,
  ticketsValueSchema,
  incompleteSchema,
).superRefine(refineTicketsObservation)
function membershipSchema<C extends z.ZodType, I extends z.ZodType>(complete: C, incomplete: I) {
  return requestDataSchema.pipe(
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('never-observed'), current: unavailableSchema.nullable() }),
      z.strictObject({ kind: z.literal('current-complete'), observation: complete }),
      z.strictObject({
        kind: z.literal('current-incomplete'),
        observation: incomplete,
        lastComplete: complete.nullable(),
      }),
      z.strictObject({
        kind: z.literal('unavailable'),
        unavailable: unavailableSchema,
        lastComplete: complete.nullable(),
      }),
    ]),
  )
}
export const mapMembershipSchema = membershipSchema(
  completeMapsObservationSchema,
  incompleteMapsObservationSchema,
).superRefine((value, ctx) => {
  if (
    value.kind === 'current-incomplete' &&
    value.lastComplete &&
    !sameScope(value.observation.scope, value.lastComplete.scope)
  )
    issue(ctx, ['lastComplete', 'scope'], 'Membership history must belong to the same scope.')
  const own =
    value.kind === 'current-complete' || value.kind === 'current-incomplete'
      ? value.observation.scope
      : value.kind === 'unavailable'
        ? value.lastComplete?.scope
        : null
  const unavailable =
    value.kind === 'unavailable'
      ? value.unavailable
      : value.kind === 'never-observed'
        ? value.current
        : null
  if (
    unavailable &&
    (own
      ? !applicableScope(unavailable.scope, own)
      : unavailable.scope.kind !== 'project' && unavailable.scope.kind !== 'maps-membership')
  )
    issue(
      ctx,
      ['unavailable', 'scope'],
      'Map membership failure must belong to its scope or Project ancestor.',
    )
})
export const ticketMembershipSchema = membershipSchema(
  completeTicketsObservationSchema,
  incompleteTicketsObservationSchema,
).superRefine((value, ctx) => {
  if (
    value.kind === 'current-incomplete' &&
    value.lastComplete &&
    !sameScope(value.observation.scope, value.lastComplete.scope)
  )
    issue(ctx, ['lastComplete', 'scope'], 'Membership history must belong to the same scope.')
  const own =
    value.kind === 'current-complete' || value.kind === 'current-incomplete'
      ? value.observation.scope
      : value.kind === 'unavailable'
        ? value.lastComplete?.scope
        : null
  const unavailable =
    value.kind === 'unavailable'
      ? value.unavailable
      : value.kind === 'never-observed'
        ? value.current
        : null
  if (
    unavailable &&
    (own ? !applicableScope(unavailable.scope, own) : unavailable.scope.kind === 'ticket')
  )
    issue(
      ctx,
      ['unavailable', 'scope'],
      'Ticket membership failure must belong to its scope or an ancestor.',
    )
})
const activeCauses = {
  'never-observed': 'Active map has never been established.',
  'project-unavailable': 'Project source is currently unavailable.',
  'membership-unavailable': 'Map membership is currently unavailable.',
  'membership-incomplete': 'Map membership is incomplete.',
  'map-unavailable': 'A map required for ordering is currently unavailable.',
  'map-incomplete': 'A map required for ordering is incomplete.',
  'map-status-unknown': 'A map required for ordering has unknown status.',
}
export const activeMapSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('known-current'), mapId: z.string() }),
    z.strictObject({ kind: z.literal('known-empty') }),
    z
      .strictObject({
        kind: z.literal('uncertain'),
        reason: z.enum([
          'never-observed',
          'project-unavailable',
          'membership-unavailable',
          'membership-incomplete',
          'map-unavailable',
          'map-incomplete',
          'map-status-unknown',
        ]),
        cause: z.string(),
      })
      .superRefine((value, ctx) => {
        if (value.cause !== activeCauses[value.reason])
          issue(ctx, ['cause'], 'Active uncertainty must carry its fixed safe description.')
      }),
  ]),
)
const ticketSchema = requestDataSchema
  .pipe(z.strictObject({ key: ticketKeySchema, resource: ticketResourceSchema }))
  .superRefine((value, ctx) => {
    if (!sameScope(resourceScope(value.resource), { kind: 'ticket', ticket: value.key }))
      issue(ctx, ['resource'], 'Ticket resource must match its enclosing identity.')
  })
const mapSchema = requestDataSchema
  .pipe(
    z.strictObject({
      key: mapKeySchema,
      resource: mapResourceSchema,
      ticketsMembership: ticketMembershipSchema,
      tickets: arrayDataSchema.pipe(z.array(ticketSchema)),
    }),
  )
  .superRefine((value, ctx) => {
    if (!sameScope(resourceScope(value.resource), { kind: 'map', map: value.key }))
      issue(ctx, ['resource'], 'Map resource must match its enclosing identity.')
    refineMembershipScope(
      value.ticketsMembership,
      { kind: 'tickets-membership', map: value.key },
      ctx,
      ['ticketsMembership'],
    )
    const ids = new Set<string>()
    for (const [index, ticket] of value.tickets.entries()) {
      if (!sameMap(ticket.key.map, value.key) || ids.has(ticket.key.ticketId))
        issue(
          ctx,
          ['tickets', index, 'key'],
          'Ticket identities must be unique and belong to this map.',
        )
      ids.add(ticket.key.ticketId)
    }
    const membership = value.ticketsMembership
    if (membership.kind === 'current-complete' || membership.kind === 'current-incomplete') {
      for (const [index, member] of membership.observation.value.members.entries())
        if (!ids.has(member.ticketId))
          issue(
            ctx,
            ['ticketsMembership', 'observation', 'value', 'members', index],
            'Current member must have a canonical resource entry.',
          )
    }
  })
export type ProjectResourceResult = z.output<typeof projectResourceSchema>
export type MapResourceResult = z.output<typeof mapResourceSchema>
export type TicketResourceResult = z.output<typeof ticketResourceSchema>
export type MapMembershipResult = z.output<typeof mapMembershipSchema>
export type TicketMembershipResult = z.output<typeof ticketMembershipSchema>
export type ActiveMapResult = z.output<typeof activeMapSchema>
export type MapResource = z.output<typeof mapSchema>
export type TicketResource = z.output<typeof ticketSchema>
export type ProjectResourceValue = z.output<typeof projectResourceValueSchema>
export type MapResourceValue = z.output<typeof mapResourceValueSchema>
export type TicketResourceValue = z.output<typeof ticketResourceValueSchema>
export type UnavailableEvidence = z.output<typeof unavailableSchema>
export type TicketTypeEvidence = z.output<typeof ticketTypeEvidenceSchema>
export type TicketState = z.output<typeof ticketStateSchema>
export type Assignee = z.output<typeof assigneeSchema>
export type Decision = z.output<typeof decisionSchema>
export type MapSection = z.output<typeof mapSectionSchema>
export type MapBody = z.output<typeof mapBodySchema>
export type MapProgress = z.output<typeof mapProgressSchema>
function resourceScope(
  resource: ProjectResourceResult | MapResourceResult | TicketResourceResult,
): Scope {
  switch (resource.kind) {
    case 'never-observed':
      return resource.scope
    case 'current-readable':
      return resource.observation.scope
    case 'retained-unavailable':
      return resource.lastSuccessful.scope
    case 'proven-absent':
      return resource.absence.scope
  }
}
function refineMembershipScope(
  membership: MapMembershipResult | TicketMembershipResult,
  scope: Scope,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (
    (membership.kind === 'current-complete' || membership.kind === 'current-incomplete') &&
    !sameScope(membership.observation.scope, scope)
  )
    issue(
      ctx,
      [...path, 'observation', 'scope'],
      'Membership must match the enclosing resource scope.',
    )
  if (
    (membership.kind === 'unavailable' || membership.kind === 'current-incomplete') &&
    membership.lastComplete &&
    !sameScope(membership.lastComplete.scope, scope)
  )
    issue(
      ctx,
      [...path, 'lastComplete', 'scope'],
      'Historical membership must match the enclosing resource scope.',
    )
  const unavailable =
    membership.kind === 'unavailable'
      ? membership.unavailable
      : membership.kind === 'never-observed'
        ? membership.current
        : null
  if (unavailable && !applicableScope(unavailable.scope, scope))
    issue(
      ctx,
      [...path, 'unavailable', 'scope'],
      'Membership failure must name its own scope or an applicable ancestor.',
    )
}
const resourcesBaseSchema = z.strictObject({
  key: projectKeySchema,
  resource: projectResourceSchema,
  mapsMembership: mapMembershipSchema,
  maps: arrayDataSchema.pipe(z.array(mapSchema)),
  displayOrder: requestDataSchema.pipe(
    z.strictObject({
      openMapIds: arrayDataSchema.pipe(z.array(z.string())),
      closedMapIds: arrayDataSchema.pipe(z.array(z.string())),
    }),
  ),
  activeMap: activeMapSchema,
})
type ResourceAggregate = z.output<typeof resourcesBaseSchema>
function currentResourceEvidence(
  resource: ProjectResourceResult | MapResourceResult | TicketResourceResult,
) {
  switch (resource.kind) {
    case 'current-readable':
      return resource.observation
    case 'never-observed':
      return resource.current?.kind !== 'no-current-evidence' ? resource.current : null
    case 'retained-unavailable':
      return resource.unavailable.kind !== 'no-current-evidence' ? resource.unavailable : null
    case 'proven-absent':
      return null
  }
}
function currentMembershipEvidence(membership: MapMembershipResult | TicketMembershipResult) {
  switch (membership.kind) {
    case 'current-complete':
    case 'current-incomplete':
      return membership.observation
    case 'never-observed':
      return membership.current?.kind !== 'no-current-evidence' ? membership.current : null
    case 'unavailable':
      return membership.unavailable.kind !== 'no-current-evidence' ? membership.unavailable : null
  }
}
function currentEvidence(project: ResourceAggregate) {
  return [
    currentResourceEvidence(project.resource),
    currentMembershipEvidence(project.mapsMembership),
    ...project.maps.flatMap((map) => [
      currentResourceEvidence(map.resource),
      currentMembershipEvidence(map.ticketsMembership),
      ...map.tickets.map((ticket) => currentResourceEvidence(ticket.resource)),
    ]),
  ].filter((evidence) => evidence !== null)
}
function localPathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}
function refineAggregate(project: ResourceAggregate, ctx: z.RefinementCtx): void {
  if (!sameScope(resourceScope(project.resource), { kind: 'project', project: project.key }))
    issue(ctx, ['resource'], 'Project resource must match its registered identity.')
  refineMembershipScope(
    project.mapsMembership,
    { kind: 'maps-membership', project: project.key },
    ctx,
    ['mapsMembership'],
  )
  const maps = new Map<string, MapResource>()
  for (const [index, map] of project.maps.entries()) {
    if (!sameProject(map.key.project, project.key) || maps.has(map.key.mapId))
      issue(
        ctx,
        ['maps', index, 'key'],
        'Map identities must be unique and belong to this Project.',
      )
    maps.set(map.key.mapId, map)
  }
  const allOrder = [...project.displayOrder.openMapIds, ...project.displayOrder.closedMapIds]
  const ordered = new Set<string>()
  for (const id of allOrder) {
    if (!maps.has(id) || ordered.has(id))
      issue(ctx, ['displayOrder'], 'Display order must reference unique canonical map identities.')
    ordered.add(id)
  }
  const membership = project.mapsMembership
  if (membership.kind === 'current-complete' || membership.kind === 'current-incomplete') {
    for (const [index, member] of membership.observation.value.members.entries())
      if (!maps.has(member.mapId))
        issue(
          ctx,
          ['mapsMembership', 'observation', 'value', 'members', index],
          'Current member must have a canonical map entry.',
        )
  }
  const evidence = currentEvidence(project)
  const owner = evidence.find((entry) => entry.provenance.integration === 'github')?.provenance
  if (owner?.integration === 'github') {
    for (const entry of evidence)
      if (
        entry.provenance.integration === 'github' &&
        (entry.provenance.connectionId !== owner.connectionId ||
          entry.provenance.repositoryId !== owner.repositoryId)
      )
        issue(
          ctx,
          ['maps'],
          'Current evidence must belong to one current Connection/repository binding.',
        )
  }
  const projectEvidence = currentResourceEvidence(project.resource)
  if (projectEvidence?.provenance.integration === 'local') {
    for (const entry of evidence)
      if (
        entry.provenance.integration === 'local' &&
        !localPathWithin(entry.provenance.path, projectEvidence.provenance.path)
      )
        issue(ctx, ['maps'], 'Current evidence must belong to the current canonical Local binding.')
  }
  if (project.activeMap.kind === 'uncertain') return
  if (
    project.resource.kind !== 'current-readable' ||
    project.resource.observation.completeness.kind !== 'complete' ||
    membership.kind !== 'current-complete'
  ) {
    issue(
      ctx,
      ['activeMap'],
      'Known active order requires current complete Project and membership evidence.',
    )
    return
  }
  const open: MapResource[] = []
  const closed: MapResource[] = []
  for (const member of membership.observation.value.members) {
    const map = maps.get(member.mapId)
    if (
      !map ||
      map.resource.kind !== 'current-readable' ||
      map.resource.observation.completeness.kind !== 'complete' ||
      map.resource.observation.value.status === 'unknown' ||
      map.resource.observation.value.progress === null ||
      map.ticketsMembership.kind !== 'current-complete'
    ) {
      issue(
        ctx,
        ['activeMap'],
        'Known active order requires current complete map and ticket membership evidence with known status and counts.',
      )
      continue
    }
    for (const ticketMember of map.ticketsMembership.observation.value.members) {
      const ticket = map.tickets.find((entry) => entry.key.ticketId === ticketMember.ticketId)
      if (
        !ticket ||
        ticket.resource.kind !== 'current-readable' ||
        ticket.resource.observation.completeness.kind !== 'complete' ||
        ticket.resource.observation.value.status === 'unknown' ||
        !ticket.resource.observation.value.blockersComplete ||
        ticket.resource.observation.value.blockedBy.some((blocker) => blocker.state === 'unknown')
      )
        issue(
          ctx,
          ['activeMap'],
          'Known active order requires current complete ticket and blocker evidence.',
        )
    }
    if (map.resource.observation.value.status === 'open') open.push(map)
    else closed.push(map)
  }
  const updated = (map: MapResource): number =>
    map.resource.kind === 'current-readable' ? map.resource.observation.value.updatedAt : 0
  const closure = (map: MapResource): number =>
    map.resource.kind === 'current-readable'
      ? (map.resource.observation.value.closedAt ?? map.resource.observation.value.updatedAt)
      : 0
  open.sort(
    (a, b) =>
      updated(b) - updated(a) ||
      (a.key.mapId < b.key.mapId ? -1 : a.key.mapId > b.key.mapId ? 1 : 0),
  )
  closed.sort(
    (a, b) =>
      closure(b) - closure(a) ||
      (a.key.mapId < b.key.mapId ? -1 : a.key.mapId > b.key.mapId ? 1 : 0),
  )
  if (
    open.length !== project.displayOrder.openMapIds.length ||
    open.some((map, index) => project.displayOrder.openMapIds[index] !== map.key.mapId) ||
    closed.length !== project.displayOrder.closedMapIds.length ||
    closed.some((map, index) => project.displayOrder.closedMapIds[index] !== map.key.mapId)
  )
    issue(
      ctx,
      ['displayOrder'],
      'Known order must match all current members and their actual source ordering.',
    )
  if (
    project.activeMap.kind === 'known-current'
      ? project.activeMap.mapId !== open[0]?.key.mapId
      : open.length !== 0
  )
    issue(ctx, ['activeMap'], 'Active certainty must match the head of the current open order.')
}
export const registeredProjectResourcesSchema = requestDataSchema.pipe(
  resourcesBaseSchema.superRefine(refineAggregate),
)
export const registeredProjectSchema = requestDataSchema.pipe(
  resourcesBaseSchema
    .superRefine(refineAggregate)
    .safeExtend({
      connectionId: z.string(),
      locator: requestDataSchema.pipe(
        z.discriminatedUnion('integration', [
          z.strictObject({ integration: z.literal('local'), path: z.string() }),
          z.strictObject({
            integration: z.literal('github'),
            repositoryId: z.string(),
            nameWithOwner: z.string(),
          }),
        ]),
      ),
      workspace: requestDataSchema.pipe(
        z.strictObject({ path: z.string(), gitIdentity: z.string().optional() }),
      ),
      displayName: z.string().optional(),
      name: z.string(),
      actions: z.array(
        requestDataSchema.pipe(
          z.strictObject({
            id: z.string(),
            label: z.string(),
            kind: z.enum(['roadmap', 'external-link', 'server-launch']),
            href: z.string().optional(),
          }),
        ),
      ),
      managementWarnings: z.array(z.string()),
    })
    .superRefine((project, ctx) => {
      if (project.locator.integration !== project.key.integration)
        issue(ctx, ['locator'], 'Registration locator must match the Project Integration.')
      for (const evidence of currentEvidence(project)) {
        const provenance = evidence.provenance
        if (project.locator.integration === 'github') {
          if (
            provenance.integration !== 'github' ||
            provenance.connectionId !== project.connectionId ||
            provenance.repositoryId !== project.locator.repositoryId
          )
            issue(
              ctx,
              ['resource'],
              'Current source evidence must match the configured Connection/repository binding.',
            )
        } else if (
          provenance.integration !== 'local' ||
          !localPathWithin(provenance.path, project.locator.path) ||
          (evidence.scope.kind === 'project' && provenance.path !== project.locator.path)
        )
          issue(
            ctx,
            ['resource'],
            'Current source evidence must match the configured canonical Local binding.',
          )
      }
    }),
)
export type RegisteredProject = z.output<typeof registeredProjectSchema>
