import { lazy, Suspense } from 'react'
import { useRoute } from './router'
import { CatalogPage } from './views/catalog/page'
import { OverviewPage } from './views/overview/page'
import { ProjectImportPage } from './views/settings/connections/[connectionId]/import/page'
import { ConnectionPage } from './views/settings/connections/[connectionId]/page'
import { ConnectionSettings } from './views/settings/connections/page'
import { ProjectRegistrationPage } from './views/settings/projects/[projectId]/page'
import { SiteHeader } from './views/shell/site-header'

const MapPage = lazy(() => import('./views/map/page').then(({ MapPage }) => ({ default: MapPage })))

/** The persistent header frames Overview, settings, and existing Project/map routes. */
export function App() {
  const route = useRoute()

  return (
    <>
      <SiteHeader />
      {route.screen === 'project' && (
        <Suspense fallback={null}>
          <MapPage route={route} />
        </Suspense>
      )}
      {route.screen === 'projects' && <OverviewPage />}
      {route.screen === 'connection-settings' && <ConnectionSettings />}
      {route.screen === 'connection' && <ConnectionPage connectionId={route.connectionId} />}
      {route.screen === 'project-import' && <ProjectImportPage connectionId={route.connectionId} />}
      {route.screen === 'project-registration' && (
        <ProjectRegistrationPage projectKey={route.project} />
      )}
      {route.screen === 'components' && <CatalogPage />}
    </>
  )
}
