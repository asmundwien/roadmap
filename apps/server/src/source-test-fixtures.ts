import { dirname, join, resolve } from 'node:path'
import type {
  MapResource,
  MapResourceValue,
  ProjectKey,
  ProjectResourceValue,
  RegisteredProject,
  TicketResource,
  TicketResourceValue,
} from '@roadmap/contracts'
import type {
  ObservationAttempt,
  ObservationBatch,
  SourceObservationHealth,
  SourceObserver,
  SourceProjectContent,
  SourceProjectKey,
  SourceProvenance,
  SourceTicketContent,
} from './observation/source.ts'
import { createReadSequenceAllocator } from './observation/source.ts'
import type {
  GitHubProjectIntent,
  GitHubProviderRead,
  LocalProjectIntent,
  ProjectAdmission,
} from './projects/registry.ts'

export type FixtureTicket = Omit<TicketResourceValue, 'source' | 'status'> & {
  id: string
  url?: string
  sourcePath?: string
}
export type FixtureMap = Omit<MapResourceValue, 'source' | 'status'> & {
  project: ProjectKey
  id: string
  isOpen: boolean
  url?: string
  sourcePath?: string
  tickets: FixtureTicket[]
  frontier: FixtureTicket[]
  ticketsComplete: boolean
}
export type FixtureProject = Pick<ProjectResourceValue, 'name' | 'warnings'> & {
  key: ProjectKey
  openMaps: FixtureMap[]
  closedMaps: FixtureMap[]
  sourcePath?: string
  sourceUrl?: string
}
export type FixtureSnapshot = {
  capturedAt: number
  projects: FixtureProject[]
  unreachable: {
    integration: ProjectKey['integration']
    project: ProjectKey
    projectName?: string
    mapId?: string
    mapDisplayId?: string
    mapTitle?: string
    reason: string
  }[]
}

export function publicProjectObservation(project: RegisteredProject) {
  switch (project.resource.kind) {
    case 'current-readable':
      return project.resource.observation
    case 'retained-unavailable':
      return project.resource.lastSuccessful
    case 'proven-absent':
      return project.resource.trace.kind === 'last-successful-trace'
        ? project.resource.trace.lastSuccessful
        : null
    case 'never-observed':
      return null
  }
}
export function publicMapResource(
  project: RegisteredProject,
  mapId: string,
): MapResource | undefined {
  return project.maps.find((map) => map.key.mapId === mapId)
}
export function publicMapObservation(map: MapResource) {
  switch (map.resource.kind) {
    case 'current-readable':
      return map.resource.observation
    case 'retained-unavailable':
      return map.resource.lastSuccessful
    case 'proven-absent':
      return map.resource.trace.kind === 'last-successful-trace'
        ? map.resource.trace.lastSuccessful
        : null
    case 'never-observed':
      return null
  }
}
export function publicTicketResource(
  map: MapResource,
  ticketId: string,
): TicketResource | undefined {
  return map.tickets.find((ticket) => ticket.key.ticketId === ticketId)
}
export function publicTicketObservation(ticket: TicketResource) {
  switch (ticket.resource.kind) {
    case 'current-readable':
      return ticket.resource.observation
    case 'retained-unavailable':
      return ticket.resource.lastSuccessful
    case 'proven-absent':
      return ticket.resource.trace.kind === 'last-successful-trace'
        ? ticket.resource.trace.lastSuccessful
        : null
    case 'never-observed':
      return null
  }
}

type FixtureConfiguration = {
  readonly projects: readonly (
    | LocalProjectIntent
    | Pick<GitHubProjectIntent, 'ref' | 'connectionId' | 'locator'>
  )[]
}

// These counters model one test source owner's reads, never production resource authority.
export function createFixtureReadSequence(): () => number {
  return createReadSequenceAllocator()
}

export function createSourceFixtureOwner() {
  const nextReadSequence = createFixtureReadSequence()
  return Object.assign(
    (
      projects: readonly FixtureProject[],
      observedAt: number,
      configuration?: FixtureConfiguration,
    ) => sourceFixture(projects, observedAt, { nextReadSequence, configuration }),
    { nextReadSequence },
  )
}

// Construct fresh simulated reads with the caller's explicit owner-local allocator.
function sourceFixture(
  projects: readonly FixtureProject[],
  observedAt: number,
  options: { nextReadSequence: () => number; configuration?: FixtureConfiguration },
): ObservationBatch {
  const { nextReadSequence, configuration } = options
  const attempts: ObservationAttempt[] = []
  for (const project of projects) {
    const registration = configuration?.projects.find(
      (intent) =>
        intent.ref.integration === project.key.integration &&
        intent.ref.projectId === project.key.id,
    )
    let source: SourceProjectContent['source']
    if (project.key.integration === 'local') {
      source = {
        integration: 'local',
        path: resolve(
          project.sourcePath ??
            (registration && 'workspace' in registration
              ? registration.workspace.path
              : undefined) ??
            `/tmp/${project.key.id}`,
        ),
      }
    } else {
      if (!registration || !('locator' in registration))
        throw new Error('Test GitHub Project requires its configured repository binding.')
      source = {
        integration: 'github',
        repositoryId: registration.locator.repositoryId,
        nameWithOwner: project.name,
        url: project.sourceUrl ?? `https://github.com/${project.name}`,
      }
    }
    const provenance = (
      path: string | undefined,
      operation: Extract<SourceProvenance, { integration: 'local' }>['operation'],
      stage: Extract<SourceProvenance, { integration: 'github' }>['stage'],
    ): SourceProvenance => {
      if (source.integration === 'local') {
        if (!path) throw new Error('Test Local scope requires an explicit source path.')
        return { integration: 'local', path: resolve(path), operation }
      }
      if (!registration) throw new Error('Test GitHub Project requires its configured Connection.')
      return {
        integration: 'github',
        connectionId: registration.connectionId,
        repositoryId: source.repositoryId,
        stage,
      }
    }
    const common = {
      kind: 'observed',
      attemptedAt: observedAt,
      observedAt,
      provenance: provenance(
        source.integration === 'local' ? source.path : undefined,
        'inspect-root',
        'repository',
      ),
      completeness: { kind: 'complete' },
    } as const
    attempts.push({
      ...common,
      readSequence: nextReadSequence(),
      scope: { kind: 'project', project: project.key },
      value: { key: project.key, name: project.name, source, warnings: project.warnings },
    })
    const maps = [...project.openMaps, ...project.closedMaps]
    attempts.push({
      ...common,
      readSequence: nextReadSequence(),
      provenance: provenance(
        source.integration === 'local' ? join(source.path, '.wayfinder') : undefined,
        'enumerate',
        'map-list',
      ),
      scope: { kind: 'maps-membership', project: project.key },
      value: { members: maps.map((map) => ({ project: project.key, mapId: map.id })) },
    })
    for (const map of maps) {
      const key = { project: project.key, mapId: map.id }
      const destination = mapSource(map)
      attempts.push(
        {
          ...common,
          readSequence: nextReadSequence(),
          provenance: provenance(
            destination.kind === 'file' ? destination.path : undefined,
            'read',
            'map-read',
          ),
          scope: { kind: 'map', map: key },
          value: {
            key,
            displayId: map.displayId,
            title: map.title,
            source: destination,
            status: map.isOpen ? 'open' : 'closed',
            updatedAt: map.updatedAt,
            closedAt: map.closedAt,
            body: map.body,
            progress: map.progress,
            unidentifiedTickets: [],
            warnings: map.warnings,
          },
        },
        {
          ...common,
          readSequence: nextReadSequence(),
          provenance: provenance(
            source.integration === 'local'
              ? join(dirname(resolve(source.path, map.id)), 'tickets')
              : undefined,
            'enumerate',
            'map-read',
          ),
          scope: { kind: 'tickets-membership', map: key },
          completeness: map.ticketsComplete
            ? { kind: 'complete' }
            : { kind: 'incomplete', reason: 'unreadable' },
          value: { members: map.tickets.map((ticket) => ({ map: key, ticketId: ticket.id })) },
        },
      )
      for (const ticket of map.tickets) {
        const ticketKey = { map: key, ticketId: ticket.id }
        const destination = ticketSource(ticket)
        const ticketProvenance = provenance(
          destination.kind === 'file' ? destination.path : undefined,
          'read',
          'map-read',
        )
        attempts.push({
          ...common,
          readSequence: nextReadSequence(),
          provenance: ticketProvenance,
          scope: { kind: 'ticket', ticket: ticketKey },
          value: {
            key: ticketKey,
            displayId: ticket.displayId,
            title: ticket.title,
            source: destination,
            body: ticket.body,
            typeEvidence: ticket.typeEvidence,
            status: ticket.state === 'closed' ? 'closed' : 'open',
            isClaimed: ticket.isClaimed,
            createdAt: ticket.createdAt,
            closedAt: ticket.closedAt,
            assignees: ticket.assignees,
            blockedBy: ticket.blockedBy.map((blocker) => ({
              reference: { ...blocker.reference, ticketId: blocker.ticketId },
              displayId: blocker.displayId,
              title: blocker.title,
              url: blocker.url,
              state: blocker.state,
              provenance: ticketProvenance,
            })),
            blockersComplete: ticket.blockersComplete,
            warnings: ticket.warnings,
          },
        })
      }
    }
  }
  return { attempts }
}

function mapSource(
  map: FixtureMap,
): { kind: 'file'; path: string } | { kind: 'issue'; url: string } {
  if (map.sourcePath) return { kind: 'file', path: map.sourcePath }
  if (map.url) return { kind: 'issue', url: map.url }
  throw new Error('Test map requires an explicit source destination.')
}

function ticketSource(ticket: FixtureTicket): SourceTicketContent['source'] {
  if (ticket.sourcePath) return { kind: 'file', path: ticket.sourcePath }
  if (ticket.url) return { kind: 'issue', url: ticket.url }
  throw new Error('Test ticket requires an explicit source destination.')
}

const fixtureProvider: GitHubProviderRead = {
  async restGet() {
    return {}
  },
  async graphql() {
    return { data: {}, errors: [] }
  },
}

export const fixtureAdmissions: Partial<Record<'local' | 'github', ProjectAdmission>> = {
  local: {
    async admit(request) {
      return {
        integration: 'local',
        workspace: {
          ok: true,
          value: { integration: 'local', path: request.path, readable: true, searchable: true },
        },
      }
    },
    async repair(request) {
      return {
        integration: 'local',
        workspace: {
          ok: true,
          value: { integration: 'local', path: request.path, readable: true, searchable: true },
        },
      }
    },
    async revalidate(request) {
      return {
        integration: 'local',
        workspace: {
          ok: true,
          value: {
            integration: 'local',
            path: request.path,
            readable: true,
            searchable: true,
            ...('gitIdentity' in request.intent.workspace
              ? { gitIdentity: request.intent.workspace.gitIdentity }
              : {}),
          },
        },
      }
    },
  },
  github: {
    async admit() {
      throw new Error('GitHub registration is not used by this fixture')
    },
    async repair(request) {
      return this.revalidate(request, {
        github: async () => {
          throw new Error('Unused runtime')
        },
      })
    },
    async revalidate(request) {
      if (
        request.intent.ref.integration !== 'github' ||
        !('locator' in request.intent) ||
        request.connection.integration !== 'github'
      )
        throw new Error('Expected GitHub intent')
      return {
        integration: 'github',
        source: {
          ok: true,
          value: {
            connectionId: request.connection.id,
            accountId: request.connection.githubIdentity.id,
            repositoryId: request.intent.locator.repositoryId,
            access: fixtureProvider,
          },
        },
        workspace: {
          ok: true,
          value: {
            integration: 'github',
            path: request.path,
            readable: true,
            searchable: true,
            worktreeRoot: true,
            matchedRepositoryId: request.intent.locator.repositoryId,
            verifiedConnectionId: request.connection.id,
            nameWithOwner: request.intent.locator.nameWithOwner,
          },
        },
      }
    },
  },
}

export function controlledSourceFixture(
  project: SourceProjectKey,
  baseline: ObservationBatch,
  options: { gate?: Promise<void>; health?: SourceObservationHealth } = {},
) {
  const observed = baseline.attempts.find((attempt) => attempt.kind === 'observed')
  let current = {
    project,
    attempts: baseline.attempts,
    health: options.health ?? {
      status: 'available' as const,
      ...(observed ? { observedAt: observed.observedAt } : {}),
    },
  }
  const listeners = new Set<Parameters<SourceObserver['subscribe']>[0]>()
  const starting = Promise.withResolvers<void>()
  let stopped = false
  const observer: SourceObserver = {
    async observe() {
      starting.resolve()
      await options.gate
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async refresh() {
      return current
    },
    async stop() {
      stopped = true
    },
  }
  return {
    observer,
    started: starting.promise,
    push(batch: ObservationBatch, health: SourceObservationHealth = current.health) {
      // Supplied operation identities also cover intentional replay; never renumber them.
      current = { project, attempts: batch.attempts, health }
      for (const listener of listeners) listener(current)
    },
    get stopped() {
      return stopped
    },
  }
}
