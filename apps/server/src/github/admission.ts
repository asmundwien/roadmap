import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { ProjectRegistration, SafeError, Workspace } from '@roadmap/contracts'
import type { AdmissionPort } from '../application/application.ts'
import { createGitHubClient, type GitHubClient, GitHubError } from './client.ts'
import type { GitHubConnectionPort } from './connections.ts'
import { type RepositoryIdentity, readRepositoryByName } from './repository.ts'

const execFileAsync = promisify(execFile)

interface WorkspaceRemote {
  name: string
  nameWithOwner: string
}

interface WorkspaceIdentity {
  path: string
  remotes: WorkspaceRemote[]
}

export interface GitHubAdmissionOptions {
  github: GitHubConnectionPort
  createClient?: (accessToken: string) => GitHubClient
  inspectWorkspace?: (path: string) => Promise<WorkspaceIdentity>
}

export function createGitHubProjectAdmission(options: GitHubAdmissionOptions): AdmissionPort {
  const createClient =
    options.createClient ?? ((accessToken) => createGitHubClient({ token: accessToken }))
  const inspectWorkspace = options.inspectWorkspace ?? inspectGitWorkspace

  return {
    async admit(candidate, configuration, runtime) {
      if (candidate.integration !== 'github') {
        return failed('integration', 'This admission path accepts only GitHub Projects.')
      }
      const connection = configuration.connections.find(
        (connection) => connection.id === candidate.connectionId,
      )
      if (connection?.integration !== 'github') {
        return failed('connectionId', 'GitHub Connection does not exist.')
      }

      let inspected: WorkspaceIdentity
      try {
        inspected = await inspectWorkspace(candidate.workspace.path)
      } catch {
        return failed('workspace.path', 'Workspace must be a readable Git worktree root.')
      }
      if (hasWorkspace(configuration.projects, inspected.path)) {
        return failed('workspace.path', 'That Workspace is already registered.')
      }

      const accessToken = await authorizedToken(runtime.accessToken, connection.id)
      if (!accessToken.ok) return accessToken
      const repository = await repositoryFromWorkspace(inspected, accessToken.value, createClient)
      if (!repository.ok) return repository
      if (hasRepository(configuration.projects, repository.value.id)) {
        return failed('workspace.path', 'That GitHub repository is already registered.')
      }

      const normalized: ProjectRegistration = {
        key: {
          integration: 'github',
          id: availableProjectId(
            repository.value.nameWithOwner,
            repository.value.id,
            configuration.projects,
          ),
        },
        connectionId: connection.id,
        locator: {
          integration: 'github',
          repositoryId: repository.value.id,
          nameWithOwner: repository.value.nameWithOwner,
        },
        workspace: { path: inspected.path, gitIdentity: repository.value.id },
        ...optionalDisplayName(candidate.displayName),
      }
      return { ok: true, registration: normalized }
    },

    async repair(command, configuration, runtime) {
      const registration = configuration.projects.find(
        (project) =>
          project.key.integration === command.project.integration &&
          project.key.id === command.project.id,
      )
      if (registration?.locator.integration !== 'github') {
        return failed('project', 'GitHub Project does not exist.')
      }
      const connection = configuration.connections.find(
        (candidate) => candidate.id === registration.connectionId,
      )
      if (connection?.integration !== 'github') {
        return failed('connectionId', 'GitHub Connection does not exist.')
      }
      const accessToken = await authorizedToken(runtime.accessToken, connection.id)
      if (!accessToken.ok) return accessToken
      const workspace = await validWorkspace(
        command.workspace.path,
        registration.locator.repositoryId,
        accessToken.value,
        createClient,
        inspectWorkspace,
      )
      if (!workspace.ok) return workspace
      if (
        configuration.projects.some(
          (project) =>
            project !== registration &&
            canonicalPath(project.workspace.path) === canonicalPath(workspace.value.path),
        )
      ) {
        return failed('workspace.path', 'That Workspace is already registered.')
      }
      return { ok: true, workspace: workspace.value }
    },
  }
}

async function repositoryFromWorkspace(
  workspace: WorkspaceIdentity,
  accessToken: string,
  createClient: (accessToken: string) => GitHubClient,
): Promise<{ ok: true; value: RepositoryIdentity } | { ok: false; error: SafeError }> {
  const origin = workspace.remotes.filter((remote) => remote.name.toLocaleLowerCase() === 'origin')
  const candidates = origin.length > 0 ? origin : workspace.remotes
  const repositories = new Map<string, RepositoryIdentity>()
  const client = createClient(accessToken)
  let inaccessible = false
  for (const remote of candidates) {
    try {
      const repository = await readRepositoryByName(client, remote.nameWithOwner)
      repositories.set(repository.id, repository)
    } catch (error) {
      inaccessible ||= error instanceof GitHubError && error.status === 404
      // Another remote may be accessible. Raw GitHub errors stay private.
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

async function validWorkspace(
  requestedPath: string,
  repositoryId: string,
  accessToken: string,
  createClient: (accessToken: string) => GitHubClient,
  inspectWorkspace: (path: string) => Promise<WorkspaceIdentity>,
): Promise<{ ok: true; value: Workspace } | { ok: false; error: SafeError }> {
  let workspace: WorkspaceIdentity
  try {
    workspace = await inspectWorkspace(requestedPath)
  } catch {
    return failed('workspace.path', 'Workspace must be a readable Git worktree root.')
  }

  const client = createClient(accessToken)
  for (const remote of workspace.remotes) {
    try {
      const repository = await readRepositoryByName(client, remote.nameWithOwner)
      if (repository.id === repositoryId) {
        return { ok: true, value: { path: workspace.path, gitIdentity: repositoryId } }
      }
    } catch {
      // Another remote may be the registered repository. Raw Git and GitHub errors stay private.
    }
  }
  return failed('workspace.path', 'Workspace Git remotes do not identify this GitHub repository.')
}

async function authorizedToken(
  accessToken: (connectionId: string) => Promise<string>,
  connectionId: string,
): Promise<{ ok: true; value: string } | { ok: false; error: SafeError }> {
  try {
    return { ok: true, value: await accessToken(connectionId) }
  } catch {
    return {
      ok: false,
      error: {
        code: 'authorization-failed',
        field: 'connectionId',
        message: 'GitHub authorization is unavailable for this Connection.',
      },
    }
  }
}

async function inspectGitWorkspace(path: string): Promise<WorkspaceIdentity> {
  const canonical = await realpath(path)
  const metadata = await stat(canonical)
  if (!metadata.isDirectory()) throw new Error('not a directory')
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
      const key = `${remote}\0${nameWithOwner?.toLocaleLowerCase()}`
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

function availableProjectId(
  nameWithOwner: string,
  repositoryId: string,
  projects: readonly ProjectRegistration[],
): string {
  const occupied = new Set(
    projects
      .filter((project) => project.key.integration === 'github')
      .map((project) => project.key.id.toLocaleLowerCase()),
  )
  if (!occupied.has(nameWithOwner.toLocaleLowerCase())) return nameWithOwner
  const suffix = repositoryId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'repository'
  let candidate = `${nameWithOwner}~${suffix}`
  let sequence = 2
  while (occupied.has(candidate.toLocaleLowerCase())) {
    candidate = `${nameWithOwner}~${suffix}-${sequence}`
    sequence += 1
  }

  return candidate
}
function hasRepository(projects: readonly ProjectRegistration[], repositoryId: string): boolean {
  return projects.some(
    (project) =>
      project.locator.integration === 'github' && project.locator.repositoryId === repositoryId,
  )
}

function hasWorkspace(projects: readonly ProjectRegistration[], path: string): boolean {
  return projects.some((project) => canonicalPath(project.workspace.path) === canonicalPath(path))
}

function optionalDisplayName(displayName: string | undefined): { displayName?: string } {
  const normalized = displayName?.trim()
  return normalized ? { displayName: normalized } : {}
}

function canonicalPath(path: string): string {
  return process.platform === 'darwin' ? path.toLocaleLowerCase() : path
}

function failed(field: string, message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'admission-failed', field, message } }
}
