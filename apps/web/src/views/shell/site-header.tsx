import { Link as ExternalLink } from '@roadmap/ui/link'
import { Navbar } from '@roadmap/ui/navbar'
import classNames from 'classnames/bind'
import { Link, NavbarBrand } from '@/navigation'
import { routePaths } from '@/router'
import styles from './site-header.module.css'

const cx = classNames.bind(styles)

/** Composes shared navigation components without active-route highlighting. */
export function SiteHeader() {
  return (
    <Navbar>
      <NavbarBrand href={routePaths.overview}>
        <img className={cx('brandIcon')} src="/favicon.svg" alt="" width="20" height="20" />
        Roadmap
      </NavbarBrand>
      <nav className={cx('navigation')} aria-label="Primary navigation">
        <Link href={routePaths.overview}>Overview</Link>
        <Link href={routePaths.connections}>Connections</Link>
        <Link href={routePaths.components}>Components</Link>
      </nav>
      <ExternalLink href="http://localhost:5174">Open UI docs</ExternalLink>
    </Navbar>
  )
}
