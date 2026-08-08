import { useRoute } from './router.ts'
import { MapScreen } from './views/map-screen.tsx'
import { ProjectList } from './views/project-list.tsx'

/** Routing shell: the project list is home, `#/map/...` opens a map. */
export function App() {
  const route = useRoute()

  if (route.screen === 'map') return <MapScreen route={route} />
  return <ProjectList />
}
