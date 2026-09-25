import { useRoute } from './router'
import { CatalogPage } from './views/catalog/page'
import { MapPage } from './views/map/page'
import { OverviewPage } from './views/overview/page'
import { SettingsPage } from './views/settings/page'
import { SiteHeader } from './views/shell/site-header'

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
