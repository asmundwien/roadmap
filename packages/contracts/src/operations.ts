import { z } from 'zod'
import {
  actionIdSchema,
  authorizationOperationIdSchema,
  configurationVersionSchema,
  connectionIdSchema,
  projectRefSchema,
  ticketRefSchema,
} from './identity.ts'
import { arrayDataSchema, requestDataSchema } from './internal/request-data.ts'
import { applicationStateSchema } from './state.ts'

const workspaceSchema = requestDataSchema.pipe(z.strictObject({ path: z.string() }))
const registrationCandidateSchema = requestDataSchema.pipe(
  z.strictObject({
    integration: z.enum(['github', 'local']),
    connectionId: connectionIdSchema,
    workspace: requestDataSchema.pipe(z.strictObject({ path: z.string() })),
    displayName: z.string().optional(),
  }),
)
const version = { expectedConfigurationVersion: configurationVersionSchema }

export const querySchema = requestDataSchema.pipe(
  z.discriminatedUnion('type', [z.strictObject({ type: z.literal('select-workspace') })]),
)

export const commandSchema = requestDataSchema.pipe(
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('begin-github-authorization'),
      ...version,
      name: z.string(),
      connectionId: connectionIdSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('cancel-github-authorization'),
      ...version,
      operationId: authorizationOperationIdSchema,
    }),
    z.strictObject({
      type: z.literal('retry-github-authorization'),
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
    z.strictObject({
      type: z.literal('remove-project'),
      ...version,
      project: projectRefSchema,
    }),
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
      stage: z.enum(['classification', 'wayfinder']),
    }),
    z.strictObject({ type: z.literal('refresh-project'), ...version, project: projectRefSchema }),
    z.strictObject({
      type: z.literal('launch-action'),
      ...version,
      actionId: actionIdSchema,
      project: projectRefSchema.optional(),
    }),
  ]),
)

export type Query = z.output<typeof querySchema>
export type Command = z.output<typeof commandSchema>

export const safeErrorSchema = requestDataSchema.pipe(
  z.strictObject({
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
  }),
)
export const queryResultSchema = requestDataSchema.pipe(
  z.discriminatedUnion('ok', [
    z.strictObject({
      ok: z.literal(true),
      type: z.literal('workspace-selection'),
      path: z.string().optional(),
    }),
    z.strictObject({ ok: z.literal(false), error: safeErrorSchema }),
  ]),
)
export const commandResultSchema = requestDataSchema.pipe(
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('configuration-updated'),
      configurationVersion: configurationVersionSchema,
    }),
    z.strictObject({
      type: z.literal('authorization-started'),
      operationId: authorizationOperationIdSchema,
    }),
    z.strictObject({
      type: z.literal('authorization-cancelled'),
      operationId: authorizationOperationIdSchema,
    }),
    z.strictObject({ type: z.literal('project-refreshed'), project: projectRefSchema }),
    z.strictObject({ type: z.literal('action-launched'), actionId: actionIdSchema }),
    z.strictObject({
      type: z.literal('automation-override-started'),
      target: ticketRefSchema,
      stage: z.enum(['classification', 'wayfinder']),
    }),
  ]),
)
export const commandOutcomeSchema = requestDataSchema.pipe(
  z
    .discriminatedUnion('ok', [
      z.strictObject({
        ok: z.literal(true),
        result: commandResultSchema,
        state: applicationStateSchema,
      }),
      z.strictObject({
        ok: z.literal(false),
        error: safeErrorSchema,
        state: applicationStateSchema,
      }),
    ])
    .superRefine((outcome, ctx) => {
      if (!outcome.ok || outcome.result.type !== 'configuration-updated') return
      const state = outcome.state
      const saved = state.phase === 'ready' ? state : 'retained' in state ? state.retained : null
      if (saved === null || outcome.result.configurationVersion !== saved.configurationVersion) {
        ctx.addIssue({
          code: 'custom',
          path: ['result', 'configurationVersion'],
          message:
            'The configuration result must match the ready or retained saved configuration version.',
        })
      }
    }),
)
export type SafeError = z.output<typeof safeErrorSchema>
export type QueryResult = z.output<typeof queryResultSchema>
export type CommandResult = z.output<typeof commandResultSchema>
export type CommandOutcome = z.output<typeof commandOutcomeSchema>

const commandResultFamilies = {
  'begin-github-authorization': 'authorization-started',
  'retry-github-authorization': 'authorization-started',
  'cancel-github-authorization': 'authorization-cancelled',
  'rename-connection': 'configuration-updated',
  'remove-connection': 'configuration-updated',
  'register-project': 'configuration-updated',
  'rename-project': 'configuration-updated',
  'repair-project-workspace': 'configuration-updated',
  'remove-project': 'configuration-updated',
  'set-automation-enabled': 'configuration-updated',
  'set-project-automation-enabled': 'configuration-updated',
  'start-automation-override': 'automation-override-started',
  'refresh-project': 'project-refreshed',
  'launch-action': 'action-launched',
} as const satisfies Record<Command['type'], CommandResult['type']>
export type CommandResultFor<C extends Command> = Extract<
  CommandResult,
  { type: (typeof commandResultFamilies)[C['type']] }
>
export function commandResultFor(command: Command, result: CommandResult): boolean {
  if (commandResultFamilies[command.type] !== result.type) return false
  switch (result.type) {
    case 'configuration-updated':
      return true
    case 'authorization-started':
      return (
        command.type !== 'retry-github-authorization' || command.operationId === result.operationId
      )
    case 'authorization-cancelled':
      return (
        command.type === 'cancel-github-authorization' && command.operationId === result.operationId
      )
    case 'project-refreshed':
      return (
        command.type === 'refresh-project' &&
        command.project.integration === result.project.integration &&
        command.project.projectId === result.project.projectId
      )
    case 'action-launched':
      return command.type === 'launch-action' && command.actionId === result.actionId
    case 'automation-override-started':
      return (
        command.type === 'start-automation-override' &&
        command.target.map.project.integration === result.target.map.project.integration &&
        command.target.map.project.projectId === result.target.map.project.projectId &&
        command.target.map.mapId === result.target.map.mapId &&
        command.target.ticketId === result.target.ticketId &&
        command.stage === result.stage
      )
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}
