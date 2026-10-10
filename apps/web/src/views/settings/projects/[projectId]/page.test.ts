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
  type AutomationEvidence,
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
import { makeRoadmapSnapshot, makeRoadmapStore } from '@/views/map/test-fixtures'
import {
  absentMap,
  currentProject,
  neverReadProject,
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

const siblingBaseMap = readableMap(project.ref, 'sibling map')
const siblingTicket = readableTicket(siblingBaseMap, 'ticket')
const siblingMap: MapResource = {
  ...siblingBaseMap,
  tickets: [siblingTicket],
  frontier: [siblingTicket.ref],
  ticketsMembership:
    siblingBaseMap.ticketsMembership.kind === 'current-complete'
      ? {
          kind: 'current-complete',
          observation: {
            ...siblingBaseMap.ticketsMembership.observation,
            value: { members: [siblingTicket.ref] },
          },
        }
      : siblingBaseMap.ticketsMembership,
}

function interruptedSession(
  target: AutomationEvidence['target'],
  acknowledged = false,
  reason = 'Server stopped.',
): AutomationEvidence {
  return {
    target,
    classification: {
      status: 'completed',
      admission: 'automatic',
      processResult: { status: 'exited', code: 0 },
      verdict: { value: 'afk', reason: 'Recorded AFK evidence.' },
    },
    wayfinder: {
      status: 'outcome-unknown',
      admission: 'automatic',
      reason,
      acknowledged,
    },
  }
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
  connections: Connection[] = [connection],
  selectedProject: Project['ref'] = project.ref,
): string {
  const state = readyApplicationStateSchema.parse({
    phase: 'ready',
    mode: valid ? 'mutable' : 'read-only',
    serverEpoch: serverEpochSchema.parse('test'),
    stateSequence: stateSequenceSchema.parse(1),
    configurationVersion: configurationVersionSchema.parse(1),
    supportedIntegrations: [],
    connections,

    projects,
    authorizationOperations: [],
    configuration: { valid, issues: [], notices: [] },
    automation,
    capturedAt: 0,
  })
  const snapshot = makeRoadmapSnapshot(initial ? state : null)
  const store = makeRoadmapStore([], snapshot)
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        RoadmapProvider,
        { store },
        createElement(ProjectSettingsPage, { projectRef: selectedProject }),
      ),
    ),
  )
}

describe('ProjectSettingsPage', () => {
  it('keeps enabling unavailable while a saved preference can still be disabled', () => {
    const automation: ReadyApplicationState['automation'] = {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'unavailable', cause: 'Harness command missing.' },
      evidence: [],
      overrides: [],
    }
    const disabledPreference = renderPage([project], true, true, automation)
    expect(disabledPreference.match(/<input[^>]*role="switch"[^>]*>/)?.[0]).toContain('disabled=""')
    const enabledPreference = renderPage([project], true, true, {
      ...automation,
      enabledProjects: [project.ref],
    })
    expect(enabledPreference.match(/<input[^>]*role="switch"[^>]*>/)?.[0]).not.toContain(
      'disabled=""',
    )
  })
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

  it('blocks ordinary and recovery configuration controls when configuration is invalid', () => {
    const valid = false
    const automation: ReadyApplicationState['automation'] = {
      enabled: true,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    }
    const ordinary = renderPage([project], true, valid, automation)
    expect(ordinary.match(/<input[^>]*role="switch"[^>]*>/)?.[0]).toContain('disabled=""')
    const recovery = renderPage([project], true, valid, {
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
    })
    expect(recovery).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Acknowledge/)
  })

  it.each([
    { name: 'current target', maps: [affectedMap, siblingMap] },
    { name: 'historical map', maps: [absentMap(affectedMap), siblingMap] },
    { name: 'historical ticket', maps: [absentTicketMap, siblingMap] },
    { name: 'retained map', maps: [retainedMap, siblingMap] },
    { name: 'missing ticket entry', maps: [baseMap, siblingMap] },
    { name: 'missing map entry', maps: [siblingMap] },
    { name: 'no map entries', maps: [] },
  ])('keeps the exact durable interruption journey with $name', ({ maps }) => {
    const markup = renderPage(
      [{ ...currentProject(project.ref.projectId, maps), name: project.name }],
      true,
      true,
      {
        enabled: true,
        enabledProjects: [],
        availability: { status: 'ready' },
        evidence: [interruptedSession(affectedTicket.ref)],
        overrides: [],
      },
    )
    expect(markup).toContain('href="/projects/local/my%20workspace/maps/map/tickets/ticket"')
    expect(markup).not.toContain(
      'href="/projects/local/my%20workspace/maps/sibling%20map/tickets/ticket"',
    )
    expect(markup).toMatch(/outcome[^<]*unknown/i)
  })

  it('keeps durable interruption navigation when the Project is no longer registered', () => {
    const markup = renderPage([], true, true, {
      enabled: true,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [interruptedSession(affectedTicket.ref)],
      overrides: [],
    })
    expect(markup).toContain('Project not found')
    expect(markup).toContain('href="/projects/local/my%20workspace/maps/map/tickets/ticket"')
    expect(markup).toMatch(/outcome[^<]*unknown/i)
    expect(markup).not.toContain('Save name</button>')
    expect(markup).not.toContain('Remove project registration</button>')
  })

  it('keeps every independent unacknowledged interruption scoped to this Project', () => {
    const markup = renderPage(
      [{ ...currentProject(project.ref.projectId, [siblingMap]), name: project.name }],
      true,
      true,
      {
        enabled: true,
        enabledProjects: [],
        availability: { status: 'ready' },
        evidence: [
          interruptedSession(affectedTicket.ref),
          interruptedSession({
            map: affectedMap.ref,
            ticketId: ticketIdSchema.parse('second/%2F#ticket'),
          }),
          interruptedSession({
            map: { project: project.ref, mapId: mapIdSchema.parse('other/%2F#map') },
            ticketId: affectedTicket.ref.ticketId,
          }),
          interruptedSession({
            map: {
              project: { integration: 'github', projectId: project.ref.projectId },
              mapId: affectedMap.ref.mapId,
            },
            ticketId: affectedTicket.ref.ticketId,
          }),
        ],
        overrides: [],
      },
    )
    expect(markup).toContain('href="/projects/local/my%20workspace/maps/map/tickets/ticket"')
    expect(markup).toContain(
      'href="/projects/local/my%20workspace/maps/map/tickets/second%2F%252F%23ticket"',
    )
    expect(markup).toContain(
      'href="/projects/local/my%20workspace/maps/other%2F%252F%23map/tickets/ticket"',
    )
    expect(markup).not.toContain('href="/projects/github/my%20workspace/maps/map/tickets/ticket"')
    expect(markup).not.toContain(
      'href="/projects/local/my%20workspace/maps/sibling%20map/tickets/ticket"',
    )
  })

  it('keeps acknowledged evidence accessible without turning an unknown outcome into success', () => {
    const markup = renderPage([project], true, true, {
      enabled: true,
      enabledProjects: [project.ref],
      availability: { status: 'ready' },
      evidence: [interruptedSession(affectedTicket.ref, true)],
      overrides: [],
    })
    expect(markup).toContain('href="/projects/local/my%20workspace/maps/map/tickets/ticket"')
    expect(markup).toMatch(/outcome[^<]*unknown/i)
    expect(markup).toMatch(/acknowledged/i)
    expect(markup).not.toMatch(/<button[^>]*>[^<]*Acknowledge/)
    const toggle = markup.match(/<input[^>]*role="switch"[^>]*>/)?.[0]
    expect(toggle).toContain('aria-checked="true"')
    expect(toggle).not.toContain('disabled=""')
  })

  it.each(['degraded', 'unavailable'] as const)(
    'keeps Project source observation independent of %s Connection health',
    (status) => {
      const unhealthy: Connection = {
        ...connection,
        availability: { status, observedAt: 2_000, cause: 'Connection health check failed.' },
      }
      const markup = renderPage([project], true, true, undefined, [unhealthy])
      expect(markup).toContain('Connection health check failed.')
      expect(markup).toContain('Current readable content.')
      expect(markup).toContain('1970-01-01T00:00:01.000Z')
      expect(markup).not.toContain('Showing the last successful content.')
    },
  )

  it('does not turn retained source evidence current when the Connection is healthy', () => {
    if (project.resource.kind !== 'current-readable')
      throw new Error('Expected readable Project fixture')
    const retained: Project = {
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
    }
    const markup = renderPage([retained])
    expect(markup).toContain('Showing the last successful content.')
    expect(markup).toContain('1970-01-01T00:00:01.000Z')
    expect(markup).not.toContain('Current readable content.')
    expect(markup).not.toContain('No current Wayfinder maps.')
  })

  it.each(['never-observed', 'current-readable'] as const)(
    'preserves %s GitHub source evidence without inventing source actions or host controls',
    (kind) => {
      const registered = neverReadProject(
        { integration: 'github', projectId: projectIdSchema.parse('opaque repository') },
        'No supplied actions',
      )
      if (registered.integration !== 'github') throw new Error('Expected GitHub Project fixture')
      const source = {
        ...registered.source,
        url: 'https://source.example.test/repositories/canonical-id',
      }
      const withoutActions: Project = {
        ...registered,
        source,
        actions: [],
        resource:
          kind === 'never-observed'
            ? registered.resource
            : {
                kind: 'current-readable',
                observation: {
                  scope: { kind: 'project', project: registered.ref },
                  attemptedAt: 1_000,
                  observedAt: 1_000,
                  provenance: {
                    integration: 'github',
                    connectionId: registered.connectionId,
                    repositoryId: source.repositoryId,
                    stage: 'repository',
                  },
                  completeness: { kind: 'complete' },
                  value: { name: registered.name, source, warnings: [] },
                },
              },
      }
      const markup = renderPage(
        [withoutActions],
        true,
        true,
        undefined,
        [
          {
            id: connectionIdSchema.parse('github'),
            integration: 'github',
            name: 'GitHub',
            builtIn: false,
            githubIdentity: { id: 'account-1', login: 'test-account' },
            availability: { status: 'available' },
          },
        ],
        withoutActions.ref,
      )
      expect(markup).toContain('test/opaque repository')
      if (kind === 'never-observed') {
        expect(markup).toContain('This resource has never been read.')
        expect(markup).not.toContain('href="https://source.example.test/repositories/canonical-id"')
      } else {
        expect(markup).toContain('Current readable content.')
        expect(markup).toContain('href="https://source.example.test/repositories/canonical-id"')
      }
      expect(markup).not.toContain('href="https://example.test/test/opaque repository"')
      expect(markup).not.toContain('href="https://github.com/test/opaque')
      expect(markup).not.toContain('Open on GitHub')
      expect(markup).not.toContain('Open in VS Code')
      expect(markup).not.toContain('View source folder')
      expect(markup).not.toContain('Open Terminal')
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
          id: actionIdSchema.parse('workspace-capability'),
          label: 'Open workspace',
          kind: 'server-launch',
          operation: 'open-workspace',
          project: project.ref,
        },
      ],
    }
    expect(renderPage([unavailable])).not.toContain('New Workspace')
  })

  it('offers Workspace repair when an action id does not prove a host capability', () => {
    const withoutWorkspaceLaunch: Project = {
      ...project,
      actions: [
        {
          id: actionIdSchema.parse('open-workspace'),
          label: 'View source',
          kind: 'external-link',
          href: 'https://example.test/project',
        },
      ],
    }
    expect(renderPage([withoutWorkspaceLaunch])).toContain('New Workspace')
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
