import { z } from 'zod'
import { requestDataSchema } from './internal/request-data.ts'

export const integrationSchema = z.enum(['local', 'github'])
export const connectionIdSchema = z.string().brand<'ConnectionId'>()
export const projectIdSchema = z.string().brand<'ProjectId'>()
export const mapIdSchema = z.string().brand<'MapId'>()
export const ticketIdSchema = z.string().brand<'TicketId'>()
export const authorizationOperationIdSchema = z.string().brand<'AuthorizationOperationId'>()
export const actionIdSchema = z.string().brand<'ActionId'>()
export const serverEpochSchema = z.string().brand<'ServerEpoch'>()
export const stateSequenceSchema = z.number().int().nonnegative().safe().brand<'StateSequence'>()
export const configurationVersionSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .brand<'ConfigurationVersion'>()
export const correlationIdSchema = z.string().brand<'CorrelationId'>()

export const localProjectRefSchema = requestDataSchema.pipe(
  z.strictObject({ integration: z.literal('local'), projectId: projectIdSchema }),
)
export const githubProjectRefSchema = requestDataSchema.pipe(
  z.strictObject({ integration: z.literal('github'), projectId: projectIdSchema }),
)
export const projectRefSchema = requestDataSchema.pipe(
  z.strictObject({ integration: integrationSchema, projectId: projectIdSchema }),
)
export const mapRefSchema = requestDataSchema.pipe(
  z.strictObject({ project: projectRefSchema, mapId: mapIdSchema }),
)
export const ticketRefSchema = requestDataSchema.pipe(
  z.strictObject({ map: mapRefSchema, ticketId: ticketIdSchema }),
)

export type Integration = z.output<typeof integrationSchema>
export type ConnectionId = z.output<typeof connectionIdSchema>
export type ProjectId = z.output<typeof projectIdSchema>
export type MapId = z.output<typeof mapIdSchema>
export type TicketId = z.output<typeof ticketIdSchema>
export type AuthorizationOperationId = z.output<typeof authorizationOperationIdSchema>
export type ActionId = z.output<typeof actionIdSchema>
export type ServerEpoch = z.output<typeof serverEpochSchema>
export type StateSequence = z.output<typeof stateSequenceSchema>
export type ConfigurationVersion = z.output<typeof configurationVersionSchema>
export type CorrelationId = z.output<typeof correlationIdSchema>
export type ProjectRef = z.output<typeof projectRefSchema>
export type LocalProjectRef = z.output<typeof localProjectRefSchema>
export type GitHubProjectRef = z.output<typeof githubProjectRefSchema>
export type MapRef = z.output<typeof mapRefSchema>
export type TicketRef = z.output<typeof ticketRefSchema>
