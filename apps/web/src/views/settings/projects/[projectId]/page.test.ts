import type {
  ApplicationState,
  Connection,
  RegisteredProject,
  WayfinderMap,
} from '@roadmap/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
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

const affectedMap: WayfinderMap = {
  project: project.key,
  id: 'map',
  isOpen: true,
  updatedAt: 1_000,
  body: {
    raw: '',
    destination: '',
    notes: [],
    decisions: [],
    notYetSpecified: [],
    notYetSpecifiedNote: '',
    outOfScope: [],
    sections: [],
    missingSections: [],
  },
  tickets: [
    {
      id: 'ticket',
      body: '',
      typeEvidence: { kind: 'recognized', value: 'task', labels: ['wayfinder:task'] },
      state: 'frontier',
      isClaimed: false,
      isBlocked: false,
      assignees: [],
      blockedBy: [],
      blockersComplete: true,
      warnings: [],
    },
  ],
  frontier: [],
  progress: { total: 1, completed: 0 },
  ticketsComplete: true,
  warnings: [],
}

function renderPage(
  projects: RegisteredProject[],
  initial = true,
  valid = true,
  automation: ApplicationState['automation'] = {
    enabled: false,
    enabledProjects: [],
    availability: { status: 'ready' },
    evidence: [],
    overrides: [],
  },
  inFlight = false,
): string {
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
    automation,
    roadmap: { capturedAt: 0, projects: [], unreachable: [] },
  }
  const store: RoadmapStore = {
    subscribe: () => () => undefined,
    getSnapshot: () =>
      initial
        ? {
            transport: 'live',
            synchronization: 'synchronized',
            state,
            command: { inFlight, error: null },
          }
        : {
            transport: 'live',
            synchronization: 'not-ready',
            state: null,
            command: { inFlight, error: null },
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
        createElement(ProjectRegistrationPage, { projectKey: project.key }),
      ),
    ),
  )
}

describe('ProjectRegistrationPage', () => {
  it('preserves the project preference while global Automation is paused', () => {
    const markup = renderPage([project], true, true, {
      enabled: false,
      enabledProjects: [project.key],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    })
    expect(markup).toMatch(/<input[^>]*role="switch"[^>]*aria-checked="true"/)
  })

  it('requires explicit acknowledgement before enabling a project with an unknown Session outcome', () => {
    const markup = renderPage([project], true, true, {
      enabled: true,
      enabledProjects: [project.key],
      availability: { status: 'ready' },
      evidence: [
        {
          target: { project: project.key, mapId: 'map', ticketId: 'ticket' },
          classification: { status: 'running', admission: 'automatic' },
          wayfinder: {
            status: 'outcome-unknown',
            admission: 'automatic',
            reason: 'Server stopped.',
            acknowledged: false,
          },
        },
      ],
      overrides: [],
    })
    const toggle = markup.match(/<input[^>]*role="switch"[^>]*>/)?.[0]
    expect(toggle).toBeDefined()
    expect(toggle).toContain('aria-checked="false"')
    expect(toggle).toContain('disabled=""')
    expect(markup).toMatch(/<button[^>]*>[^<]*Acknowledge/)
  })

  it.each([
    { interruptedProject: project.key, acknowledged: true },
    { interruptedProject: { integration: 'github', id: project.key.id }, acknowledged: false },
    { interruptedProject: { integration: 'local', id: 'another project' }, acknowledged: false },
  ] satisfies { interruptedProject: RegisteredProject['key']; acknowledged: boolean }[])(
    'does not block this project for acknowledged or another project interruption: %j',
    ({ interruptedProject, acknowledged }) => {
      const markup = renderPage([project], true, true, {
        enabled: true,
        enabledProjects: [project.key],
        availability: { status: 'ready' },
        evidence: [
          {
            target: { project: interruptedProject, mapId: 'map', ticketId: 'ticket' },
            classification: { status: 'running', admission: 'automatic' },
            wayfinder: {
              status: 'outcome-unknown',
              admission: 'automatic',
              reason: 'Server stopped.',
              acknowledged,
            },
          },
        ],
        overrides: [],
      })
      const toggle = markup.match(/<input[^>]*role="switch"[^>]*>/)?.[0]
      expect(toggle).toContain('aria-checked="true"')
      expect(toggle).not.toContain('disabled=""')
      expect(markup).not.toMatch(/<button[^>]*>[^<]*Acknowledge/)
    },
  )

  it('allows project preference changes while Harness Commands are unavailable', () => {
    const markup = renderPage([project], true, true, {
      enabled: false,
      enabledProjects: [project.key],
      availability: { status: 'unavailable', cause: 'Harness command missing.' },
      evidence: [],
      overrides: [],
    })
    const toggle = markup.match(/<input[^>]*role="switch"[^>]*>/)?.[0]
    expect(toggle).toContain('aria-checked="true"')
    expect(toggle).not.toContain('disabled=""')
  })

  it.each([
    { valid: false, inFlight: false },
    { valid: true, inFlight: true },
  ])(
    'blocks ordinary and recovery controls while changes are blocked: %j',
    ({ valid, inFlight }) => {
      const automation: ApplicationState['automation'] = {
        enabled: true,
        enabledProjects: [],
        availability: { status: 'ready' },
        evidence: [],
        overrides: [],
      }
      const ordinary = renderPage([project], true, valid, automation, inFlight)
      expect(ordinary.match(/<input[^>]*role="switch"[^>]*>/)?.[0]).toContain('disabled=""')
      const recovery = renderPage(
        [project],
        true,
        valid,
        {
          ...automation,
          evidence: [
            {
              target: { project: project.key, mapId: 'map', ticketId: 'ticket' },
              classification: { status: 'running', admission: 'automatic' },
              wayfinder: {
                status: 'outcome-unknown',
                admission: 'automatic',
                reason: 'Server stopped.',
                acknowledged: false,
              },
            },
          ],
        },
        inFlight,
      )
      expect(recovery).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Acknowledge/)
    },
  )

  it.each([
    { maps: [affectedMap], linked: true },
    { maps: [{ ...affectedMap, tickets: [] }], linked: false },
    { maps: [], linked: false },
  ])(
    'links the interrupted ticket only when it resolves in current project maps: %j',
    ({ maps, linked }) => {
      const markup = renderPage([{ ...project, openMaps: maps }], true, true, {
        enabled: true,
        enabledProjects: [],
        availability: { status: 'ready' },
        evidence: [
          {
            target: { project: project.key, mapId: 'map', ticketId: 'ticket' },
            classification: { status: 'running', admission: 'automatic' },
            wayfinder: {
              status: 'outcome-unknown',
              admission: 'automatic',
              reason: 'Server stopped.',
              acknowledged: false,
            },
          },
        ],
        overrides: [],
      })
      expect(markup.includes('href="/projects/local/my%20workspace/maps/map/tickets/ticket"')).toBe(
        linked,
      )
    },
  )

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

  it('blocks changes when configuration needs repair', () => {
    const markup = renderPage([project], true, false)
    expect(markup).toContain('Configuration needs repair.')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Save name<\/button>/)
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Remove project registration<\/button>/)
  })

  it('waits for a first snapshot before reporting a missing project', () => {
    expect(renderPage([], false)).not.toContain('Project not found')
  })

  it('provides a return link when the project is no longer registered', () => {
    const markup = renderPage([])
    expect(markup).toContain('Project not found')
    expect(markup).toContain('href="/connections"')
  })
})
