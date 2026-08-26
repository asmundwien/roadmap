import {
  automationSettingsHash,
  connectionSettingsHash,
  overviewHash,
  projectSettingsHash,
  type Route,
} from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import './views.css'

/**
 * The persistent top bar: the fork-tile mark and wordmark leading home, with transport health on
 * the right. The readout lives here because liveness is global truth; domain Connections are not.
 */
export function SiteHeader({ route }: { route: Route }) {
  const { transport, capturedAt } = useRoadmap()

  return (
    <header className="site-header">
      <a className="brand" href={overviewHash}>
        <BrandMark />
        Roadmap
      </a>
      <nav className="site-nav" aria-label="Primary navigation">
        <a className={route.screen === 'projects' ? 'is-current' : ''} href={overviewHash}>
          Overview
        </a>
        <a
          className={route.screen === 'project-settings' ? 'is-current' : ''}
          href={projectSettingsHash}
        >
          Projects
        </a>
        <a
          className={route.screen === 'connection-settings' ? 'is-current' : ''}
          href={connectionSettingsHash}
        >
          Connections
        </a>
        <a
          className={route.screen === 'automation-settings' ? 'is-current' : ''}
          href={automationSettingsHash}
        >
          Automation
        </a>
      </nav>
      <span className={`conn conn-${transport}`}>
        <i className="conn-dot" aria-hidden="true" />
        {transport === 'connecting' && 'Connecting…'}
        {transport === 'live' && `Live · updated ${formatClock(capturedAt)}`}
        {transport === 'disconnected' && 'Disconnected'}
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
