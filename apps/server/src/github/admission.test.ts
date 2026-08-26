import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ProjectRegistration, ProjectRegistrationCandidate } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import type { RoadmapConfiguration } from '../application/configuration.ts'
import { createGitHubProjectAdmission } from './admission.ts'
import { type GitHubClient, GitHubError } from './client.ts'
import type { GitHubConnectionPort } from './connections.ts'
import type { RepositoryIdentity } from './repository.ts'

const execFileAsync = promisify(execFile)

const REPOSITORY: RepositoryIdentity = {
  id: '42',
  nameWithOwner: 'Acme/Roadmap',
  visibility: 'private',
}
const UPSTREAM: RepositoryIdentity = {
  id: '99',
  nameWithOwner: 'Upstream/Roadmap',
  visibility: 'public',
}

const CONFIGURATION: RoadmapConfiguration = {
  schemaVersion: 4,
  configurationVersion: 1,
  connections: [
    {
      id: 'github-one',
      integration: 'github',
      name: 'Work',
      builtIn: false,
      githubIdentity: { id: '7', login: 'octocat' },
    },
  ],
  projects: [],
  automation: { enabled: false, enabledProjects: [] },
}

function github(): GitHubConnectionPort {
  return {
    integration: {
      integration: 'github',
      name: 'GitHub',
      connectionKind: 'device-authorization',
      newInstallationUrl: 'https://github.com/apps/roadmap/installations/new',
      installationsUrl: 'https://github.com/settings/installations',
      authorizationsUrl: 'https://github.com/settings/connections/applications/client',
    },
    beginDeviceAuthorization: async () => {
      throw new Error('not used')
    },
    pollDeviceAuthorization: async () => ({ status: 'pending' }),
    identify: async () => ({ id: '7', login: 'octocat' }),
    refresh: async () => {
      throw new Error('not used')
    },
  }
}

function registration(overrides: Partial<ProjectRegistration> = {}): ProjectRegistration {
  return {
    key: { integration: 'github', id: 'client-supplied' },
    connectionId: 'github-one',
    locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'stale/name' },
    workspace: { path: '/chosen/path' },
    ...overrides,
  }
}
function candidate(
  overrides: Partial<ProjectRegistrationCandidate> = {},
): ProjectRegistrationCandidate {
  return {
    integration: 'github',
    connectionId: 'github-one',
    workspace: { path: '/chosen/path' },
    ...overrides,
  }
}

function repositoryClient(repositories: RepositoryIdentity[] = [REPOSITORY]): GitHubClient {
  return {
    graphql: async () => {
      throw new Error('not used')
    },
    restGet: async <T>(path: string) => {
      const match = /^\/repos\/([^/]+)\/([^/]+)$/.exec(path)
      const nameWithOwner = match
        ? `${decodeURIComponent(match[1] ?? '')}/${decodeURIComponent(match[2] ?? '')}`
        : ''
      const repository = repositories.find(
        (candidate) =>
          candidate.nameWithOwner.toLocaleLowerCase() === nameWithOwner.toLocaleLowerCase(),
      )
      if (!repository) throw new Error('not accessible')
      return {
        id: repository.id,
        full_name: repository.nameWithOwner,
        private: repository.visibility === 'private',
      } as T
    },
  }
}

describe('GitHub Project admission', () => {
  it('derives canonical repository identity from the selected Workspace', async () => {
    const admission = createGitHubProjectAdmission({
      github: github(),
      createClient: () => repositoryClient([REPOSITORY, UPSTREAM]),
      inspectWorkspace: async () => ({
        path: '/canonical/workspace',
        remotes: [
          { name: 'origin', nameWithOwner: 'Acme/Roadmap' },
          { name: 'upstream', nameWithOwner: 'Upstream/Roadmap' },
        ],
      }),
    })

    const result = await admission.admit(
      candidate({ displayName: '  My project  ' }),
      CONFIGURATION,
      {
        accessToken: async () => 'secret',
      },
    )

    expect(result).toEqual({
      ok: true,
      registration: {
        key: { integration: 'github', id: 'Acme/Roadmap' },
        connectionId: 'github-one',
        locator: {
          integration: 'github',
          repositoryId: '42',
          nameWithOwner: 'Acme/Roadmap',
        },
        workspace: { path: '/canonical/workspace', gitIdentity: '42' },

        displayName: 'My project',
      },
    })
  })
  it('reads repository identity from an actual Git origin remote', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'roadmap-github-admission-'))
    const canonicalWorkspace = await realpath(workspace)
    try {
      await execFileAsync('/usr/bin/git', ['-C', workspace, 'init'])
      await execFileAsync('/usr/bin/git', [
        '-C',
        workspace,
        'remote',
        'add',
        'origin',
        'git@github.com:Acme/Roadmap.git',
      ])
      await execFileAsync('/usr/bin/git', [
        '-C',
        workspace,
        'remote',
        'add',
        'upstream',
        'https://github.com/Upstream/Roadmap.git',
      ])
      const admission = createGitHubProjectAdmission({
        github: github(),
        createClient: () => repositoryClient([REPOSITORY, UPSTREAM]),
      })

      const result = await admission.admit(
        candidate({ workspace: { path: workspace } }),
        CONFIGURATION,
        { accessToken: async () => 'secret' },
      )

      expect(result).toMatchObject({
        ok: true,
        registration: {
          locator: { repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
          workspace: { path: canonicalWorkspace, gitIdentity: '42' },
        },
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects duplicate and inaccessible Workspace repositories before persistence', async () => {
    const existing = registration({
      key: { integration: 'github', id: 'existing' },
      locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
      workspace: { path: '/other' },
    })
    const duplicate = createGitHubProjectAdmission({
      github: github(),
      inspectWorkspace: async () => ({
        path: '/canonical',
        remotes: [{ name: 'origin', nameWithOwner: 'Acme/Roadmap' }],
      }),
    })
    await expect(
      duplicate.admit(
        candidate(),
        { ...CONFIGURATION, projects: [existing] },
        {
          accessToken: async () => 'secret',
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { field: 'workspace.path', code: 'admission-failed' },
    })

    const mismatched = createGitHubProjectAdmission({
      github: github(),
      createClient: () => ({
        graphql: async () => {
          throw new Error('not used')
        },
        restGet: async () => {
          throw new GitHubError('GET failed', 404)
        },
      }),
      inspectWorkspace: async () => ({
        path: '/canonical',
        remotes: [{ name: 'origin', nameWithOwner: 'other/repository' }],
      }),
    })
    await expect(
      mismatched.admit(candidate(), CONFIGURATION, { accessToken: async () => 'secret' }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        field: 'workspace.path',
        code: 'admission-failed',
        message:
          'The selected Connection cannot access this Workspace repository. Install Roadmap for that repository on GitHub, then try again.',
      },
    })
  })

  it('repairs to a canonical Workspace only when it proves the same repository id', async () => {
    const existing = registration({
      key: { integration: 'github', id: 'stable/route' },
      locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
      workspace: { path: '/missing', gitIdentity: '42' },
    })

    const admission = createGitHubProjectAdmission({
      github: github(),
      createClient: () => repositoryClient(),
      inspectWorkspace: async () => ({
        path: '/moved',
        remotes: [{ name: 'origin', nameWithOwner: 'Acme/Roadmap' }],
      }),
    })

    await expect(
      admission.repair(
        {
          type: 'repair-project-workspace',
          project: existing.key,
          workspace: { path: '/candidate' },
          expectedConfigurationVersion: 1,
        },
        { ...CONFIGURATION, projects: [existing] },
        { accessToken: async () => 'secret' },
      ),
    ).resolves.toEqual({ ok: true, workspace: { path: '/moved', gitIdentity: '42' } })
  })
  it('adds a stable suffix only when the readable route key is already occupied', async () => {
    const occupied = registration({
      key: { integration: 'github', id: 'Acme/Roadmap' },
      locator: { integration: 'github', repositoryId: '99', nameWithOwner: 'old/repository' },
      workspace: { path: '/existing' },
    })
    const admission = createGitHubProjectAdmission({
      github: github(),
      createClient: () => repositoryClient(),
      inspectWorkspace: async () => ({
        path: '/new',
        remotes: [{ name: 'origin', nameWithOwner: 'Acme/Roadmap' }],
      }),
    })

    const result = await admission.admit(
      candidate(),
      { ...CONFIGURATION, projects: [occupied] },
      { accessToken: async () => 'secret' },
    )

    expect(result).toMatchObject({
      ok: true,
      registration: { key: { integration: 'github', id: 'Acme/Roadmap~42' } },
    })
  })
})
