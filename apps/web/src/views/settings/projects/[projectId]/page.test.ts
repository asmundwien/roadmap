import {
  actionIdSchema,
  configurationVersionSchema,
  connectionIdSchema,
  mapIdSchema,
  projectIdSchema,
  serverEpochSchema,
  stateSequenceSchema,
  ticketIdSchema,
} from '@roadmap/contracts/identity'
import {
  type Connection,
  type MapResource,
  type Project,
  type ReadyApplicationState,
  readyApplicationStateSchema,
} from '@roadmap/contracts/state'
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
import { ProjectSettingsPage } from './page'

const project: Project = {
  ...currentProject('my workspace'),
  name: 'My workspace',
}

const connection: Connection = {
  id: connectionIdSchema.parse('local'),
  integration: 'local',
  name: 'On this Mac',
  builtIn: true,
  availability: { status: 'available', observedAt: 1_000 },
}

const baseMap = readableMap(project.ref, 'map')
const affectedTicket = readableTicket(baseMap, 'ticket')
const affectedMap: MapResource = {
  ...baseMap,
  tickets: [affectedTicket],
  frontier: [affectedTicket.ref],
  ticketsMembership:
    baseMap.ticketsMembership.kind === 'current-complete'
      ? {
          kind: 'current-complete',
          observation: {
            ...baseMap.ticketsMembership.observation,
            value: { members: [affectedTicket.ref] },
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
  ticketsMembership:
    affectedMap.ticketsMembership.kind === 'current-complete'
      ? {
          kind: 'current-complete',
          observation: {
            ...affectedMap.ticketsMembership.observation,
            attemptedAt: 2_000,
            observedAt: 2_000,
            value: { members: [] },
          },
        }
      : affectedMap.ticketsMembership,
  tickets: [
    {
      ref: affectedTicket.ref,
      resource: {
        kind: 'proven-absent',
        absence: {
          scope: { kind: 'ticket', ticket: affectedTicket.ref },
          attemptedAt: 2_000,
          observedAt: 2_000,
          provenance: {
            integration: 'local',
            path: '/tmp/my workspace/tickets',
            operation: 'enumerate',
          },
          proof: {
            kind: 'complete-membership',
            parent: { kind: 'tickets-membership', map: affectedMap.ref },
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
      scope: { kind: 'map', map: affectedMap.ref },
      cause: 'No current source observation is available.',
    },
  },
}

function renderPage(
  projects: Project[],
  initial = true,
  valid = true,
  automation: ReadyApplicationState['automation'] = {
    enabled: false,
    enabledProjects: [],
    availability: { status: 'ready' },
    evidence: [],
    overrides: [],
  },
  inFlight = false,
): string {
  const state = readyApplicationStateSchema.parse({
    phase: 'ready',
    mode: valid ? 'mutable' : 'read-only',
    serverEpoch: serverEpochSchema.parse('test'),
    stateSequence: stateSequenceSchema.parse(1),
    configurationVersion: configurationVersionSchema.parse(1),
    supportedIntegrations: [],
    connections: [connection],

    projects,
    authorizationOperations: [],
    configuration: { valid, issues: [], notices: [] },
    automation,
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
        createElement(ProjectSettingsPage, { projectRef: project.ref }),
      ),
    ),
  )
}

describe('ProjectSettingsPage', () => {
  it('preserves the project preference while global Automation is paused', () => {
    const markup = renderPage([project], true, true, {
      enabled: false,
      enabledProjects: [project.ref],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    })
    expect(markup).toMatch(/<input[^>]*role="switch"[^>]*aria-checked="true"/)
  })

  it('requires explicit acknowledgement before enabling a project with an unknown Session outcome', () => {
    const markup = renderPage([project], true, true, {
      enabled: true,
      enabledProjects: [project.ref],
      availability: { status: 'ready' },
      evidence: [
        {
          target: {
            map: { project: project.ref, mapId: mapIdSchema.parse('map') },
            ticketId: ticketIdSchema.parse('ticket'),
          },
          classification: {
            status: 'completed',
            admission: 'automatic',
            processResult: { status: 'exited', code: 0 },
            verdict: { value: 'afk', reason: 'Recorded AFK evidence.' },
          },
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
    { interruptedProject: project.ref, acknowledged: true },
    {
      interruptedProject: { integration: 'github', projectId: project.ref.projectId },
      acknowledged: false,
    },
    {
      interruptedProject: {
        integration: 'local',
        projectId: projectIdSchema.parse('another project'),
      },
      acknowledged: false,
    },
  ] satisfies { interruptedProject: Project['ref']; acknowledged: boolean }[])(
    'does not block this project for acknowledged or another project interruption: %j',
    ({ interruptedProject, acknowledged }) => {
      const markup = renderPage([project], true, true, {
        enabled: true,
        enabledProjects: [project.ref],
        availability: { status: 'ready' },
        evidence: [
          {
            target: {
              map: { project: interruptedProject, mapId: mapIdSchema.parse('map') },
              ticketId: ticketIdSchema.parse('ticket'),
            },
            classification: {
              status: 'completed',
              admission: 'automatic',
              processResult: { status: 'exited', code: 0 },
              verdict: { value: 'afk', reason: 'Recorded AFK evidence.' },
            },
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
      enabledProjects: [project.ref],
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
      const automation: ReadyApplicationState['automation'] = {
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
              target: {
                map: { project: project.ref, mapId: mapIdSchema.parse('map') },
                ticketId: ticketIdSchema.parse('ticket'),
              },
              classification: {
                status: 'completed',
                admission: 'automatic',
                processResult: { status: 'exited', code: 0 },
                verdict: { value: 'afk', reason: 'Recorded AFK evidence.' },
              },
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
    { maps: [baseMap], linked: false },
    { maps: [], linked: false },
  ])(
    'links durable interruption evidence to keyed current or historical resources: %j',
    ({ maps, linked }) => {
      const markup = renderPage(
        [{ ...currentProject(project.ref.projectId, maps), name: project.name }],
        true,
        true,
        {
          enabled: true,
          enabledProjects: [],
          availability: { status: 'ready' },
          evidence: [
            {
              target: {
                map: { project: project.ref, mapId: mapIdSchema.parse('map') },
                ticketId: ticketIdSchema.parse('ticket'),
              },
              classification: {
                status: 'completed',
                admission: 'automatic',
                processResult: { status: 'exited', code: 0 },
                verdict: { value: 'afk', reason: 'Recorded AFK evidence.' },
              },
              wayfinder: {
                status: 'outcome-unknown',
                admission: 'automatic',
                reason: 'Server stopped.',
                acknowledged: false,
              },
            },
          ],
          overrides: [],
        },
      )
      expect(markup.includes('href="/projects/local/my%20workspace/maps/map/tickets/ticket"')).toBe(
        linked,
      )
    },
  )

  it('does not offer Workspace repair merely because source evidence is unavailable', () => {
    if (project.resource.kind !== 'current-readable')
      throw new Error('Expected readable Project fixture')
    const unavailable: Project = {
      ...project,
      resource: {
        kind: 'retained-unavailable',
        lastSuccessful: project.resource.observation,
        unavailable: {
          kind: 'no-current-evidence',
          scope: { kind: 'project', project: project.ref },
          cause: 'No current source observation is available.',
        },
      },
      activeMap: {
        kind: 'uncertain',
        reason: 'project-unavailable',
        cause: 'Project source is currently unavailable.',
      },
      actions: [
        {
          id: actionIdSchema.parse('open-workspace'),
          label: 'Open workspace',
          kind: 'server-launch',
          operation: 'open-workspace',
        },
      ],
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
