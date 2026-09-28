import { useRoute } from './router'
import { CatalogPage } from './views/catalog/page'
import { MapPage } from './views/map/page'
import { OverviewPage } from './views/overview/page'
import { ConnectionPage } from './views/settings/connections/[connectionId]/page'
import { ConnectionSettings } from './views/settings/connections/page'
import { SettingsPage } from './views/settings/page'
import { ProjectRegistrationPage } from './views/settings/projects/[projectId]/page'
import { SiteHeader } from './views/shell/site-header'

/** The persistent header frames Overview, settings, and existing Project/map routes. */
export function App() {
  const route = useRoute()

  return (
    <>
      <SiteHeader route={route} />
      {route.screen === 'project' && <MapPage route={route} />}
      {route.screen === 'projects' && <OverviewPage />}
      {(route.screen === 'project-settings' || route.screen === 'automation-settings') && (
        <SettingsPage route={route} />
      )}
      {route.screen === 'connection-settings' && <ConnectionSettings />}
      {route.screen === 'connection' && <ConnectionPage connectionId={route.connectionId} />}
      {route.screen === 'project-registration' && (
        <ProjectRegistrationPage projectKey={route.project} />
      )}
      {route.screen === 'components' && <CatalogPage />}
    </>
  )
}
