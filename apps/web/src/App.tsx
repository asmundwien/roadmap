import { useRoute } from './router.ts'
import { ComponentCatalog } from './views/catalog/component-catalog.tsx'
import { ProjectScreen } from './views/map/project-screen.tsx'
import { ProjectList } from './views/overview/project-list.tsx'
import { AutomationSettings } from './views/settings/automation-settings.tsx'
import { ConnectionSettings } from './views/settings/connection-settings.tsx'
import { ProjectSettings } from './views/settings/project-settings.tsx'
import { SiteHeader } from './views/shell/site-header.tsx'

/** The persistent header frames Overview, settings, and existing Project/map routes. */
export function App() {
  const route = useRoute()

  return (
    <>
      <SiteHeader route={route} />
      {route.screen === 'project' && <ProjectScreen route={route} />}
      {route.screen === 'projects' && <ProjectList />}
      {route.screen === 'project-settings' && <ProjectSettings />}
      {route.screen === 'connection-settings' && <ConnectionSettings />}
      {route.screen === 'automation-settings' && <AutomationSettings />}
      {route.screen === 'components' && <ComponentCatalog />}
    </>
  )
}
