import type { ApplicationState, Connection, RegisteredProject } from '@roadmap/contracts'
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

const connection: Connection = {
  id: 'local',
  integration: 'local',
  name: 'On this Mac',
  builtIn: true,
  availability: { status: 'available', observedAt: 1_000 },
}

function renderPage(projects: RegisteredProject[], initial = true, valid = true): string {
  const state: ApplicationState = {
    serverEpoch: 'test',
    stateSequence: 1,
    configurationVersion: 1,
    supportedIntegrations: [],
    connections: [connection],
    registrations: [],
    projects,
    authorizationOperations: [],
    configuration: { valid, issues: [], notices: [] },
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
    roadmap: { capturedAt: 0, projects: [], unreachable: [] },
  }
  const store: RoadmapStore = {
    subscribe: () => () => undefined,
    getSnapshot: () => ({
      transport: 'live',
      state: initial ? state : null,
      command: { inFlight: false, error: null },
    }),
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
  it('shows the selected registration and its management actions without showing another project', () => {
    const markup = renderPage([
      project,
      { ...project, key: { integration: 'github', id: 'other' }, name: 'Other' },
    ])
    expect(markup).toContain('My workspace</h1>')
    expect(markup).toContain('On this Mac')
    expect(markup).toContain('/tmp/my-workspace')
    expect(markup).toContain('Save name')
    expect(markup).toContain('Refresh now')
    expect(markup).toContain('Remove project registration')
    expect(markup).not.toContain('Other</h1>')
  })

  it('offers workspace repair only when the selected project is unavailable', () => {
    const unavailable = {
      ...project,
      availability: { status: 'unavailable', cause: 'Workspace moved.' },
    } satisfies RegisteredProject
    const markup = renderPage([unavailable])
    expect(markup).toContain('Workspace moved.')
    expect(markup).toContain('Choose folder')
    expect(markup).toContain('Validate and repair')
    expect(renderPage([project])).not.toContain('Validate and repair')
  })

  it('blocks changes when configuration needs repair', () => {
    const markup = renderPage([project], true, false)
    expect(markup).toContain('Configuration needs repair.')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Save name<\/button>/)
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Remove project registration<\/button>/)
  })

  it('waits for a first snapshot before reporting a missing project', () => {
    expect(renderPage([], false)).toContain('Loading project')
    expect(renderPage([], false)).not.toContain('Project not found')
  })

  it('provides a return link when the project is no longer registered', () => {
    const markup = renderPage([])
    expect(markup).toContain('Project not found')
    expect(markup).toContain('href="#/settings/connections"')
  })
})
