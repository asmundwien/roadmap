import type { Project, ProjectKey, Unreachable, WayfinderMap } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Link } from '@roadmap/ui/link'
import { Page, PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import {
  mapHash,
  mapV2Hash,
  overviewHash,
  projectHash,
  projectRegistrationHash,
  type Route,
  ticketV2Hash,
} from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { MapContainer } from './map-container'
import { MapContent } from './map-content'
import { MapNavigation } from './map-navigation'
import styles from './page.module.css'
import { TicketModal } from './ticket-modal'

const cx = classNames.bind(styles)

type MapV2PageProps = { route: Extract<Route, { screen: 'project-v2' }> }

export function MapV2Page({ route }: MapV2PageProps) {
  const { transport, projects, roadmapProjects, capturedAt, unreachable } = useRoadmap()
  const registration = projects.find((candidate) => sameProject(candidate.key, route.project))
  const source = roadmapProjects.find((candidate) => sameProject(candidate.key, route.project))
  const project = projectWithSource(registration, source)
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
      <ProjectHeading
        projectKey={route.project}
        project={project}
        registration={registration}
        map={map}
      />
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
      {project && (
        <div className={cx('layout')}>
          <MapNavigation project={project} selectedMap={map} />
          <div className={cx('map-main')}>
            {map ? (
              <SelectedMap
                map={map}
                activeMapId={project.openMaps[0]?.id}
                ticketId={route.selection?.kind === 'ticket' ? route.selection.id : null}
                onOpenTicket={onOpenTicket}
                onOpenMap={onOpenMap}
              />
            ) : (
              <Surface>
                <SurfaceDescription>{missingMapDescription(route.selected)}</SurfaceDescription>
              </Surface>
            )}
          </div>
        </div>
      )}
    </Page>
  )
}

function ProjectHeading({
  projectKey,
  project,
  registration,
  map,
}: {
  projectKey: ProjectKey
  project: Project | undefined
  registration: ReturnType<typeof useRoadmap>['projects'][number] | undefined
  map: WayfinderMap | undefined
}) {
  return (
    <PageHeader>
      <Link href={overviewHash}>Back to projects</Link>
      <PageTitle>{project?.name ?? projectKey.id}</PageTitle>
      <PageDescription>{projectDescription(project)}</PageDescription>
      <div className={cx('project-context')}>
        <IntegrationBadge integration={projectKey.integration} />
        <span className={cx('source-path')}>{projectKey.id}</span>
        {registration && (
          <Link href={projectRegistrationHash(registration.key)}>Project settings</Link>
        )}
        {project?.sourceUrl && <Link href={project.sourceUrl}>Project source</Link>}
      </div>
      {project?.sourcePath && <p className={cx('source-path')}>{project.sourcePath}</p>}
      <Link href={map ? mapHash(map) : projectHash(projectKey)}>Open legacy project page</Link>
    </PageHeader>
  )
}

function projectWithSource(
  registration: ReturnType<typeof useRoadmap>['projects'][number] | undefined,
  source: Project | undefined,
): Project | undefined {
  if (!registration) return source
  return {
    ...registration,
    ...(source?.sourcePath === undefined ? {} : { sourcePath: source.sourcePath }),
    ...(source?.sourceUrl === undefined ? {} : { sourceUrl: source.sourceUrl }),
  }
}

function projectDescription(project: Project | undefined): string {
  if (!project) return 'Project map'
  const state = project.openMaps.length > 0 ? 'Travelling' : 'Resting'
  return `${state} · ${project.openMaps.length} live maps · ${project.closedMaps.length} closed maps`
}

function missingMapDescription(selected: string | null): string {
  return selected !== null
    ? `The requested map "${selected}" is not available in this project. No other map has been selected.`
    : 'This project has no available open or closed maps.'
}

type SelectedMapProps = {
  map: WayfinderMap
  activeMapId: string | undefined
  ticketId: string | null
  onOpenTicket: (id: string) => void
  onOpenMap: () => void
}

function SelectedMap({ map, activeMapId, ticketId, onOpenTicket, onOpenMap }: SelectedMapProps) {
  const status = map.isOpen ? (map.id === activeMapId ? 'Active map' : 'Open map') : 'Closed map'
  return (
    <>
      <Surface>
        <header className={cx('map-heading')}>
          <h2>{map.title ?? map.displayId ?? map.id}</h2>
          <SurfaceDescription>
            {map.displayId ?? map.id} · {status} · {map.progress.completed} closed tickets
          </SurfaceDescription>
          {map.url && <Link href={map.url}>Map source</Link>}
          {map.sourcePath && <span className={cx('source-path')}>{map.sourcePath}</span>}
        </header>
        <MapContainer map={map} onOpenTicket={onOpenTicket} />
      </Surface>
      <MapContent map={map} onOpenTicket={onOpenTicket} onOpenMap={onOpenMap} />
      <TicketModal
        map={map}
        ticketId={ticketId}
        onClose={onOpenMap}
        onOpenTicket={onOpenTicket}
        onOpenMap={onOpenMap}
      />
    </>
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
