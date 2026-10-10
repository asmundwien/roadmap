import { z } from 'zod'
import { actionIdSchema, projectRefSchema } from '../identity.ts'
import { strictDataObject } from './request-data.ts'

const absoluteHttpUrlSchema = z.url({ protocol: /^https?$/ })
export const projectOperationSchema = z.enum(['open-workspace', 'open-terminal', 'reveal-source'])
export type ProjectOperation = z.output<typeof projectOperationSchema>

export const hrefSchema = z.string().refine(
  (href) => {
    if (!/^(?:https?:\/\/[^\s\\]+|\/(?![/\\])[^\s\\]*)$/.test(href)) return false
    if (href.startsWith('/')) return true
    return absoluteHttpUrlSchema.safeParse(href).success && !/^https?:\/\/[^/?#]*@/.test(href)
  },
  { message: 'A destination must be a credential-free HTTP URL or absolute application path.' },
)
const roadmapHrefSchema = hrefSchema.refine((href) => href.startsWith('/'), {
  message: 'A Roadmap action requires an absolute application path.',
})
const externalHrefSchema = hrefSchema.refine((href) => /^https?:\/\//.test(href), {
  message: 'An external action requires a credential-free HTTP URL.',
})
export const linkActionSchema = z.union([
  strictDataObject({
    id: actionIdSchema,
    label: z.string(),
    kind: z.literal('roadmap'),
    href: roadmapHrefSchema,
  }),
  strictDataObject({
    id: actionIdSchema,
    label: z.string(),
    kind: z.literal('external-link'),
    href: externalHrefSchema,
  }),
])
export const serverLaunchActionSchema = strictDataObject({
  id: actionIdSchema,
  label: z.string(),
  kind: z.literal('server-launch'),
  project: projectRefSchema,
  operation: projectOperationSchema,
})
export const projectActionSchema = z.union([linkActionSchema, serverLaunchActionSchema])
export type LinkAction = z.output<typeof linkActionSchema>
export type ServerLaunchAction = z.output<typeof serverLaunchActionSchema>
export type ProjectAction = z.output<typeof projectActionSchema>
