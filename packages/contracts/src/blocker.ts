import { z } from 'zod'
import { requestDataSchema } from './internal/request-data.ts'

const projectKeySchema = requestDataSchema.pipe(
  z.strictObject({
    integration: z.enum(['github', 'local']),
    id: z.string(),
  }),
)

const blockerReferenceSchema = requestDataSchema.pipe(
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('registered'), project: projectKeySchema }),
    z.strictObject({
      kind: z.literal('external'),
      integration: z.literal('github'),
      nameWithOwner: z.string(),
      repositoryId: z.string().optional(),
    }),
    z.strictObject({ kind: z.literal('unresolved'), locator: z.string() }),
  ]),
)

/** Browser-safe blocker evidence. Only registered references carry admitted project identity. */
export const blockerSchema = requestDataSchema.pipe(
  z.strictObject({
    reference: blockerReferenceSchema,
    ticketId: z.string(),
    displayId: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    state: z.enum(['open', 'closed', 'unknown']),
  }),
)

export type Blocker = z.output<typeof blockerSchema>
