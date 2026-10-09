import { z } from 'zod'
import {
  authorizationOperationIdSchema,
  configurationVersionSchema,
  connectionIdSchema,
  projectRefSchema,
  serverEpochSchema,
  stateSequenceSchema,
  ticketRefSchema,
} from './identity.ts'
import { hrefSchema } from './internal/actions.ts'
import { arrayDataSchema, requestDataSchema } from './internal/request-data.ts'
import { projectSchema, type ticketTypeEvidenceSchema } from './resources.ts'

export { type Blocker, type BlockerState, blockerSchema } from './blocker.ts'
export {
  type LinkAction,
  linkActionSchema,
  type ProjectAction,
  projectActionSchema,
  type ServerLaunchAction,
  serverLaunchActionSchema,
} from './internal/actions.ts'
export * from './resources.ts'

const timeSchema = z.number().nonnegative().max(8_640_000_000_000_000)
export const connectionAvailabilitySchema = requestDataSchema.pipe(
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('available'), observedAt: timeSchema.optional() }),
    z.strictObject({ status: z.literal('degraded'), cause: z.string(), observedAt: timeSchema }),
    z.strictObject({
      status: z.literal('authorization-required'),
      cause: z.string(),
      observedAt: timeSchema.optional(),
    }),
    z.strictObject({
      status: z.literal('unavailable'),
      cause: z.string(),
      observedAt: timeSchema.optional(),
    }),
  ]),
)
export const githubConnectionIdentitySchema = requestDataSchema.pipe(
  z.strictObject({ id: z.string(), login: z.string() }),
)
const connectionFields = {
  id: connectionIdSchema,
  name: z.string(),
  availability: connectionAvailabilitySchema,
}
const localConnectionObjectSchema = z.strictObject({
  ...connectionFields,
  integration: z.literal('local'),
  builtIn: z.literal(true),
})
const githubConnectionObjectSchema = z.strictObject({
  ...connectionFields,
  integration: z.literal('github'),
  builtIn: z.literal(false),
  githubIdentity: githubConnectionIdentitySchema,
})
export const localConnectionSchema = requestDataSchema.pipe(localConnectionObjectSchema)
export const githubConnectionSchema = requestDataSchema.pipe(githubConnectionObjectSchema)
export const connectionSchema = requestDataSchema.pipe(
  z.discriminatedUnion('integration', [localConnectionObjectSchema, githubConnectionObjectSchema]),
)
export const supportedIntegrationSchema = requestDataSchema.pipe(
  z.discriminatedUnion('integration', [
    z.strictObject({
      integration: z.literal('local'),
      name: z.string(),
      connectionKind: z.literal('built-in'),
    }),
    z.strictObject({
      integration: z.literal('github'),
      name: z.string(),
      connectionKind: z.literal('device-authorization'),
      newInstallationUrl: hrefSchema,
      installationsUrl: hrefSchema,
      authorizationsUrl: hrefSchema,
    }),
  ]),
)
const terminalAuthorizationSchema = requestDataSchema.pipe(
  z.discriminatedUnion('outcome', [
    z.strictObject({
      id: authorizationOperationIdSchema,
      status: z.literal('terminal'),
      outcome: z.literal('cancelled'),
      connectionId: connectionIdSchema.optional(),
    }),
    z.strictObject({
      id: authorizationOperationIdSchema,
      status: z.literal('terminal'),
      outcome: z.literal('expired'),
      connectionId: connectionIdSchema.optional(),
    }),
    z.strictObject({
      id: authorizationOperationIdSchema,
      status: z.literal('terminal'),
      outcome: z.literal('denied'),
      connectionId: connectionIdSchema.optional(),
      cause: z.string(),
    }),
    z.strictObject({
      id: authorizationOperationIdSchema,
      status: z.literal('terminal'),
      outcome: z.literal('failed'),
      connectionId: connectionIdSchema.optional(),
      cause: z.string(),
    }),
  ]),
)
const authorizationConnectionSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('current'), id: connectionIdSchema, accountId: z.string() }),
    z.strictObject({
      kind: z.literal('historical'),
      id: connectionIdSchema,
      accountId: z.string(),
    }),
  ]),
)
export const authorizationOperationSchema = requestDataSchema.pipe(
  z.union([
    z.strictObject({
      id: authorizationOperationIdSchema,
      status: z.literal('waiting'),
      verificationUri: hrefSchema,
      userCode: z.string(),
      expiresAt: timeSchema,
      connectionId: connectionIdSchema.optional(),
    }),
    z.strictObject({
      id: authorizationOperationIdSchema,
      status: z.literal('granted'),
      connection: authorizationConnectionSchema,
    }),
    terminalAuthorizationSchema,
  ]),
)
export const configurationIssueSchema = requestDataSchema.pipe(
  z.strictObject({ path: z.string(), message: z.string() }),
)
export const configurationStatusSchema = requestDataSchema.pipe(
  z.strictObject({
    valid: z.boolean(),
    issues: arrayDataSchema.pipe(z.array(configurationIssueSchema)),
    notices: arrayDataSchema.pipe(z.array(z.string())),
  }),
)
export const automationAdmissionSchema = z.enum(['automatic', 'override'])
export const automationOverrideStageSchema = z.enum(['classification', 'wayfinder'])
export const automationOverrideAvailabilitySchema = requestDataSchema.pipe(
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('eligible') }),
    z.strictObject({ status: z.literal('ineligible'), reason: z.string() }),
  ]),
)
export const automationOverrideControlSchema = requestDataSchema.pipe(
  z.strictObject({
    target: ticketRefSchema,
    classification: automationOverrideAvailabilitySchema,
    wayfinder: automationOverrideAvailabilitySchema,
  }),
)
export const automationProcessResultSchema = requestDataSchema.pipe(
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('exited'), code: z.number().int().nonnegative().safe() }),
    z.strictObject({ status: z.literal('signaled'), signal: z.string() }),
    z.strictObject({ status: z.literal('unavailable'), reason: z.string() }),
  ]),
)
export const classificationVerdictSchema = requestDataSchema.pipe(
  z.strictObject({ value: z.enum(['afk', 'hitl', 'unable']), reason: z.string() }),
)
const completedClassificationSchema = z.strictObject({
  status: z.literal('completed'),
  admission: automationAdmissionSchema,
  processResult: automationProcessResultSchema,
  verdict: classificationVerdictSchema,
})
const classificationStages = {
  running: z.strictObject({ status: z.literal('running'), admission: automationAdmissionSchema }),
  failed: z.strictObject({
    status: z.literal('failed'),
    admission: automationAdmissionSchema,
    processResult: automationProcessResultSchema,
    reason: z.string(),
  }),
  launchFailed: z.strictObject({
    status: z.literal('launch-failed'),
    admission: automationAdmissionSchema,
    reason: z.string(),
  }),
  unknown: z.strictObject({
    status: z.literal('outcome-unknown'),
    admission: automationAdmissionSchema,
    reason: z.string(),
  }),
}
export const classificationAttemptSchema = requestDataSchema.pipe(
  z.discriminatedUnion('status', [
    classificationStages.running,
    completedClassificationSchema,
    classificationStages.failed,
    classificationStages.launchFailed,
    classificationStages.unknown,
  ]),
)
const classificationWithoutSessionSchema = requestDataSchema.pipe(
  z.discriminatedUnion('status', [
    classificationStages.running,
    completedClassificationSchema.extend({
      verdict: requestDataSchema.pipe(
        z.strictObject({ value: z.enum(['hitl', 'unable']), reason: z.string() }),
      ),
    }),
    classificationStages.failed,
    classificationStages.launchFailed,
    classificationStages.unknown,
  ]),
)
export const sessionReportSchema = requestDataSchema.pipe(
  z.strictObject({ outcome: z.enum(['completed', 'stopped', 'failed']), reason: z.string() }),
)
export const sessionReportEvidenceSchema = requestDataSchema.pipe(
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('received'), report: sessionReportSchema }),
    z.strictObject({ status: z.literal('missing'), reason: z.string() }),
    z.strictObject({ status: z.literal('invalid'), reason: z.string() }),
  ]),
)
export const wayfinderSessionSchema = requestDataSchema.pipe(
  z.discriminatedUnion('status', [
    z
      .strictObject({ status: z.literal('queued'), admission: z.never().optional() })
      .superRefine((session, ctx) => {
        if (Object.hasOwn(session, 'admission'))
          ctx.addIssue({
            code: 'custom',
            path: ['admission'],
            message: 'Queued Sessions cannot carry admission.',
          })
      }),
    z.strictObject({ status: z.literal('launching'), admission: automationAdmissionSchema }),
    z.strictObject({ status: z.literal('running'), admission: automationAdmissionSchema }),
    z.strictObject({
      status: z.literal('finished'),
      admission: automationAdmissionSchema,
      processResult: automationProcessResultSchema,
      report: sessionReportEvidenceSchema,
    }),
    z.strictObject({
      status: z.literal('launch-failed'),
      admission: automationAdmissionSchema,
      reason: z.string(),
    }),
    z.strictObject({
      status: z.literal('outcome-unknown'),
      admission: automationAdmissionSchema,
      reason: z.string(),
      acknowledged: z.boolean(),
    }),
  ]),
)
const completedAfkClassificationSchema = requestDataSchema.pipe(
  completedClassificationSchema.extend({
    verdict: requestDataSchema.pipe(
      z.strictObject({ value: z.literal('afk'), reason: z.string() }),
    ),
  }),
)
export const automationEvidenceSchema = requestDataSchema.pipe(
  z.union([
    z.strictObject({
      target: ticketRefSchema,
      classification: classificationWithoutSessionSchema,
      wayfinder: z.never().optional(),
    }),
    z.strictObject({
      target: ticketRefSchema,
      classification: completedAfkClassificationSchema,
      wayfinder: wayfinderSessionSchema,
    }),
  ]),
)
export const automationAvailabilitySchema = requestDataSchema.pipe(
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ready') }),
    z.strictObject({ status: z.literal('unavailable'), cause: z.string() }),
  ]),
)
export const automationStateSchema = requestDataSchema.pipe(
  z.strictObject({
    enabled: z.boolean(),
    enabledProjects: arrayDataSchema.pipe(z.array(projectRefSchema)),
    availability: automationAvailabilitySchema,
    evidence: arrayDataSchema.pipe(z.array(automationEvidenceSchema)),
    overrides: arrayDataSchema.pipe(z.array(automationOverrideControlSchema)),
  }),
)
const publicationFields = {
  serverEpoch: serverEpochSchema,
  stateSequence: stateSequenceSchema,
  capturedAt: timeSchema,
}
const readyObjectSchema = z.strictObject({
  ...publicationFields,
  phase: z.literal('ready'),
  mode: z.enum(['mutable', 'read-only']),
  configurationVersion: configurationVersionSchema,
  supportedIntegrations: arrayDataSchema.pipe(z.array(supportedIntegrationSchema)),
  connections: arrayDataSchema.pipe(z.array(connectionSchema)),
  projects: arrayDataSchema.pipe(z.array(projectSchema)),
  authorizationOperations: arrayDataSchema.pipe(z.array(authorizationOperationSchema)),
  configuration: configurationStatusSchema,
  automation: automationStateSchema,
})
function refineReadyState(state: z.output<typeof readyObjectSchema>, ctx: z.RefinementCtx): void {
  const issue = (path: PropertyKey[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message })
  const connections = new Map<string, Connection>()
  const accounts = new Set<string>()
  let localConnections = 0
  for (const [index, connection] of state.connections.entries()) {
    if (connections.has(connection.id))
      issue(['connections', index, 'id'], 'Connection identities must be unique.')
    connections.set(connection.id, connection)
    if (connection.integration === 'local') {
      if (++localConnections > 1)
        issue(['connections', index], 'The built-in Local Connection is unique.')
    } else {
      if (accounts.has(connection.githubIdentity.id))
        issue(
          ['connections', index, 'githubIdentity', 'id'],
          'Canonical GitHub accounts must be unique.',
        )
      accounts.add(connection.githubIdentity.id)
    }
  }
  const projects = new Set<string>()
  const repositories = new Set<string>()
  for (const [index, project] of state.projects.entries()) {
    const key = JSON.stringify([project.ref.integration, project.ref.projectId])
    if (projects.has(key)) issue(['projects', index, 'ref'], 'Project identities must be unique.')
    projects.add(key)
    if (connections.get(project.connectionId)?.integration !== project.integration)
      issue(
        ['projects', index, 'connectionId'],
        'Project must associate with its canonical Integration Connection.',
      )
    if (project.integration === 'github') {
      if (repositories.has(project.source.repositoryId))
        issue(
          ['projects', index, 'source', 'repositoryId'],
          'Configured repository identities must be unique.',
        )
      repositories.add(project.source.repositoryId)
    }
  }
  const operations = new Set<string>()
  for (const [index, operation] of state.authorizationOperations.entries()) {
    if (operations.has(operation.id))
      issue(['authorizationOperations', index, 'id'], 'Authorization identities must be unique.')
    operations.add(operation.id)
    if (operation.status === 'granted') {
      const canonical = connections.get(operation.connection.id)
      const matches =
        canonical?.integration === 'github' &&
        canonical.githubIdentity.id === operation.connection.accountId
      if ((operation.connection.kind === 'current') !== matches)
        issue(
          ['authorizationOperations', index, 'connection'],
          'Grant receipt association must agree with its current or historical canonical account.',
        )
    }
    if (
      operation.status === 'waiting' &&
      operation.connectionId !== undefined &&
      connections.get(operation.connectionId)?.integration !== 'github'
    )
      issue(
        ['authorizationOperations', index, 'connectionId'],
        'Waiting reauthorization must name an existing GitHub Connection.',
      )
    if (
      operation.status === 'terminal' &&
      operation.connectionId !== undefined &&
      connections.get(operation.connectionId)?.integration === 'local'
    )
      issue(
        ['authorizationOperations', index, 'connectionId'],
        'Terminal reauthorization cannot name a current Local Connection.',
      )
  }
  const enabled = new Set<string>()
  for (const [index, ref] of state.automation.enabledProjects.entries()) {
    const key = JSON.stringify([ref.integration, ref.projectId])
    if (!projects.has(key) || enabled.has(key))
      issue(
        ['automation', 'enabledProjects', index],
        'Enabled Projects must name unique canonical Projects.',
      )
    enabled.add(key)
  }
  for (const field of ['evidence', 'overrides'] as const) {
    const targets = new Set<string>()
    for (const [index, entry] of state.automation[field].entries()) {
      const key = JSON.stringify(entry.target)
      if (targets.has(key))
        issue(
          ['automation', field, index, 'target'],
          'Automation targets must be unique within their evidence family.',
        )
      targets.add(key)
    }
  }
  if ((state.mode === 'mutable') !== state.configuration.valid)
    issue(['mode'], 'Ready mode must match configuration admission validity.')
}
export const readyApplicationStateSchema = requestDataSchema.pipe(
  readyObjectSchema.superRefine(refineReadyState),
)
export const applicationStateSchema = requestDataSchema.pipe(
  z.discriminatedUnion('phase', [
    z.strictObject({ ...publicationFields, phase: z.literal('idle') }),
    z.strictObject({ ...publicationFields, phase: z.literal('starting') }),
    readyObjectSchema.superRefine(refineReadyState),
    z.strictObject({
      ...publicationFields,
      phase: z.literal('stopping'),
      retained: readyApplicationStateSchema.nullable(),
    }),
    z.strictObject({
      ...publicationFields,
      phase: z.literal('stopped'),
      retained: readyApplicationStateSchema.nullable(),
    }),
    z.strictObject({
      ...publicationFields,
      phase: z.literal('failed'),
      cause: z.string(),
      retained: readyApplicationStateSchema.nullable(),
    }),
  ]),
)
export type ConnectionAvailability = z.output<typeof connectionAvailabilitySchema>
export type GitHubConnectionIdentity = z.output<typeof githubConnectionIdentitySchema>
export type Connection = z.output<typeof connectionSchema>
export type LocalConnection = z.output<typeof localConnectionSchema>
export type GitHubConnection = z.output<typeof githubConnectionSchema>
export type SupportedIntegration = z.output<typeof supportedIntegrationSchema>
export type AuthorizationOperation = z.output<typeof authorizationOperationSchema>
export type ConfigurationIssue = z.output<typeof configurationIssueSchema>
export type ConfigurationStatus = z.output<typeof configurationStatusSchema>
export type AutomationAdmission = z.output<typeof automationAdmissionSchema>
export type AutomationOverrideStage = z.output<typeof automationOverrideStageSchema>
export type AutomationOverrideAvailability = z.output<typeof automationOverrideAvailabilitySchema>
export type AutomationOverrideControl = z.output<typeof automationOverrideControlSchema>
export type AutomationProcessResult = z.output<typeof automationProcessResultSchema>
export type ClassificationVerdict = z.output<typeof classificationVerdictSchema>
export type ClassificationAttempt = z.output<typeof classificationAttemptSchema>
export type SessionReport = z.output<typeof sessionReportSchema>
export type SessionReportEvidence = z.output<typeof sessionReportEvidenceSchema>
export type WayfinderSession = z.output<typeof wayfinderSessionSchema>
export type AutomationEvidence = z.output<typeof automationEvidenceSchema>
export type AutomationAvailability = z.output<typeof automationAvailabilitySchema>
export type AutomationState = z.output<typeof automationStateSchema>
export type ReadyApplicationState = z.output<typeof readyApplicationStateSchema>
export type ApplicationState = z.output<typeof applicationStateSchema>
export type RecognizedTicketType = Extract<
  z.output<typeof ticketTypeEvidenceSchema>,
  { kind: 'recognized' }
>['value']
export type TicketType = RecognizedTicketType | 'untyped'
export function ticketTypeOf(evidence: z.output<typeof ticketTypeEvidenceSchema>): TicketType {
  return evidence.kind === 'recognized' ? evidence.value : 'untyped'
}
