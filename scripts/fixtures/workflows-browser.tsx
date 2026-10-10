import type { OperationSubject } from '@roadmap/contracts/operations'
import { commandSchema } from '@roadmap/contracts/operations'
import { StrictMode, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router'
import { App } from '../../apps/web/src/App'
import { RoadmapProvider } from '../../apps/web/src/store/roadmap-provider'
import { createRoadmapStore } from '../../apps/web/src/store/roadmap-store'
import type {
  RoadmapWorkflows,
  WorkflowAttemptId,
  WorkflowOperation,
  WorkflowScope,
} from '../../apps/web/src/workflows/workflows'
import { authorizationFeedback, workflowFeedback } from '../../apps/web/src/workflows/workflows'
import '@roadmap/ui/index.css'
import '../../apps/web/src/index.module.css'

type SocketRecord = {
  generation: number
  opened: boolean
  messages: number
  closeRequests: number
  closed: { code: number; reason: string } | null
}
const socketRecords: SocketRecord[] = []
const requestStarts: { correlationId: string | null; socket: SocketRecord | null }[] = []
class ObservedSocket extends WebSocket {
  private readonly record: SocketRecord

  constructor(url: string) {
    super(url)
    this.record = {
      generation: socketRecords.length + 1,
      opened: false,
      messages: 0,
      closeRequests: 0,
      closed: null,
    }
    socketRecords.push(this.record)
    this.addEventListener('open', () => {
      this.record.opened = true
    })
    this.addEventListener('message', () => {
      this.record.messages += 1
    })
    this.addEventListener('close', (event) => {
      this.record.closed = { code: event.code, reason: event.reason }
    })
  }

  override close(code?: number, reason?: string) {
    this.record.closeRequests += 1
    super.close(code, reason)
  }
}
const store = createRoadmapStore(location.origin, {
  createSocket: (url) => new ObservedSocket(url),
  fetch(input, init) {
    const socket = socketRecords.at(-1)
    requestStarts.push({
      correlationId: new Headers(init?.headers).get('X-Roadmap-Request-Id'),
      socket: socket ? { ...socket } : null,
    })
    return fetch(input, init)
  },
  reconnectDelayMs: () => 100,
})
let navigateTo: ReturnType<typeof useNavigate> | null = null
const settlements = new Map<
  string,
  { kind: 'pending' } | { kind: 'settled'; value: unknown } | { kind: 'threw'; message: string }
>()

type AsyncName = Exclude<keyof RoadmapWorkflows, 'dismiss'>
type ActionInput = {
  [K in AsyncName]: { name: K; argument: Parameters<RoadmapWorkflows[K]>[0] }
}[AsyncName]
function perform(input: ActionInput) {
  switch (input.name) {
    case 'beginAuthorization':
      return store.workflows.beginAuthorization(input.argument)
    case 'reauthorizeConnection':
      return store.workflows.reauthorizeConnection(input.argument)
    case 'retryAuthorization':
      return store.workflows.retryAuthorization(input.argument)
    case 'cancelAuthorization':
      return store.workflows.cancelAuthorization(input.argument)
    case 'renameConnection':
      return store.workflows.renameConnection(input.argument)
    case 'removeConnection':
      return store.workflows.removeConnection(input.argument)
    case 'registerProject':
      return store.workflows.registerProject(input.argument)
    case 'renameProject':
      return store.workflows.renameProject(input.argument)
    case 'repairWorkspace':
      return store.workflows.repairWorkspace(input.argument)
    case 'removeProject':
      return store.workflows.removeProject(input.argument)
    case 'setAutomationEnabled':
      return store.workflows.setAutomationEnabled(input.argument)
    case 'setProjectAutomationEnabled':
      return store.workflows.setProjectAutomationEnabled(input.argument)
    case 'startOverride':
      return store.workflows.startOverride(input.argument)
    case 'refreshProject':
      return store.workflows.refreshProject(input.argument)
    case 'launchProject':
      return store.workflows.launchProject(input.argument)
    case 'selectWorkspace':
      return store.workflows.selectWorkspace(input.argument)
  }
}
function record(value: Promise<unknown>) {
  const handle = crypto.randomUUID()
  settlements.set(handle, { kind: 'pending' })
  value.then(
    (value) => settlements.set(handle, { kind: 'settled', value }),
    (error: unknown) => settlements.set(handle, { kind: 'threw', message: String(error) }),
  )
  return handle
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
const api = {
  snapshot: () => store.getSnapshot(),
  sockets: () => socketRecords.map((record) => ({ ...record })),
  requestStarts: () => requestStarts.map((request) => ({ ...request })),
  navigate(path: string) {
    if (!navigateTo) throw new Error('The actual router is not mounted.')
    navigateTo(path)
  },
  start(input: ActionInput) {
    return record(perform(input))
  },
  // A retained generation cannot dispatch through workflow admission. This public seam tests raw protocol authority only.
  startProtocolCommand(input: unknown) {
    return record(store.execute(commandSchema.parse(input)))
  },
  settlement: (handle: string) => settlements.get(handle) ?? null,
  dismiss(attemptId: WorkflowAttemptId) {
    store.workflows.dismiss({ attemptId })
  },
  feedback(operation: WorkflowOperation, subject: OperationSubject, owner?: WorkflowScope) {
    return workflowFeedback(store.getSnapshot().workflows, operation, subject, owner)
  },
  authorizationFeedback(operationId: Parameters<typeof authorizationFeedback>[1]) {
    return authorizationFeedback(store.getSnapshot().workflows, operationId)
  },
}
declare global {
  interface Window {
    workflowsFixture: typeof api
  }
}
window.workflowsFixture = api
const element = document.getElementById('root')
if (!element) throw new Error('Missing fixture root.')
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
