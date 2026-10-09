import type { ApplicationState, ReadyApplicationState } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import { createStoreFromEnv } from './create-store'
import type {
  CommandActivity,
  RoadmapStore,
  RoadmapStoreSnapshot,
  TransportLiveness,
} from './roadmap-store'

const RoadmapContext = createContext<RoadmapStore | null>(null)

export interface RoadmapViewState {
  transport: TransportLiveness
  synchronization: Exclude<RoadmapStoreSnapshot['synchronization'], 'not-ready'>
  projects: ReadyApplicationState['projects']
  connections: ReadyApplicationState['connections']
  configuration: ReadyApplicationState['configuration']
  automation: ReadyApplicationState['automation']
  capturedAt: number
  supportedIntegrations: ReadyApplicationState['supportedIntegrations']
  authorizationOperations: ReadyApplicationState['authorizationOperations']
  configurationVersion: ReadyApplicationState['configurationVersion']
  command: CommandActivity
  query: RoadmapStore['query']
  execute: RoadmapStore['execute']
}

function readableState(state: ApplicationState | null): ReadyApplicationState | null {
  if (state === null) return null
  switch (state.phase) {
    case 'ready':
      return state
    case 'failed':
    case 'stopping':
    case 'stopped':
      return state.retained
    case 'idle':
    case 'starting':
      return null
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

type RoadmapProviderProps = {
  children?: ReactNode
  store?: RoadmapStore
}

/** Owns the single store the app renders from; injectable for prototypes and tests. */
export function RoadmapProvider({ children, store }: RoadmapProviderProps) {
  const value = useMemo(() => store ?? createStoreFromEnv(), [store])
  const snapshot = useSyncExternalStore(value.subscribe, value.getSnapshot, value.getSnapshot)
  useEffect(() => value.start(), [value])

  if (readableState(snapshot.state) === null) {
    return (
      <div role="status" data-roadmap-readiness="waiting">
        <Alert variant="info">Waiting for the first authoritative Roadmap state.</Alert>
      </div>
    )
  }

  return (
    <RoadmapContext.Provider value={value}>
      {(snapshot.synchronization === 'retained' || snapshot.state?.phase !== 'ready') && (
        <div role="status" data-roadmap-readiness="retained">
          <Alert variant="info">
            Showing the last authoritative Roadmap snapshot without current application readiness.
          </Alert>
        </div>
      )}
      {children}
    </RoadmapContext.Provider>
  )
}

/** Projects the application's roadmap while preserving transport liveness and stale-state truth. */
export function useRoadmap(): RoadmapViewState {
  const store = useContext(RoadmapContext)
  if (!store) throw new Error('useRoadmap must be used inside a <RoadmapProvider>')

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const state = readableState(snapshot.state)
  if (state === null || snapshot.synchronization === 'not-ready') {
    throw new Error('useRoadmap requires authoritative readable state from its provider')
  }

  return {
    transport: snapshot.transport,
    synchronization: snapshot.state?.phase === 'ready' ? snapshot.synchronization : 'retained',
    projects: state.projects,
    connections: state.connections,
    automation: state.automation,
    configuration: state.configuration,
    capturedAt: state.capturedAt,
    supportedIntegrations: state.supportedIntegrations,
    authorizationOperations: state.authorizationOperations,
    configurationVersion: state.configurationVersion,
    command: snapshot.command,
    query: store.query,
    execute: store.execute,
  }
}
