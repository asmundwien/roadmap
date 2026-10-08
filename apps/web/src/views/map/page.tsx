import type { Project, ProjectKey, Unreachable, WayfinderMap } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Link as SourceLink } from '@roadmap/ui/link'
import { Page, PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { useNavigate } from 'react-router'
import { Link } from '@/navigation'
import { mapPath, projectSettingsPath, ticketPath } from '@/router'
import { type RoadmapViewState, useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { sameProject } from '@/views/shared/settings-shared'
import { MapContainer } from './map-container'
import { MapContent } from './map-content'
import { MapNavigation } from './map-navigation'
import styles from './page.module.css'
import { TicketModal } from './ticket-modal'

const cx = classNames.bind(styles)

type MapPageProps = {
  projectKey: ProjectKey
  mapId: string | null
  ticketId: string | null
}

export function MapPage({ projectKey, mapId, ticketId }: MapPageProps) {
  const navigate = useNavigate()
  const { projects, roadmapProjects, unreachable } = useRoadmap()
  const registration = projects.find((candidate) => sameProject(candidate.key, projectKey))
  const source = roadmapProjects.find((candidate) => sameProject(candidate.key, projectKey))
  const project = projectWithSource(registration, source)
  const map = findMap(project, mapId)
  const unavailable =
    registration?.availability.status === 'unavailable' ? registration.availability.cause : null
  const missingSources = unreachable.filter((candidate) =>
    sameProject(candidate.project, projectKey),
  )
  const onOpenTicket = (id: string) => {
    if (map) void navigate(ticketPath(map, id))
  }
  const onOpenMap = () => {
    if (map) void navigate(mapPath(map), { replace: true })
  }

  return (
    <Page>
      <ProjectHeading projectKey={projectKey} project={project} registration={registration} />
      <ProjectNotices
        unavailable={unavailable}
        missingSources={missingSources}
        warnings={project?.warnings}
      />
      {!project && <Alert>This project is not present in the current roadmap snapshot.</Alert>}
      {project && (
        <div className={cx('layout')}>
          <MapNavigation project={project} selectedMap={map} />
          <div className={cx('map-main')}>
            {map ? (
              <SelectedMap
                map={map}
                activeMapId={project.openMaps[0]?.id}
                ticketId={ticketId}
                onOpenTicket={onOpenTicket}
                onOpenMap={onOpenMap}
              />
            ) : (
              <Surface>
                <SurfaceDescription>{missingMapDescription(mapId)}</SurfaceDescription>
              </Surface>
            )}
          </div>
        </div>
      )}
    </Page>
  )
}

type ProjectHeadingProps = {
  projectKey: ProjectKey
  project: Project | undefined
  registration: RoadmapViewState['projects'][number] | undefined
}

function ProjectHeading({ projectKey, project, registration }: ProjectHeadingProps) {
  return (
    <PageHeader>
      <PageTitle>{project?.name ?? projectKey.id}</PageTitle>
      <PageDescription>{projectDescription(project)}</PageDescription>
      <div className={cx('project-context')}>
        <IntegrationBadge integration={projectKey.integration} />
        <span className={cx('source-path')}>{projectKey.id}</span>
        {registration && <Link href={projectSettingsPath(registration.key)}>Project settings</Link>}
      </div>
      {project?.sourcePath && <p className={cx('source-path')}>{project.sourcePath}</p>}
    </PageHeader>
  )
}

function projectWithSource(
  registration: RoadmapViewState['projects'][number] | undefined,
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

function missingMapDescription(mapId: string | null): string {
  return mapId !== null
    ? `The requested map "${mapId}" is not available in this project. No other map has been selected.`
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
          {map.url && <SourceLink href={map.url}>Map source</SourceLink>}
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

type ProjectNoticesProps = {
  unavailable: string | null
  missingSources: Unreachable[]
  warnings: string[] | undefined
}

function ProjectNotices({ unavailable, missingSources, warnings }: ProjectNoticesProps) {
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
  project: Pick<RoadmapViewState['projects'][number], 'openMaps' | 'closedMaps'> | undefined,
  mapId: string | null,
) {
  return mapId === null
    ? (project?.openMaps[0] ?? project?.closedMaps[0])
    : (project?.openMaps.find((candidate) => candidate.id === mapId) ??
        project?.closedMaps.find((candidate) => candidate.id === mapId))
}
