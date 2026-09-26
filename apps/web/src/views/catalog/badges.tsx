import { Badge } from '@/components/badge/badge'
import type { Variant } from '@/components/variant'
import { CatalogSection } from './section'
import './badges.css'

const BADGE_VARIANTS = [
  ['Neutral', 'neutral', '--comp-badge-neutral-color'],
  ['Accent', 'accent', '--comp-badge-accent-color'],
  ['Warning', 'warning', '--comp-badge-warning-color'],
  ['Danger', 'danger', '--comp-badge-danger-color'],
  ['Success', 'success', '--comp-badge-success-color'],
  ['Info', 'info', '--comp-badge-info-color'],
  ['Muted', 'muted', '--comp-badge-muted-color'],
  ['Violet', 'violet', '--comp-badge-violet-color'],
  ['Teal', 'teal', '--comp-badge-teal-color'],
] as const satisfies readonly (readonly [string, Variant, string])[]

export function BadgesCatalogSection() {
  return (
    <CatalogSection
      title="Badges"
      description="Compact status and metadata labels. Text states the meaning; color supports it. Every supported variant appears here."
    >
      <div className="catalog-component-examples">
        {BADGE_VARIANTS.map(([label, variant, token]) => (
          <div className="catalog-component-example" key={variant}>
            <Badge variant={variant}>{label}</Badge>
            <code>{token}</code>
          </div>
        ))}
      </div>
    </CatalogSection>
  )
}
