import type { Connection } from '@roadmap/contracts'
import { Badge } from '../../components/badge/badge.tsx'
import { INTEGRATION_META } from '../shared/project-meta.ts'

type IntegrationBadgeProps = { connection: Connection | undefined }

export function IntegrationBadge({ connection }: IntegrationBadgeProps) {
  if (!connection) return <Badge>Unknown</Badge>

  const meta = INTEGRATION_META[connection.integration]
  return <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
}
