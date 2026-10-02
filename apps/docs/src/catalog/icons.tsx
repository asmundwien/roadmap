import { Icon, icon } from '@roadmap/ui/icon'
import { PageTitle } from '@roadmap/ui/page'
import { Section, SectionDescription, SectionHeader } from '@roadmap/ui/section'
import classNames from 'classnames/bind'
import styles from './badges.module.css'

const cx = classNames.bind(styles)

const ICONS = Object.values(icon)

export function IconsCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <PageTitle>Icons</PageTitle>
        <SectionDescription>
          Decorative symbols inherit text color. Pair each icon with a text label.
        </SectionDescription>
      </SectionHeader>
      <div className={cx('catalog-component-examples')}>
        {ICONS.map((iconName) => (
          <div className={cx('catalog-component-example')} key={iconName}>
            <Icon icon={iconName} />
            <span>{iconName}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}
