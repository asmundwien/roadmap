import type { ProjectKey, Unreachable } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Link } from '@roadmap/ui/link'
import { Page, PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { mapHash, mapV2Hash, overviewHash, projectHash, type Route, ticketV2Hash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { MapContainer } from './map-container'
import { TicketModal } from './ticket-modal'

type MapV2PageProps = { route: Extract<Route, { screen: 'project-v2' }> }

export function MapV2Page({ route }: MapV2PageProps) {
  const { transport, projects, roadmapProjects, capturedAt, unreachable } = useRoadmap()
  const registration = projects.find((candidate) => sameProject(candidate.key, route.project))
  const source = roadmapProjects.find((candidate) => sameProject(candidate.key, route.project))
  const project = registration
    ? {
        ...registration,
        ...(source?.sourcePath === undefined ? {} : { sourcePath: source.sourcePath }),
      }
    : source
  const map = findMap(project, route.selected)
  const unavailable =
    registration?.availability.status === 'unavailable' ? registration.availability.cause : null
  const missingSources = unreachable.filter((candidate) =>
    sameProject(candidate.project, route.project),
  )
  const onOpenTicket = (id: string) => {
    if (map) window.location.hash = ticketV2Hash(map, id)
  }
  const onOpenMap = () => {
    if (map) window.location.hash = mapV2Hash(map)
  }

  return (
    <Page>
      <PageHeader>
        <Link href={overviewHash}>Back to projects</Link>
        <PageTitle>{project?.name ?? route.project.id}</PageTitle>
        <PageDescription>Project map</PageDescription>
        <Link href={map ? mapHash(map) : projectHash(route.project)}>Open legacy project page</Link>
      </PageHeader>
      <ProjectNotices
        transport={transport}
        capturedAt={capturedAt}
        unavailable={unavailable}
        missingSources={missingSources}
        warnings={project?.warnings}
      />
      {capturedAt !== null && !project && (
        <Alert>This project is not present in the current roadmap snapshot.</Alert>
      )}
      {project && !map && (
        <Surface>
          <SurfaceDescription>
            {route.selected !== null
              ? `The requested map "${route.selected}" is not available in this project. No other map has been selected.`
              : 'This project has no available open or closed maps.'}
          </SurfaceDescription>
        </Surface>
      )}
      {map && (
        <>
          <Surface>
            <h2>{map.title ?? map.displayId ?? map.id}</h2>
            {!map.isOpen && <SurfaceDescription>This map is closed.</SurfaceDescription>}
            <MapContainer map={map} onOpenTicket={onOpenTicket} />
          </Surface>
          <TicketModal
            map={map}
            ticketId={route.selection?.kind === 'ticket' ? route.selection.id : null}
            onClose={onOpenMap}
            onOpenTicket={onOpenTicket}
            onOpenMap={onOpenMap}
          />
        </>
      )}
    </Page>
  )
}

type ProjectNoticesProps = Pick<ReturnType<typeof useRoadmap>, 'transport' | 'capturedAt'> & {
  unavailable: string | null
  missingSources: Unreachable[]
  warnings: string[] | undefined
}

function ProjectNotices({
  transport,
  capturedAt,
  unavailable,
  missingSources,
  warnings,
}: ProjectNoticesProps) {
  const sourceNotices = new Map(
    missingSources.map((entry) => [
      JSON.stringify([
        entry.integration,
        entry.project.integration,
        entry.project.id,
        entry.mapId,
        entry.mapDisplayId,
        entry.mapTitle,
        entry.reason,
      ]),
      entry,
    ]),
  )

  return (
    <>
      {transport === 'disconnected' && (
        <Alert>
          {capturedAt === null
            ? 'Server disconnected. Waiting for the first roadmap snapshot.'
            : 'Server disconnected. Showing the last roadmap snapshot.'}
        </Alert>
      )}
      {capturedAt === null && <Alert variant="info">Loading project data.</Alert>}
      {unavailable !== null && <Alert>Project unavailable: {unavailable}</Alert>}
      {Array.from(sourceNotices, ([key, entry]) => (
        <Alert key={key}>
          {entry.mapTitle ?? entry.mapDisplayId ?? entry.mapId ?? 'Project source'} could not be
          reached: {entry.reason}
        </Alert>
      ))}
      {Array.from(new Set(warnings), (warning) => (
        <Alert key={warning} variant="info">
          {warning}
        </Alert>
      ))}
    </>
  )
}

function findMap(
  project:
    | Pick<ReturnType<typeof useRoadmap>['projects'][number], 'openMaps' | 'closedMaps'>
    | undefined,
  selected: MapV2PageProps['route']['selected'],
) {
  return selected === null
    ? (project?.openMaps[0] ?? project?.closedMaps[0])
    : (project?.openMaps.find((candidate) => candidate.id === selected) ??
        project?.closedMaps.find((candidate) => candidate.id === selected))
}

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
