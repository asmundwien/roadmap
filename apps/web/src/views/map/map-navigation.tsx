import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { Link } from '@/navigation'
import type { KnownProjectResult, MapResult, MapSummary } from '@/resources/results'
import { mapPath, projectPath } from '@/router'
import styles from './page.module.css'

const cx = classNames.bind(styles)

type MapNavigationProps = {
  project: KnownProjectResult
  selectedMap: MapResult | null
}

export function MapNavigation({ project, selectedMap }: MapNavigationProps) {
  return (
    <Surface>
      <SurfaceTitle>Maps</SurfaceTitle>
      <nav aria-label="Project maps">
        <Link href={projectPath(project.navigation.project)}>
          Active map or latest closed history
        </Link>
        <MapGroup
          heading={project.orderWarning ? 'Last trustworthy open order' : 'Open maps'}
          maps={project.navigation.open}
          selectedMap={selectedMap}
        />
        <MapGroup
          heading="Closed history"
          maps={project.navigation.closed}
          selectedMap={selectedMap}
        />
        <MapGroup
          heading="Historical or unplaced maps"
          maps={project.navigation.unplaced}
          selectedMap={selectedMap}
        />
      </nav>
    </Surface>
  )
}

type MapGroupProps = {
  heading: string
  maps: MapSummary[]
  selectedMap: MapResult | null
}

function MapGroup({ heading, maps, selectedMap }: MapGroupProps) {
  return (
    <section className={cx('map-group')}>
      <h3>
        {heading} ({maps.length})
      </h3>
      {maps.length === 0 ? (
        <p>No maps in this group.</p>
      ) : (
        <ul>
          {maps.map((map) => (
            <li key={map.key}>
              <Link
                href={mapPath(map.ref)}
                aria-current={selectedMap?.ref.mapId === map.ref.mapId ? 'page' : undefined}
              >
                <span>{map.title}</span>
                <small>
                  {map.displayId} · {map.statusLabel}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
