import { Badge } from '@roadmap/ui/badge'
import { Section, SectionDescription, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import type { Variant } from '@roadmap/ui/variant'
import './badges.css'

const BADGE_VARIANTS = [
  ['Neutral', 'neutral'],
  ['Accent', 'accent'],
  ['Highlight', 'highlight'],
  ['Warning', 'warning'],
  ['Danger', 'danger'],
  ['Success', 'success'],
  ['Info', 'info'],
  ['Muted', 'muted'],
] as const satisfies readonly (readonly [string, Variant])[]

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
        {BADGE_VARIANTS.map(([label, variant]) => (
          <div className="catalog-component-example" key={variant}>
            <Badge variant={variant}>{label}</Badge>
          </div>
        ))}
      </div>
    </Section>
  )
}
