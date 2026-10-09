import { validLocalProject } from './inputs.ts'
export const candidate = {
  ...validLocalProject,
  source: {
    integration: 'github',
    repositoryId: 'repo',
    nameWithOwner: 'owner/repo',
    url: 'https://github.com/owner/repo',
  },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').Project
