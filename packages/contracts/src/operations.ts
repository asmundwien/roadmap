import { z } from 'zod'
import {
  authorizationOperationIdSchema,
  configurationVersionSchema,
  connectionIdSchema,
  integrationSchema,
  type ProjectRef,
  projectRefSchema,
  serverEpochSchema,
  stateSequenceSchema,
  type TicketRef,
  ticketRefSchema,
} from './identity.ts'
import { projectOperationSchema } from './internal/actions.ts'
import { arrayDataSchema, requestDataSchema, strictDataObject } from './internal/request-data.ts'
import { provenanceSchema, timeSchema } from './resources.ts'

export { type ProjectOperation, projectOperationSchema } from './internal/actions.ts'

const workspaceSchema = strictDataObject({ path: z.string() })
const registrationCandidateSchema = strictDataObject({
  integration: integrationSchema,
  connectionId: connectionIdSchema,
  workspace: workspaceSchema,
  displayName: z.string().optional(),
})
const version = { expectedConfigurationVersion: configurationVersionSchema }
const stageSchema = z.enum(['classification', 'wayfinder'])

export const querySchema = strictDataObject({ type: z.literal('select-workspace') })
export const commandSchema = requestDataSchema.pipe(
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('begin-github-authorization'), ...version, name: z.string() }),
    z.strictObject({
      type: z.literal('reauthorize-github-connection'),
      ...version,
      connectionId: connectionIdSchema,
    }),
    z.strictObject({
      type: z.literal('retry-github-authorization'),
      ...version,
      operationId: authorizationOperationIdSchema,
    }),
    z.strictObject({
      type: z.literal('cancel-github-authorization'),
      ...version,
      operationId: authorizationOperationIdSchema,
    }),
    z.strictObject({
      type: z.literal('rename-connection'),
      ...version,
      connectionId: connectionIdSchema,
      name: z.string(),
    }),
    z.strictObject({
      type: z.literal('remove-connection'),
      ...version,
      connectionId: connectionIdSchema,
    }),
    z.strictObject({
      type: z.literal('register-project'),
      ...version,
      candidate: registrationCandidateSchema,
    }),
    z.strictObject({
      type: z.literal('rename-project'),
      ...version,
      project: projectRefSchema,
      name: z.string(),
    }),
    z.strictObject({
      type: z.literal('repair-project-workspace'),
      ...version,
      project: projectRefSchema,
      workspace: workspaceSchema,
    }),
    z.strictObject({ type: z.literal('remove-project'), ...version, project: projectRefSchema }),
    z.strictObject({ type: z.literal('set-automation-enabled'), ...version, enabled: z.boolean() }),
    z.strictObject({
      type: z.literal('set-project-automation-enabled'),
      ...version,
      project: projectRefSchema,
      enabled: z.boolean(),
    }),
    z.strictObject({
      type: z.literal('start-automation-override'),
      ...version,
      target: ticketRefSchema,
      stage: stageSchema,
    }),
    z.strictObject({ type: z.literal('refresh-project'), ...version, project: projectRefSchema }),
    z.strictObject({
      type: z.literal('launch-project-operation'),
      ...version,
      project: projectRefSchema,
      operation: projectOperationSchema,
    }),
  ]),
)
export type Query = z.output<typeof querySchema>
export type Command = z.output<typeof commandSchema>

export const safeErrorSchema = strictDataObject({
  code: z.enum([
    'conflict',
    'configuration-invalid',
    'validation',
    'dependency',
    'admission-failed',
    'authorization-failed',
    'persistence-failed',
    'launch-failed',
    'selection-failed',
    'not-supported',
    'transport-failed',
  ]),
  message: z.string(),
  field: z.string().optional(),
  dependentProjects: arrayDataSchema.pipe(z.array(projectRefSchema)).optional(),
})
export type SafeError = z.output<typeof safeErrorSchema>

const noneSubjectSchema = strictDataObject({ kind: z.literal('none') })
const connectionSubjectSchema = strictDataObject({
  kind: z.literal('connection'),
  connectionId: connectionIdSchema,
})
const projectSubjectSchema = strictDataObject({
  kind: z.literal('project'),
  project: projectRefSchema,
})
const authorizationSubjectSchema = strictDataObject({
  kind: z.literal('authorization'),
  operationId: authorizationOperationIdSchema,
})
const registrationSubjectSchema = strictDataObject({
  kind: z.literal('registration'),
  integration: integrationSchema,
  connectionId: connectionIdSchema,
})
const automationSubjectSchema = strictDataObject({ kind: z.literal('automation') })
const ticketSubjectSchema = strictDataObject({
  kind: z.literal('ticket'),
  target: ticketRefSchema,
  stage: stageSchema,
})
export const operationSubjectSchema = z.union([
  noneSubjectSchema,
  connectionSubjectSchema,
  projectSubjectSchema,
  authorizationSubjectSchema,
  registrationSubjectSchema,
  automationSubjectSchema,
  ticketSubjectSchema,
])
export type OperationSubject = z.output<typeof operationSubjectSchema>

const producer = { serverEpoch: serverEpochSchema, stateSequence: stateSequenceSchema }
export const queryResultSchema = z.union([
  strictDataObject({
    operation: z.literal('select-workspace'),
    subject: noneSubjectSchema,
    ...producer,
    ok: z.literal(true),
    result: z.union([
      strictDataObject({ kind: z.literal('selected'), path: z.string() }),
      strictDataObject({ kind: z.literal('cancelled') }),
    ]),
  }),
  strictDataObject({
    operation: z.literal('select-workspace'),
    subject: noneSubjectSchema,
    ...producer,
    ok: z.literal(false),
    error: safeErrorSchema,
  }),
])
export type QueryResult = z.output<typeof queryResultSchema>

export const configurationCommitSchema = z.enum(['committed', 'committed-unconfirmed'])
const commit = {
  configurationVersion: configurationVersionSchema,
  commit: configurationCommitSchema,
}

export const refreshCauseSchema = z.enum([
  'Workspace read permission was denied.',
  'Workspace cannot be read.',
  'Source path is currently missing.',
  'Source read permission was denied.',
  'Source path cannot be read.',
  'GitHub rate limit prevents this read.',
  'GitHub is temporarily unreachable.',
  'GitHub could not execute this source read.',
  'GitHub response could not be read.',
  'Source response is malformed.',
  'GitHub access is currently unavailable.',
  'GitHub authorization is required.',
  'GitHub source is inaccessible; absence is not proven.',
  'GitHub repository identity does not match the admitted Project.',
  'Current ancestor source evidence is incomplete.',
  'No current source observation is available.',
  'Current source evidence is incomplete.',
])
const refreshMetadata = { attemptedAt: timeSchema, provenance: provenanceSchema }
export const refreshAttemptSchema = z
  .union([
    strictDataObject({ kind: z.literal('observed'), ...refreshMetadata, observedAt: timeSchema }),
    strictDataObject({
      kind: z.literal('degraded'),
      ...refreshMetadata,
      observedAt: timeSchema,
      cause: refreshCauseSchema,
    }),
    strictDataObject({ kind: z.literal('failed'), ...refreshMetadata, cause: refreshCauseSchema }),
    strictDataObject({
      kind: z.literal('proven-absent'),
      ...refreshMetadata,
      observedAt: timeSchema,
    }),
  ])
  .superRefine((attempt, ctx) => {
    if (attempt.kind === 'observed' || attempt.kind === 'proven-absent') {
      if (attempt.observedAt < attempt.attemptedAt)
        ctx.addIssue({
          code: 'custom',
          path: ['observedAt'],
          message: 'Completed observation cannot precede its attempt.',
        })
    }
  })
export type RefreshAttempt = z.output<typeof refreshAttemptSchema>
export type RefreshCause = z.output<typeof refreshCauseSchema>
export type ConfigurationCommit = z.output<typeof configurationCommitSchema>

type AuthorizationCommand = Extract<
  Command,
  {
    type:
      | 'begin-github-authorization'
      | 'reauthorize-github-connection'
      | 'retry-github-authorization'
      | 'cancel-github-authorization'
  }
>
function authorizationResultSchema<const T extends AuthorizationCommand['type']>(type: T) {
  const common = { type: z.literal(type), operationId: authorizationOperationIdSchema }
  return z.union([
    strictDataObject({
      ...common,
      phase: z.literal('waiting'),
      verificationUri: z
        .url({ protocol: /^https?$/ })
        .refine((uri) => !/^https?:\/\/[^/?#]*@/.test(uri)),
      userCode: z.string(),
      expiresAt: timeSchema,
    }),
    strictDataObject({
      ...common,
      phase: z.literal('granted'),
      connection: strictDataObject({ connectionId: connectionIdSchema, accountId: z.string() }),
      configurationVersion: configurationVersionSchema,
    }),
    strictDataObject({ ...common, phase: z.literal('denied'), error: safeErrorSchema }),
    strictDataObject({ ...common, phase: z.literal('failed'), error: safeErrorSchema }),
    strictDataObject({ ...common, phase: z.literal('expired') }),
    strictDataObject({ ...common, phase: z.literal('cancelled') }),
  ])
}
const beginResult = authorizationResultSchema('begin-github-authorization')
const reauthorizeResult = authorizationResultSchema('reauthorize-github-connection')
const retryResult = authorizationResultSchema('retry-github-authorization')
const cancelResult = authorizationResultSchema('cancel-github-authorization')
const renameConnectionResult = strictDataObject({
  type: z.literal('rename-connection'),
  connectionId: connectionIdSchema,
  ...commit,
})
const removeConnectionResult = strictDataObject({
  type: z.literal('remove-connection'),
  connectionId: connectionIdSchema,
  ...commit,
})
const registerResult = strictDataObject({
  type: z.literal('register-project'),
  project: projectRefSchema,
  connectionId: connectionIdSchema,
  workspacePath: z.string(),
  ...commit,
})
const renameProjectResult = strictDataObject({
  type: z.literal('rename-project'),
  project: projectRefSchema,
  ...commit,
})
const repairResult = strictDataObject({
  type: z.literal('repair-project-workspace'),
  project: projectRefSchema,
  workspacePath: z.string(),
  ...commit,
})
const removeProjectResult = strictDataObject({
  type: z.literal('remove-project'),
  project: projectRefSchema,
  ...commit,
})
const automationResult = strictDataObject({
  type: z.literal('set-automation-enabled'),
  enabled: z.boolean(),
  ...commit,
})
const projectAutomationResult = strictDataObject({
  type: z.literal('set-project-automation-enabled'),
  project: projectRefSchema,
  enabled: z.boolean(),
  ...commit,
})
const overrideResult = strictDataObject({
  type: z.literal('start-automation-override'),
  target: ticketRefSchema,
  stage: stageSchema,
  admission: z.literal('override'),
  status: z.literal('admitted'),
})
const refreshResult = strictDataObject({
  type: z.literal('refresh-project'),
  project: projectRefSchema,
  attempt: refreshAttemptSchema,
})
const launchResult = strictDataObject({
  type: z.literal('launch-project-operation'),
  project: projectRefSchema,
  operation: projectOperationSchema,
  status: z.literal('invoked'),
})
export const commandResultSchema = z.union([
  beginResult,
  reauthorizeResult,
  retryResult,
  cancelResult,
  renameConnectionResult,
  removeConnectionResult,
  registerResult,
  renameProjectResult,
  repairResult,
  removeProjectResult,
  automationResult,
  projectAutomationResult,
  overrideResult,
  refreshResult,
  launchResult,
])
export type CommandResult = z.output<typeof commandResultSchema>
export type CommandResultFor<C extends Command> = Extract<CommandResult, { type: C['type'] }>

function outcomeSchema<const T extends Command['type'], S extends z.ZodType, R extends z.ZodType>(
  operation: T,
  subject: S,
  result: R,
) {
  const common = { operation: z.literal(operation), subject, ...producer }
  return z.union([
    strictDataObject({ ...common, ok: z.literal(true), result }),
    strictDataObject({ ...common, ok: z.literal(false), error: safeErrorSchema }),
  ])
}
export const commandOutcomeSchema = z
  .union([
    outcomeSchema('begin-github-authorization', noneSubjectSchema, beginResult),
    outcomeSchema('reauthorize-github-connection', connectionSubjectSchema, reauthorizeResult),
    outcomeSchema('retry-github-authorization', authorizationSubjectSchema, retryResult),
    outcomeSchema('cancel-github-authorization', authorizationSubjectSchema, cancelResult),
    outcomeSchema('rename-connection', connectionSubjectSchema, renameConnectionResult),
    outcomeSchema('remove-connection', connectionSubjectSchema, removeConnectionResult),
    outcomeSchema('register-project', registrationSubjectSchema, registerResult),
    outcomeSchema('rename-project', projectSubjectSchema, renameProjectResult),
    outcomeSchema('repair-project-workspace', projectSubjectSchema, repairResult),
    outcomeSchema('remove-project', projectSubjectSchema, removeProjectResult),
    outcomeSchema('set-automation-enabled', automationSubjectSchema, automationResult),
    outcomeSchema('set-project-automation-enabled', projectSubjectSchema, projectAutomationResult),
    outcomeSchema('start-automation-override', ticketSubjectSchema, overrideResult),
    outcomeSchema('refresh-project', projectSubjectSchema, refreshResult),
    outcomeSchema('launch-project-operation', projectSubjectSchema, launchResult),
  ])
  .superRefine((outcome, ctx) => {
    if (outcome.ok && !resultSubjectMatches(outcome.subject, outcome.result))
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Result must match the canonical outcome subject.',
      })
  })
export type CommandOutcome = z.output<typeof commandOutcomeSchema>
export type CommandOutcomeFor<C extends Command> = Extract<CommandOutcome, { operation: C['type'] }>
export type CommandSubjectFor<C extends Command> = CommandOutcomeFor<C>['subject']

function sameProject(a: ProjectRef, b: ProjectRef): boolean {
  return a.integration === b.integration && a.projectId === b.projectId
}
function sameTicket(a: TicketRef, b: TicketRef): boolean {
  return (
    sameProject(a.map.project, b.map.project) &&
    a.map.mapId === b.map.mapId &&
    a.ticketId === b.ticketId
  )
}
function sameSubject(a: OperationSubject, b: OperationSubject): boolean {
  switch (a.kind) {
    case 'none':
    case 'automation':
      return b.kind === a.kind
    case 'connection':
      return b.kind === 'connection' && a.connectionId === b.connectionId
    case 'authorization':
      return b.kind === 'authorization' && a.operationId === b.operationId
    case 'project':
      return b.kind === 'project' && sameProject(a.project, b.project)
    case 'registration':
      return (
        b.kind === 'registration' &&
        a.integration === b.integration &&
        a.connectionId === b.connectionId
      )
    case 'ticket':
      return b.kind === 'ticket' && sameTicket(a.target, b.target) && a.stage === b.stage
  }
}
export function commandSubject<C extends Command>(command: C): CommandSubjectFor<C>
export function commandSubject(command: Command): OperationSubject {
  switch (command.type) {
    case 'begin-github-authorization':
      return { kind: 'none' }
    case 'reauthorize-github-connection':
    case 'rename-connection':
    case 'remove-connection':
      return { kind: 'connection', connectionId: command.connectionId }
    case 'retry-github-authorization':
    case 'cancel-github-authorization':
      return { kind: 'authorization', operationId: command.operationId }
    case 'register-project':
      return {
        kind: 'registration',
        integration: command.candidate.integration,
        connectionId: command.candidate.connectionId,
      }
    case 'rename-project':
    case 'repair-project-workspace':
    case 'remove-project':
    case 'set-project-automation-enabled':
    case 'refresh-project':
    case 'launch-project-operation':
      return { kind: 'project', project: command.project }
    case 'set-automation-enabled':
      return { kind: 'automation' }
    case 'start-automation-override':
      return { kind: 'ticket', target: command.target, stage: command.stage }
  }
}
function resultSubjectMatches(subject: OperationSubject, result: CommandResult): boolean {
  switch (result.type) {
    case 'begin-github-authorization':
      return subject.kind === 'none'
    case 'reauthorize-github-connection':
      return (
        subject.kind === 'connection' &&
        (result.phase !== 'granted' || result.connection.connectionId === subject.connectionId)
      )
    case 'retry-github-authorization':
    case 'cancel-github-authorization':
      return subject.kind === 'authorization' && subject.operationId === result.operationId
    case 'rename-connection':
    case 'remove-connection':
      return subject.kind === 'connection' && subject.connectionId === result.connectionId
    case 'register-project':
      return (
        subject.kind === 'registration' &&
        subject.connectionId === result.connectionId &&
        subject.integration === result.project.integration
      )
    case 'rename-project':
    case 'repair-project-workspace':
    case 'remove-project':
    case 'set-project-automation-enabled':
    case 'launch-project-operation':
      return subject.kind === 'project' && sameProject(subject.project, result.project)
    case 'refresh-project':
      return (
        subject.kind === 'project' &&
        sameProject(subject.project, result.project) &&
        result.attempt.provenance.integration === result.project.integration
      )
    case 'set-automation-enabled':
      return subject.kind === 'automation'
    case 'start-automation-override':
      return (
        subject.kind === 'ticket' &&
        sameTicket(subject.target, result.target) &&
        subject.stage === result.stage
      )
  }
}
export function commandResultFor<C extends Command>(
  command: C,
  result: CommandResult,
): result is CommandResultFor<C> {
  if (command.type !== result.type || !resultSubjectMatches(commandSubject(command), result))
    return false
  switch (command.type) {
    case 'launch-project-operation':
      return result.type === command.type && result.operation === command.operation
    case 'set-automation-enabled':
    case 'set-project-automation-enabled':
      return result.type === command.type && result.enabled === command.enabled
    default:
      return true
  }
}
export function commandOutcomeFor<C extends Command>(
  command: C,
  outcome: CommandOutcome,
): outcome is CommandOutcomeFor<C> {
  return (
    outcome.operation === command.type &&
    sameSubject(commandSubject(command), outcome.subject) &&
    (!outcome.ok || commandResultFor(command, outcome.result))
  )
}
export function parseCommandOutcomeFor<C extends Command>(
  command: C,
  value: unknown,
): CommandOutcomeFor<C> {
  const outcome = commandOutcomeSchema.parse(value)
  if (commandOutcomeFor(command, outcome)) return outcome
  throw new Error('The command outcome does not match its initiating command.')
}
