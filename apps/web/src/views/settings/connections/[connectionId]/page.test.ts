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
import type { RoadmapStore } from '@/store/roadmap-store'
import { ConnectionPage } from './page'

const connection: Connection = {
  id: connectionIdSchema.parse('github/work'),
  integration: 'github',
  name: 'Work',
  builtIn: false,
  githubIdentity: { id: 'account-1', login: 'test-account' },
  availability: { status: 'authorization-required', cause: 'Token expired.' },
}

function renderDetail(
  connectionId: string,
  connections: Connection[],
  initial = true,
  authorizationOperations: ReadyApplicationState['authorizationOperations'] = [],
): string {
  const state = readyApplicationStateSchema.parse({
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: serverEpochSchema.parse('test'),
    stateSequence: stateSequenceSchema.parse(1),
    configurationVersion: configurationVersionSchema.parse(1),
    supportedIntegrations: [],
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
  const store: RoadmapStore = {
    subscribe: () => () => undefined,
    getSnapshot: () =>
      initial
        ? {
            transport: 'live',
            synchronization: 'synchronized',
            state,
            command: { inFlight: false, error: null },
          }
        : {
            transport: 'live',
            synchronization: 'not-ready',
            state: null,
            command: { inFlight: false, error: null },
          },
    start: () => () => undefined,
    query: async () => {
      throw new Error('Unexpected query')
    },
    execute: async () => {
      throw new Error('Unexpected command')
    },
  }
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
    expect(markup).not.toContain('Authorization terminal')
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
})
