import type { ApplicationState, ReadyApplicationState } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'
import type { RoadmapWorkflows, WorkflowSnapshot } from '@/workflows/workflows'
import { createStoreFromEnv } from './create-store'
import type {
  RoadmapLifecycle,
  RoadmapStore,
  RoadmapStoreSnapshot,
  TransportLiveness,
} from './roadmap-store'

const RoadmapContext = createContext<RoadmapStore | null>(null)

export interface RoadmapViewState {
  readonly transport: TransportLiveness
  readonly lifecycle: RoadmapLifecycle
  readonly synchronization: Exclude<RoadmapStoreSnapshot['synchronization'], 'not-ready'>
  readonly projects: ReadyApplicationState['projects']
  readonly connections: ReadyApplicationState['connections']
  readonly configuration: ReadyApplicationState['configuration']
  readonly automation: ReadyApplicationState['automation']
  readonly capturedAt: ReadyApplicationState['capturedAt']
  readonly supportedIntegrations: ReadyApplicationState['supportedIntegrations']
  readonly authorizationOperations: ReadyApplicationState['authorizationOperations']
  readonly configurationVersion: ReadyApplicationState['configurationVersion']
  readonly workflows: RoadmapWorkflows
  readonly workflowState: WorkflowSnapshot
}

function readableState(
  state: Readonly<ApplicationState> | null,
): Readonly<ReadyApplicationState> | null {
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
  const status = useSyncExternalStoreWithSelector(
    value.subscribe,
    value.getSnapshot,
    // Static consumer tests use this snapshot; the SPA has no hydration contract.
    value.getSnapshot,
    selectProviderStatus,
    selectedEqual,
  )
  useEffect(() => value.start(), [value])

  if (!status.readable) {
    return (
      <div
        role="status"
        data-roadmap-readiness="waiting"
        data-roadmap-lifecycle={status.lifecycle?.phase}
      >
        <Alert variant="info">{waitingMessage(status.lifecycle)}</Alert>
      </div>
    )
  }

  return (
    <RoadmapContext.Provider value={value}>
      {status.synchronization === 'retained' && (
        <div
          role="status"
          data-roadmap-readiness="retained"
          data-roadmap-lifecycle={status.lifecycle?.phase}
        >
          <Alert variant="info">
            Showing the last authoritative Roadmap snapshot without current application readiness.
          </Alert>
        </div>
      )}
      {children}
    </RoadmapContext.Provider>
  )
}

/** Observes only the pure selected result, with semantic reuse across full publications. */
export function useRoadmap<T>(selector: (roadmap: RoadmapViewState) => T): T {
  const store = useContext(RoadmapContext)
  if (!store) throw new Error('useRoadmap must be used inside a <RoadmapProvider>')

  return useSyncExternalStoreWithSelector(
    store.subscribe,
    store.getSnapshot,
    // Static consumer tests use this snapshot; the SPA has no hydration contract.
    store.getSnapshot,
    (snapshot) => freezeSelected(selector(roadmapView(store, snapshot))),
    selectedEqual,
  )
}

function roadmapView(store: RoadmapStore, snapshot: RoadmapStoreSnapshot): RoadmapViewState {
  const state = readableState(snapshot.state)
  if (state === null || snapshot.synchronization === 'not-ready' || snapshot.lifecycle === null) {
    throw new Error('useRoadmap requires authoritative readable state from its provider')
  }

  return Object.freeze({
    transport: snapshot.transport,
    lifecycle: snapshot.lifecycle,
    synchronization: snapshot.lifecycle.phase === 'ready' ? snapshot.synchronization : 'retained',
    projects: state.projects,
    connections: state.connections,
    automation: state.automation,
    configuration: state.configuration,
    capturedAt: state.capturedAt,
    supportedIntegrations: state.supportedIntegrations,
    authorizationOperations: state.authorizationOperations,
    configurationVersion: state.configurationVersion,
    workflows: store.workflows,
    workflowState: snapshot.workflows,
  })
}

function selectProviderStatus(snapshot: RoadmapStoreSnapshot) {
  return {
    readable:
      snapshot.lifecycle !== null &&
      snapshot.synchronization !== 'not-ready' &&
      readableState(snapshot.state) !== null,
    lifecycle: snapshot.lifecycle,
    synchronization:
      snapshot.synchronization === 'not-ready' || snapshot.lifecycle?.phase === 'ready'
        ? snapshot.synchronization
        : 'retained',
  }
}

function waitingMessage(lifecycle: RoadmapLifecycle | null): string {
  if (lifecycle === null) return 'Waiting for the first authoritative Roadmap state.'
  switch (lifecycle.phase) {
    case 'ready':
      return `Roadmap application is ready in ${lifecycle.mode} mode. Waiting for authoritative readable state.`
    case 'failed':
      return `Roadmap application failed: ${lifecycle.cause} Waiting for authoritative readable state.`
    case 'idle':
    case 'starting':
    case 'stopping':
    case 'stopped':
      return `Roadmap application is ${lifecycle.phase}. Waiting for authoritative readable state.`
    default: {
      const exhaustive: never = lifecycle
      return exhaustive
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function selectedEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    if (
      Object.getPrototypeOf(left) !== Array.prototype ||
      Object.getPrototypeOf(right) !== Array.prototype
    ) {
      return false
    }
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
      if (Object.hasOwn(left, index) !== Object.hasOwn(right, index)) return false
      if (!selectedEqual(left[index], right[index])) return false
    }
    return true
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && selectedEqual(left[key], right[key]))
  )
}

function freezeSelected<T>(value: T): T {
  if (Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return value
    Object.freeze(value)
    for (const key in value) {
      if (Object.hasOwn(value, key)) freezeSelected(value[key])
    }
  } else if (isPlainRecord(value)) {
    Object.freeze(value)
    for (const key in value) {
      if (Object.hasOwn(value, key)) freezeSelected(value[key])
    }
  }
  return value
}
