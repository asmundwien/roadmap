import type { Project, WayfinderMap } from '@roadmap/contracts'
import { Link } from '@roadmap/ui/link'
import classNames from 'classnames/bind'
import { mapHash, projectHash } from '@/router'
import styles from './page.module.css'

const cx = classNames.bind(styles)

type MapNavigationProps = {
  project: Pick<Project, 'key' | 'openMaps' | 'closedMaps'>
  selectedMap: WayfinderMap | undefined
}

export function MapNavigation({ project, selectedMap }: MapNavigationProps) {
  return (
    <details className={cx('navigation')} open>
      <summary>Maps</summary>
      <nav aria-label="Project maps">
        <Link href={projectHash(project.key)}>Active map or latest history</Link>
        <MapGroup heading="Live maps" maps={project.openMaps} selectedMap={selectedMap} />
        <MapGroup heading="History" maps={project.closedMaps} selectedMap={selectedMap} />
      </nav>
    </details>
  )
}

function MapGroup({
  heading,
  maps,
  selectedMap,
}: {
  heading: string
  maps: WayfinderMap[]
  selectedMap: WayfinderMap | undefined
}) {
  return (
    <section className={cx('map-group')}>
      <h2>
        {heading} ({maps.length})
      </h2>
      {maps.length === 0 ? (
        <p>No {heading.toLowerCase()}.</p>
      ) : (
        <ul>
          {maps.map((map, index) => (
            <li key={map.id}>
              <Link
                href={mapHash(map)}
                aria-current={selectedMap?.id === map.id ? 'page' : undefined}
              >
                <span>{map.title ?? map.displayId ?? map.id}</span>
                <small>
                  {map.displayId ?? map.id} · {mapStatus(map, index)}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function mapStatus(map: WayfinderMap, index: number): string {
  if (!map.isOpen) return 'Closed'
  return index === 0 ? 'Active' : 'Open'
}
