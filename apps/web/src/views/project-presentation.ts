import type {
  ApplicationState,
  AutomationEvidence,
  Connection,
  ProjectKey,
  RegisteredProject,
  Ticket,
  WayfinderMap,
  WayfinderSession,
} from '@roadmap/contracts'
import { stripInlineMarkdown } from './gist.ts'

export type ProjectJourney = 'active' | 'resting' | 'waiting'

export interface ProjectPresentation {
  project: RegisteredProject
  connection: Connection | null
  journey: ProjectJourney
  activeMap: WayfinderMap | null
  destination: string
  mapCount: number
  decisions: number
  openTickets: number
  hasFog: boolean
  priorities: string[]
  activityAt?: number
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
      connectionId: string
    }
  | {
      kind: 'project'
      key: string
      title: string
      detail: string
      project: ProjectKey
    }

export interface ProjectPortfolio {
  projects: ProjectPresentation[]
  active: ProjectPresentation[]
  resting: ProjectPresentation[]
  waiting: ProjectPresentation[]
  attention: AttentionItem[]
}

type PresentationState = Pick<ApplicationState, 'connections' | 'projects' | 'configuration'>

/**
 * The registration-led interpretation shared by the Overview and Project settings. Source facts
 * stay on the Project; this projection owns only presentation precedence and grouping.
 */
export function presentProjects(state: PresentationState): ProjectPortfolio {
  const connections = new Map(state.connections.map((connection) => [connection.id, connection]))
  const projects = state.projects.map((project) => presentProject(project, connections))
  const active = projects
    .filter((project) => project.journey === 'active')
    .sort((left, right) => (right.activityAt ?? 0) - (left.activityAt ?? 0))
  const resting = projects.filter((project) => project.journey === 'resting')
  const waiting = projects.filter((project) => project.journey === 'waiting')

  return {
    projects,
    active,
    resting,
    waiting,
    attention: [
      ...configurationAttention(state),
      ...connectionAttention(state.connections, projects),
      ...projectAttention(projects),
    ],
  }
}

function presentProject(
  project: RegisteredProject,
  connections: ReadonlyMap<string, Connection>,
): ProjectPresentation {
  const activeMap = project.openMaps[0] ?? null
  const maps = [...project.openMaps, ...project.closedMaps]
  const latestClosed = project.closedMaps[0]
  const destination = activeMap
    ? stripInlineMarkdown(activeMap.body.destination) || activeMap.title || 'Untitled map'
    : ''

  return {
    project,
    connection: connections.get(project.connectionId) ?? null,
    journey: activeMap ? 'active' : maps.length === 0 ? 'waiting' : 'resting',
    activeMap,
    destination,
    mapCount: maps.length,
    decisions: maps.reduce((sum, map) => sum + map.progress.completed, 0),
    openTickets: activeMap ? activeMap.progress.total - activeMap.progress.completed : 0,
    hasFog: Boolean(
      activeMap &&
        (activeMap.body.notYetSpecified.length > 0 || activeMap.body.notYetSpecifiedNote !== ''),
    ),
    priorities:
      activeMap?.frontier.map(
        (ticket) => ticket.title ?? ticket.displayId ?? `Ticket ${ticket.id}`,
      ) ?? [],
    activityAt: activeMap?.updatedAt ?? latestClosed?.closedAt ?? latestClosed?.updatedAt,
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
    const { project, connection } = presentation
    const items: AttentionItem[] = []
    if (project.availability.status === 'unavailable') {
      items.push({
        kind: 'project',
        key: `project:${project.key.integration}:${project.key.id}:availability`,
        title: `${project.name} is unavailable`,
        detail: connection
          ? `${connection.name}: ${project.availability.cause}`
          : project.availability.cause,
        project: project.key,
      })
    }
    if (project.warnings.length > 0) {
      items.push({
        kind: 'project',
        key: `project:${project.key.integration}:${project.key.id}:warnings`,
        title: `${project.name} has ${project.warnings.length === 1 ? 'a warning' : `${project.warnings.length} warnings`}`,
        detail: project.warnings.join(' '),
        project: project.key,
      })
    }
    return items
  })
}

export type AutomationLifecycle = 'active' | 'terminal'

export interface AutomationStageSummary {
  active: number
  terminal: number
}

export interface AutomationTicketPresentation {
  evidence: AutomationEvidence
  project: RegisteredProject | null
  map: WayfinderMap | null
  ticket: Ticket | null
  classification: AutomationLifecycle
  wayfinder: AutomationLifecycle | null
}

export interface AutomationSummary {
  classification: AutomationStageSummary
  wayfinder: AutomationStageSummary
  tickets: AutomationTicketPresentation[]
}

export interface ProjectAutomationPresentation {
  project: RegisteredProject
  summary: AutomationSummary
}

export interface AutomationPresentation {
  global: AutomationSummary
  projects: ProjectAutomationPresentation[]
}

type AutomationPresentationState = {
  projects: readonly RegisteredProject[]
  automation: { evidence: readonly AutomationEvidence[] }
}

/**
 * Summarizes durable Automation evidence without interpreting tracker state. A stage is active only
 * while its process is live; every other recorded outcome is terminal, including unknown outcomes.
 */
export function presentAutomation(state: AutomationPresentationState): AutomationPresentation {
  const projects = state.projects.map((project) => ({ project, summary: emptyAutomationSummary() }))
  const byProject = new Map(
    projects.map((presentation) => [projectKey(presentation.project.key), presentation]),
  )
  const global = emptyAutomationSummary()

  for (const evidence of state.automation.evidence) {
    const projectPresentation = byProject.get(projectKey(evidence.target.project))
    const project = projectPresentation?.project ?? null
    const map = project ? findMap(project, evidence.target.mapId) : null
    const ticket =
      map?.tickets.find((candidate) => candidate.id === evidence.target.ticketId) ?? null
    const entry: AutomationTicketPresentation = {
      evidence,
      project,
      map,
      ticket,
      classification: evidence.classification.status === 'running' ? 'active' : 'terminal',
      wayfinder: evidence.wayfinder ? wayfinderLifecycle(evidence.wayfinder.status) : null,
    }

    addAutomationEvidence(global, entry)
    if (projectPresentation) addAutomationEvidence(projectPresentation.summary, entry)
  }

  return { global, projects }
}

function emptyAutomationSummary(): AutomationSummary {
  return {
    classification: { active: 0, terminal: 0 },
    wayfinder: { active: 0, terminal: 0 },
    tickets: [],
  }
}

function addAutomationEvidence(
  summary: AutomationSummary,
  entry: AutomationTicketPresentation,
): void {
  summary.classification[entry.classification] += 1
  if (entry.wayfinder) summary.wayfinder[entry.wayfinder] += 1
  summary.tickets.push(entry)
}

function wayfinderLifecycle(status: WayfinderSession['status']): AutomationLifecycle {
  return status === 'launching' || status === 'running' ? 'active' : 'terminal'
}

function findMap(project: RegisteredProject, mapId: string): WayfinderMap | null {
  return (
    project.openMaps.find((candidate) => candidate.id === mapId) ??
    project.closedMaps.find((candidate) => candidate.id === mapId) ??
    null
  )
}

function projectKey(project: ProjectKey): string {
  return `${project.integration}:${project.id}`
}
