import { z } from 'zod'

import { requestDataSchema } from './internal/request-data.ts'

const projectKeySchema = requestDataSchema.pipe(
  z.strictObject({
    integration: z.enum(['github', 'local']),
    id: z.string(),
  }),
)
const workspaceSchema = requestDataSchema.pipe(
  z.strictObject({ path: z.string(), gitIdentity: z.string().optional() }),
)
const registrationCandidateSchema = requestDataSchema.pipe(
  z.strictObject({
    integration: z.enum(['github', 'local']),
    connectionId: z.string(),
    workspace: requestDataSchema.pipe(z.strictObject({ path: z.string() })),
    displayName: z.string().optional(),
  }),
)
const automationTargetSchema = requestDataSchema.pipe(
  z.strictObject({
    project: projectKeySchema,
    mapId: z.string(),
    ticketId: z.string(),
  }),
)
const version = { expectedConfigurationVersion: z.number().int().nonnegative() }

export const querySchema = requestDataSchema.pipe(
  z.discriminatedUnion('type', [z.strictObject({ type: z.literal('select-workspace') })]),
)

export const commandSchema = requestDataSchema.pipe(
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('begin-github-authorization'),
      ...version,
      name: z.string(),
      connectionId: z.string().optional(),
    }),
    z.strictObject({
      type: z.literal('cancel-github-authorization'),
      ...version,
      operationId: z.string(),
    }),
    z.strictObject({
      type: z.literal('retry-github-authorization'),
      ...version,
      operationId: z.string(),
    }),
    z.strictObject({
      type: z.literal('rename-connection'),
      ...version,
      connectionId: z.string(),
      name: z.string(),
    }),
    z.strictObject({
      type: z.literal('remove-connection'),
      ...version,
      connectionId: z.string(),
    }),
    z.strictObject({
      type: z.literal('register-project'),
      ...version,
      candidate: registrationCandidateSchema,
    }),
    z.strictObject({
      type: z.literal('rename-project'),
      ...version,
      project: projectKeySchema,
      name: z.string(),
    }),
    z.strictObject({
      type: z.literal('repair-project-workspace'),
      ...version,
      project: projectKeySchema,
      workspace: workspaceSchema,
    }),
    z.strictObject({
      type: z.literal('remove-project'),
      ...version,
      project: projectKeySchema,
    }),
    z.strictObject({ type: z.literal('set-automation-enabled'), ...version, enabled: z.boolean() }),
    z.strictObject({
      type: z.literal('set-project-automation-enabled'),
      ...version,
      project: projectKeySchema,
      enabled: z.boolean(),
    }),
    z.strictObject({
      type: z.literal('start-automation-override'),
      ...version,
      target: automationTargetSchema,
      stage: z.enum(['classification', 'wayfinder']),
    }),
    z.strictObject({ type: z.literal('refresh-project'), ...version, project: projectKeySchema }),
    z.strictObject({
      type: z.literal('launch-action'),
      ...version,
      actionId: z.string(),
      project: projectKeySchema.optional(),
    }),
  ]),
)

export type Query = z.output<typeof querySchema>
export type Command = z.output<typeof commandSchema>
