import {
  type ConnectionId,
  connectionIdSchema,
  type MapRef,
  mapRefSchema,
  type ProjectRef,
  projectRefSchema,
  type TicketRef,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
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

export function projectRoute(
  pattern: string,
  pathname: string,
): {
  project: ProjectRef
  map: MapRef | null
  ticket: TicketRef | null
} | null {
  const params = pathParams(pattern, pathname)
  const project = projectRefSchema.safeParse({
    integration: params.integration,
    projectId: params.projectId,
  })
  if (!project.success) return null
  const map =
    params.mapId === undefined
      ? null
      : mapRefSchema.parse({ project: project.data, mapId: params.mapId })
  const ticket =
    params.ticketId === undefined || map === null
      ? null
      : ticketRefSchema.parse({ map, ticketId: params.ticketId })
  return { project: project.data, map, ticket }
}

export function connectionRoute(pattern: string, pathname: string): ConnectionId | null {
  const parsed = connectionIdSchema.safeParse(pathParams(pattern, pathname).connectionId)
  return parsed.success ? parsed.data : null
}

export function projectPath(project: ProjectRef): string {
  return generatePath(routePaths.project, {
    integration: project.integration,
    projectId: project.projectId,
  })
}

export function projectSettingsPath(project: ProjectRef): string {
  return `${projectPath(project)}/settings`
}

export function connectionPath(connectionId: ConnectionId): string {
  return generatePath(routePaths.connection, { connectionId })
}

export function projectImportPath(connectionId: ConnectionId): string {
  return `${connectionPath(connectionId)}/projects/import`
}

export function mapPath(map: MapRef): string {
  return `${projectPath(map.project)}${generatePath('/maps/:mapId', { mapId: map.mapId })}`
}

export function ticketPath(ticket: TicketRef): string {
  return `${mapPath(ticket.map)}${generatePath('/tickets/:ticketId', { ticketId: ticket.ticketId })}`
}
