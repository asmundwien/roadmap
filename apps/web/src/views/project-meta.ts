import type { Integration } from '@roadmap/contracts'

/** Human-facing labels for the integration badge; wire tags stay `github` / `local`. */
export function integrationLabel(integration: Integration): string {
  return integration === 'github' ? 'GitHub' : 'Local'
}
