import { isPrototypeRequested, StridePrototype } from './prototypes/stride/prototype.tsx'
import { useRoute } from './router.ts'
import { MapScreen } from './views/map-screen.tsx'
import { ProjectList } from './views/project-list.tsx'

/**
 * Routing shell: the project list is home, `#/map/...` opens a map.
 *
 * PROTOTYPE (throwaway): `?variant=A` hands the page to the stride/card prototype instead. Goes
 * away with the rest of `src/prototypes/` once issue #12 picks a direction.
 */
export function App() {
  const route = useRoute()

  if (isPrototypeRequested()) return <StridePrototype />

  if (route.screen === 'map') return <MapScreen route={route} />
  return <ProjectList />
}
