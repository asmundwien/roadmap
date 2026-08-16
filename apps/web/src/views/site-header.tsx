import { useRoadmap } from '../store/roadmap-provider.tsx'
import './views.css'

/**
 * The persistent top bar: the fork-tile mark and wordmark leading home, the socket's health on
 * the right. The connection readout lives here because it is global truth — every screen renders
 * the same snapshot, so its liveness belongs to the frame, not to any one view.
 */
export function SiteHeader() {
  const { connection, capturedAt } = useRoadmap()

  return (
    <header className="site-header">
      <a className="brand" href="#/">
        <BrandMark />
        Roadmap
      </a>
      <span className={`conn conn-${connection}`}>
        <i className="conn-dot" aria-hidden="true" />
        {connection === 'connecting' && 'Connecting…'}
        {connection === 'live' && `Live · updated ${formatClock(capturedAt)}`}
        {connection === 'disconnected' && 'Disconnected'}
      </span>
    </header>
  )
}

/**
 * The fork-knockout tile, identical to the favicon: trunk, branch, and goal node in ink on the
 * goal-gold field. Fixed brand colors, not theme vars — the tile is the same in both themes,
 * the way a real app icon would be.
 */
function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="115" fill="#dcaf3f" />
      <path
        d="M 182 404 V 180"
        fill="none"
        stroke="#1c1b1a"
        strokeWidth="36"
        strokeLinecap="round"
      />
      <path
        d="M 182 300 C 182 226, 328 254, 328 164"
        fill="none"
        stroke="#1c1b1a"
        strokeWidth="36"
        strokeLinecap="round"
      />
      <circle cx="328" cy="140" r="36" fill="#1c1b1a" stroke="#dcaf3f" strokeWidth="12" />
    </svg>
  )
}

function formatClock(at: number | null): string {
  return at === null ? 'never' : new Date(at).toLocaleTimeString()
}
