import type { ApplicationState, ReadyApplicationState } from '@roadmap/contracts/state'
import { useRoadmap } from '@/store/roadmap-provider'
import type { RoadmapLifecycle, RoadmapStoreSnapshot } from '@/store/roadmap-store'
import type { RoadmapWorkflows, WorkflowSnapshot } from '@/workflows/workflows'

export function selectedProjects(): ReadyApplicationState['projects'] {
  return useRoadmap((roadmap) => roadmap.projects)
}

export function derivedSelection() {
  const selected = useRoadmap((roadmap) => ({
    projects: roadmap.projects,
    projectCount: roadmap.projects.length,
    workflows: roadmap.workflows,
    workflowState: roadmap.workflowState,
    lifecycle: roadmap.lifecycle,
  }))
  const projects: ReadyApplicationState['projects'] = selected.projects
  const projectCount: number = selected.projectCount
  const workflows: RoadmapWorkflows = selected.workflows
  const workflowState: WorkflowSnapshot = selected.workflowState
  return { projects, projectCount, workflows, workflowState, lifecycle: selected.lifecycle }
}

export function selectedLifecycle(): RoadmapLifecycle {
  return useRoadmap((roadmap) => roadmap.lifecycle)
}

export function lifecyclePayload(lifecycle: RoadmapLifecycle) {
  if (lifecycle.phase === 'ready') {
    const mode: Extract<ApplicationState, { phase: 'ready' }>['mode'] = lifecycle.mode
    return mode
  }
  if (lifecycle.phase === 'failed') {
    const cause: Extract<ApplicationState, { phase: 'failed' }>['cause'] = lifecycle.cause
    return cause
  }
  return lifecycle.phase
}

export function unreadableState(snapshot: RoadmapStoreSnapshot): null | undefined {
  if (snapshot.synchronization === 'not-ready') {
    const state: null = snapshot.state
    return state
  }
  const state: Readonly<ApplicationState> = snapshot.state
  void state
  return undefined
}

export const readyLifecycle: RoadmapLifecycle = { phase: 'ready', mode: 'mutable' }
export const failedLifecycle: RoadmapLifecycle = { phase: 'failed', cause: 'source unavailable' }
export const startingLifecycle: RoadmapLifecycle = { phase: 'starting' }
export const initialSnapshot: RoadmapStoreSnapshot = {
  transport: 'connecting',
  lifecycle: null,
  synchronization: 'not-ready',
  state: null,
  workflows: {
    attempts: [],
    policy: { synchronization: 'not-ready', lifecycle: null, state: null },
  },
}

// Invalid constructions.
declare const acceptedState: Readonly<ApplicationState>

export const invalidMissingSelector = useRoadmap()
export const invalidReadyLifecycle: RoadmapLifecycle = { phase: 'ready' }
export const invalidFailedLifecycle: RoadmapLifecycle = { phase: 'failed' }
export const invalidReadyCause: RoadmapLifecycle = {
  phase: 'ready',
  mode: 'mutable',
  cause: 'failed',
}
export const invalidNotReady: RoadmapStoreSnapshot = {
  ...initialSnapshot,
  synchronization: 'not-ready',
  state: acceptedState,
}
export const invalidSynchronized: RoadmapStoreSnapshot = {
  ...initialSnapshot,
  synchronization: 'synchronized',
  state: null,
}
