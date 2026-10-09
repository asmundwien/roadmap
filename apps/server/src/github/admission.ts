import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import type {
  AdmissionFailure,
  AdmissionOutcome,
  AdmissionRuntime,
  EvidenceResult,
  GitHubConnection,
  GitHubConnectionAccess,
  GitHubProviderRead,
  GitHubSourceAccessEvidence,
  GitHubWorkspaceInspection,
  ProjectAdmission,
  ProjectRevalidationRequest,
} from '../projects/registry.ts'
import { GitHubAccessError } from '../projects/registry.ts'
import { GitHubError } from './client.ts'
import { type RepositoryIdentity, readRepositoryByName } from './repository.ts'

const execFileAsync = promisify(execFile)

interface WorkspaceRemote {
  name: string
  nameWithOwner: string
}

interface GitHubWorktreeInspection {
  path: string
  remotes: WorkspaceRemote[]
}

export interface GitHubAdmissionOptions {
  inspectWorkspace?: (path: string) => Promise<GitHubWorktreeInspection>
}

type GitHubOutcome = Extract<AdmissionOutcome, { integration: 'github' }>

/** Translates inspected worktrees and Connection-bound access into registry evidence. */
export function createGitHubProjectAdmission(
  options: GitHubAdmissionOptions = {},
): ProjectAdmission {
  const inspectWorkspace = options.inspectWorkspace ?? inspectGitWorkspace

  async function inspectExpected(
    request: ProjectRevalidationRequest,
    runtime: AdmissionRuntime,
  ): Promise<GitHubOutcome> {
    const { intent, connection } = request
    if (
      !('locator' in intent) ||
      connection.integration !== 'github' ||
      intent.connectionId !== connection.id
    ) {
      return unavailable('connectionId', 'GitHub Project and Connection do not agree.')
    }
    const authorized = await authorizedAccess(connection, runtime)
    const source: EvidenceResult<GitHubSourceAccessEvidence> = authorized.ok
      ? { ok: true, value: { ...authorized.value, repositoryId: intent.locator.repositoryId } }
      : authorized
    // Source authority is independent of worktree access. No repository/content preflight is
    // needed to admit the actual stable-ID provider observation.
    const workspace = await expectedWorkspace(
      request.path,
      intent.locator.repositoryId,
      authorized,
      inspectWorkspace,
    )
    return {
      integration: 'github',
      source,
      workspace,
      ...(workspace.ok
        ? {
            locator: {
              repositoryId: workspace.value.matchedRepositoryId,
              nameWithOwner: workspace.value.nameWithOwner,
            },
          }
        : {}),
    }
  }

  return {
    async admit(request, runtime) {
      const connection = request.connection
      if (request.integration !== 'github' || connection.integration !== 'github') {
        return unavailable('integration', 'This admission path accepts only GitHub Projects.')
      }
      const authorized = await authorizedAccess(connection, runtime)
      if (!authorized.ok)
        return { integration: 'github', source: authorized, workspace: authorized }
      let inspected: GitHubWorktreeInspection
      try {
        inspected = await inspectWorkspace(request.path)
      } catch {
        return unavailable('workspace.path', 'Workspace must be a readable Git worktree root.')
      }
      const repository = await repositoryFromWorkspace(inspected, authorized.value.access)
      if (!repository.ok)
        return { integration: 'github', source: repository, workspace: repository }
      return {
        integration: 'github',
        source: { ok: true, value: { ...authorized.value, repositoryId: repository.value.id } },
        workspace: {
          ok: true,
          value: workspaceEvidence(inspected.path, connection.id, repository.value),
        },
        locator: {
          repositoryId: repository.value.id,
          nameWithOwner: repository.value.nameWithOwner,
        },
      }
    },
    repair: inspectExpected,
    revalidate: inspectExpected,
  }
}

async function repositoryFromWorkspace(
  workspace: GitHubWorktreeInspection,
  client: GitHubProviderRead,
): Promise<EvidenceResult<RepositoryIdentity>> {
  const origin = workspace.remotes.filter((remote) => remote.name.toLowerCase() === 'origin')
  const candidates = origin.length > 0 ? origin : workspace.remotes
  const repositories = new Map<string, RepositoryIdentity>()
  let inaccessible = false
  for (const remote of candidates) {
    try {
      const repository = await readRepositoryByName(client, remote.nameWithOwner)
      repositories.set(repository.id, repository)
    } catch (error) {
      inaccessible ||= error instanceof GitHubError && error.status === 404
    }
  }
  if (repositories.size === 0) {
    return failed(
      'workspace.path',
      inaccessible
        ? 'The selected Connection cannot access this Workspace repository. Install Roadmap for that repository on GitHub, then try again.'
        : 'GitHub could not verify this Workspace repository through the selected Connection.',
    )
  }
  if (repositories.size > 1) {
    return failed(
      'workspace.path',
      'Workspace Git remotes identify more than one repository through this Connection.',
    )
  }
  const repository = repositories.values().next().value
  return repository
    ? { ok: true, value: repository }
    : failed('workspace.path', 'Workspace Git remote could not be resolved.')
}

async function expectedWorkspace(
  path: string,
  repositoryId: string,
  authorized: EvidenceResult<GitHubConnectionAccess>,
  inspectWorkspace: (path: string) => Promise<GitHubWorktreeInspection>,
): Promise<GitHubOutcome['workspace']> {
  let workspace: GitHubWorktreeInspection
  try {
    workspace = await inspectWorkspace(path)
  } catch {
    return failed('workspace.path', 'Workspace must be a readable Git worktree root.')
  }
  if (!authorized.ok) return { ...authorized, canonicalOccupancyPath: workspace.path }
  for (const remote of workspace.remotes) {
    try {
      const repository = await readRepositoryByName(authorized.value.access, remote.nameWithOwner)
      if (repository.id === repositoryId) {
        return {
          ok: true,
          value: workspaceEvidence(workspace.path, authorized.value.connectionId, repository),
        }
      }
    } catch {
      // A different remote may prove the admitted stable repository. Provider errors stay private.
    }
  }
  return {
    ...failed('workspace.path', 'Workspace Git remotes do not identify this GitHub repository.'),
    canonicalOccupancyPath: workspace.path,
  }
}

function workspaceEvidence(
  path: string,
  connectionId: string,
  repository: RepositoryIdentity,
): GitHubWorkspaceInspection {
  return {
    integration: 'github',
    path,
    readable: true,
    searchable: true,
    worktreeRoot: true,
    matchedRepositoryId: repository.id,
    verifiedConnectionId: connectionId,
    nameWithOwner: repository.nameWithOwner,
  }
}

async function authorizedAccess(
  connection: GitHubConnection,
  runtime: AdmissionRuntime,
): Promise<EvidenceResult<GitHubConnectionAccess>> {
  try {
    const value = await runtime.github(connection)
    if (value.accountId !== connection.githubIdentity.id) {
      throw new GitHubAccessError('account-mismatch')
    }
    if (
      value.connectionId !== connection.id ||
      typeof value.access?.restGet !== 'function' ||
      typeof value.access.graphql !== 'function'
    ) {
      throw new GitHubAccessError('unavailable')
    }
    return { ok: true, value }
  } catch (error) {
    const failure =
      error instanceof GitHubAccessError ? error : new GitHubAccessError('unavailable')
    return {
      ok: false,
      error: {
        code: 'authorization-failed',
        field: 'connectionId',
        message: failure.message,
        githubAccessFailure: failure.failure,
      },
    }
  }
}

async function inspectGitWorkspace(path: string): Promise<GitHubWorktreeInspection> {
  const canonical = await realpath(path)
  const metadata = await stat(canonical)
  if (!metadata.isDirectory()) throw new Error('not a directory')
  await access(canonical, constants.R_OK | constants.X_OK)
  const { stdout: rootOutput } = await execFileAsync('/usr/bin/git', [
    '-C',
    canonical,
    'rev-parse',
    '--show-toplevel',
  ])
  const root = await realpath(rootOutput.trim())
  if (root !== canonical) throw new Error('not the worktree root')

  const { stdout: remoteOutput } = await execFileAsync('/usr/bin/git', ['-C', canonical, 'remote'])
  const remotes: WorkspaceRemote[] = []
  const seen = new Set<string>()
  for (const remote of remoteOutput
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)) {
    const { stdout } = await execFileAsync('/usr/bin/git', [
      '-C',
      canonical,
      'remote',
      'get-url',
      '--all',
      remote,
    ])
    for (const url of stdout.split('\n')) {
      const nameWithOwner = githubNameFromRemote(url.trim())
      const key = `${remote}\0${nameWithOwner?.toLowerCase()}`
      if (nameWithOwner && !seen.has(key)) {
        seen.add(key)
        remotes.push({ name: remote, nameWithOwner })
      }
    }
  }
  if (remotes.length === 0) throw new Error('no GitHub remote')
  return { path: canonical, remotes }
}

function githubNameFromRemote(value: string): string | null {
  const match =
    /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(
      value,
    )
  return match?.[1] ?? null
}

function failed(field: string, message: string): { ok: false; error: AdmissionFailure } {
  return { ok: false, error: { code: 'admission-failed', field, message } }
}

function unavailable(field: string, message: string): GitHubOutcome {
  const failure = failed(field, message)
  return { integration: 'github', source: failure, workspace: failure }
}
