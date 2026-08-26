import { basename } from 'node:path'
import type { ProjectRegistration, SafeError } from '@roadmap/contracts'
import type { AdmissionPort } from '../application/application.ts'
import { inspectLocalWorkspace, type LocalWorkspace } from './workspace.ts'

export interface LocalAdmissionOptions {
  inspectWorkspace?: (path: string) => Promise<LocalWorkspace>
}

export function createLocalProjectAdmission(options: LocalAdmissionOptions = {}): AdmissionPort {
  const inspectWorkspace = options.inspectWorkspace ?? inspectLocalWorkspace

  return {
    async admit(candidate, configuration) {
      if (candidate.integration !== 'local') {
        return failed('integration', 'This admission path accepts only Local Projects.')
      }
      const connection = configuration.connections.find(
        (connection) => connection.id === candidate.connectionId,
      )
      if (connection?.integration !== 'local' || !connection.builtIn) {
        return failed('connectionId', 'The built-in Local Connection does not exist.')
      }

      const inspected = await inspectReadable(
        candidate.workspace.path,
        'workspace.path',
        inspectWorkspace,
      )
      if (!inspected.ok) return inspected
      if (hasWorkspace(configuration.projects, inspected.value.path)) {
        return failed('workspace.path', 'That folder is already registered.')
      }

      return {
        ok: true,
        registration: {
          key: {
            integration: 'local',
            id: availableProjectId(basename(inspected.value.path), configuration.projects),
          },
          connectionId: connection.id,
          locator: { integration: 'local', path: inspected.value.path },
          workspace: inspected.value,
          ...optionalDisplayName(candidate.displayName),
        },
      }
    },

    async repair(command, configuration) {
      const registration = configuration.projects.find((project) =>
        sameProject(project.key, command.project),
      )
      if (registration?.locator.integration !== 'local') {
        return failed('project', 'Local Project does not exist.')
      }
      if (!registration.workspace.gitIdentity) {
        return failed(
          'workspace.path',
          'This Local Project has no recorded Git identity. Remove it and register the new folder.',
        )
      }

      const inspected = await inspectReadable(
        command.workspace.path,
        'workspace.path',
        inspectWorkspace,
      )
      if (!inspected.ok) return inspected
      if (inspected.value.gitIdentity !== registration.workspace.gitIdentity) {
        return failed('workspace.path', 'That folder does not have the registered Git identity.')
      }
      if (hasWorkspace(configuration.projects, inspected.value.path, registration)) {
        return failed('workspace.path', 'That Workspace is already registered.')
      }
      return { ok: true, workspace: inspected.value }
    },
  }
}

async function inspectReadable(
  path: string,
  field: string,
  inspectWorkspace: (path: string) => Promise<LocalWorkspace>,
): Promise<{ ok: true; value: LocalWorkspace } | { ok: false; error: SafeError }> {
  try {
    return { ok: true, value: await inspectWorkspace(path) }
  } catch {
    return failed(field, 'Choose a readable local folder.')
  }
}

function availableProjectId(folderName: string, projects: readonly ProjectRegistration[]): string {
  const base = folderName.trim() || 'local-project'
  const occupied = new Set(
    projects
      .filter((project) => project.key.integration === 'local')
      .map((project) => project.key.id.toLocaleLowerCase()),
  )
  if (!occupied.has(base.toLocaleLowerCase())) return base
  let sequence = 2
  while (occupied.has(`${base}-${sequence}`.toLocaleLowerCase())) sequence += 1
  return `${base}-${sequence}`
}

function hasWorkspace(
  projects: readonly ProjectRegistration[],
  path: string,
  except?: ProjectRegistration,
): boolean {
  return projects.some(
    (project) =>
      project !== except && canonicalPath(project.workspace.path) === canonicalPath(path),
  )
}

function optionalDisplayName(displayName: string | undefined): { displayName?: string } {
  const normalized = displayName?.trim()
  return normalized ? { displayName: normalized } : {}
}

function sameProject(
  first: ProjectRegistration['key'],
  second: ProjectRegistration['key'],
): boolean {
  return first.integration === second.integration && first.id === second.id
}

function canonicalPath(path: string): string {
  return process.platform === 'darwin' ? path.toLocaleLowerCase() : path
}

function failed(field: string, message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'admission-failed', field, message } }
}
