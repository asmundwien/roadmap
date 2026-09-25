import type { Integration } from '@roadmap/contracts'
import type { Variant } from '../components/variant.ts'

type IntegrationMeta = {
  label: string
  badgeVariant: Variant
}

export const INTEGRATION_META = {
  github: { label: 'GitHub', badgeVariant: 'accent' },
  local: { label: 'Local', badgeVariant: 'warning' },
} as const satisfies Record<Integration, IntegrationMeta>

/** Human-facing labels for integrations; wire tags stay `github` / `local`. */
export function integrationLabel(integration: Integration): string {
  return INTEGRATION_META[integration].label
}
