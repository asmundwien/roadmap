import type { ApplicationState, RegisteredProject } from '@roadmap/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import { ProjectRegistrationPage } from './page'

const project: RegisteredProject = {
  key: { integration: 'local', id: 'my workspace' },
  connectionId: 'local',
  locator: { integration: 'local', path: '/tmp/my-workspace' },
  workspace: { path: '/tmp/my-workspace' },
  name: 'My workspace',
  availability: { status: 'available', observedAt: 1_000 },
  openMaps: [],
  closedMaps: [],
  warnings: [],
  actions: [],
}

function renderPage(projects: RegisteredProject[], capturedAt = 0): string {
  const state: ApplicationState = {
    serverEpoch: 'test',
    stateSequence: 1,
    configurationVersion: 1,
    supportedIntegrations: [],
    connections: [],
    registrations: [],
    projects,
    authorizationOperations: [],
    configuration: { valid: true, issues: [], notices: [] },
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
    roadmap: { capturedAt, projects: [], unreachable: [] },
  }
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
    createElement(
      RoadmapProvider,
      { store },
      createElement(ProjectRegistrationPage, { projectKey: project.key }),
    ),
  )
}

describe('ProjectRegistrationPage', () => {
  it('names the selected project without showing another project or editing controls', () => {
    const markup = renderPage([
      project,
      { ...project, key: { integration: 'github', id: 'other' }, name: 'Other' },
    ])
    expect(markup).toContain('Settings / Projects')
    expect(markup).toContain('My workspace</h1>')
    expect(markup).not.toContain('Other</h1>')
    expect(markup).not.toContain('<form')
  })

  it('provides a return link when the project is no longer registered', () => {
    const markup = renderPage([])
    expect(markup).toContain('Project not found')
    expect(markup).toContain('href="#/settings/connections"')
  })
})
