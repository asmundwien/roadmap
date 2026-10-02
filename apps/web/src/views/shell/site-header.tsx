import { Link } from '@roadmap/ui/link'
import { Navbar, NavbarBrand } from '@roadmap/ui/navbar'
import {
  automationSettingsHash,
  componentsHash,
  connectionSettingsHash,
  overviewHash,
} from '@/router'
import styles from './site-header.module.css'

/** Composes shared navigation components without active-route highlighting. */
export function SiteHeader() {
  return (
    <Navbar>
      <NavbarBrand href={overviewHash}>
        <img className={styles.brandIcon} src="/favicon.svg" alt="" width="20" height="20" />
        Roadmap
      </NavbarBrand>
      <nav className={styles.navigation} aria-label="Primary navigation">
        <Link href={overviewHash}>Overview</Link>
        <Link href={connectionSettingsHash}>Connections</Link>
        <Link href={automationSettingsHash}>Automation</Link>
        <Link href={componentsHash}>Components</Link>
      </nav>
      <Link href="http://localhost:5174">
        Open UI docs
      </Link>
    </Navbar>
  )
}
