import { z } from 'zod'
import { ticketIdSchema, ticketRefSchema } from './identity.ts'
import { hrefSchema } from './internal/actions.ts'
import { requestDataSchema } from './internal/request-data.ts'

const blockerReferenceSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('registered'), ticket: ticketRefSchema }),
    z.strictObject({
      kind: z.literal('external'),
      integration: z.literal('github'),
      nameWithOwner: z.string(),
      repositoryId: z.string().optional(),
      ticketId: ticketIdSchema,
    }),
    z.strictObject({
      kind: z.literal('unresolved'),
      locator: z.string(),
      ticketId: ticketIdSchema,
    }),
  ]),
)

/** Reference scope and observed blocker state are independent facts. */
export const blockerSchema = requestDataSchema.pipe(
  z.strictObject({
    reference: blockerReferenceSchema,
    displayId: z.string().optional(),
    title: z.string().optional(),
    url: hrefSchema.optional(),
    state: z.enum(['open', 'closed', 'unknown']),
  }),
)
export type Blocker = z.output<typeof blockerSchema>
export type BlockerState = Blocker['state']
