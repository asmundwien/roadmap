import {
  actionIdSchema,
  authorizationOperationIdSchema,
  configurationVersionSchema,
  serverEpochSchema,
  stateSequenceSchema,
} from '@roadmap/contracts/identity'
import type {
  Command,
  CommandOutcomeFor,
  OperationSubject,
  SafeError,
} from '@roadmap/contracts/operations'
import {
  type ApplicationState,
  applicationStateSchema,
  type Project,
} from '@roadmap/contracts/state'
import { REQUEST_ID_HEADER } from '@roadmap/contracts/wire'
import { describe, expect, it } from 'vitest'
import { currentProject } from '@/views/overview/test-fixtures'
import {
  authorizationFeedback,
  automationEnablementFeedback,
  nativeOperationFeedback,
  type RoadmapWorkflows,
  type WorkflowOperation,
  type WorkflowScope,
  type WorkflowSettledAttempt,
  type WorkflowSnapshot,
  workflowFeedback,
} from '@/workflows/workflows'
import { createRoadmapStore, type SocketLike } from './roadmap-store'

type CommandFor<O extends Command['type']> = Extract<Command, { type: O }>

function workflows(store: ReturnType<typeof createRoadmapStore>): RoadmapWorkflows {
  expect(
    store.workflows,
    'createRoadmapStore must own named workflows, not aggregate command activity',
  ).toBeDefined()
  for (const method of [
    'beginAuthorization',
    'registerProject',
    'repairWorkspace',
    'renameConnection',
    'renameProject',
    'setAutomationEnabled',
    'setProjectAutomationEnabled',
    'refreshProject',
    'launchProject',
    'selectWorkspace',
    'dismiss',
  ]) {
    expect(typeof Reflect.get(store.workflows, method), `Missing named workflow ${method}`).toBe(
      'function',
    )
  }
  return store.workflows
}

function workflowState(store: ReturnType<typeof createRoadmapStore>): WorkflowSnapshot {
  expect(
    store.getSnapshot().workflows,
    'Workflow attempts must be published in the store snapshot',
  ).toBeDefined()
  return store.getSnapshot().workflows
}

function attempts(store: ReturnType<typeof createRoadmapStore>) {
  return workflowState(store).attempts
}

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

function launchableProject(id: string): Project {
  const project = currentProject(id)
  return {
    ...project,
    actions: [
      {
        id: actionIdSchema.parse(`launch-${id}`),
        label: 'Open Workspace',
        kind: 'server-launch',
        project: project.ref,
        operation: 'open-workspace',
      },
    ],
  }
}
const alpha = launchableProject('alpha')
const beta = launchableProject('beta')
const alphaSubject = { kind: 'project', project: alpha.ref } satisfies OperationSubject
const betaSubject = { kind: 'project', project: beta.ref } satisfies OperationSubject
const noneSubject = { kind: 'none' } satisfies OperationSubject
const folderOwner = { kind: 'project', project: alpha.ref } satisfies WorkflowScope

function readyState(sequence = 4, version = 1, epoch = 'epoch-a') {
  return applicationStateSchema.parse({
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: epoch,
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
      {
        id: 'github',
        integration: 'github',
        name: 'GitHub',
        builtIn: false,
        githubIdentity: { id: 'github', login: 'fixture' },
        availability: { status: 'available' },
      },
    ],
    projects: [alpha, beta],
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

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}
function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  function socket(index = 0) {
    const value = sockets[index]
    if (!value) throw new Error(`Missing socket ${index}`)
    return value
  }
  function publish(state: ApplicationState = readyState(), index = 0) {
    socket(index).emit('message', JSON.stringify({ type: 'state', state }))
  }
  async function captured(index = 0) {
    // As in operation-delivery.test.ts, Request.json() crosses microtasks.
    for (let attempt = 0; attempt < 20 && requests.length <= index; attempt += 1)
      await Promise.resolve()
    const request = requests[index]
    if (!request) throw new Error(`Missing request ${index}`)
    return request
  }
  async function reply(index: number, outcome: unknown) {
    const request = await captured(index)
    request.response.resolve(
      jsonResponse({ type: 'command-result', correlationId: correlationOf(request.body), outcome }),
    )
  }
  return { store, sockets, requests, socket, publish, captured, reply }
}

function renameOutcome(project = alpha.ref, version = 2, epoch = 'epoch-a', sequence = 5) {
  return {
    ok: true,
    operation: 'rename-project',
    serverEpoch: serverEpochSchema.parse(epoch),
    stateSequence: stateSequenceSchema.parse(sequence),
    subject: { kind: 'project', project },
    result: {
      type: 'rename-project',
      project,
      configurationVersion: configurationVersionSchema.parse(version),
      commit: 'committed',
    },
  } satisfies Extract<CommandOutcomeFor<CommandFor<'rename-project'>>, { ok: true }>
}
function launchOutcome(project = alpha.ref, epoch = 'epoch-a', sequence = 5) {
  return {
    ok: true,
    operation: 'launch-project-operation',
    serverEpoch: serverEpochSchema.parse(epoch),
    stateSequence: stateSequenceSchema.parse(sequence),
    subject: { kind: 'project', project },
    result: {
      type: 'launch-project-operation',
      project,
      operation: 'open-workspace',
      status: 'invoked',
    },
  } satisfies Extract<CommandOutcomeFor<CommandFor<'launch-project-operation'>>, { ok: true }>
}
function refreshOutcome(project = beta.ref) {
  return {
    ok: true,
    operation: 'refresh-project',
    serverEpoch: serverEpochSchema.parse('epoch-a'),
    stateSequence: stateSequenceSchema.parse(5),
    subject: { kind: 'project', project },
    result: {
      type: 'refresh-project',
      project,
      attempt: {
        kind: 'observed',
        attemptedAt: 100,
        observedAt: 101,
        provenance: {
          integration: 'local',
          path: `/tmp/${project.projectId}`,
          operation: 'inspect-root',
        },
      },
    },
  } satisfies Extract<CommandOutcomeFor<CommandFor<'refresh-project'>>, { ok: true }>
}
function renameRejected(project = alpha.ref, code: SafeError['code'] = 'conflict', field?: string) {
  return {
    ok: false,
    operation: 'rename-project',
    serverEpoch: serverEpochSchema.parse('epoch-a'),
    stateSequence: stateSequenceSchema.parse(5),
    subject: { kind: 'project', project },
    error: {
      code,
      message: 'The server did not admit this configuration change.',
      ...(field ? { field } : {}),
    },
  } satisfies Extract<CommandOutcomeFor<CommandFor<'rename-project'>>, { ok: false }>
}

function requireAcknowledged<O extends WorkflowOperation>(attempt: WorkflowSettledAttempt<O>) {
  expect(attempt.kind).toBe('acknowledged')
  if (attempt.kind !== 'acknowledged')
    throw new Error(`Expected ${attempt.operation} acknowledgement`)
  return attempt
}

async function noAdditionalRequests(h: ReturnType<typeof harness>, count: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve()
  expect(h.requests).toHaveLength(count)
}

describe('named public-store workflow policy', () => {
  it.each([
    { schedule: 'waiting then identical denied', transitions: true },
    { schedule: 'unrelated snapshots without authorization transition', transitions: false },
  ])(
    'tracks accepted authorization phase while retry acknowledgement is pending: $schedule',
    async ({ transitions }) => {
      const h = harness()
      const stop = h.store.start()
      const operationId = authorizationOperationIdSchema.parse('authorization-pending-retry')
      const subject = { kind: 'authorization', operationId } satisfies OperationSubject
      const denied = {
        id: operationId,
        status: 'terminal',
        outcome: 'denied',
        cause: 'Authorization was denied.',
      } satisfies Extract<ApplicationState, { phase: 'ready' }>['authorizationOperations'][number]
      const waiting = {
        id: operationId,
        status: 'waiting',
        verificationUri: 'https://github.test/device',
        userCode: 'RETRY',
        expiresAt: 100000,
      } satisfies Extract<ApplicationState, { phase: 'ready' }>['authorizationOperations'][number]
      const outcome = {
        ok: true,
        operation: 'retry-github-authorization',
        subject,
        serverEpoch: serverEpochSchema.parse('epoch-a'),
        stateSequence: stateSequenceSchema.parse(5),
        result: {
          type: 'retry-github-authorization',
          operationId,
          phase: 'waiting',
          verificationUri: waiting.verificationUri,
          userCode: waiting.userCode,
          expiresAt: waiting.expiresAt,
        },
      } satisfies Extract<CommandOutcomeFor<CommandFor<'retry-github-authorization'>>, { ok: true }>
      h.publish(
        applicationStateSchema.parse({ ...readyState(), authorizationOperations: [denied] }),
      )
      try {
        const w = workflows(h.store)
        const retry = w.retryAuthorization({ operationId })
        expect((await h.captured()).body).toMatchObject({
          command: {
            type: 'retry-github-authorization',
            operationId,
            expectedConfigurationVersion: 1,
          },
        })
        const pendingSnapshot = workflowState(h.store)
        const pending = pendingSnapshot.attempts.at(-1)
        expect(pending).toMatchObject({ kind: 'pending', operation: 'retry-github-authorization' })
        const unrelated = readyState(5)
        if (unrelated.phase !== 'ready') throw new Error('Expected ready fixture')
        h.publish(
          applicationStateSchema.parse({
            ...unrelated,
            authorizationOperations: [transitions ? waiting : denied],
            connections: unrelated.connections.map((connection) => ({
              ...connection,
              name: `${connection.name} renamed`,
            })),
          }),
        )
        h.publish(
          applicationStateSchema.parse({ ...readyState(6, 2), authorizationOperations: [denied] }),
        )
        expect(h.store.getSnapshot().state).toMatchObject({
          phase: 'ready',
          stateSequence: 6,
          authorizationOperations: [denied],
        })
        expect(workflowState(h.store).attempts.at(-1)).toMatchObject({ kind: 'pending' })
        await h.reply(0, outcome)
        const acknowledgement = requireAcknowledged(await retry)
        const feedback = authorizationFeedback(workflowState(h.store), operationId)
        expect(feedback?.consumed).toBe(transitions)
        expect(feedback?.previous).toEqual(denied)
        expect(feedback?.result).toEqual(outcome.result)
        expect(acknowledgement.result).toEqual(outcome.result)
        expect(pendingSnapshot.attempts.at(-1)).toBe(pending)
        expect(pending).toMatchObject({ kind: 'pending' })
        expect(h.store.getSnapshot().state).toMatchObject({ authorizationOperations: [denied] })
        const nextRetry = w.retryAuthorization({ operationId })
        if (transitions) {
          expect((await h.captured(1)).body).toMatchObject({
            command: {
              type: 'retry-github-authorization',
              operationId,
              expectedConfigurationVersion: 2,
            },
          })
          await h.reply(1, { ...outcome, stateSequence: stateSequenceSchema.parse(7) })
          requireAcknowledged(await nextRetry)
        } else {
          expect(await nextRetry).toMatchObject({
            kind: 'not-dispatched',
            operation: 'retry-github-authorization',
          })
          await noAdditionalRequests(h, 1)
        }
      } finally {
        stop()
      }
    },
  )

  it('exposes the workflow owner at the public runtime boundary', () => {
    workflows(harness().store)
  })

  it('retains one accepted read authority rather than a snapshot history inside workflow policy', async () => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    const accepted = h.store.getSnapshot().state
    const published: ReturnType<typeof h.store.getSnapshot>[] = []
    const unsubscribe = h.store.subscribe(() => published.push(h.store.getSnapshot()))
    try {
      const w = workflows(h.store)
      for (let index = 0; index < 8; index += 1) {
        const launch = w.launchProject({ project: alpha.ref, operation: 'open-workspace' })
        await h.reply(index, launchOutcome(alpha.ref, 'epoch-a', 100 + index))
        requireAcknowledged(await launch)
      }
      expect(published.length).toBeGreaterThanOrEqual(16)
      for (const snapshot of published) {
        expect(snapshot.state).toBe(accepted)
        expect(snapshot.workflows.policy.state).toBe(snapshot.state)
        expect(snapshot.workflows.policy.synchronization).toBe(snapshot.synchronization)
        expect(snapshot.workflows.policy.lifecycle).toEqual(snapshot.lifecycle)
        // Nesting the enclosing snapshot here retains all prior attempt lists.
        expect(snapshot.workflows.policy).not.toHaveProperty('workflows')
        expect(snapshot.workflows.policy).not.toHaveProperty('command')
        expect(snapshot.workflows.policy).not.toHaveProperty('transport')
      }
      expect(attempts(h.store)).toHaveLength(8)
      expect(published[0]?.workflows.attempts).toMatchObject([{ kind: 'pending' }])
      const beforeUpdate = h.store.getSnapshot()
      h.publish(readyState(5, 2))
      const updated = h.store.getSnapshot()
      expect(updated.state).not.toBe(accepted)
      expect(updated.workflows.policy.state).toBe(updated.state)
      expect(beforeUpdate.workflows.policy.state).toBe(accepted)
      await noAdditionalRequests(h, 8)
    } finally {
      unsubscribe()
      stop()
    }
  })

  it.each(['alpha-first', 'beta-first'])(
    'serializes different Projects on the shared configuration revision, %s',
    async (order) => {
      const h = harness()
      const stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        const firstProject = order === 'alpha-first' ? alpha.ref : beta.ref
        const secondProject = order === 'alpha-first' ? beta.ref : alpha.ref
        const first = w.renameProject({ project: firstProject, name: 'First draft' })
        await h.captured()
        const blocked = await w.renameProject({
          project: secondProject,
          name: 'Retained second draft',
        })
        expect(blocked).toMatchObject({
          kind: 'not-dispatched',
          operation: 'rename-project',
          subject: { kind: 'project', project: secondProject },
        })
        expect(blocked).not.toHaveProperty('configurationVersion')
        await noAdditionalRequests(h, 1)
        await h.reply(0, renameOutcome(firstProject))
        requireAcknowledged(await first)
        await noAdditionalRequests(h, 1)
        // A commit result alone is not the accepted read configuration version.
        h.publish(readyState(5, 2))
        const explicit = w.renameProject({ project: secondProject, name: 'Retained second draft' })
        expect((await h.captured(1)).body).toMatchObject({
          command: {
            type: 'rename-project',
            project: secondProject,
            expectedConfigurationVersion: 2,
          },
        })
        await h.reply(1, renameOutcome(secondProject, 3))
        requireAcknowledged(await explicit)
        expect(attempts(h.store)).toHaveLength(3)
      } finally {
        stop()
      }
    },
  )

  it.each(['authorization-first', 'preference-first'])(
    'shares revision contention between authorization and a different Project preference, %s',
    async (order) => {
      const h = harness()
      const stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        if (order === 'authorization-first') {
          const first = w.beginAuthorization({ name: 'Personal account' })
          await h.captured()
          expect(
            await w.setProjectAutomationEnabled({ project: beta.ref, enabled: true }),
          ).toMatchObject({ kind: 'not-dispatched', operation: 'set-project-automation-enabled' })
          await h.reply(0, {
            ok: true,
            operation: 'begin-github-authorization',
            subject: noneSubject,
            serverEpoch: 'epoch-a',
            stateSequence: 5,
            result: {
              type: 'begin-github-authorization',
              operationId: authorizationOperationIdSchema.parse('authorization-one'),
              phase: 'waiting',
              verificationUri: 'https://github.test/device',
              userCode: 'ABCD',
              expiresAt: 100000,
            },
          })
          expect(requireAcknowledged(await first).result).toMatchObject({ phase: 'waiting' })
        } else {
          const first = w.setProjectAutomationEnabled({ project: beta.ref, enabled: true })
          await h.captured()
          expect(await w.beginAuthorization({ name: 'Personal account' })).toMatchObject({
            kind: 'not-dispatched',
            operation: 'begin-github-authorization',
          })
          await h.reply(0, {
            ok: true,
            operation: 'set-project-automation-enabled',
            subject: betaSubject,
            serverEpoch: 'epoch-a',
            stateSequence: 5,
            result: {
              type: 'set-project-automation-enabled',
              project: beta.ref,
              enabled: true,
              configurationVersion: 2,
              commit: 'committed',
            },
          })
          expect(requireAcknowledged(await first).result).toMatchObject({
            enabled: true,
            commit: 'committed',
          })
        }
        await noAdditionalRequests(h, 1)
      } finally {
        stop()
      }
    },
  )

  it.each(['forward', 'reverse'])(
    'allows independent configuration, refresh and native scopes in %s dispatch and settlement order',
    async (order) => {
      const h = harness()
      const stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        const pending =
          order === 'forward'
            ? [
                w.renameProject({ project: alpha.ref, name: 'Renamed' }),
                w.refreshProject({ project: beta.ref }),
                w.launchProject({ project: alpha.ref, operation: 'open-workspace' }),
              ]
            : [
                w.launchProject({ project: alpha.ref, operation: 'open-workspace' }),
                w.refreshProject({ project: beta.ref }),
                w.renameProject({ project: alpha.ref, name: 'Renamed' }),
              ]
        await h.captured(2)
        expect(attempts(h.store)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ operation: 'rename-project', kind: 'pending' }),
            expect.objectContaining({ operation: 'refresh-project', kind: 'pending' }),
            expect.objectContaining({ operation: 'launch-project-operation', kind: 'pending' }),
          ]),
        )
        const replies =
          order === 'forward'
            ? [renameOutcome(), refreshOutcome(), launchOutcome()]
            : [launchOutcome(), refreshOutcome(), renameOutcome()]
        for (const index of order === 'forward' ? [0, 1, 2] : [2, 1, 0]) {
          await h.reply(index, replies[index])
          const attempt = await pending[index]
          expect(attempt?.kind).toBe('acknowledged')
        }
        await noAdditionalRequests(h, 3)
        expect(h.store.getSnapshot().state).toEqual(readyState())
      } finally {
        stop()
      }
    },
  )

  it.each(['refresh-first', 'launch-first'])(
    'does not overlap refresh and native launch on the same canonical Project, %s',
    async (order) => {
      const h = harness()
      const stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        if (order === 'refresh-first') {
          const first = w.refreshProject({ project: alpha.ref })
          await h.captured()
          expect(
            await w.launchProject({ project: alpha.ref, operation: 'open-workspace' }),
          ).toMatchObject({ kind: 'not-dispatched', subject: alphaSubject })
          await h.reply(0, refreshOutcome(alpha.ref))
          requireAcknowledged(await first)
        } else {
          const first = w.launchProject({ project: alpha.ref, operation: 'open-workspace' })
          await h.captured()
          expect(await w.refreshProject({ project: alpha.ref })).toMatchObject({
            kind: 'not-dispatched',
            subject: alphaSubject,
          })
          await h.reply(0, launchOutcome())
          requireAcknowledged(await first)
        }
        await noAdditionalRequests(h, 1)
      } finally {
        stop()
      }
    },
  )

  it('captures the latest accepted revision through a retained named action reference', async () => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    try {
      const rename = workflows(h.store).renameProject
      h.publish(readyState(5, 7))
      const dispatched = rename({ project: alpha.ref, name: 'Open pane draft' })
      expect((await h.captured()).body).toEqual({
        type: 'command',
        correlationId: expect.any(String),
        command: {
          type: 'rename-project',
          project: alpha.ref,
          name: 'Open pane draft',
          expectedConfigurationVersion: 7,
        },
      })
      await h.reply(0, renameOutcome(alpha.ref, 8))
      expect(requireAcknowledged(await dispatched).configurationVersion).toBe(7)
    } finally {
      stop()
    }
  })

  it.each(['not-ready', 'retained', 'invalid', 'stopped'])(
    'does not invent a dispatch version when current readiness is %s',
    async (policy) => {
      const h = harness()
      const stop = h.store.start()
      try {
        const begin = workflows(h.store).beginAuthorization
        if (policy !== 'not-ready') h.publish()
        if (policy === 'retained') h.socket().emit('close')
        if (policy === 'invalid') {
          const valid = readyState(5, 9)
          if (valid.phase !== 'ready') throw new Error('Expected ready fixture')
          h.publish(
            applicationStateSchema.parse({
              ...valid,
              mode: 'read-only',
              configuration: {
                valid: false,
                issues: [{ path: 'projects', message: 'Configuration requires repair.' }],
                notices: [],
              },
            }),
          )
        }
        if (policy === 'stopped')
          h.publish(
            applicationStateSchema.parse({
              phase: 'stopped',
              serverEpoch: 'epoch-a',
              stateSequence: 5,
              retained: readyState(),
              capturedAt: 5000,
            }),
          )
        const rejected = await begin({ name: 'Open pane authorization draft' })
        expect(rejected).toMatchObject({
          kind: 'not-dispatched',
          operation: 'begin-github-authorization',
        })
        expect(rejected).not.toHaveProperty('configurationVersion')
        await noAdditionalRequests(h, 0)
      } finally {
        stop()
      }
    },
  )

  it('reads current Automation availability before dispatch while preserving the disable action', async () => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    try {
      const setEnabled = workflows(h.store).setAutomationEnabled
      const next = readyState(5, 8)
      if (next.phase !== 'ready') throw new Error('Expected ready fixture')
      h.publish(
        applicationStateSchema.parse({
          ...next,
          automation: {
            ...next.automation,
            enabled: true,
            availability: { status: 'unavailable', cause: 'Host launch is unavailable.' },
          },
        }),
      )
      expect(automationEnablementFeedback(workflowState(h.store), { enabled: true }).blocked).toBe(
        true,
      )
      expect(automationEnablementFeedback(workflowState(h.store), { enabled: false }).blocked).toBe(
        false,
      )
      expect(await setEnabled({ enabled: true })).toMatchObject({
        kind: 'not-dispatched',
        operation: 'set-automation-enabled',
      })
      await noAdditionalRequests(h, 0)
      const disabling = setEnabled({ enabled: false })
      expect((await h.captured()).body).toMatchObject({
        command: { expectedConfigurationVersion: 8, enabled: false },
      })
      await h.reply(0, {
        ok: true,
        operation: 'set-automation-enabled',
        subject: { kind: 'automation' },
        serverEpoch: 'epoch-a',
        stateSequence: 6,
        result: {
          type: 'set-automation-enabled',
          enabled: false,
          configurationVersion: 9,
          commit: 'committed',
        },
      })
      expect(requireAcknowledged(await disabling).result).toMatchObject({ enabled: false })
    } finally {
      stop()
    }
  })

  it('rechecks available native actions instead of trusting a pane-open action', async () => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    try {
      const launch = workflows(h.store).launchProject
      const next = readyState(5, 2)
      if (next.phase !== 'ready') throw new Error('Expected ready fixture')
      h.publish(
        applicationStateSchema.parse({
          ...next,
          projects: next.projects.map((project) => ({ ...project, actions: [] })),
        }),
      )
      expect(
        nativeOperationFeedback(workflowState(h.store), {
          project: alpha.ref,
          operation: 'open-workspace',
        }).blocked,
      ).toBe(true)
      expect(await launch({ project: alpha.ref, operation: 'open-workspace' })).toMatchObject({
        kind: 'not-dispatched',
        subject: alphaSubject,
      })
      await noAdditionalRequests(h, 0)
    } finally {
      stop()
    }
  })

  it('returns application conflict after external revision advancement without rebase or automatic resubmission', async () => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    try {
      const w = workflows(h.store)
      const dispatched = w.renameProject({ project: alpha.ref, name: 'Kept draft' })
      expect((await h.captured()).body).toMatchObject({
        command: { expectedConfigurationVersion: 1 },
      })
      h.publish(readyState(5, 2))
      await h.reply(0, renameRejected())
      const result = await dispatched
      expect(result).toMatchObject({
        kind: 'rejected',
        configurationVersion: 1,
        outcome: { ok: false, error: { code: 'conflict' } },
      })
      expect(result).not.toHaveProperty('result')
      expect(result).not.toHaveProperty('destination')
      await noAdditionalRequests(h, 1)
    } finally {
      stop()
    }
  })

  it('keeps local validation, attributable non-admission and server field rejection distinct', async () => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    try {
      const w = workflows(h.store)
      const selector = workflowFeedback
      const invalid = await w.renameProject({ project: alpha.ref, name: '   ' })
      expect(invalid).toMatchObject({
        kind: 'not-dispatched',
        fields: { name: expect.any(String) },
      })
      await noAdditionalRequests(h, 0)
      const refused = w.renameProject({ project: alpha.ref, name: 'Kept draft' })
      const request = await h.captured()
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
      expect(await refused).toMatchObject({
        kind: 'not-admitted',
        rejection: { requestId: request.requestId, reason: 'origin' },
      })
      const rejected = w.renameProject({ project: alpha.ref, name: 'Kept draft' })
      await h.reply(1, renameRejected(alpha.ref, 'validation', 'name'))
      expect(await rejected).toMatchObject({
        kind: 'rejected',
        fields: { name: expect.any(String) },
        outcome: { ok: false, error: { field: 'name' } },
      })
      expect(selector(workflowState(h.store), 'rename-project', alphaSubject)).toMatchObject({
        pending: false,
        fields: { name: expect.any(String) },
        unknown: [],
      })
      await noAdditionalRequests(h, 2)
    } finally {
      stop()
    }
  })

  it.each([
    'lost',
    'unreadable',
    'wrong-correlation',
    'wrong-operation',
    'wrong-native-operation',
    'wrong-subject',
    'unattributable-rejection',
  ])('retains %s native delivery as unknown, never acknowledged or replayed', async (failure) => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    try {
      const launch = workflows(h.store).launchProject({
        project: alpha.ref,
        operation: 'open-workspace',
      })
      const request = await h.captured()
      if (failure === 'lost') request.response.reject(new Error('Post-effect reply was lost'))
      else if (failure === 'unreadable')
        request.response.resolve(
          new Response('{', { headers: { 'Content-Type': 'application/json' } }),
        )
      else if (failure === 'unattributable-rejection')
        request.response.resolve(
          jsonResponse(
            {
              type: 'request-rejected',
              request: 'command',
              requestId: '00000000-0000-4000-8000-000000000000',
              reason: 'origin',
              message: 'Cannot attribute this rejection.',
            },
            403,
          ),
        )
      else
        request.response.resolve(
          jsonResponse({
            type: 'command-result',
            correlationId:
              failure === 'wrong-correlation'
                ? '00000000-0000-4000-8000-000000000000'
                : correlationOf(request.body),
            outcome:
              failure === 'wrong-operation'
                ? renameOutcome()
                : failure === 'wrong-native-operation'
                  ? {
                      ...launchOutcome(),
                      result: { ...launchOutcome().result, operation: 'open-terminal' },
                    }
                  : failure === 'wrong-subject'
                    ? launchOutcome(beta.ref)
                    : launchOutcome(),
          }),
        )
      const result = await launch
      expect(result).toMatchObject({
        kind: 'completion-unknown',
        operation: 'launch-project-operation',
        subject: alphaSubject,
        error: { code: 'transport-failed' },
      })
      expect(result).not.toHaveProperty('result')
      expect(result).not.toHaveProperty('canonicalSubject')
      expect(result).not.toHaveProperty('destination')
      await noAdditionalRequests(h, 1)
      expect(h.store.getSnapshot().state).toEqual(readyState())
    } finally {
      stop()
    }
  })

  it.each(['unknown-first', 'unrelated-first'])(
    'does not clear ambiguity when unrelated settlement arrives %s',
    async (order) => {
      const h = harness()
      const stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        const selector = workflowFeedback
        const launch = w.launchProject({ project: alpha.ref, operation: 'open-workspace' })
        const rename = w.renameProject({ project: beta.ref, name: 'Independent draft' })
        const launchRequest = await h.captured()
        await h.captured(1)
        if (order === 'unknown-first') {
          launchRequest.response.reject(new Error('Native reply lost'))
          await launch
          await h.reply(1, renameOutcome(beta.ref))
          await rename
        } else {
          await h.reply(1, renameOutcome(beta.ref))
          await rename
          launchRequest.response.reject(new Error('Native reply lost'))
          await launch
        }
        const unknown = await launch
        expect(
          selector(workflowState(h.store), 'launch-project-operation', alphaSubject),
        ).toMatchObject({
          current: { id: unknown.id, kind: 'completion-unknown' },
          unknown: [{ id: unknown.id }],
        })
        const rejected = w.renameProject({ project: beta.ref, name: 'Another independent draft' })
        await h.reply(2, renameRejected(beta.ref))
        await rejected
        h.socket().emit('open')
        h.publish(readyState(100, 50))
        expect(
          selector(workflowState(h.store), 'launch-project-operation', alphaSubject).unknown,
        ).toMatchObject([{ id: unknown.id, kind: 'completion-unknown' }])
        expect(attempts(h.store)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: unknown.id,
              kind: 'completion-unknown',
              subject: alphaSubject,
            }),
          ]),
        )
        await noAdditionalRequests(h, 3)
      } finally {
        stop()
      }
    },
  )

  it('retains dismissed unknown truth through pane close, observation release, reconnect and explicit fresh retry', async () => {
    const h = harness()
    let stop = h.store.start()
    h.publish()
    let unsubscribe: () => void = () => undefined
    try {
      const w = workflows(h.store)
      const selector = workflowFeedback
      unsubscribe = h.store.subscribe(() => undefined)
      const launch = w.launchProject({ project: alpha.ref, operation: 'open-workspace' })
      const pendingSnapshot = attempts(h.store)
      const request = await h.captured()
      unsubscribe()
      request.response.reject(new Error('Pane closed before its native result arrived'))
      const old = await launch
      expect(old.kind).toBe('completion-unknown')
      if (old.kind !== 'completion-unknown') throw new Error('Expected retained launch uncertainty')
      const unknownSnapshot = attempts(h.store)
      w.dismiss({ attemptId: old.id })
      expect(
        selector(workflowState(h.store), 'launch-project-operation', alphaSubject),
      ).toMatchObject({
        current: { id: old.id, kind: 'completion-unknown', dismissed: true },
        message: null,
        unknown: [{ id: old.id, kind: 'completion-unknown' }],
      })
      expect(attempts(h.store)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: old.id,
            kind: 'completion-unknown',
            dismissed: true,
            error: old.error,
            reason: old.reason,
          }),
        ]),
      )
      expect(unknownSnapshot).toMatchObject([
        { id: old.id, kind: 'completion-unknown', dismissed: false, error: old.error },
      ])
      stop()
      stop = h.store.start()
      h.socket(1).emit('open')
      expect(
        selector(workflowState(h.store), 'launch-project-operation', alphaSubject).unknown,
      ).toMatchObject([{ id: old.id }])
      h.publish(readyState(1, 20, 'epoch-b'), 1)
      const retry = w.launchProject({ project: alpha.ref, operation: 'open-workspace' })
      expect((await h.captured(1)).body).toMatchObject({
        command: { expectedConfigurationVersion: 20 },
      })
      await h.reply(1, launchOutcome(alpha.ref, 'epoch-b', 900))
      const current = requireAcknowledged(await retry)
      expect(current.id).not.toBe(old.id)
      expect(current.result).toMatchObject({ status: 'invoked', operation: 'open-workspace' })
      expect(current.destination).toBeNull()
      expect(
        selector(workflowState(h.store), 'launch-project-operation', alphaSubject),
      ).toMatchObject({
        current: { id: current.id, kind: 'acknowledged' },
        unknown: [{ id: old.id, kind: 'completion-unknown', dismissed: true }],
      })
      expect(pendingSnapshot).toMatchObject([{ kind: 'pending', dismissed: false }])
      expect(Reflect.set(pendingSnapshot, '0', null)).toBe(false)
      const pendingAttempt = pendingSnapshot[0]
      if (typeof pendingAttempt !== 'object' || pendingAttempt === null)
        throw new Error('Expected immutable pending attempt')
      expect(Reflect.set(pendingAttempt, 'kind', 'acknowledged')).toBe(false)
      await noAdditionalRequests(h, 2)
    } finally {
      unsubscribe()
      stop()
    }
  })

  it.each(['older-first', 'newer-first'])(
    'keeps the latest created same-workflow attempt current after %s late settlement',
    async (order) => {
      const h = harness()
      let stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        const selector = workflowFeedback
        const older = w.renameProject({ project: alpha.ref, name: 'Older draft' })
        await h.captured()
        const newer = await w.renameProject({ project: alpha.ref, name: 'Latest blocked draft' })
        expect(newer.kind).toBe('not-dispatched')
        const before = selector(workflowState(h.store), 'rename-project', alphaSubject)
        expect(before.current?.id).toBe(newer.id)
        expect(before.pending).toBe(true)
        // A pane has no store lifetime authority. A new observer receives the same attempts.
        const pane = h.store.subscribe(() => undefined)
        pane()
        stop()
        stop = h.store.start()
        h.publish(readyState(1, 2, 'epoch-b'), 1)
        if (order === 'newer-first') {
          const newest = await w.renameProject({ project: alpha.ref, name: 'Reopened pane draft' })
          expect(newest.kind).toBe('not-dispatched')
          await h.reply(0, renameOutcome(alpha.ref, 2, 'epoch-a', 900))
          requireAcknowledged(await older)
          expect(selector(workflowState(h.store), 'rename-project', alphaSubject).current?.id).toBe(
            newest.id,
          )
        } else {
          await h.reply(0, renameOutcome(alpha.ref, 2, 'epoch-a', 900))
          requireAcknowledged(await older)
          expect(selector(workflowState(h.store), 'rename-project', alphaSubject).current?.id).toBe(
            newer.id,
          )
          const explicit = w.renameProject({ project: alpha.ref, name: 'Reopened pane draft' })
          await h.reply(1, renameOutcome(alpha.ref, 3, 'epoch-b', 900))
          const current = requireAcknowledged(await explicit)
          expect(selector(workflowState(h.store), 'rename-project', alphaSubject).current?.id).toBe(
            current.id,
          )
        }
        h.publish(readyState(2, 3, 'epoch-b'), 1)
        expect(h.sockets).toHaveLength(2)
        expect(h.store.getSnapshot().state?.stateSequence).toBe(2)
      } finally {
        stop()
      }
    },
  )

  it.each(['predecessor-first', 'successor-first'])(
    'preserves obsolete outcome truth without retiring successor reads, %s',
    async (order) => {
      const h = harness()
      let stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        const predecessor = w.launchProject({ project: alpha.ref, operation: 'open-workspace' })
        await h.captured()
        stop()
        stop = h.store.start()
        h.publish(readyState(1, 10, 'epoch-b'), 1)
        const successor = w.launchProject({ project: beta.ref, operation: 'open-workspace' })
        await h.captured(1)
        if (order === 'predecessor-first') {
          await h.reply(0, launchOutcome(alpha.ref, 'epoch-a', 900))
          requireAcknowledged(await predecessor)
          await h.reply(1, launchOutcome(beta.ref, 'epoch-b', 900))
          requireAcknowledged(await successor)
        } else {
          await h.reply(1, launchOutcome(beta.ref, 'epoch-b', 900))
          requireAcknowledged(await successor)
          await h.reply(0, launchOutcome(alpha.ref, 'epoch-a', 900))
          requireAcknowledged(await predecessor)
        }
        expect(h.store.getSnapshot().state).toEqual(readyState(1, 10, 'epoch-b'))
        h.publish(readyState(2, 11, 'epoch-b'), 1)
        expect(h.store.getSnapshot().state).toEqual(readyState(2, 11, 'epoch-b'))
        expect(h.sockets).toHaveLength(2)
        expect(h.socket(1).closed).toBe(false)
        await noAdditionalRequests(h, 2)
      } finally {
        stop()
      }
    },
  )

  it('uses an independently valid current-authority outcome to request a fresh baseline, not replace reads or settle unknown', async () => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    try {
      const w = workflows(h.store)
      const selector = workflowFeedback
      const lost = w.launchProject({ project: alpha.ref, operation: 'open-workspace' })
      const lostRequest = await h.captured()
      lostRequest.response.reject(new Error('Previous native result was lost'))
      const unknown = await lost
      const accepted = h.store.getSnapshot().state
      const current = w.launchProject({ project: beta.ref, operation: 'open-workspace' })
      await h.reply(1, launchOutcome(beta.ref, 'epoch-b', 900))
      const acknowledgement = requireAcknowledged(await current)
      expect(acknowledgement.result).toMatchObject({ project: beta.ref, status: 'invoked' })
      expect(h.sockets).toHaveLength(2)
      expect(h.socket(0).closed).toBe(true)
      expect(h.store.getSnapshot().synchronization).toBe('retained')
      expect(h.store.getSnapshot().state).toBe(accepted)
      h.socket(1).emit('open')
      expect(h.store.getSnapshot().state).toBe(accepted)
      h.publish(readyState(1, 20, 'epoch-b'), 1)
      h.publish(readyState(2, 21, 'epoch-b'), 1)
      expect(h.store.getSnapshot().state).toEqual(readyState(2, 21, 'epoch-b'))
      expect(
        selector(workflowState(h.store), 'launch-project-operation', alphaSubject).unknown,
      ).toMatchObject([{ id: unknown.id, kind: 'completion-unknown' }])
      await noAdditionalRequests(h, 2)
    } finally {
      stop()
    }
  })

  it('allows synchronized read-only folder selection without a version and overlaps it with native dispatch', async () => {
    const h = harness()
    const stop = h.store.start()
    h.publish()
    try {
      const w = workflows(h.store)
      const native = w.launchProject({ project: beta.ref, operation: 'open-workspace' })
      await h.captured()
      const next = readyState(5, 9)
      if (next.phase !== 'ready') throw new Error('Expected ready fixture')
      h.publish(
        applicationStateSchema.parse({
          ...next,
          mode: 'read-only',
          configuration: {
            valid: false,
            issues: [{ path: 'projects', message: 'Configuration requires repair.' }],
            notices: [],
          },
        }),
      )
      const selecting = w.selectWorkspace({ owner: folderOwner })
      const request = await h.captured(1)
      // A single browser folder dialog conflicts even when its repair owner differs.
      expect(
        await w.selectWorkspace({ owner: { kind: 'project', project: beta.ref } }),
      ).toMatchObject({ kind: 'not-dispatched', operation: 'select-workspace' })
      request.response.resolve(
        jsonResponse({
          type: 'query-result',
          correlationId: correlationOf(request.body),
          result: {
            ok: true,
            operation: 'select-workspace',
            subject: noneSubject,
            serverEpoch: 'epoch-a',
            stateSequence: 5,
            result: { kind: 'cancelled' },
          },
        }),
      )
      const cancellation = requireAcknowledged(await selecting)
      expect(cancellation.result).toEqual({ kind: 'cancelled' })
      expect(cancellation).not.toHaveProperty('configurationVersion')
      await h.reply(0, launchOutcome(beta.ref))
      requireAcknowledged(await native)
      await noAdditionalRequests(h, 2)
    } finally {
      stop()
    }
  })

  it.each(['committed', 'committed-unconfirmed'])(
    'returns canonical normalized registration identity with truthful %s destination',
    async (commit) => {
      const h = harness()
      const stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        const candidate = {
          integration: 'local',
          connectionId: alpha.connectionId,
          workspace: { path: '/submitted/../unclean' },
          displayName: 'New Project',
        } satisfies CommandFor<'register-project'>['candidate']
        const admission = w.registerProject({ candidate })
        expect((await h.captured()).body).toMatchObject({
          command: { type: 'register-project', candidate, expectedConfigurationVersion: 1 },
        })
        await h.reply(0, {
          ok: true,
          operation: 'register-project',
          subject: { kind: 'registration', integration: 'local', connectionId: alpha.connectionId },
          serverEpoch: 'epoch-a',
          stateSequence: 5,
          result: {
            type: 'register-project',
            project: beta.ref,
            connectionId: alpha.connectionId,
            workspacePath: '/canonical',
            configurationVersion: 2,
            commit,
          },
        })
        const result = requireAcknowledged(await admission)
        expect(result.result).toMatchObject({
          project: beta.ref,
          workspacePath: '/canonical',
          commit,
        })
        expect(result.canonicalSubject).toEqual(betaSubject)
        expect(result.destination).toBe(
          commit === 'committed' ? '/projects/local/beta/settings' : null,
        )
        // No HTTP response adopts a read Project or guesses one by submitted Workspace.
        expect(h.store.getSnapshot().state).toEqual(readyState())
        await noAdditionalRequests(h, 1)
      } finally {
        stop()
      }
    },
  )

  it.each(['committed', 'committed-unconfirmed'])(
    'returns canonical Workspace repair identity with truthful %s destination',
    async (commit) => {
      const h = harness()
      const stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        const repair = w.repairWorkspace({ project: alpha.ref, path: '/submitted/../unclean' })
        expect((await h.captured()).body).toMatchObject({
          command: {
            type: 'repair-project-workspace',
            project: alpha.ref,
            workspace: { path: '/submitted/../unclean' },
            expectedConfigurationVersion: 1,
          },
        })
        await h.reply(0, {
          ok: true,
          operation: 'repair-project-workspace',
          subject: alphaSubject,
          serverEpoch: 'epoch-a',
          stateSequence: 5,
          result: {
            type: 'repair-project-workspace',
            project: alpha.ref,
            workspacePath: '/canonical',
            configurationVersion: 2,
            commit,
          },
        })
        const result = requireAcknowledged(await repair)
        expect(result.result).toMatchObject({
          project: alpha.ref,
          workspacePath: '/canonical',
          commit,
        })
        expect(result.canonicalSubject).toEqual(alphaSubject)
        expect(result.destination).toBe(
          commit === 'committed' ? '/projects/local/alpha/settings' : null,
        )
        await noAdditionalRequests(h, 1)
      } finally {
        stop()
      }
    },
  )

  it.each(['selected', 'cancelled'])(
    'owns the explicit %s folder interaction result in its consuming repair scope',
    async (kind) => {
      const h = harness()
      const stop = h.store.start()
      h.publish()
      try {
        const w = workflows(h.store)
        const selector = workflowFeedback
        const selection = w.selectWorkspace({ owner: folderOwner })
        const request = await h.captured()
        expect(request.body).toEqual({
          type: 'query',
          correlationId: expect.any(String),
          query: { type: 'select-workspace' },
        })
        request.response.resolve(
          jsonResponse({
            type: 'query-result',
            correlationId: correlationOf(request.body),
            result: {
              ok: true,
              operation: 'select-workspace',
              subject: noneSubject,
              serverEpoch: 'epoch-a',
              stateSequence: 5,
              result:
                kind === 'selected'
                  ? { kind: 'selected', path: '/canonical/workspace' }
                  : { kind: 'cancelled' },
            },
          }),
        )
        const result = requireAcknowledged(await selection)
        expect(result.result).toEqual(
          kind === 'selected'
            ? { kind: 'selected', path: '/canonical/workspace' }
            : { kind: 'cancelled' },
        )
        expect(result.destination).toBeNull()
        expect(
          selector(workflowState(h.store), 'select-workspace', noneSubject, folderOwner).current
            ?.id,
        ).toBe(result.id)
        expect(
          selector(workflowState(h.store), 'select-workspace', noneSubject, {
            kind: 'project',
            project: beta.ref,
          }).current,
        ).toBeNull()
        await noAdditionalRequests(h, 1)
      } finally {
        stop()
      }
    },
  )
})
