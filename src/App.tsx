import { useRoute } from './router.ts'
import { ProjectList } from './views/project-list.tsx'
import { ProjectScreen } from './views/project-screen.tsx'

/** Routing shell: the project list is home, `#/owner/repo` opens a project. */
export function App() {
  const route = useRoute()

  if (route.screen === 'project') return <ProjectScreen route={route} />
  return <ProjectList />
}
