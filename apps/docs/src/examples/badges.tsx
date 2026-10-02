import { Badge } from '@roadmap/ui/badge'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
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

      <div className={cx('component-examples')}>
        {BADGE_VARIANTS.map(([label, variant]) => (
          <div className={cx('component-example')} key={variant}>
            <Badge variant={variant}>{label}</Badge>
          </div>
        ))}
      </div>
    </>
  )
}
