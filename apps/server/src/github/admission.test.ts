import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type {
  AdmissionRuntime,
  GitHubConnection,
  GitHubProjectIntent,
  GitHubProviderRead,
  ProjectAdmissionRequest,
} from '../projects/registry.ts'
import { createGitHubProjectAdmission } from './admission.ts'
import { GitHubError } from './client.ts'

const execFileAsync = promisify(execFile)
const CONNECTION: GitHubConnection = {
  id: 'github-one',
  integration: 'github',
  name: 'Work',
  builtIn: false,
  githubIdentity: { id: '7', login: 'octocat' },
}
const INTENT: GitHubProjectIntent = {
  ref: { integration: 'github', projectId: 'stable/route' },
  connectionId: CONNECTION.id,
  locator: { repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
  workspace: { path: '/missing' },
}

function request(path: string): ProjectAdmissionRequest {
  return { integration: 'github', connection: CONNECTION, path }
}

function repositoryClient(): GitHubProviderRead {
  return {
    graphql: async () => {
      throw new Error('not used')
    },
    restGet: async (path) => {
      if (path === '/repos/Acme/Roadmap' || path === '/repositories/42') {
        return { id: 42, full_name: 'Acme/Roadmap' }
      }
      if (path === '/repos/Upstream/Roadmap' || path === '/repositories/99') {
        return { id: 99, full_name: 'Upstream/Roadmap' }
      }
      throw new GitHubError({ kind: 'access-ambiguous', evidence: 'http-404' }, 404)
    },
  }
}

function runtime(access: GitHubProviderRead = repositoryClient()): AdmissionRuntime {
  return { github: async () => ({ connectionId: CONNECTION.id, accountId: '7', access }) }
}

async function withWorkspace(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), 'roadmap-github-admission-'))
  try {
    await execFileAsync('/usr/bin/git', ['-C', path, 'init'])
    await execFileAsync('/usr/bin/git', [
      '-C',
      path,
      'remote',
      'add',
      'origin',
      'git@github.com:Acme/Roadmap.git',
    ])
    await execFileAsync('/usr/bin/git', [
      '-C',
      path,
      'remote',
      'add',
      'upstream',
      'https://github.com/Upstream/Roadmap.git',
    ])
    await run(path)
  } finally {
    await rm(path, { recursive: true, force: true })
  }
}

describe('GitHub Project admission', () => {
  it('uses the actual Git origin and selected Connection to produce canonical repository evidence', async () => {
    await withWorkspace(async (path) => {
      const access = repositoryClient()
      const result = await createGitHubProjectAdmission({}).admit(request(path), runtime(access))

      expect(result).toEqual({
        integration: 'github',
        source: {
          ok: true,
          value: { connectionId: CONNECTION.id, accountId: '7', repositoryId: '42', access },
        },
        workspace: {
          ok: true,
          value: {
            integration: 'github',
            path: await realpath(path),
            readable: true,
            searchable: true,
            worktreeRoot: true,
            matchedRepositoryId: '42',
            verifiedConnectionId: CONNECTION.id,
            nameWithOwner: 'Acme/Roadmap',
          },
        },
        locator: { repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
      })
    })
  })

  it('does not claim worktree-root evidence for a directory inside the actual Git worktree', async () => {
    await withWorkspace(async (path) => {
      const nested = join(path, 'nested')
      await mkdir(nested)
      await expect(
        createGitHubProjectAdmission({}).admit(request(nested), runtime()),
      ).resolves.toMatchObject({
        integration: 'github',
        workspace: { ok: false, error: { code: 'admission-failed', field: 'workspace.path' } },
      })
    })
  })

  it('does not claim repository access when the provider cannot verify the origin through the selected Connection', async () => {
    await withWorkspace(async (path) => {
      const access: GitHubProviderRead = {
        graphql: async () => {
          throw new Error('not used')
        },
        restGet: async () => {
          throw new GitHubError({ kind: 'access-ambiguous', evidence: 'http-404' }, 404)
        },
      }
      await expect(
        createGitHubProjectAdmission({}).admit(request(path), runtime(access)),
      ).resolves.toMatchObject({
        integration: 'github',
        source: { ok: false },
        workspace: { ok: false, error: { code: 'admission-failed', field: 'workspace.path' } },
      })
    })
  })

  it('repairs a moved actual worktree only when a remote identifies the recorded repository id', async () => {
    await withWorkspace(async (path) => {
      const admission = createGitHubProjectAdmission({})
      const repair = { intent: INTENT, connection: CONNECTION, path }
      await expect(admission.repair(repair, runtime())).resolves.toMatchObject({
        integration: 'github',
        source: { ok: true, value: { repositoryId: '42', connectionId: CONNECTION.id } },
        workspace: {
          ok: true,
          value: {
            path: await realpath(path),
            matchedRepositoryId: '42',
            verifiedConnectionId: CONNECTION.id,
          },
        },
      })
      await expect(
        admission.repair(
          {
            ...repair,
            intent: {
              ...INTENT,
              locator: { repositoryId: '123', nameWithOwner: 'Other/Repository' },
            },
          },
          runtime(),
        ),
      ).resolves.toMatchObject({
        integration: 'github',
        workspace: { ok: false, error: { code: 'admission-failed', field: 'workspace.path' } },
      })
    })
  })

  it('retains Connection-bound source access when the saved Workspace cannot be inspected', async () => {
    const access = repositoryClient()
    const admission = createGitHubProjectAdmission({
      inspectWorkspace: async () => {
        throw new Error('missing worktree')
      },
    })
    await expect(
      admission.revalidate(
        {
          intent: INTENT,
          connection: CONNECTION,
          path: '/missing',
        },
        runtime(access),
      ),
    ).resolves.toMatchObject({
      integration: 'github',
      source: {
        ok: true,
        value: { connectionId: CONNECTION.id, accountId: '7', repositoryId: '42', access },
      },
      workspace: {
        ok: false,
        error: {
          code: 'admission-failed',
          field: 'workspace.path',
        },
      },
    })
  })

  it('rejects runtime access bound to another Connection or canonical account', async () => {
    await withWorkspace(async (path) => {
      for (const binding of [
        { connectionId: 'github-other', accountId: '7' },
        { connectionId: CONNECTION.id, accountId: 'other-account' },
      ]) {
        const mismatched: AdmissionRuntime = {
          github: async () => ({ ...binding, access: repositoryClient() }),
        }
        await expect(
          createGitHubProjectAdmission({}).admit(request(path), mismatched),
        ).resolves.toMatchObject({
          integration: 'github',
          source: { ok: false, error: { code: 'authorization-failed', field: 'connectionId' } },
          workspace: { ok: false },
        })
      }
    })
  })

  it('keeps authorization failure separate from successful source or Workspace evidence', async () => {
    await withWorkspace(async (path) => {
      const unavailable: AdmissionRuntime = {
        github: async () => {
          throw new Error('private credential failure')
        },
      }
      await expect(
        createGitHubProjectAdmission({}).admit(request(path), unavailable),
      ).resolves.toMatchObject({
        integration: 'github',
        source: { ok: false, error: { code: 'authorization-failed', field: 'connectionId' } },
        workspace: { ok: false },
      })
    })
  })
})
