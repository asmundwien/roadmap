import type { Connection } from '@roadmap/contracts'
import { Badge } from '@/components/badge/badge'
import { INTEGRATION_META } from '@/views/shared/project-meta'

type IntegrationBadgeProps = { connection: Connection | undefined }

export function IntegrationBadge({ connection }: IntegrationBadgeProps) {
  if (!connection) return <Badge>Unknown</Badge>

  const meta = INTEGRATION_META[connection.integration]
  return <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
}
