import { useRoadmap } from '../store/roadmap-provider.tsx'
import './views.css'

/**
 * The persistent top bar: the waypoint-flag mark and wordmark leading home, the socket's health on
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

/** The waypoint flag drawn from the palette: a goal-amber pennant on a muted pole. */
function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 3.5v25" fill="none" stroke="var(--muted)" strokeWidth="3" strokeLinecap="round" />
      <path fill="var(--goal)" d="M9 4.5h16.5l-4.5 6.25 4.5 6.25H9z" />
    </svg>
  )
}

function formatClock(at: number | null): string {
  return at === null ? 'never' : new Date(at).toLocaleTimeString()
}
