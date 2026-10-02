import { Page, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import type { ReactNode } from 'react'
import { AlertsCatalogSection } from './catalog/alerts'
import { BadgesCatalogSection } from './catalog/badges'
import { ButtonsCatalogSection } from './catalog/buttons'
import { ControlGroupCatalogSection } from './catalog/control-group'
import { IconsCatalogSection } from './catalog/icons'
import { LinksCatalogSection } from './catalog/links'
import { MarkCatalogPage } from './catalog/mark'
import { ModalCatalogSection } from './catalog/modal'
import { ReferenceTokensPage } from './catalog/reference'
import { ReferenceColorsCatalogSection } from './catalog/reference-colors'
import { ReferenceDimensionsCatalogSection } from './catalog/reference-dimensions'
import { ReferenceMotionCatalogSection } from './catalog/reference-motion'
import { ReferenceTypographyCatalogSection } from './catalog/reference-typography'
import { SemanticPaletteCatalogSection } from './catalog/semantic'
import { SurfacesCatalogPage } from './catalog/surfaces'
import { TextInputCatalogSection } from './catalog/text-input'
import { ToggleCatalogSection } from './catalog/toggle'
import styles from './shell.module.css'

const cx = classNames.bind(styles)

function getPage(pathname: string) {
  switch (pathname) {
    case '/':
    case '/tokens/reference':
      return { title: 'Reference tokens', content: <ReferenceTokensPage /> }
    case '/tokens/reference-colors':
      return { title: 'Reference colors', content: <ReferenceColorsCatalogSection /> }
    case '/tokens/reference-typography':
      return { title: 'Reference typography', content: <ReferenceTypographyCatalogSection /> }
    case '/tokens/reference-dimensions':
      return { title: 'Reference dimensions', content: <ReferenceDimensionsCatalogSection /> }
    case '/tokens/reference-motion':
      return { title: 'Reference motion', content: <ReferenceMotionCatalogSection /> }
    case '/tokens/semantic':
      return { title: 'Semantic tokens', content: <SemanticPaletteCatalogSection /> }
    case '/components/surfaces':
      return { title: 'Surfaces', content: <SurfacesCatalogPage /> }
    case '/components/mark':
      return { title: 'Mark', content: <MarkCatalogPage /> }
    case '/components/badges':
      return { title: 'Badges', content: <BadgesCatalogSection /> }
    case '/components/alerts':
      return { title: 'Alerts', content: <AlertsCatalogSection /> }
    case '/components/icons':
      return { title: 'Icons', content: <IconsCatalogSection /> }
    case '/components/buttons':
      return { title: 'Buttons', content: <ButtonsCatalogSection /> }
    case '/components/control-group':
      return { title: 'Control group', content: <ControlGroupCatalogSection /> }
    case '/components/modal':
      return { title: 'Modal', content: <ModalCatalogSection /> }
    case '/components/text-input':
      return { title: 'Text input', content: <TextInputCatalogSection /> }
    case '/components/toggle':
      return { title: 'Toggle', content: <ToggleCatalogSection /> }
    case '/components/links':
      return { title: 'Links', content: <LinksCatalogSection /> }
    default:
      return {
        title: 'Page not found',
        content: (
          <>
            <PageTitle>Page not found</PageTitle>
            <p>This documentation page does not exist.</p>
            <a href="/">Return to the documentation home</a>
          </>
        ),
      }
  }
}

type NavigationGroupProps = {
  group: 'Tokens' | 'Components'
  children: ReactNode
}

function NavigationGroup({ group, children }: NavigationGroupProps) {
  return (
    <div className={cx('navigationGroup')}>
      <h2 className={cx('groupTitle')} id={`navigation-${group}`}>
        {group}
      </h2>
      <ul className={cx('navigationList')} aria-labelledby={`navigation-${group}`}>
        {children}
      </ul>
    </div>
  )
}

type NavigationLinkProps = {
  href: string
  children: ReactNode
}

function NavigationLink({ href, children }: NavigationLinkProps) {
  const pathname = window.location.pathname
  const selected = href === pathname || (pathname === '/' && href === '/tokens/reference')

  return (
    <li>
      <a
        className={cx('navigationLink', { selected })}
        href={href}
        aria-current={selected ? 'page' : undefined}
      >
        {children}
      </a>
    </li>
  )
}

export function App() {
  const page = getPage(window.location.pathname)

  return (
    <div className={cx('shell')}>
      <title>{`${page.title} | Roadmap UI docs`}</title>
      <a className={cx('skipLink')} href="#catalog-content">
        Skip to content
      </a>
      <header className={cx('header')}>
        <a className={cx('brand')} href="/">
          Roadmap <span className={cx('brandDetail')}>UI docs</span>
        </a>
        <p className={cx('headerDescription')}>Design tokens and shared components</p>
      </header>
      <div className={cx('layout')}>
        <nav className={cx('navigation')} aria-label="Documentation">
          <NavigationGroup group="Tokens">
            <NavigationLink href="/tokens/reference">Reference tokens</NavigationLink>
            <NavigationLink href="/tokens/reference-colors">Reference colors</NavigationLink>
            <NavigationLink href="/tokens/reference-typography">
              Reference typography
            </NavigationLink>
            <NavigationLink href="/tokens/reference-dimensions">
              Reference dimensions
            </NavigationLink>
            <NavigationLink href="/tokens/reference-motion">Reference motion</NavigationLink>
            <NavigationLink href="/tokens/semantic">Semantic tokens</NavigationLink>
          </NavigationGroup>
          <NavigationGroup group="Components">
            <NavigationLink href="/components/surfaces">Surfaces</NavigationLink>
            <NavigationLink href="/components/mark">Mark</NavigationLink>
            <NavigationLink href="/components/badges">Badges</NavigationLink>
            <NavigationLink href="/components/alerts">Alerts</NavigationLink>
            <NavigationLink href="/components/icons">Icons</NavigationLink>
            <NavigationLink href="/components/buttons">Buttons</NavigationLink>
            <NavigationLink href="/components/control-group">Control group</NavigationLink>
            <NavigationLink href="/components/modal">Modal</NavigationLink>
            <NavigationLink href="/components/text-input">Text input</NavigationLink>
            <NavigationLink href="/components/toggle">Toggle</NavigationLink>
            <NavigationLink href="/components/links">Links</NavigationLink>
          </NavigationGroup>
        </nav>
        <Page className={cx('content')} id="catalog-content" tabIndex={-1}>
          {page.content}
        </Page>
      </div>
    </div>
  )
}
