import type { Connection } from '@roadmap/contracts'
import type { ReactNode } from 'react'
import './badge.css'

export type BadgeVariant = 'neutral' | 'github' | 'local'

export function Badge({
  children,
  variant = 'neutral',
}: {
  children: ReactNode
  variant?: BadgeVariant
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}

export function IntegrationBadge({ connection }: { connection: Connection | undefined }) {
  if (!connection) return <Badge>Unknown</Badge>
  return (
    <Badge variant={connection.integration}>
      {connection.integration === 'github' ? 'GitHub' : 'Local'}
    </Badge>
  )
}
