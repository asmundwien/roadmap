import type { MapId, ProjectRef, TicketId, TicketRef } from '@roadmap/contracts/identity'
import type { MapResource, Project } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Link as SourceLink } from '@roadmap/ui/link'
import { Page, PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { useNavigate } from 'react-router'
import { Link } from '@/navigation'
import { mapPath, projectSettingsPath, ticketPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { resourceMessage, resourceObservation } from '@/views/shared/resource-results'
import { sameProject } from '@/views/shared/settings-shared'
import { MapContainer } from './map-container'
import { MapContent } from './map-content'
import { MapNavigation } from './map-navigation'
import styles from './page.module.css'
import { TicketModal } from './ticket-modal'

const cx = classNames.bind(styles)

type MapPageProps = {
  projectRef: ProjectRef
  mapId: MapId | null
  ticketId: TicketId | null
}

export function MapPage({ projectRef, mapId, ticketId }: MapPageProps) {
  const navigate = useNavigate()
  const { projects } = useRoadmap()
  const project = projects.find((candidate) => sameProject(candidate.ref, projectRef))
  const selectedId =
    mapId ??
    (project?.activeMap.kind === 'known-current'
      ? project.activeMap.ref.mapId
      : project?.activeMap.kind === 'known-empty'
        ? (project.displayOrder.closed[0]?.mapId ?? null)
        : null)
  const map =
    selectedId === null
      ? undefined
      : project?.maps.find((candidate) => candidate.ref.mapId === selectedId)
  const observation = project === undefined ? null : resourceObservation(project.resource)
  const selectedTicket: TicketRef | null =
    mapId === null || ticketId === null ? null : { map: { project: projectRef, mapId }, ticketId }
  const onOpenTicket = (id: TicketId) => {
    if (map) void navigate(ticketPath({ map: map.ref, ticketId: id }))
  }
  const onOpenMap = () => {
    const ref = map?.ref ?? selectedTicket?.map
    if (ref) void navigate(mapPath(ref), { replace: true })
  }

  return (
    <Page>
      <PageHeader>
        <PageTitle>{project?.name ?? projectRef.projectId}</PageTitle>
        <PageDescription>{projectDescription(project)}</PageDescription>
        <div className={cx('project-context')}>
          <IntegrationBadge integration={projectRef.integration} />
          <span className={cx('source-path')}>{projectRef.projectId}</span>
          {project && <Link href={projectSettingsPath(project.ref)}>Project settings</Link>}
        </div>
        {project?.integration === 'local' && (
          <p className={cx('source-path')}>{project.source.path}</p>
        )}
        {project?.integration === 'github' && (
          <SourceLink href={project.source.url}>Project source</SourceLink>
        )}
      </PageHeader>
      {!project ? (
        <Alert>This project is not registered in the current Roadmap state.</Alert>
      ) : (
        <>
          <Alert variant="info">Project source. {resourceMessage(project.resource)}</Alert>
          {project.activeMap.kind === 'uncertain' && (
            <Alert variant="info">
              {project.activeMap.cause} The last trustworthy map order is retained. No map is
              promoted to active.
            </Alert>
          )}
          {[
            ...new Set([...(observation?.value.warnings ?? []), ...project.managementWarnings]),
          ].map((warning) => (
            <Alert key={warning} variant="info">
              {warning}
            </Alert>
          ))}
          <div className={cx('layout')}>
            <MapNavigation project={project} selectedMap={map} />
            <div className={cx('map-main')}>
              {map ? (
                <SelectedMap
                  map={map}
                  activeMapId={
                    project.activeMap.kind === 'known-current'
                      ? project.activeMap.ref.mapId
                      : undefined
                  }
                  onOpenTicket={onOpenTicket}
                  onOpenMap={onOpenMap}
                />
              ) : (
                <Surface>
                  <SurfaceDescription>
                    {mapId !== null
                      ? `The requested map "${mapId}" has no known resource in this project. No other map has been selected.`
                      : project.activeMap.kind === 'uncertain'
                        ? 'Current map ordering is uncertain. Choose a known map explicitly to inspect its source evidence.'
                        : 'This project has no current open map. Historical maps remain available in navigation.'}
                  </SurfaceDescription>
                </Surface>
              )}
            </div>
          </div>
        </>
      )}
      <TicketModal
        map={map ?? null}
        selected={selectedTicket}
        onClose={onOpenMap}
        onOpenTicket={onOpenTicket}
        onOpenMap={onOpenMap}
      />
    </Page>
  )
}

function projectDescription(project: Project | undefined): string {
  if (!project) return 'Project map'
  if (project.activeMap.kind === 'uncertain') return 'Active map is uncertain'
  return project.activeMap.kind === 'known-current'
    ? 'Current active map established'
    : 'No current open map'
}

type SelectedMapProps = {
  map: MapResource
  activeMapId: string | undefined
  onOpenTicket: (id: TicketId) => void
  onOpenMap: () => void
}

function SelectedMap({ map, activeMapId, onOpenTicket, onOpenMap }: SelectedMapProps) {
  const content = resourceObservation(map.resource)?.value
  const status =
    map.resource.kind === 'proven-absent'
      ? 'Historical map'
      : map.ref.mapId === activeMapId
        ? 'Active map'
        : content?.status === 'open'
          ? 'Open map'
          : content?.status === 'closed'
            ? 'Closed map'
            : 'Map status unknown'
  return (
    <>
      <Surface>
        <header className={cx('map-heading')}>
          <h2>{content?.title ?? content?.displayId ?? map.ref.mapId}</h2>
          <SurfaceDescription>
            {content?.displayId ?? map.ref.mapId} · {status}
            {content &&
              ` · ${content.progress === null ? 'Closed ticket count unknown' : `${content.progress.completed} closed tickets`}`}
          </SurfaceDescription>
          {content?.source.kind === 'issue' && (
            <SourceLink href={content.source.url}>Map source</SourceLink>
          )}
          {content?.source.kind === 'file' && (
            <span className={cx('source-path')}>{content.source.path}</span>
          )}
        </header>
        <Alert variant="info">Map source. {resourceMessage(map.resource)}</Alert>
        <MapContainer map={map} onOpenTicket={onOpenTicket} />
      </Surface>
      <MapContent map={map} onOpenTicket={onOpenTicket} onOpenMap={onOpenMap} />
    </>
  )
}
