import type { MapResource, RegisteredProject } from '@roadmap/contracts'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { Link } from '@/navigation'
import { mapPath, projectPath } from '@/router'
import { orderedMaps, resourceObservation } from '@/views/shared/resource-results'
import styles from './page.module.css'

const cx = classNames.bind(styles)

type MapNavigationProps = {
  project: RegisteredProject
  selectedMap: MapResource | undefined
}

export function MapNavigation({ project, selectedMap }: MapNavigationProps) {
  const maps = orderedMaps(project)
  const activeMapId =
    project.activeMap.kind === 'known-current' ? project.activeMap.mapId : undefined
  return (
    <Surface>
      <SurfaceTitle>Maps</SurfaceTitle>
      <nav aria-label="Project maps">
        <Link href={projectPath(project.key)}>Active map or latest closed history</Link>
        <MapGroup
          heading={
            project.activeMap.kind === 'uncertain' ? 'Last trustworthy open order' : 'Open maps'
          }
          maps={maps.open}
          selectedMap={selectedMap}
          activeMapId={activeMapId}
        />
        <MapGroup
          heading="Closed history"
          maps={maps.closed}
          selectedMap={selectedMap}
          activeMapId={activeMapId}
        />
        <MapGroup
          heading="Historical or unplaced maps"
          maps={maps.unplaced}
          selectedMap={selectedMap}
          activeMapId={activeMapId}
        />
      </nav>
    </Surface>
  )
}

type MapGroupProps = {
  heading: string
  maps: MapResource[]
  selectedMap: MapResource | undefined
  activeMapId: string | undefined
}

function MapGroup({ heading, maps, selectedMap, activeMapId }: MapGroupProps) {
  return (
    <section className={cx('map-group')}>
      <h3>
        {heading} ({maps.length})
      </h3>
      {maps.length === 0 ? (
        <p>No maps in this group.</p>
      ) : (
        <ul>
          {maps.map((map) => {
            const content = resourceObservation(map.resource)?.value
            return (
              <li key={map.key.mapId}>
                <Link
                  href={mapPath(map.key)}
                  aria-current={selectedMap?.key.mapId === map.key.mapId ? 'page' : undefined}
                >
                  <span>{content?.title ?? content?.displayId ?? map.key.mapId}</span>
                  <small>
                    {content?.displayId ?? map.key.mapId} · {mapStatus(map, activeMapId)}
                  </small>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function mapStatus(map: MapResource, activeMapId: string | undefined): string {
  if (map.resource.kind === 'proven-absent') return 'Historical, proven absent'
  if (map.resource.kind === 'never-observed') return 'Never read'
  if (map.resource.kind === 'retained-unavailable') return 'Unavailable, retained content'
  if (map.key.mapId === activeMapId) return 'Active'
  const status = map.resource.observation.value.status
  return status === 'open' ? 'Open' : status === 'closed' ? 'Closed' : 'Status unknown'
}
