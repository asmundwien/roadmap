import { z } from 'zod'
import { type CorrelationId, correlationIdSchema } from './identity.ts'
import { requestDataSchema, strictDataObject } from './internal/request-data.ts'
import {
  type Command,
  type CommandOutcomeFor,
  commandOutcomeFor,
  commandOutcomeSchema,
  commandSchema,
  type Query,
  queryResultSchema,
  querySchema,
} from './operations.ts'
import { applicationStateSchema } from './state.ts'

export const REQUEST_ID_HEADER = 'X-Roadmap-Request-Id'
export const requestIdSchema = z.uuid()

export const queryEnvelopeSchema = strictDataObject({
  type: z.literal('query'),
  correlationId: correlationIdSchema,
  query: querySchema,
})
export const commandEnvelopeSchema = strictDataObject({
  type: z.literal('command'),
  correlationId: correlationIdSchema,
  command: commandSchema,
})
export const stateEnvelopeSchema = requestDataSchema.pipe(
  z.strictObject({ type: z.literal('state'), state: applicationStateSchema }),
)
export const queryResultEnvelopeSchema = strictDataObject({
  type: z.literal('query-result'),
  correlationId: correlationIdSchema,
  result: queryResultSchema,
})
export const commandResultEnvelopeSchema = strictDataObject({
  type: z.literal('command-result'),
  correlationId: correlationIdSchema,
  outcome: commandOutcomeSchema,
})

export const requestRejectionSchema = requestDataSchema.pipe(
  z.strictObject({
    type: z.literal('request-rejected'),
    request: z.enum(['query', 'command']),
    requestId: requestIdSchema.nullable(),
    reason: z.enum([
      'origin',
      'method',
      'peer',
      'media-type',
      'too-large',
      'malformed-json',
      'malformed-envelope',
      'interrupted',
    ]),
    message: z.string(),
  }),
)

export type QueryEnvelope = z.output<typeof queryEnvelopeSchema>
export type CommandEnvelope = z.output<typeof commandEnvelopeSchema>
export type RequestRejection = z.output<typeof requestRejectionSchema>
export type StateEnvelope = z.output<typeof stateEnvelopeSchema>
export type QueryResultEnvelope = z.output<typeof queryResultEnvelopeSchema>
export type CommandResultEnvelope = z.output<typeof commandResultEnvelopeSchema>
export type CommandResultEnvelopeFor<C extends Command> = Omit<CommandResultEnvelope, 'outcome'> & {
  outcome: CommandOutcomeFor<C>
}

export interface DecodeIssue {
  path: string
  message: string
}
export type DecodeResult<T> = { ok: true; value: T } | { ok: false; issues: DecodeIssue[] }

// Only schema field names belong in diagnostics. Unknown keys, enum contents,
// Zod messages and input values may contain credentials.
const safeFields = new Set([
  'type',
  'query',
  'command',
  'expectedConfigurationVersion',
  'name',
  'connectionId',
  'operationId',
  'candidate',
  'integration',
  'workspace',
  'path',
  'gitIdentity',
  'displayName',
  'project',
  'projectId',
  'enabled',
  'target',
  'mapId',
  'ticketId',
  'stage',
  'actionId',
  'request',
  'requestId',
  'correlationId',
  'subject',
  'commit',
  'reason',
  'message',
  'state',
  'result',
  'outcome',
  'error',
  'ok',
  'serverEpoch',
  'stateSequence',
  'capturedAt',
  'phase',
  'mode',
  'retained',
  'cause',
  'configurationVersion',
  'supportedIntegrations',
  'connections',
  'projects',
  'authorizationOperations',
  'configuration',
  'automation',
  'ref',
  'resource',
  'source',
  'management',
  'workspacePath',
  'maps',
  'mapsMembership',
  'tickets',
  'ticketsMembership',
  'displayOrder',
  'open',
  'closed',
  'activeMap',
  'frontier',
  'kind',
  'scope',
  'observation',
  'attemptedAt',
  'observedAt',
  'provenance',
  'completeness',
  'value',
  'lastSuccessful',
  'unavailable',
  'absence',
  'proof',
  'trace',
  'labels',
  'typeEvidence',
  'classification',
  'wayfinder',
  'admission',
  'verdict',
  'processResult',
  'report',
  'acknowledged',
  'status',
  'id',
  'reference',
  'ticket',
  'map',
  'members',
  'lastComplete',
  'blockedBy',
  'blockersComplete',
  'isClaimed',
  'isBlocked',
  'githubIdentity',
  'verificationUri',
  'userCode',
  'expiresAt',
  'connection',
  'actions',
  'operation',
  'href',
  'repositoryId',
  'nameWithOwner',
  'title',
  'body',
  'updatedAt',
  'closedAt',
  'createdAt',
  'progress',
  'total',
  'completed',
  'failure',
  'availability',
  'enabledProjects',
  'evidence',
  'overrides',
  'accountId',
])

function decode<S extends z.ZodType>(schema: S, input: unknown): DecodeResult<z.output<S>> {
  try {
    const result = schema.safeParse(input)
    if (result.success) return { ok: true, value: result.data }
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path:
          '$' +
          issue.path
            .map((key) => (typeof key === 'string' && safeFields.has(key) ? `.${key}` : '.?'))
            .join(''),
        message: issue.code,
      })),
    }
  } catch {
    return { ok: false, issues: [{ path: '$', message: 'invalid_data' }] }
  }
}

export function decodeQueryEnvelope(input: unknown): DecodeResult<QueryEnvelope> {
  return decode(queryEnvelopeSchema, input)
}
export function decodeCommandEnvelope(input: unknown): DecodeResult<CommandEnvelope> {
  return decode(commandEnvelopeSchema, input)
}
export function decodeRequestRejection(input: unknown): DecodeResult<RequestRejection> {
  return decode(requestRejectionSchema, input)
}

export function decodeApplicationState(
  input: unknown,
): DecodeResult<z.output<typeof applicationStateSchema>> {
  return decode(applicationStateSchema, input)
}
export function decodeStateEnvelope(input: unknown): DecodeResult<StateEnvelope> {
  return decode(stateEnvelopeSchema, input)
}
export function decodeQueryResultEnvelope(
  input: unknown,
  expectedQuery: Query,
  expectedCorrelationId: CorrelationId,
): DecodeResult<QueryResultEnvelope> {
  const result = decode(queryResultEnvelopeSchema, input)
  if (!result.ok) return result
  if (
    !expectedQuery ||
    result.value.correlationId !== expectedCorrelationId ||
    result.value.result.operation !== expectedQuery.type
  )
    return { ok: false, issues: [{ path: '$.result', message: 'invalid_result' }] }
  return result
}
function commandEnvelopeFor<C extends Command>(
  command: C,
  envelope: CommandResultEnvelope,
): envelope is CommandResultEnvelopeFor<C> {
  return commandOutcomeFor(command, envelope.outcome)
}
export function decodeCommandResultEnvelope<C extends Command>(
  input: unknown,
  expectedCommand: C,
  expectedCorrelationId: CorrelationId,
): DecodeResult<CommandResultEnvelopeFor<C>> {
  const result = decode(commandResultEnvelopeSchema, input)
  if (!result.ok) return result
  if (
    expectedCommand &&
    result.value.correlationId === expectedCorrelationId &&
    commandEnvelopeFor(expectedCommand, result.value)
  )
    return { ok: true, value: result.value }
  return { ok: false, issues: [{ path: '$.outcome', message: 'invalid_result' }] }
}

export function requestRejectionStatus(
  reason: RequestRejection['reason'],
): 400 | 403 | 405 | 413 | 415 {
  switch (reason) {
    case 'origin':
    case 'peer':
      return 403
    case 'method':
      return 405
    case 'media-type':
      return 415
    case 'too-large':
      return 413
    case 'malformed-json':
    case 'malformed-envelope':
    case 'interrupted':
      return 400
    default: {
      const exhaustive: never = reason
      return exhaustive
    }
  }
}
