import { commandSchema } from '@roadmap/contracts/operations'
import { StrictMode, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router'
import { App } from '../../apps/web/src/App'
import { RoadmapProvider } from '../../apps/web/src/store/roadmap-provider'
import { createRoadmapStore } from '../../apps/web/src/store/roadmap-store'
import '@roadmap/ui/index.css'
import '../../apps/web/src/index.module.css'

const store = createRoadmapStore(location.origin, { reconnectDelayMs: () => 100 })
let navigateTo: ReturnType<typeof useNavigate> | null = null

function NavigationProbe() {
  const navigate = useNavigate()
  useLayoutEffect(() => {
    navigateTo = navigate
    return () => {
      navigateTo = null
    }
  }, [navigate])
  return null
}

const api = {
  snapshot: () => store.getSnapshot(),
  navigate(path: string) {
    if (navigateTo === null) throw new Error('The real router is not mounted.')
    navigateTo(path)
  },
  executeOverride(target: unknown, stage: unknown) {
    const state = store.getSnapshot().state
    const readable =
      state?.phase === 'ready' ? state : state && 'retained' in state ? state.retained : null
    if (!readable) throw new Error('An override probe requires accepted application state.')
    return store.execute(
      commandSchema.parse({
        type: 'start-automation-override',
        expectedConfigurationVersion: readable.configurationVersion,
        target,
        stage,
      }),
    )
  },
}
declare global {
  interface Window {
    resourceResultsFixture: typeof api
  }
}
window.resourceResultsFixture = api
const element = document.getElementById('root')
if (element === null) throw new Error('Missing fixture root.')
createRoot(element).render(
  <StrictMode>
    <RoadmapProvider store={store}>
      <BrowserRouter>
        <NavigationProbe />
        <App />
      </BrowserRouter>
    </RoadmapProvider>
  </StrictMode>,
)
