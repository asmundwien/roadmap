import { commandSchema } from '@roadmap/contracts/operations'
import { StrictMode, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router'
import { App } from '../../apps/web/src/App'
import {
  RoadmapProvider,
  type RoadmapViewState,
  useRoadmap,
} from '../../apps/web/src/store/roadmap-provider'
import { createRoadmapStore } from '../../apps/web/src/store/roadmap-store'
import '@roadmap/ui/index.css'
import '../../apps/web/src/index.module.css'

const store = createRoadmapStore(location.origin, { reconnectDelayMs: () => 400 })
const projectsSelection = (view: RoadmapViewState) => ({ projects: view.projects })
const statusSelection = (view: RoadmapViewState) => ({
  lifecycle: view.lifecycle,
  synchronization: view.synchronization,
})
const observations = {
  projectCommits: 0,
  projectIdentityChanges: 0,
  selectedResultIdentityChanges: 0,
  projectRenders: 0,
  mounts: 0,
  cleanups: 0,
}
const derivedObservations = { renders: 0, commits: 0, identities: 0 }
const derivedSelection = (view: RoadmapViewState) => ({
  projects: view.projects.map((project) => ({
    id: project.ref.projectId,
    name: project.management.displayName ?? null,
  })),
})
const outcomes: unknown[] = []
let selectedProjects: RoadmapViewState['projects'] | null = null
let observedStatus: ReturnType<typeof statusSelection> | null = null
let navigateTo: ((path: string) => void) | null = null
let mountedRoot: ReturnType<typeof createRoot> | null = null
let readers = true
let churn = 0
let ownerCount = 1
let savedNodes: {
  graph: Element
  modal: HTMLDialogElement
  mapProse: Element
  ticketProse: Element
  draft: HTMLInputElement
} | null = null
let pinnedReadState: ReturnType<typeof store.getSnapshot>['state'] = null
let pinnedUnknown: unknown = null
let pinnedCommandError: ReturnType<typeof store.getSnapshot>['command']['error'] = null

// Both projections retain compatible object keys. The old no-argument hook ignores its argument at runtime,
// so its regression is a real render/identity assertion rather than an import or destructuring failure.
function ProjectsProbe() {
  const selection = useRoadmap(projectsSelection)
  const previous = useRef(selection.projects)
  const previousSelection = useRef(selection)
  observations.projectRenders += 1
  useLayoutEffect(() => {
    observations.projectCommits += 1
    if (previous.current !== selection.projects) observations.projectIdentityChanges += 1
    if (previousSelection.current !== selection) observations.selectedResultIdentityChanges += 1
    previousSelection.current = selection
    previous.current = selection.projects
    selectedProjects = selection.projects
  })
  useLayoutEffect(() => {
    observations.mounts += 1
    return () => {
      observations.cleanups += 1
    }
  }, [])
  return (
    <output data-fixture-projects>
      {JSON.stringify(
        selection.projects.map((project) => ({
          id: project.ref.projectId,
          name: project.management.displayName,
          resource: project.resource.kind,
        })),
      )}
    </output>
  )
}

function DerivedProbe() {
  const selection = useRoadmap(derivedSelection)
  const previous = useRef(selection)
  derivedObservations.renders += 1
  useLayoutEffect(() => {
    derivedObservations.commits += 1
    if (previous.current !== selection) derivedObservations.identities += 1
    previous.current = selection
  })
  return <output data-fixture-derived>{JSON.stringify(selection)}</output>
}

function StatusProbe() {
  const value = useRoadmap(statusSelection)
  useLayoutEffect(() => {
    observedStatus = value
  })
  return <output data-fixture-status>{JSON.stringify(value)}</output>
}

function LocalDraft() {
  const [draft, setDraft] = useState('')
  return (
    <label>
      Fixture local draft
      <input
        data-fixture-draft
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
    </label>
  )
}

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

function MountedApp() {
  return (
    <BrowserRouter>
      <NavigationProbe />
      <LocalDraft />
      {readers && (
        <>
          <ProjectsProbe key={churn} />
          <DerivedProbe />
          <StatusProbe />
        </>
      )}
      <App />
    </BrowserRouter>
  )
}

function render() {
  if (mountedRoot === null) {
    const element = document.getElementById('root')
    if (element === null) throw new Error('Missing fixture root.')
    mountedRoot = createRoot(element)
  }
  mountedRoot.render(
    <StrictMode>
      <RoadmapProvider store={store}>
        <MountedApp />
      </RoadmapProvider>
      {Array.from({ length: ownerCount - 1 }, (_, index) => (
        <RoadmapProvider key={index} store={store}>
          <span data-fixture-extra-owner />
        </RoadmapProvider>
      ))}
    </StrictMode>,
  )
}

function findProse(text: string, scope: ParentNode = document): Element {
  const element = [...scope.querySelectorAll('p')].find((node) => node.textContent === text)
  if (element === undefined) throw new Error(`Missing real prose node ${text}.`)
  return element
}

function pinIdentity(label: string) {
  const graph = document.querySelector('.react-flow')
  const modal = document.querySelector('dialog[open]')
  const draft = document.querySelector('[data-fixture-draft]')
  if (
    graph === null ||
    !(modal instanceof HTMLDialogElement) ||
    !(draft instanceof HTMLInputElement)
  )
    throw new Error('Graph, native Modal, or local draft is not mounted.')
  savedNodes = {
    graph,
    modal,
    draft,
    mapProse: findProse(`${label} map prose.`),
    ticketProse: findProse(`${label} ticket prose.`, modal),
  }
}

function identity() {
  if (savedNodes === null) throw new Error('Identity has not been pinned.')
  return {
    graph: savedNodes.graph === document.querySelector('.react-flow'),
    modal: savedNodes.modal === document.querySelector('dialog[open]'),
    mapProse: savedNodes.mapProse.isConnected,
    ticketProse: savedNodes.ticketProse.isConnected,
    draft: savedNodes.draft === document.querySelector('[data-fixture-draft]'),
    draftValue: savedNodes.draft.value,
    pathname: location.pathname,
  }
}

async function execute(kind: 'conflict' | 'successor-conflict' | 'host') {
  const state = store.getSnapshot().state
  const readable =
    state?.phase === 'ready' ? state : state && 'retained' in state ? state.retained : null
  if (readable === null || readable === undefined)
    throw new Error('Command fixture requires accepted readable state.')
  const command = commandSchema.parse(
    kind === 'host'
      ? {
          type: 'launch-project-operation',
          expectedConfigurationVersion: readable.configurationVersion,
          project: { integration: 'local', projectId: 'fixture' },
          operation: 'open-workspace',
        }
      : {
          type: 'rename-project',
          expectedConfigurationVersion:
            kind === 'successor-conflict' ? readable.configurationVersion : 0,
          project: { integration: 'local', projectId: 'fixture' },
          name: 'Rejected rename must never appear',
        },
  )
  try {
    outcomes.push(await store.execute(command))
  } catch (error: unknown) {
    const current = store.getSnapshot()
    if (!(error instanceof Error) || current.command.error?.code !== 'transport-failed') throw error
    outcomes.push(Object.freeze({ kind: 'completion-unknown', message: error.message }))
  }
}

const api = {
  snapshot: () => ({
    snapshot: store.getSnapshot(),
    observations: { ...observations },
    derivedObservations: { ...derivedObservations },
    selectedProjects,
    observedStatus,
    outcomes: [...outcomes],
    pathname: location.pathname,
  }),
  navigate(path: string) {
    if (navigateTo === null) throw new Error('Router is not mounted.')
    navigateTo(path)
  },
  readers(enabled: boolean) {
    readers = enabled
    churn += 1
    render()
  },
  owners(count: number) {
    if (!Number.isInteger(count) || count < 1) throw new Error('Owner count must be positive.')
    ownerCount = count
    render()
  },
  pinIdentity,
  identity,
  execute,
  pinReadState() {
    pinnedReadState = store.getSnapshot().state
  },
  readStateIdentity: () => pinnedReadState === store.getSnapshot().state,
  pinUnknown() {
    pinnedUnknown = outcomes.at(-1)
    pinnedCommandError = store.getSnapshot().command.error
  },
  unknownIdentity: () => ({
    completion: pinnedUnknown === outcomes.at(-1),
    completionFrozen: Object.isFrozen(pinnedUnknown),
    commandError: pinnedCommandError === store.getSnapshot().command.error,
    commandErrorFrozen: Object.isFrozen(store.getSnapshot().command.error),
  }),
  dispose() {
    mountedRoot?.unmount()
    mountedRoot = null
    navigateTo = null
  },
  mount() {
    render()
  },
}

declare global {
  interface Window {
    clientOwnerFixture: typeof api
  }
}
window.clientOwnerFixture = api
render()
