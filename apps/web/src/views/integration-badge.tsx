import type { Connection } from '@roadmap/contracts'
import { Badge } from '../components/badge/badge.tsx'
import { INTEGRATION_META } from './project-meta.ts'

export function IntegrationBadge({ connection }: { connection: Connection | undefined }) {
  if (!connection) return <Badge>Unknown</Badge>

  const meta = INTEGRATION_META[connection.integration]
  return <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
}
