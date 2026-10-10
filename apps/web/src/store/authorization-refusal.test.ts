import { authorizationOperationIdSchema } from '@roadmap/contracts/identity'
import { type ApplicationState, applicationStateSchema } from '@roadmap/contracts/state'
import { commandEnvelopeSchema, REQUEST_ID_HEADER } from '@roadmap/contracts/wire'
import { describe, expect, it } from 'vitest'
import { authorizationFeedback, workflowFeedback } from '@/workflows/workflows'
import { createRoadmapStore, type SocketLike } from './roadmap-store'

type SocketEvent = 'open' | 'message' | 'close'
class ControlledSocket implements SocketLike {
  private listeners: Record<SocketEvent, ((event: { data?: unknown }) => void)[]> = {
    open: [],
    message: [],
    close: [],
  }

  addEventListener(type: SocketEvent, listener: (event: { data?: unknown }) => void): void {
    this.listeners[type].push(listener)
  }

  close(): void {}

  publish(state: ApplicationState): void {
    for (const listener of this.listeners.message) {
      listener({ data: JSON.stringify({ type: 'state', state }) })
    }
  }
}

const operationId = authorizationOperationIdSchema.parse('authorization-refusal')
const waitingResult = {
  type: 'begin-github-authorization',
  operationId,
  phase: 'waiting',
  verificationUri: 'https://github.test/device',
  userCode: 'REFUSAL',
  expiresAt: 100000,
}
const subject = { kind: 'authorization', operationId } as const

function readyState(sequence = 4, version = 1, authorizationOperations: unknown[] = []) {
  return applicationStateSchema.parse({
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: 'epoch-refusal',
    stateSequence: sequence,
    configurationVersion: version,
    supportedIntegrations: [
      { integration: 'local', name: 'Local', connectionKind: 'built-in' },
      {
        integration: 'github',
        name: 'GitHub',
        connectionKind: 'device-authorization',
        newInstallationUrl: 'https://github.test/install',
        installationsUrl: 'https://github.test/installations',
        authorizationsUrl: 'https://github.test/authorizations',
      },
    ],
    connections: [
      {
        id: 'local',
        integration: 'local',
        name: 'Local',
        builtIn: true,
        availability: { status: 'available' },
      },
    ],
    projects: [],
    authorizationOperations,
    configuration: { valid: true, issues: [], notices: [] },
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
    capturedAt: sequence * 1000,
  })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function harness() {
  const socket = new ControlledSocket()
  const requests: {
    body: unknown
    requestId: string | null
    response: ReturnType<typeof deferred<Response>>
  }[] = []
  const fetchRequest: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const body: unknown = await request.json()
    const response = deferred<Response>()
    requests.push({ body, requestId: request.headers.get(REQUEST_ID_HEADER), response })
    return response.promise
  }
  const store = createRoadmapStore('http://roadmap.test', {
    fetch: fetchRequest,
    createSocket: () => socket,
  })
  async function captured(index: number) {
    for (let attempt = 0; attempt < 20 && requests.length <= index; attempt += 1)
      await Promise.resolve()
    const request = requests[index]
    if (request === undefined) throw new Error(`Missing request ${index}`)
    return request
  }
  async function reply(index: number, outcome: unknown) {
    const request = await captured(index)
    const body = request.body
    if (typeof body !== 'object' || body === null || !('correlationId' in body)) {
      throw new Error('Command request has no correlation identity')
    }
    request.response.resolve(
      jsonResponse({ type: 'command-result', correlationId: body.correlationId, outcome }),
    )
  }
  return { store, socket, requests, captured, reply }
}

async function beginWaiting(h: ReturnType<typeof harness>) {
  const begin = h.store.workflows.beginAuthorization({ name: 'Waiting account' })
  await h.reply(0, {
    ok: true,
    operation: 'begin-github-authorization',
    subject: { kind: 'none' },
    serverEpoch: 'epoch-refusal',
    stateSequence: 5,
    result: waitingResult,
  })
  expect(await begin).toMatchObject({ kind: 'acknowledged', result: waitingResult })
  expect(h.store.getSnapshot().state).toEqual(readyState())
  expectWaiting(h)
}

function expectWaiting(h: ReturnType<typeof harness>) {
  const feedback = authorizationFeedback(h.store.getSnapshot().workflows, operationId)
  expect(feedback).not.toBeNull()
  // Keep this separate so the regression reports actual true versus expected false.
  expect(feedback?.consumed).toBe(false)
  expect(feedback?.result).toEqual(waitingResult)
}

async function cancelAcknowledged(h: ReturnType<typeof harness>, index: number) {
  const cancel = h.store.workflows.cancelAuthorization({ operationId })
  const request = await h.captured(index)
  expect(commandEnvelopeSchema.parse(request.body).command).toMatchObject({
    type: 'cancel-github-authorization',
    operationId,
  })
  await h.reply(index, {
    ok: true,
    operation: 'cancel-github-authorization',
    subject,
    serverEpoch: 'epoch-refusal',
    stateSequence: 7,
    result: { type: 'cancel-github-authorization', operationId, phase: 'cancelled' },
  })
  expect(await cancel).toMatchObject({ kind: 'acknowledged', result: { phase: 'cancelled' } })
  const attempts = h.store.getSnapshot().workflows.attempts
  const begin = attempts.find((attempt) => attempt.operation === 'begin-github-authorization')
  expect(begin).toMatchObject({ kind: 'acknowledged', authorization: { consumed: true } })
  expect(authorizationFeedback(h.store.getSnapshot().workflows, operationId)).toMatchObject({
    result: { phase: 'cancelled' },
    consumed: false,
  })
}

describe('authorization refusal preserves acknowledged phase', () => {
  it.each(['cancel', 'retry'] as const)(
    'preserves waiting acknowledgement after locally not-dispatched %s and allows subsequent cancellation',
    async (action) => {
      const h = harness()
      const stop = h.store.start()
      h.socket.publish(readyState())
      try {
        await beginWaiting(h)
        const blocker = h.store.workflows.setAutomationEnabled({ enabled: true })
        await h.captured(1)
        const refused =
          action === 'cancel'
            ? await h.store.workflows.cancelAuthorization({ operationId })
            : await h.store.workflows.retryAuthorization({ operationId })
        expect(refused).toMatchObject({
          kind: 'not-dispatched',
          subject,
          error: { code: 'conflict' },
        })
        expect(h.requests).toHaveLength(2)
        expectWaiting(h)
        expect(h.store.getSnapshot().state).toEqual(readyState())

        await h.reply(1, {
          ok: true,
          operation: 'set-automation-enabled',
          subject: { kind: 'automation' },
          serverEpoch: 'epoch-refusal',
          stateSequence: 6,
          result: {
            type: 'set-automation-enabled',
            enabled: true,
            configurationVersion: 2,
            commit: 'committed',
          },
        })
        expect(await blocker).toMatchObject({ kind: 'acknowledged' })
        expectWaiting(h)
        expect(
          workflowFeedback(h.store.getSnapshot().workflows, 'cancel-github-authorization', subject)
            .blocked,
        ).toBe(false)
        await cancelAcknowledged(h, 2)
        expect(h.requests).toHaveLength(3)
        expect(h.store.getSnapshot().state).toEqual(readyState())
      } finally {
        stop()
      }
    },
  )

  it('preserves waiting acknowledgement after attributable not-admitted cancellation until actual cancellation is acknowledged', async () => {
    const h = harness()
    const stop = h.store.start()
    h.socket.publish(readyState())
    try {
      await beginWaiting(h)
      const cancel = h.store.workflows.cancelAuthorization({ operationId })
      const request = await h.captured(1)
      expect(commandEnvelopeSchema.parse(request.body).command).toMatchObject({
        type: 'cancel-github-authorization',
        operationId,
      })
      request.response.resolve(
        jsonResponse(
          {
            type: 'request-rejected',
            request: 'command',
            requestId: request.requestId,
            reason: 'origin',
            message: 'Rejected before application admission.',
          },
          403,
        ),
      )
      expect(await cancel).toMatchObject({
        kind: 'not-admitted',
        subject,
        rejection: { requestId: request.requestId, reason: 'origin' },
      })
      expectWaiting(h)
      expect(h.requests).toHaveLength(2)
      expect(h.store.getSnapshot().state).toEqual(readyState())
      expect(
        workflowFeedback(h.store.getSnapshot().workflows, 'cancel-github-authorization', subject)
          .blocked,
      ).toBe(false)
      await cancelAcknowledged(h, 2)
      expect(h.requests).toHaveLength(3)
      expect(h.store.getSnapshot().state).toEqual(readyState())
    } finally {
      stop()
    }
  })
})
