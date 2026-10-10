import {
  configurationVersionSchema,
  connectionIdSchema,
  serverEpochSchema,
  stateSequenceSchema,
} from '@roadmap/contracts/identity'
import {
  authorizationOperationSchema,
  type Connection,
  type ReadyApplicationState,
  readyApplicationStateSchema,
} from '@roadmap/contracts/state'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RoadmapProvider } from '@/store/roadmap-provider'
import { createRoadmapStore, type RoadmapStore, type SocketLike } from '@/store/roadmap-store'
import { makeRoadmapSnapshot, makeRoadmapStore } from '@/views/map/test-fixtures'
import { ConnectionPage } from './page'

const connection: Connection = {
  id: connectionIdSchema.parse('github/work'),
  integration: 'github',
  name: 'Work',
  builtIn: false,
  githubIdentity: { id: 'account-1', login: 'test-account' },
  availability: { status: 'authorization-required', cause: 'Token expired.' },
}

function detailState(
  connections: Connection[],
  authorizationOperations: ReadyApplicationState['authorizationOperations'] = [],
): ReadyApplicationState {
  return readyApplicationStateSchema.parse({
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: serverEpochSchema.parse('test'),
    stateSequence: stateSequenceSchema.parse(1),
    configurationVersion: configurationVersionSchema.parse(1),
    supportedIntegrations: [
      {
        integration: 'github',
        name: 'GitHub',
        connectionKind: 'device-authorization',
        newInstallationUrl: 'https://github.test/install',
        installationsUrl: 'https://github.test/installations',
        authorizationsUrl: 'https://github.test/authorizations',
      },
    ],
    connections,

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
    capturedAt: 0,
  })
}

function renderStore(store: RoadmapStore, connectionId: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        RoadmapProvider,
        { store },
        createElement(ConnectionPage, { connectionId: connectionIdSchema.parse(connectionId) }),
      ),
    ),
  )
}

function renderDetail(
  connectionId: string,
  connections: Connection[],
  initial = true,
  authorizationOperations: ReadyApplicationState['authorizationOperations'] = [],
): string {
  return renderStore(
    makeRoadmapStore(
      [],
      makeRoadmapSnapshot(initial ? detailState(connections, authorizationOperations) : null),
    ),
    connectionId,
  )
}

function detailStore(fetchRequest: typeof fetch) {
  const listeners = new Set<(event: { data?: unknown }) => void>()
  const socket: SocketLike = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener)
    },
    close() {},
  }
  const store = createRoadmapStore('http://roadmap.test', {
    createSocket: () => socket,
    fetch: fetchRequest,
  })
  const release = store.start()
  const publish = (state: ReadyApplicationState) => {
    for (const listener of listeners) listener({ data: JSON.stringify({ type: 'state', state }) })
  }
  publish(detailState([connection]))
  return { store, publish, release }
}

describe('ConnectionPage', () => {
  it('offers rename, reauthentication, and removal for the selected connection', () => {
    const markup = renderDetail('github/work', [
      connection,
      {
        ...connection,
        id: connectionIdSchema.parse('other'),
        name: 'Other',
        githubIdentity: { id: 'account-2', login: 'other-account' },
      },
    ])
    expect(markup).toContain('value="Work"')
    expect(markup).toContain('Token expired.')
    expect(markup).toContain('Reauthenticate')
    expect(markup).toContain('Remove connection')
    expect(markup).not.toContain('Other</h1>')
  })
  it('waits for the first snapshot before reporting an unknown connection', () => {
    const markup = renderDetail('github/work', [], false)
    expect(markup).not.toContain('Connection not found')
  })

  it('offers a return link when a connection no longer exists', () => {
    const markup = renderDetail('missing', [connection])
    expect(markup).toContain('Connection not found')
    expect(markup).toContain('href="/connections"')
    expect(markup).not.toContain('Save name')
  })

  it('keeps a denied reauthorization visible and offers retry for its original Connection subject', () => {
    const denied = authorizationOperationSchema.parse({
      id: 'authorization-original',
      status: 'terminal',
      outcome: 'denied',
      cause: 'GitHub denied this authorization.',
      connectionId: connection.id,
    })
    const markup = renderDetail(connection.id, [connection], true, [denied])

    expect(markup).toContain('GitHub denied this authorization.')
    expect(markup).toContain('Retry authorization')
  })

  it('renders the required verification destination and code from a waiting reauthorization', () => {
    const waiting = authorizationOperationSchema.parse({
      id: 'authorization-original',
      status: 'waiting',
      connectionId: connection.id,
      verificationUri: 'https://github.com/login/device',
      userCode: 'EXACT-CODE',
      expiresAt: 0,
    })
    const markup = renderDetail(connection.id, [connection], true, [waiting])

    expect(markup).toContain('href="https://github.com/login/device"')
    expect(markup).toContain('EXACT-CODE')
    expect(markup).toContain('Cancel authorization')
  })

  it('keeps rename and removal uncertainty visible after the Connection disappears and the page reopens', async () => {
    const fixture = detailStore(async () => {
      throw new Error('Lost response')
    })
    try {
      await fixture.store.workflows.renameConnection({
        connectionId: connection.id,
        name: 'Renamed',
      })
      await fixture.store.workflows.removeConnection({ connectionId: connection.id })
      fixture.publish({ ...detailState([]), stateSequence: stateSequenceSchema.parse(2) })

      for (const markup of [
        renderStore(fixture.store, connection.id),
        renderStore(fixture.store, connection.id),
      ]) {
        expect(markup).toContain('Connection not found')
        expect(markup.match(/Dismiss notice/g)).toHaveLength(2)
        expect(markup.match(/href="\/connections"/g)).toHaveLength(1)
      }
    } finally {
      fixture.release()
    }
  })

  it('keeps pending removal visible after disappearance and does not offer confirmed navigation for an unconfirmed commit', async () => {
    let settle: (response: Response) => void = () => {
      throw new Error('Removal transport has not started')
    }
    let correlationId: string | null = null
    const fixture = detailStore(async (_input, init) => {
      correlationId = new Headers(init?.headers).get('X-Roadmap-Request-Id')
      return new Promise<Response>((resolve) => {
        settle = resolve
      })
    })
    try {
      const removal = fixture.store.workflows.removeConnection({ connectionId: connection.id })
      fixture.publish({ ...detailState([]), stateSequence: stateSequenceSchema.parse(2) })
      const pendingMarkup = renderStore(fixture.store, connection.id)
      expect(pendingMarkup).toContain('Connection not found')
      expect(pendingMarkup).toContain('pending')

      settle(
        new Response(
          JSON.stringify({
            type: 'command-result',
            correlationId,
            outcome: {
              operation: 'remove-connection',
              ok: true,
              serverEpoch: 'test',
              stateSequence: 2,
              subject: { kind: 'connection', connectionId: connection.id },
              result: {
                type: 'remove-connection',
                connectionId: connection.id,
                configurationVersion: 2,
                commit: 'committed-unconfirmed',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      const attempt = await removal
      expect(attempt.kind).toBe('acknowledged')
      const settledMarkup = renderStore(fixture.store, connection.id)
      expect(settledMarkup).toContain(connection.id)
      expect(settledMarkup.match(/href="\/connections"/g)).toHaveLength(1)
      expect(settledMarkup).not.toContain('Dismiss notice')
    } finally {
      fixture.release()
    }
  })

  it('keeps retry and cancellation uncertainty scoped to the Connection after authorization and target disappear', async () => {
    const fixture = detailStore(async () => {
      throw new Error('Lost authorization response')
    })
    const operation = authorizationOperationSchema.parse({
      id: 'authorization-original',
      status: 'waiting',
      connectionId: connection.id,
      verificationUri: 'https://github.com/login/device',
      userCode: 'EXACT-CODE',
      expiresAt: 0,
    })
    try {
      fixture.publish({
        ...detailState([connection], [operation]),
        stateSequence: stateSequenceSchema.parse(2),
      })
      await fixture.store.workflows.cancelAuthorization({ operationId: operation.id })
      fixture.publish({
        ...detailState(
          [connection],
          [
            authorizationOperationSchema.parse({
              id: operation.id,
              status: 'terminal',
              outcome: 'denied',
              cause: 'Denied by GitHub',
              connectionId: connection.id,
            }),
          ],
        ),
        stateSequence: stateSequenceSchema.parse(3),
      })
      await fixture.store.workflows.retryAuthorization({ operationId: operation.id })
      fixture.publish({ ...detailState([]), stateSequence: stateSequenceSchema.parse(4) })

      const markup = renderStore(fixture.store, connection.id)
      expect(markup).toContain('Connection not found')
      expect(markup.match(/Dismiss notice/g)).toHaveLength(2)
      expect(renderStore(fixture.store, 'another-connection')).not.toContain('Dismiss notice')
    } finally {
      fixture.release()
    }
  })

  it('keeps a rejected removal visible after target disappearance without a confirmed result link', async () => {
    const fixture = detailStore(
      async (_input, init) =>
        new Response(
          JSON.stringify({
            type: 'command-result',
            correlationId: new Headers(init?.headers).get('X-Roadmap-Request-Id'),
            outcome: {
              operation: 'remove-connection',
              ok: false,
              serverEpoch: 'test',
              stateSequence: 2,
              subject: { kind: 'connection', connectionId: connection.id },
              error: {
                code: 'conflict',
                message: 'External configuration changed before removal.',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    try {
      await fixture.store.workflows.removeConnection({ connectionId: connection.id })
      fixture.publish({ ...detailState([]), stateSequence: stateSequenceSchema.parse(2) })
      const markup = renderStore(fixture.store, connection.id)
      expect(markup).toContain('Connection not found')
      expect(markup).toContain('External configuration changed before removal.')
      expect(markup.match(/href="\/connections"/g)).toHaveLength(1)
    } finally {
      fixture.release()
    }
  })
})
