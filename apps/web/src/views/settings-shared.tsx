import type { Connection, ProjectKey, RegisteredProject, SafeError } from '@roadmap/contracts'
import { type ReactNode, useEffect, useRef } from 'react'

export function SettingsPane({
  children,
  label,
  onClose,
}: {
  children: ReactNode
  label: string
  onClose: () => void
}) {
  const paneRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const closePane = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') onClose()
      if (
        event instanceof MouseEvent &&
        event.target instanceof Node &&
        !paneRef.current?.contains(event.target)
      ) {
        onClose()
      }
    }
    window.addEventListener('keydown', closePane)
    window.addEventListener('mousedown', closePane)
    return () => {
      window.removeEventListener('keydown', closePane)
      window.removeEventListener('mousedown', closePane)
    }
  }, [onClose])

  return (
    <div className="settings-scrim">
      <section
        ref={paneRef}
        className="settings-flow"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <button className="settings-close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </section>
    </div>
  )
}

export function IntegrationBadge({ connection }: { connection: Connection | undefined }) {
  if (!connection) return <span className="settings-badge">Unknown</span>
  return (
    <span className={`settings-badge is-${connection.integration}`}>
      {connection.integration === 'github' ? 'GitHub' : 'Local'}
    </span>
  )
}

export function SettingsAlert({
  children,
  tone = 'error',
}: {
  children: ReactNode
  tone?: 'error' | 'info'
}) {
  return (
    <div className={`settings-alert is-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}

export function ErrorText({ error }: { error: SafeError | string | null }) {
  if (!error) return null
  return <p className="settings-error">{typeof error === 'string' ? error : error.message}</p>
}

export function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}

export function projectIdentity(project: Pick<RegisteredProject, 'key'>): string {
  return `${project.key.integration}:${project.key.id}`
}

export function locatorLabel(project: Pick<RegisteredProject, 'locator'>): string {
  return project.locator.integration === 'github'
    ? project.locator.nameWithOwner
    : project.locator.path
}

export function mapState(project: RegisteredProject): string {
  const open = project.openMaps.length
  const closed = project.closedMaps.length
  if (open + closed === 0) return 'No Wayfinder maps yet.'
  if (open === 0) return `${closed} closed ${closed === 1 ? 'map' : 'maps'} · at rest`
  return `${open} open · ${closed} closed`
}

export function observedLabel(observedAt: number | undefined): string {
  return observedAt === undefined ? 'Not observed yet' : new Date(observedAt).toLocaleString()
}

export function markerFor(project: RegisteredProject): { className: string; glyph: string } {
  if (project.availability.status === 'unavailable') {
    return { className: 'is-blocked', glyph: '×' }
  }
  if (project.openMaps.length > 0) return { className: 'is-active', glyph: '●' }
  if (project.closedMaps.length > 0) return { className: 'is-closed', glyph: '✓' }
  return { className: 'is-open', glyph: '○' }
}
