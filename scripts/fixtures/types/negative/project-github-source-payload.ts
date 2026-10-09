import { validGitHubProject } from './inputs.ts'
export const candidate = {
  ...validGitHubProject,
  source: { integration: 'github', url: 'https://github.com/owner/repo' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').Project
