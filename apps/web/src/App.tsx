import { useRoute } from './router.ts'
import { CatalogPage } from './views/catalog/page.tsx'
import { MapPage } from './views/map/page.tsx'
import { OverviewPage } from './views/overview/page.tsx'
import { SettingsPage } from './views/settings/page.tsx'
import { SiteHeader } from './views/shell/site-header.tsx'

/** The persistent header frames Overview, settings, and existing Project/map routes. */
export function App() {
  const route = useRoute()

  return (
    <>
      <SiteHeader route={route} />
      {route.screen === 'project' && <MapPage route={route} />}
      {route.screen === 'projects' && <OverviewPage />}
      {(route.screen === 'project-settings' ||
        route.screen === 'connection-settings' ||
        route.screen === 'automation-settings') && <SettingsPage route={route} />}
      {route.screen === 'components' && <CatalogPage />}
    </>
  )
}
