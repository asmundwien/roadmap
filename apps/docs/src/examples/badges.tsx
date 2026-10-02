import { Badge } from '@roadmap/ui/badge'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import type { Variant } from '@roadmap/ui/variant'
import { ComponentExample, ComponentExamples } from './component-examples'

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

export function BadgesPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Badges</PageTitle>
        <PageDescription>
          Compact status and metadata labels. Text states the meaning; color supports it. Every
          supported variant appears here.
        </PageDescription>
      </PageHeader>

      <ComponentExamples>
        {BADGE_VARIANTS.map(([label, variant]) => (
          <ComponentExample key={variant}>
            <Badge variant={variant}>{label}</Badge>
          </ComponentExample>
        ))}
      </ComponentExamples>
    </>
  )
}
