import { Badge } from '@roadmap/ui/badge'
import { Section, SectionDescription, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import type { Variant } from '@roadmap/ui/variant'
import './badges.css'

const BADGE_VARIANTS = [
  ['Neutral', 'neutral', '--comp-badge-neutral-color'],
  ['Accent', 'accent', '--comp-badge-accent-color'],
  ['Highlight', 'highlight', '--comp-badge-highlight-color'],
  ['Warning', 'warning', '--comp-badge-warning-color'],
  ['Danger', 'danger', '--comp-badge-danger-color'],
  ['Success', 'success', '--comp-badge-success-color'],
  ['Info', 'info', '--comp-badge-info-color'],
  ['Muted', 'muted', '--comp-badge-muted-color'],
] as const satisfies readonly (readonly [string, Variant, string])[]

export function BadgesCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Badges</SectionTitle>
        <SectionDescription>
          Compact status and metadata labels. Text states the meaning; color supports it. Every
          supported variant appears here.
        </SectionDescription>
      </SectionHeader>

      <div className="catalog-component-examples">
        {BADGE_VARIANTS.map(([label, variant, token]) => (
          <div className="catalog-component-example" key={variant}>
            <Badge variant={variant}>{label}</Badge>
            <code>{token}</code>
          </div>
        ))}
      </div>
    </Section>
  )
}
