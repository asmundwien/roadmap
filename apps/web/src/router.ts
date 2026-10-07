import type { ProjectKey, WayfinderMap } from '@roadmap/contracts'
import { generatePath, matchPath } from 'react-router'

export const routePaths = {
  overview: '/',
  connections: '/connections',
  connection: '/connections/:connectionId',
  projectImport: '/connections/:connectionId/projects/import',
  project: '/projects/:integration/:projectId',
  projectSettings: '/projects/:integration/:projectId/settings',
  map: '/projects/:integration/:projectId/maps/:mapId',
  ticket: '/projects/:integration/:projectId/maps/:mapId/tickets/:ticketId',
  components: '/components',
} as const

export function pathParams(pattern: string, pathname: string): Record<string, string | undefined> {
  const match = matchPath(pattern, pathname)
  if (!match) return {}
  try {
    return Object.fromEntries(
      Object.entries(match.params).map(([name, value]) => [
        name,
        value === undefined ? undefined : decodeURIComponent(value),
      ]),
    )
  } catch (error) {
    if (error instanceof URIError) return {}
    throw error
  }
}

export function projectPath(project: ProjectKey): string {
  return generatePath(routePaths.project, {
    integration: project.integration,
    projectId: project.id,
  })
}

export function projectSettingsPath(project: ProjectKey): string {
  return `${projectPath(project)}/settings`
}

export function connectionPath(connectionId: string): string {
  return generatePath(routePaths.connection, { connectionId })
}

export function projectImportPath(connectionId: string): string {
  return `${connectionPath(connectionId)}/projects/import`
}

export function mapPath(map: Pick<WayfinderMap, 'project' | 'id'>): string {
  return `${projectPath(map.project)}${generatePath('/maps/:mapId', { mapId: map.id })}`
}

export function ticketPath(map: Pick<WayfinderMap, 'project' | 'id'>, ticketId: string): string {
  return `${mapPath(map)}${generatePath('/tickets/:ticketId', { ticketId })}`
}
