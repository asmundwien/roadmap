import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import { createStoreFromEnv } from './create-store.ts'
import type { RoadmapSnapshot, RoadmapStore } from './roadmap-store.ts'

const RoadmapContext = createContext<RoadmapStore | null>(null)

/**
 * Owns the single store the app renders from. `store` is injectable so prototypes and tests can
 * drive the views off fixtures instead of a live socket.
 */
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

/** Subscribes to the live snapshot, keeping the socket open for as long as anything is watching. */
export function useRoadmap(): RoadmapSnapshot {
  const store = useContext(RoadmapContext)
  if (!store) throw new Error('useRoadmap must be used inside a <RoadmapProvider>')

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  useEffect(() => store.start(), [store])

  return snapshot
}
