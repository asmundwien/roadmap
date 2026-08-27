import type { ApplicationState, Snapshot } from '@roadmap/contracts'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import { createStoreFromEnv } from './create-store.ts'
import type { CommandActivity, RoadmapStore, TransportLiveness } from './roadmap-store.ts'

const RoadmapContext = createContext<RoadmapStore | null>(null)
const EMPTY_ROADMAP: Snapshot = { capturedAt: 0, projects: [], unreachable: [] }

export interface RoadmapViewState {
  transport: TransportLiveness
  projects: ApplicationState['projects']
  roadmapProjects: Snapshot['projects']
  connections: ApplicationState['connections']
  configuration: ApplicationState['configuration']
  automation: ApplicationState['automation']
  unreachable: Snapshot['unreachable']
  /** Null until an authoritative ApplicationState has arrived. */
  capturedAt: number | null
  supportedIntegrations: ApplicationState['supportedIntegrations']
  authorizationOperations: ApplicationState['authorizationOperations']
  configurationVersion: number
  command: CommandActivity
  query: RoadmapStore['query']
  execute: RoadmapStore['execute']
}

/** Owns the single store the app renders from; injectable for prototypes and tests. */
export function RoadmapProvider({
  children,
  store,
}: {
  children: ReactNode
  store?: RoadmapStore
}) {
  const value = useMemo(() => store ?? createStoreFromEnv(), [store])
  return <RoadmapContext.Provider value={value}>{children}</RoadmapContext.Provider>
}

/** Projects the application's roadmap while preserving transport liveness and stale-state truth. */
export function useRoadmap(): RoadmapViewState {
  const store = useContext(RoadmapContext)
  if (!store) throw new Error('useRoadmap must be used inside a <RoadmapProvider>')

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => store.start(), [store])
  const state = snapshot.state
  const roadmap = state?.roadmap ?? EMPTY_ROADMAP

  return {
    transport: snapshot.transport,
    projects: state?.projects ?? [],
    roadmapProjects: roadmap.projects,
    connections: state?.connections ?? [],
    automation: state?.automation ?? {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'unavailable', cause: 'Waiting for Roadmap state.' },
      evidence: [],
    },
    configuration: state?.configuration ?? { valid: true, issues: [], notices: [] },
    unreachable: roadmap.unreachable,
    capturedAt: state === null ? null : roadmap.capturedAt,
    supportedIntegrations: state?.supportedIntegrations ?? [],
    authorizationOperations: state?.authorizationOperations ?? [],
    configurationVersion: state?.configurationVersion ?? 0,
    command: snapshot.command,
    query: store.query,
    execute: store.execute,
  }
}
