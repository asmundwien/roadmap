import type { ConnectionId, ProjectRef } from '@roadmap/contracts/identity'
import type {
  Connection,
  MapResource,
  Project,
  ReadyApplicationState,
} from '@roadmap/contracts/state'
import { stripInlineMarkdown } from '@/views/shared/gist'
import { orderedMaps, resourceMessage, resourceObservation } from '@/views/shared/resource-results'

type ProjectJourney = 'active' | 'resting' | 'waiting' | 'uncertain'

export interface ProjectPresentation {
  project: Project
  connection: Connection | null
  journey: ProjectJourney
  activeMap: MapResource | null
  destination: string
  mapCount: number | null
  decisions: number | null
  openTickets: number | null
  hasFog: boolean
  priorities: string[]
  activityAt?: number
  sourceMessage: string
}

export type AttentionItem =
  | {
      kind: 'configuration'
      key: string
      title: string
      detail: string
    }
  | {
      kind: 'connection'
      key: string
      title: string
      detail: string
      connectionId: ConnectionId
    }
  | {
      kind: 'project'
      key: string
      title: string
      detail: string
      project: ProjectRef
    }

export interface ProjectPortfolio {
  projects: ProjectPresentation[]
  active: ProjectPresentation[]
  resting: ProjectPresentation[]
  waiting: ProjectPresentation[]
  uncertain: ProjectPresentation[]
  attention: AttentionItem[]
}

type PresentationState = Pick<ReadyApplicationState, 'connections' | 'projects' | 'configuration'>

/** Derives presentation without establishing resource membership or active ordering. */
export function presentProjects(state: PresentationState): ProjectPortfolio {
  const connections = new Map(state.connections.map((connection) => [connection.id, connection]))
  const projects = state.projects.map((project) => presentProject(project, connections))
  const active = projects
    .filter((project) => project.journey === 'active')
    .sort((left, right) => (right.activityAt ?? 0) - (left.activityAt ?? 0))
  const resting = projects.filter((project) => project.journey === 'resting')
  const waiting = projects.filter((project) => project.journey === 'waiting')
  const uncertain = projects.filter((project) => project.journey === 'uncertain')

  return {
    projects,
    active,
    resting,
    waiting,
    uncertain,
    attention: [
      ...configurationAttention(state),
      ...connectionAttention(state.connections, projects),
      ...projectAttention(projects),
    ],
  }
}

function presentProject(
  project: Project,
  connections: ReadonlyMap<string, Connection>,
): ProjectPresentation {
  const ordered = orderedMaps(project)
  const activeMapId =
    project.activeMap.kind === 'known-current' ? project.activeMap.ref.mapId : null
  const activeMap =
    activeMapId === null
      ? null
      : (project.maps.find((map) => map.ref.mapId === activeMapId) ?? null)
  const active = activeMap ? resourceObservation(activeMap.resource)?.value : undefined
  const latestClosed = ordered.closed[0]
  const closed = latestClosed ? resourceObservation(latestClosed.resource)?.value : undefined
  const membership = project.mapsMembership
  const complete = membership.kind === 'current-complete'
  const currentMaps = complete
    ? membership.observation.value.members.map((key) =>
        project.maps.find((map) => map.ref.mapId === key.mapId),
      )
    : null
  const decisions =
    currentMaps?.reduce<number | null>((sum, map) => {
      if (sum === null || !map || map.resource.kind !== 'current-readable') return null
      const observation = map.resource.observation
      if (observation.completeness.kind !== 'complete' || observation.value.progress === null)
        return null
      return sum + observation.value.progress.completed
    }, 0) ?? null
  const journey: ProjectJourney =
    project.activeMap.kind === 'uncertain'
      ? 'uncertain'
      : activeMap
        ? 'active'
        : currentMaps?.length === 0
          ? 'waiting'
          : 'resting'
  return {
    project,
    connection: connections.get(project.connectionId) ?? null,
    journey,
    activeMap,
    destination: active
      ? stripInlineMarkdown(active.body.destination) || active.title || 'Untitled map'
      : '',
    mapCount: currentMaps?.length ?? null,
    decisions,
    openTickets: active
      ? active.progress === null
        ? null
        : active.progress.total - active.progress.completed
      : project.activeMap.kind === 'known-empty'
        ? 0
        : null,
    hasFog: Boolean(
      active && (active.body.notYetSpecified.length > 0 || active.body.notYetSpecifiedNote !== ''),
    ),
    priorities:
      activeMap?.frontier.flatMap((ref) => {
        const ticket = activeMap.tickets.find((ticket) => ticket.ref.ticketId === ref.ticketId)
        if (ticket?.resource.kind !== 'current-readable') return []
        const value = ticket.resource.observation.value
        return [value.title ?? value.displayId ?? `Ticket ${ref.ticketId}`]
      }) ?? [],
    activityAt: active?.updatedAt ?? closed?.closedAt ?? closed?.updatedAt,
    sourceMessage: resourceMessage(project.resource),
  }
}

function configurationAttention(state: PresentationState): AttentionItem[] {
  if (state.configuration.valid) return []
  const detail = state.configuration.issues.map((issue) => issue.message).join(' ')
  return [
    {
      kind: 'configuration',
      key: 'configuration',
      title: 'Configuration needs attention',
      detail: detail || 'Roadmap is keeping the last valid configuration until this is repaired.',
    },
  ]
}

function connectionAttention(
  connections: readonly Connection[],
  projects: readonly ProjectPresentation[],
): AttentionItem[] {
  return connections.flatMap((connection): AttentionItem[] => {
    if (connection.availability.status === 'available') return []
    const dependents = projects
      .filter((project) => project.project.connectionId === connection.id)
      .map((project) => project.project.name)
    const dependencyDetail =
      dependents.length === 0
        ? 'No registered Projects currently depend on it.'
        : connection.availability.status === 'degraded'
          ? `Last-good data is retained for: ${dependents.join(', ')}.`
          : `Affected Projects: ${dependents.join(', ')}.`
    const authorizationRequired = connection.availability.status === 'authorization-required'
    const degraded = connection.availability.status === 'degraded'
    return [
      {
        kind: 'connection',
        key: `connection:${connection.id}`,
        title: authorizationRequired
          ? `${connection.name} needs authorization`
          : degraded
            ? `${connection.name} observations are stale`
            : `${connection.name} is unavailable`,
        detail: `${connection.availability.cause} ${dependencyDetail}`,
        connectionId: connection.id,
      },
    ]
  })
}

function projectAttention(projects: readonly ProjectPresentation[]): AttentionItem[] {
  return projects.flatMap((presentation): AttentionItem[] => {
    const { project, sourceMessage } = presentation
    const items: AttentionItem[] = []
    if (project.resource.kind !== 'current-readable' || project.activeMap.kind === 'uncertain') {
      items.push({
        kind: 'project',
        key: JSON.stringify([project.ref.integration, project.ref.projectId, 'source']),
        title: `${project.name} source needs attention`,
        detail: `${sourceMessage}${project.activeMap.kind === 'uncertain' ? ` ${project.activeMap.cause}` : ''}`,
        project: project.ref,
      })
    }
    const warnings = [
      ...(resourceObservation(project.resource)?.value.warnings ?? []),
      ...project.managementWarnings,
    ]
    if (warnings.length > 0) {
      items.push({
        kind: 'project',
        key: JSON.stringify([project.ref.integration, project.ref.projectId, 'warnings']),
        title: `${project.name} has warnings`,
        detail: warnings.join(' '),
        project: project.ref,
      })
    }
    return items
  })
}
