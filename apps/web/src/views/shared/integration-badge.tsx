import type { Integration } from '@roadmap/contracts'
import { Badge } from '@roadmap/ui/badge'

const INTEGRATION_META = {
  github: { label: 'GitHub', variant: 'accent' },
  local: { label: 'Local', variant: 'warning' },
} as const satisfies Record<Integration, { label: string; variant: string }>

type IntegrationBadgeProps = { integration: Integration }

export function IntegrationBadge({ integration }: IntegrationBadgeProps) {
  const { variant, label } = INTEGRATION_META[integration]
  return <Badge variant={variant}>{label}</Badge>
}
