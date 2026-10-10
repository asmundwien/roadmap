import {
  configurationVersionSchema,
  correlationIdSchema,
  projectRefSchema,
  serverEpochSchema,
  stateSequenceSchema,
} from '@roadmap/contracts/identity'
import type { Command } from '@roadmap/contracts/operations'
import { applicationStateSchema, connectionSchema, type Project } from '@roadmap/contracts/state'
import { REQUEST_ID_HEADER, requestIdSchema } from '@roadmap/contracts/wire'
import { describe, expect, it } from 'vitest'
import { neverReadProject } from '@/views/overview/test-fixtures'
import { createRoadmapStore, type SocketLike } from './roadmap-store'

type SocketEvent = 'open' | 'message' | 'close'

class FakeSocket implements SocketLike {
  closed = false
  private listeners: Record<SocketEvent, ((event: { data?: unknown }) => void)[]> = {
    open: [],
    message: [],
    close: [],
  }

  addEventListener(type: SocketEvent, listener: (event: { data?: unknown }) => void): void {
    this.listeners[type].push(listener)
  }

  close(): void {
    this.closed = true
  }

  emit(type: SocketEvent, data?: unknown): void {
    for (const listener of this.listeners[type]) listener({ data })
  }
}

const canonicalProject = neverReadProject(
  { integration: 'github', projectId: 'delivery/one' },
  'Canonical',
)
const command = {
  type: 'launch-project-operation',
  expectedConfigurationVersion: configurationVersionSchema.parse(1),
  project: projectRefSchema.parse(canonicalProject.ref),
  operation: 'open-workspace',
} satisfies Command

function state(sequence: number, epoch = 'epoch-a', name = 'Accepted read facts') {
  const project: Project = { ...canonicalProject, name }
  return applicationStateSchema.parse({
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: epoch,
    stateSequence: sequence,
    configurationVersion: 1,
    supportedIntegrations: [],
    connections: [
      connectionSchema.parse({
        id: project.connectionId,
        integration: 'github',
        name: 'GitHub',
        builtIn: false,
        githubIdentity: { id: project.connectionId, login: 'fixture' },
        availability: { status: 'available' },
      }),
    ],
    projects: [project],
    authorizationOperations: [],
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

function outcome(epoch = 'epoch-a', sequence = 100) {
  return {
    ok: true,
    operation: command.type,
    serverEpoch: serverEpochSchema.parse(epoch),
    stateSequence: stateSequenceSchema.parse(sequence),
    subject: { kind: 'project', project: canonicalProject.ref },
    result: {
      type: command.type,
      project: canonicalProject.ref,
      operation: command.operation,
      status: 'invoked',
    },
  }
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

function correlationOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('correlationId' in body)) return undefined
  return typeof body.correlationId === 'string' ? body.correlationId : undefined
}

function harness() {
  const sockets: FakeSocket[] = []
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
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  function socket(index: number) {
    const socket = sockets[index]
    if (!socket) throw new Error(`Missing socket ${index}`)
    return socket
  }
  function baseline(sequence = 4, epoch = 'epoch-a', index = 0, name?: string) {
    socket(index).emit(
      'message',
      JSON.stringify({ type: 'state', state: state(sequence, epoch, name) }),
    )
  }
  async function captured(index = 0) {
    // Request.json() is asynchronous even though the injected transport has no network.
    for (let attempt = 0; attempt < 20 && requests.length <= index; attempt += 1)
      await Promise.resolve()
    const request = requests[index]
    if (!request) throw new Error(`Missing request ${index}`)
    return request
  }
  async function reply(index: number, value: unknown = outcome()) {
    const request = await captured(index)
    request.response.resolve(
      jsonResponse({
        type: 'command-result',
        correlationId: correlationOf(request.body),
        outcome: value,
      }),
    )
  }
  return { store, sockets, requests, socket, baseline, captured, reply }
}

describe('state-free operation delivery through the public store', () => {
  it('serializes a fresh call-local correlation and accepts only its echoed state-free outcome', async () => {
    const h = harness()
    const stop = h.store.start()
    h.baseline()
    try {
      const first = h.store.execute(command)
      const request = await h.captured()
      expect(request.body).toEqual({ type: 'command', correlationId: expect.any(String), command })
      expect(correlationIdSchema.safeParse(correlationOf(request.body)).success).toBe(true)
      expect(request.requestId).toBe(correlationOf(request.body))
      await h.reply(0)
      await expect(first).resolves.toEqual(outcome())
      const second = h.store.execute(command)
      const secondRequest = await h.captured(1)
      expect(correlationOf(secondRequest.body)).not.toBe(correlationOf(request.body))
      await h.reply(1)
      await expect(second).resolves.toEqual(outcome())
    } finally {
      stop()
    }
  })

  it('does not advance WebSocket facts with a same-epoch higher outcome sequence', async () => {
    const h = harness()
    const stop = h.store.start()
    h.baseline()
    const accepted = h.store.getSnapshot().state
    try {
      const execution = h.store.execute(command)
      await h.reply(0, outcome('epoch-a', 900))
      await expect(execution).resolves.toEqual(outcome('epoch-a', 900))
      expect(h.store.getSnapshot().state).toBe(accepted)
      h.baseline(5, 'epoch-a', 0, 'Next socket observation')
      expect(h.store.getSnapshot().state).toEqual(state(5, 'epoch-a', 'Next socket observation'))
      expect(h.sockets).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it.each(['matching', 'wrong-subject'])(
    'keeps %s application rejection distinct from transport uncertainty',
    async (subject) => {
      const h = harness()
      const stop = h.store.start()
      h.baseline()
      try {
        const execution = h.store.execute(command)
        const rejected = {
          ok: false,
          operation: command.type,
          serverEpoch: serverEpochSchema.parse('epoch-a'),
          stateSequence: stateSequenceSchema.parse(4),
          subject: {
            kind: 'project',
            project:
              subject === 'matching'
                ? command.project
                : projectRefSchema.parse({ integration: 'github', projectId: 'delivery/other' }),
          },
          error: { code: 'conflict', message: 'Workspace is unavailable.' },
        }
        const assertion =
          subject === 'matching'
            ? expect(execution).resolves.toEqual(rejected)
            : expect(execution).rejects.toBeInstanceOf(Error)
        await h.reply(0, rejected)
        await assertion
        expect(h.store.getSnapshot().command.error?.code).toBe(
          subject === 'matching' ? 'conflict' : 'transport-failed',
        )
        expect(h.store.getSnapshot().state).toEqual(state(4))
      } finally {
        stop()
      }
    },
  )

  it.each(['correlation', 'subject', 'result', 'operation', 'family'])(
    'rejects an otherwise valid mismatched %s as completion-unknown',
    async (mismatch) => {
      const h = harness()
      const stop = h.store.start()
      h.baseline()
      const accepted = h.store.getSnapshot().state
      try {
        const execution = h.store.execute(command)
        const assertion = expect(execution).rejects.toBeInstanceOf(Error)
        const request = await h.captured()
        const valid = outcome()
        const wrongProject = neverReadProject({
          integration: 'github',
          projectId: 'delivery/other',
        })
        const returned =
          mismatch === 'subject'
            ? {
                ...valid,
                subject: { kind: 'project', project: wrongProject.ref },
                result: { ...valid.result, project: wrongProject.ref },
              }
            : mismatch === 'result'
              ? { ...valid, result: { ...valid.result, operation: 'open-terminal' } }
              : mismatch === 'operation'
                ? { ...valid, operation: 'rename-project' }
                : mismatch === 'family'
                  ? {
                      ...valid,
                      operation: 'rename-project',
                      result: {
                        type: 'rename-project',
                        project: canonicalProject.ref,
                        configurationVersion: configurationVersionSchema.parse(2),
                        commit: 'committed',
                      },
                    }
                  : valid
        request.response.resolve(
          jsonResponse({
            type: 'command-result',
            correlationId:
              mismatch === 'correlation'
                ? '00000000-0000-4000-8000-000000000000'
                : correlationOf(request.body),
            outcome: returned,
          }),
        )
        await assertion
        expect(h.store.getSnapshot().command.error).toMatchObject({ code: 'transport-failed' })
        expect(h.store.getSnapshot().state).toBe(accepted)
        expect(h.requests).toHaveLength(1)
      } finally {
        stop()
      }
    },
  )

  it.each(['before-successor', 'after-successor'])(
    'preserves delayed predecessor truth %s settlement and ongoing successor reads',
    async (order) => {
      const h = harness()
      let stop = h.store.start()
      h.baseline()
      try {
        const predecessor = h.store.execute(command)
        await h.captured()
        stop()
        stop = h.store.start()
        h.baseline(1, 'epoch-b', 1, 'Successor baseline')
        const successor = h.store.execute(command)
        await h.captured(1)
        if (order === 'before-successor') {
          await h.reply(0, outcome('epoch-a', 999))
          await expect(predecessor).resolves.toEqual(outcome('epoch-a', 999))
          await h.reply(1, outcome('epoch-b', 999))
          await expect(successor).resolves.toEqual(outcome('epoch-b', 999))
        } else {
          await h.reply(1, outcome('epoch-b', 999))
          await expect(successor).resolves.toEqual(outcome('epoch-b', 999))
          await h.reply(0, outcome('epoch-a', 999))
          await expect(predecessor).resolves.toEqual(outcome('epoch-a', 999))
        }
        expect(h.store.getSnapshot().state).toEqual(state(1, 'epoch-b', 'Successor baseline'))
        h.baseline(2, 'epoch-b', 1, 'Successor update')
        expect(h.store.getSnapshot().state).toEqual(state(2, 'epoch-b', 'Successor update'))
        expect(h.sockets).toHaveLength(2)
        expect(h.socket(1).closed).toBe(false)
      } finally {
        stop()
      }
    },
  )

  it('uses a current-authority differing epoch only to request a fresh baseline while retaining facts', async () => {
    const h = harness()
    const stop = h.store.start()
    h.baseline()
    const accepted = h.store.getSnapshot().state
    try {
      const execution = h.store.execute(command)
      await h.reply(0, outcome('epoch-b', 900))
      await expect(execution).resolves.toEqual(outcome('epoch-b', 900))
      expect(h.sockets).toHaveLength(2)
      expect(h.socket(0).closed).toBe(true)
      expect(h.store.getSnapshot()).toMatchObject({ synchronization: 'retained' })
      expect(h.store.getSnapshot().state).toBe(accepted)
      h.socket(1).emit('open')
      h.baseline(1000, 'epoch-a', 0)
      expect(h.store.getSnapshot().state).toBe(accepted)
      h.baseline(1, 'epoch-b', 1, 'Fresh baseline')
      expect(h.store.getSnapshot()).toMatchObject({ synchronization: 'synchronized' })
      expect(h.store.getSnapshot().state).toEqual(state(1, 'epoch-b', 'Fresh baseline'))
      h.baseline(2, 'epoch-b', 1)
      expect(h.store.getSnapshot().state?.stateSequence).toBe(2)
    } finally {
      stop()
    }
  })

  it.each(['before-baseline', 'after-baseline'])(
    'never grants a prebaseline request synchronization authority when settled %s',
    async (order) => {
      const h = harness()
      const stop = h.store.start()
      try {
        const execution = h.store.execute(command)
        await h.captured()
        if (order === 'after-baseline') h.baseline()
        await h.reply(0, outcome('epoch-b'))
        await expect(execution).resolves.toEqual(outcome('epoch-b'))
        expect(h.sockets).toHaveLength(1)
        expect(h.socket(0).closed).toBe(false)
        if (order === 'before-baseline') {
          expect(h.store.getSnapshot()).toMatchObject({ synchronization: 'not-ready', state: null })
          h.baseline()
        }
        expect(h.store.getSnapshot().state).toEqual(state(4))
        h.baseline(5)
        expect(h.store.getSnapshot().state?.stateSequence).toBe(5)
      } finally {
        stop()
      }
    },
  )

  it('does not let a reentrant publication acquire the successor authority for an obsolete request', async () => {
    const h = harness()
    let stop = h.store.start()
    h.baseline()
    let switched = false
    const unsubscribe = h.store.subscribe(() => {
      if (!h.store.getSnapshot().command.inFlight || switched) return
      switched = true
      stop()
      stop = h.store.start()
      h.baseline(1, 'epoch-b', 1)
    })
    try {
      const execution = h.store.execute(command)
      await h.reply(0, outcome('epoch-c'))
      await expect(execution).resolves.toEqual(outcome('epoch-c'))
      expect(h.sockets).toHaveLength(2)
      expect(h.store.getSnapshot().state).toEqual(state(1, 'epoch-b'))
      h.baseline(2, 'epoch-b', 1)
      expect(h.store.getSnapshot().state?.stateSequence).toBe(2)
    } finally {
      unsubscribe()
      stop()
    }
  })

  it('keeps attributable protocol non-admission separate using the matching request header UUID', async () => {
    const h = harness()
    const stop = h.store.start()
    h.baseline()
    try {
      const execution = h.store.execute(command)
      const request = await h.captured()
      expect(requestIdSchema.safeParse(request.requestId).success).toBe(true)
      request.response.resolve(
        jsonResponse(
          {
            type: 'request-rejected',
            request: 'command',
            requestId: request.requestId,
            reason: 'origin',
            message: 'Rejected before admission.',
          },
          403,
        ),
      )
      await expect(execution).resolves.toMatchObject({ kind: 'not-admitted', ok: false })
      expect(h.store.getSnapshot().state).toEqual(state(4))
      expect(h.requests).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it.each(['lost', 'unreadable'])(
    'does not replay a host operation after its %s result or infer completion from later read facts',
    async (failure) => {
      const h = harness()
      let stop = h.store.start()
      h.baseline()
      try {
        const execution = h.store.execute(command)
        const assertion = expect(execution).rejects.toBeInstanceOf(Error)
        const request = await h.captured()
        if (failure === 'lost') request.response.reject(new Error('Network response lost'))
        else
          request.response.resolve(
            new Response('{', { headers: { 'Content-Type': 'application/json' } }),
          )
        await assertion
        expect(h.store.getSnapshot().command.error).toMatchObject({ code: 'transport-failed' })
        stop()
        stop = h.store.start()
        const newer = state(50, 'epoch-b', 'Later facts do not prove a launch')
        h.socket(1).emit(
          'message',
          JSON.stringify({ type: 'state', state: { ...newer, configurationVersion: 20 } }),
        )
        await Promise.resolve()
        const accepted = h.store.getSnapshot().state
        expect(accepted?.phase).toBe('ready')
        if (accepted?.phase !== 'ready') throw new Error('Expected the successor read baseline.')
        expect(accepted.configurationVersion).toBe(20)
        expect(h.store.getSnapshot().command.error).toMatchObject({ code: 'transport-failed' })
        expect(h.requests).toHaveLength(1)
      } finally {
        stop()
      }
    },
  )
})
