import { useRoute } from './router.ts'
import { AutomationSettings } from './views/automation-settings.tsx'
import { ConnectionSettings } from './views/connection-settings.tsx'
import { ProjectList } from './views/project-list.tsx'
import { ProjectScreen } from './views/project-screen.tsx'
import { ProjectSettings } from './views/project-settings.tsx'
import { SiteHeader } from './views/site-header.tsx'

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
    </>
  )
}
