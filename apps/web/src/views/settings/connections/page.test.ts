import type { ApplicationState, Connection } from '@roadmap/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import { ConnectionSettings } from './page'

const github = {
  integration: 'github',
  name: 'GitHub',
  connectionKind: 'device-authorization',
  newInstallationUrl: 'https://github.com/apps/example/installations/new',
  installationsUrl: 'https://github.com/settings/installations',
  authorizationsUrl: 'https://github.com/settings/applications',
} as const

function renderConnections(state: ApplicationState): string {
  const store: RoadmapStore = {
    subscribe: () => () => undefined,
    getSnapshot: () => ({ transport: 'live', state, command: { inFlight: false, error: null } }),
    start: () => () => undefined,
    query: async () => {
      throw new Error('Unexpected query')
    },
    execute: async () => {
      throw new Error('Unexpected command')
    },
  }
  return renderToStaticMarkup(
    createElement(RoadmapProvider, { store }, createElement(ConnectionSettings)),
  )
}

function state(connections: Connection[]): ApplicationState {
  return {
    serverEpoch: 'test',
    stateSequence: 1,
    configurationVersion: 1,
    supportedIntegrations: [github],
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
    roadmap: { capturedAt: 0, projects: [], unreachable: [] },
  }
}

describe('ConnectionSettings', () => {
  it('keeps setup and connection issues in their respective sections', () => {
    const initial = state([
      {
        id: 'one',
        integration: 'github',
        name: 'Work',
        builtIn: false,
        availability: { status: 'authorization-required', cause: 'Token expired.' },
      },
      {
        id: 'two',
        integration: 'github',
        name: 'Personal',
        builtIn: false,
        availability: { status: 'available' },
      },
    ])
    const markup = renderConnections({
      ...initial,
      configuration: { valid: false, issues: [], notices: [] },
    })
    const setup = markup.indexOf('>Connection setup</h2>')
    expect(setup).toBeGreaterThan(0)
    expect(markup.indexOf('Configuration needs repair.')).toBeGreaterThan(setup)
    const work = markup.indexOf('>Work</h2>')
    const personal = markup.indexOf('>Personal</h2>')
    const issue = markup.indexOf('Token expired.')
    expect(work).toBeGreaterThan(0)
    expect(issue).toBeGreaterThan(work)
    expect(issue).toBeLessThan(personal)
    expect(markup.slice(personal)).not.toContain('Token expired.')
  })

  it('keeps setup problems and notices inside the setup section even with no connections', () => {
    const initial = state([])
    const markup = renderConnections({
      ...initial,
      supportedIntegrations: [],
      configuration: { valid: false, issues: [], notices: ['Credential cleanup pending.'] },
    })
    const setup = markup.indexOf('>Connection setup</h2>')
    expect(setup).toBeGreaterThan(0)
    expect(markup.indexOf('GitHub Connections are unavailable.')).toBeGreaterThan(setup)
    expect(markup.indexOf('Configuration needs repair.')).toBeGreaterThan(setup)
    expect(markup.indexOf('Credential cleanup pending.')).toBeGreaterThan(setup)
  })
})
