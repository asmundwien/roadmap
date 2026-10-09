import type { ApplicationState, Connection } from '@roadmap/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import { ConnectionPage } from './page'

const connection: Connection = {
  id: 'github/work',
  integration: 'github',
  name: 'Work',
  builtIn: false,
  availability: { status: 'authorization-required', cause: 'Token expired.' },
}

function renderDetail(connectionId: string, connections: Connection[], initial = true): string {
  const state: ApplicationState = {
    serverEpoch: 'test',
    stateSequence: 1,
    configurationVersion: 1,
    supportedIntegrations: [],
    connections,
    registrations: [],
    projects: [],
    authorizationOperations: [],
    configuration: { valid: true, issues: [], notices: [] },
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
    roadmap: { capturedAt: 0 },
  }
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
      createElement(RoadmapProvider, { store }, createElement(ConnectionPage, { connectionId })),
    ),
  )
}

describe('ConnectionPage', () => {
  it('offers rename, reauthentication, and removal for the selected connection', () => {
    const markup = renderDetail('github/work', [
      connection,
      { ...connection, id: 'other', name: 'Other' },
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
})
