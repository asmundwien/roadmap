import { useRoute } from './router.ts'
import { ProjectList } from './views/project-list.tsx'
import { ProjectScreen } from './views/project-screen.tsx'
import { SiteHeader } from './views/site-header.tsx'

/** Routing shell: the site header frames every screen; the project list is home, `#/owner/repo` opens a project. */
export function App() {
  const route = useRoute()

  return (
    <>
      <SiteHeader />
      {route.screen === 'project' ? <ProjectScreen route={route} /> : <ProjectList />}
    </>
  )
}
