import { z } from 'zod'
import { actionIdSchema } from '../identity.ts'
import { requestDataSchema } from './request-data.ts'

const absoluteHttpUrlSchema = z.url({ protocol: /^https?$/ })

export const hrefSchema = z.string().refine(
  (href) => {
    if (!/^(?:https?:\/\/[^\s\\]+|\/(?![/\\])[^\s\\]*)$/.test(href)) return false
    if (href.startsWith('/')) return true
    return absoluteHttpUrlSchema.safeParse(href).success && !/^https?:\/\/[^/?#]*@/.test(href)
  },
  { message: 'A destination must be a credential-free HTTP URL or absolute application path.' },
)
export const linkActionSchema = requestDataSchema.pipe(
  z.strictObject({
    id: actionIdSchema,
    label: z.string(),
    kind: z.enum(['roadmap', 'external-link']),
    href: hrefSchema,
  }),
)
export const serverLaunchActionSchema = requestDataSchema.pipe(
  z.strictObject({
    id: actionIdSchema,
    label: z.string(),
    kind: z.literal('server-launch'),
    operation: z.enum(['open-workspace', 'open-terminal', 'reveal-source']),
  }),
)
export const projectActionSchema = requestDataSchema.pipe(
  z.union([linkActionSchema, serverLaunchActionSchema]),
)
export type LinkAction = z.output<typeof linkActionSchema>
export type ServerLaunchAction = z.output<typeof serverLaunchActionSchema>
export type ProjectAction = z.output<typeof projectActionSchema>
