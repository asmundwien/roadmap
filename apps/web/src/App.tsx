import { Page, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Route, Routes, useLocation } from 'react-router'
import { Link } from './navigation'
import { connectionRoute, projectRoute, routePaths } from './router'
import { CatalogPage } from './views/catalog/page'
import { MapPage } from './views/map/page'
import { OverviewPage } from './views/overview/page'
import { ProjectImportPage } from './views/settings/connections/[connectionId]/import/page'
import { ConnectionPage } from './views/settings/connections/[connectionId]/page'
import { ConnectionSettings } from './views/settings/connections/page'
import { ProjectSettingsPage } from './views/settings/projects/[projectId]/page'
import { SiteHeader } from './views/shell/site-header'

export function App() {
  return (
    <>
      <SiteHeader />
      <Routes>
        <Route path={routePaths.overview} element={<OverviewPage />} />
        <Route path={routePaths.connections} element={<ConnectionSettings />} />
        <Route
          path={routePaths.connection}
          element={<ConnectionRoute pattern={routePaths.connection} />}
        />
        <Route
          path={routePaths.projectImport}
          element={<ConnectionRoute pattern={routePaths.projectImport} importProjects />}
        />
        <Route path={routePaths.project} element={<ProjectRoute pattern={routePaths.project} />} />
        <Route
          path={routePaths.projectSettings}
          element={<ProjectRoute pattern={routePaths.projectSettings} settings />}
        />
        <Route path={routePaths.map} element={<ProjectRoute pattern={routePaths.map} />} />
        <Route path={routePaths.ticket} element={<ProjectRoute pattern={routePaths.ticket} />} />
        <Route path={routePaths.components} element={<CatalogPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}

type ProjectRouteProps = {
  pattern: string
  settings?: boolean
}

function ProjectRoute({ pattern, settings = false }: ProjectRouteProps) {
  const { pathname } = useLocation()
  const selected = projectRoute(pattern, pathname)
  if (selected === null) return <NotFoundPage />
  return settings ? (
    <ProjectSettingsPage projectRef={selected.project} />
  ) : (
    <MapPage selection={selected} />
  )
}

type ConnectionRouteProps = {
  pattern: string
  importProjects?: boolean
}

function ConnectionRoute({ pattern, importProjects = false }: ConnectionRouteProps) {
  const { pathname } = useLocation()
  const connectionId = connectionRoute(pattern, pathname)
  if (connectionId === null) return <NotFoundPage />
  return importProjects ? (
    <ProjectImportPage connectionId={connectionId} />
  ) : (
    <ConnectionPage connectionId={connectionId} />
  )
}

function NotFoundPage() {
  return (
    <Page>
      <PageHeader>
        <PageTitle>Page not found</PageTitle>
      </PageHeader>
      <Link href={routePaths.overview}>Back to Overview</Link>
    </Page>
  )
}
