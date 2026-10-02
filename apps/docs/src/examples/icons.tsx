import { Icon, icon } from '@roadmap/ui/icon'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import styles from './badges.module.css'

const cx = classNames.bind(styles)

const ICONS = Object.values(icon)

export function IconsPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Icons</PageTitle>
        <PageDescription>
          Decorative symbols inherit text color. Pair each icon with a text label.
        </PageDescription>
      </PageHeader>
      <div className={cx('component-examples')}>
        {ICONS.map((iconName) => (
          <div className={cx('component-example')} key={iconName}>
            <Icon icon={iconName} />
            <span>{iconName}</span>
          </div>
        ))}
      </div>
    </>
  )
}
