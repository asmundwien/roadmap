import type { ApplicationState, Snapshot } from '@roadmap/contracts'
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
  projects: ApplicationState['projects']
  roadmapProjects: Snapshot['projects']
  connections: ApplicationState['connections']
  configuration: ApplicationState['configuration']
  automation: ApplicationState['automation']
  unreachable: Snapshot['unreachable']
  capturedAt: number
  supportedIntegrations: ApplicationState['supportedIntegrations']
  authorizationOperations: ApplicationState['authorizationOperations']
  configurationVersion: number
  command: CommandActivity
  query: RoadmapStore['query']
  execute: RoadmapStore['execute']
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

  if (snapshot.synchronization === 'not-ready') {
    return (
      <div role="status">
        <Alert variant="info">Waiting for the first authoritative Roadmap state.</Alert>
      </div>
    )
  }

  return (
    <RoadmapContext.Provider value={value}>
      {snapshot.synchronization === 'retained' && (
        <div role="status">
          <Alert variant="info">
            Showing the last authoritative Roadmap snapshot while synchronization is pending.
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
  if (snapshot.synchronization === 'not-ready') {
    throw new Error('useRoadmap requires authoritative state from its provider')
  }
  const { state } = snapshot
  const { roadmap } = state

  return {
    transport: snapshot.transport,
    synchronization: snapshot.synchronization,
    projects: state.projects,
    roadmapProjects: roadmap.projects,
    connections: state.connections,
    automation: state.automation,
    configuration: state.configuration,
    unreachable: roadmap.unreachable,
    capturedAt: roadmap.capturedAt,
    supportedIntegrations: state.supportedIntegrations,
    authorizationOperations: state.authorizationOperations,
    configurationVersion: state.configurationVersion,
    command: snapshot.command,
    query: store.query,
    execute: store.execute,
  }
}
