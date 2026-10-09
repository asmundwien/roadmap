import { githubProject, validLocalProject } from './inputs.ts'
export const candidate = { ...validLocalProject, ref: githubProject } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').Project
