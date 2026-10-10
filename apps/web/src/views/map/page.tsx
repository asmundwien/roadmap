import type { TicketId } from '@roadmap/contracts/identity'
import { Alert } from '@roadmap/ui/alert'
import { Link as SourceLink } from '@roadmap/ui/link'
import { Page, PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { useNavigate } from 'react-router'
import { Link } from '@/navigation'
import { type MapResult, resolveSelection, type SelectionRequest } from '@/resources/results'
import { mapPath, projectSettingsPath, ticketPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { MapContainer } from './map-container'
import { MapContent } from './map-content'
import { MapNavigation } from './map-navigation'
import styles from './page.module.css'
import { TicketModal } from './ticket-modal'

const cx = classNames.bind(styles)

type MapPageProps = { selection: SelectionRequest }

export function MapPage({ selection }: MapPageProps) {
  const navigate = useNavigate()
  const result = useRoadmap((read) => resolveSelection(read, selection))
  const { project, map } = result
  const onOpenTicket = (id: TicketId) => {
    if (map) void navigate(ticketPath({ map: map.navigation.map, ticketId: id }))
  }
  const onOpenMap = () => {
    const ref = map?.navigation.map ?? result.ticket?.navigation.map
    if (ref) void navigate(mapPath(ref), { replace: true })
  }

  return (
    <Page>
      <PageHeader>
        <PageTitle>{project.name}</PageTitle>
        <PageDescription>{project.description}</PageDescription>
        <div className={cx('project-context')}>
          <IntegrationBadge integration={project.ref.integration} />
          <span className={cx('source-path')}>{project.ref.projectId}</span>
          {project.kind === 'known' && (
            <Link href={projectSettingsPath(project.navigation.settings)}>Project settings</Link>
          )}
        </div>
        {project.kind === 'known' && project.observedSource.kind === 'file' && (
          <p className={cx('source-path')}>{project.observedSource.path}</p>
        )}
        {project.kind === 'known' && project.observedSource.kind === 'link' && (
          <SourceLink href={project.observedSource.href}>Project source</SourceLink>
        )}
      </PageHeader>
      {project.kind === 'missing' ? (
        <>
          <Alert>{project.message}</Alert>
          {map?.kind === 'missing' && <Alert variant="info">{map.message}</Alert>}
        </>
      ) : (
        <>
          <Alert variant="info">Project source. {project.availability.message}</Alert>
          {project.orderWarning && <Alert variant="info">{project.orderWarning}</Alert>}
          {project.warnings.map((warning) => (
            <Alert key={warning} variant="info">
              {warning}
            </Alert>
          ))}
          <div className={cx('layout')}>
            <MapNavigation project={project} selectedMap={map} />
            <div className={cx('map-main')}>
              {map?.kind === 'known' ? (
                <SelectedMap map={map} onOpenTicket={onOpenTicket} onOpenMap={onOpenMap} />
              ) : (
                <Surface>
                  <SurfaceDescription>{map?.message ?? result.message}</SurfaceDescription>
                </Surface>
              )}
            </div>
          </div>
        </>
      )}
      <TicketModal
        selected={selection.ticket}
        onClose={onOpenMap}
        onOpenTicket={onOpenTicket}
        onOpenMap={onOpenMap}
      />
    </Page>
  )
}

type SelectedMapProps = {
  map: Extract<MapResult, { kind: 'known' }>
  onOpenTicket: (id: TicketId) => void
  onOpenMap: () => void
}

function SelectedMap({ map, onOpenTicket, onOpenMap }: SelectedMapProps) {
  return (
    <>
      <Surface>
        <header className={cx('map-heading')}>
          <h2>{map.title}</h2>
          <SurfaceDescription>
            {map.displayId} · {map.statusLabel} · {map.progressLabel}
          </SurfaceDescription>
          {map.source.kind === 'link' && <SourceLink href={map.source.href}>Map source</SourceLink>}
          {map.source.kind === 'file' && (
            <span className={cx('source-path')}>{map.source.path}</span>
          )}
        </header>
        <Alert variant="info">Map source. {map.availability.message}</Alert>
        <MapContainer map={map} onOpenTicket={onOpenTicket} />
      </Surface>
      <MapContent map={map} onOpenTicket={onOpenTicket} onOpenMap={onOpenMap} />
    </>
  )
}
