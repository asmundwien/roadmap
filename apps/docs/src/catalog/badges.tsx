import { Badge } from '@roadmap/ui/badge'
import { PageTitle } from '@roadmap/ui/page'
import { Section, SectionDescription, SectionHeader } from '@roadmap/ui/section'
import type { Variant } from '@roadmap/ui/variant'
import classNames from 'classnames/bind'
import styles from './badges.module.css'

const cx = classNames.bind(styles)

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
        <PageTitle>Badges</PageTitle>
        <SectionDescription>
          Compact status and metadata labels. Text states the meaning; color supports it. Every
          supported variant appears here.
        </SectionDescription>
      </SectionHeader>

      <div className={cx('catalog-component-examples')}>
        {BADGE_VARIANTS.map(([label, variant]) => (
          <div className={cx('catalog-component-example')} key={variant}>
            <Badge variant={variant}>{label}</Badge>
          </div>
        ))}
      </div>
    </Section>
  )
}
