import type {
  ApplicationState,
  Connection,
  MapResource,
  RegisteredProject,
} from '@roadmap/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import {
  absentMap,
  currentProject,
  readableMap,
  readableTicket,
} from '@/views/overview/test-fixtures'
import { ProjectRegistrationPage } from './page'

const project: RegisteredProject = {
  ...currentProject('my workspace'),
  workspace: { path: '/tmp/my-workspace' },
  name: 'My workspace',
}

const connection: Connection = {
  id: 'local',
  integration: 'local',
  name: 'On this Mac',
  builtIn: true,
  availability: { status: 'available', observedAt: 1_000 },
}

const baseMap = readableMap(project.key, 'map')
const affectedTicket = readableTicket(baseMap, 'ticket')
const affectedMap: MapResource = {
  ...baseMap,
  tickets: [affectedTicket],
  ticketsMembership:
    baseMap.ticketsMembership.kind === 'current-complete'
      ? {
          kind: 'current-complete',
          observation: {
            ...baseMap.ticketsMembership.observation,
            value: { members: [affectedTicket.key] },
          },
        }
      : baseMap.ticketsMembership,
}

if (
  affectedTicket.resource.kind !== 'current-readable' ||
  affectedMap.resource.kind !== 'current-readable'
) {
  throw new Error('Expected readable interruption fixtures')
}
const absentTicketMap: MapResource = {
  ...absentMap(affectedMap),
  tickets: [
    {
      key: affectedTicket.key,
      resource: {
        kind: 'proven-absent',
        absence: {
          scope: { kind: 'ticket', ticket: affectedTicket.key },
          attemptedAt: 2_000,
          observedAt: 2_000,
          provenance: {
            integration: 'local',
            path: '/tmp/my workspace/tickets',
            operation: 'enumerate',
          },
          proof: {
            kind: 'complete-membership',
            parent: { kind: 'tickets-membership', map: affectedMap.key },
          },
        },
        trace: {
          kind: 'last-successful-trace',
          lastSuccessful: affectedTicket.resource.observation,
        },
      },
    },
  ],
}
const retainedMap: MapResource = {
  ...affectedMap,
  resource: {
    kind: 'retained-unavailable',
    lastSuccessful: affectedMap.resource.observation,
    unavailable: {
      kind: 'no-current-evidence',
      scope: { kind: 'map', map: affectedMap.key },
      cause: 'No current source observation is available.',
    },
  },
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
    { maps: [absentMap(affectedMap)], linked: true },
    { maps: [absentTicketMap], linked: true },
    { maps: [retainedMap], linked: true },
    { maps: [{ ...affectedMap, tickets: [] }], linked: false },
    { maps: [], linked: false },
  ])(
    'links durable interruption evidence to keyed current or historical resources: %j',
    ({ maps, linked }) => {
      const markup = renderPage([{ ...project, maps }], true, true, {
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

  it('does not offer Workspace repair merely because source evidence is unavailable', () => {
    if (project.resource.kind !== 'current-readable')
      throw new Error('Expected readable Project fixture')
    const unavailable: RegisteredProject = {
      ...project,
      resource: {
        kind: 'retained-unavailable',
        lastSuccessful: project.resource.observation,
        unavailable: {
          kind: 'no-current-evidence',
          scope: { kind: 'project', project: project.key },
          cause: 'No current source observation is available.',
        },
      },
      actions: [{ id: 'open-workspace', label: 'Open workspace', kind: 'server-launch' }],
    }
    expect(renderPage([unavailable])).not.toContain('New Workspace')
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
