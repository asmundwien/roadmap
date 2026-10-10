import type { ProjectRef } from '@roadmap/contracts/identity'
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
import { commandResultSchema } from '@roadmap/contracts/operations'
import {
  type AutomationEvidence,
  authorizationOperationSchema,
  type Connection,
  connectionSchema,
  type ReadyApplicationState,
  readyApplicationStateSchema,
} from '@roadmap/contracts/state'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { resolveAuthorization } from '@/resources/results'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import { makeRoadmapSnapshot } from '@/views/map/test-fixtures'
import {
  currentProject,
  neverReadProject,
  readableMap,
  readableTicket,
} from '@/views/overview/test-fixtures'
import { AuthorizationPane } from './connection-panes'
import { ConnectionSettings } from './page'

const github = {
  integration: 'github',
  name: 'GitHub',
  connectionKind: 'device-authorization',
  newInstallationUrl: 'https://github.com/apps/example/installations/new',
  installationsUrl: 'https://github.com/settings/installations',
  authorizationsUrl: 'https://github.com/settings/applications',
} as const

function renderConnections(state: ReadyApplicationState): string {
  const validatedState = readyApplicationStateSchema.parse(state)
  const snapshot = makeRoadmapSnapshot(validatedState)
  const store: RoadmapStore = {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
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
      createElement(RoadmapProvider, { store }, createElement(ConnectionSettings)),
    ),
  )
}

function state(connections: Connection[]): ReadyApplicationState {
  return {
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: serverEpochSchema.parse('test'),
    stateSequence: stateSequenceSchema.parse(1),
    configurationVersion: configurationVersionSchema.parse(1),
    supportedIntegrations: [github],
    connections,

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
    capturedAt: 0,
  }
}

function interruption(
  target: AutomationEvidence['target'],
  acknowledged = false,
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
      reason: 'Server stopped.',
      acknowledged,
    },
  }
}

describe('ConnectionSettings', () => {
  it('omits roadmap navigation when the projection has no roadmap capability', () => {
    const initial = state([
      {
        id: connectionIdSchema.parse('local'),
        integration: 'local',
        name: 'Local files',
        builtIn: true,
        availability: { status: 'available' },
      },
    ])
    const markup = renderConnections({
      ...initial,
      projects: [
        neverReadProject(
          { integration: 'local', projectId: projectIdSchema.parse('no-roadmap') },
          'No roadmap',
        ),
      ],
    })
    expect(markup).not.toContain('Go to roadmap')
    expect(markup).not.toContain('href="/projects/local/no-roadmap"')
    expect(markup).toContain('href="/projects/local/no-roadmap/settings"')
  })

  it('uses the projected roadmap destination without reconstructing it from the Project', () => {
    const initial = state([
      {
        id: connectionIdSchema.parse('local'),
        integration: 'local',
        name: 'Local files',
        builtIn: true,
        availability: { status: 'available' },
      },
    ])
    const markup = renderConnections({
      ...initial,
      projects: [
        {
          ...neverReadProject(
            { integration: 'local', projectId: projectIdSchema.parse('pinned') },
            'Pinned',
          ),
          actions: [
            {
              id: actionIdSchema.parse('display-only'),
              label: 'Open selected map',
              kind: 'roadmap',
              href: '/projects/local/pinned/maps/selected',
            },
          ],
        },
      ],
    })
    expect(markup).toContain('href="/projects/local/pinned/maps/selected"')
    expect(markup).toContain('Open selected map')
    expect(markup).not.toContain('display-only')
  })

  it.each([false, true])(
    'allows shutdown but not enablement when Automation is unavailable, enabled=%s',
    (enabled) => {
      const initial = state([])
      const markup = renderConnections({
        ...initial,
        automation: {
          ...initial.automation,
          enabled,
          availability: { status: 'unavailable', cause: 'Commands need repair.' },
        },
      })
      const toggle = markup.match(/<input[^>]*role="switch"[^>]*>/)?.[0]
      expect(toggle).toBeDefined()
      expect(toggle).toContain(`aria-checked="${enabled}"`)
      if (enabled) expect(toggle).not.toContain('disabled=""')
      else expect(toggle).toContain('disabled=""')
    },
  )

  it.each<{ key: ProjectRef; acknowledged: boolean; needsReview: boolean }>([
    {
      key: { integration: 'local', projectId: projectIdSchema.parse('shared') },
      acknowledged: false,
      needsReview: true,
    },
    {
      key: { integration: 'local', projectId: projectIdSchema.parse('shared') },
      acknowledged: true,
      needsReview: false,
    },
    {
      key: { integration: 'local', projectId: projectIdSchema.parse('other') },
      acknowledged: false,
      needsReview: false,
    },
    {
      key: { integration: 'github', projectId: projectIdSchema.parse('shared') },
      acknowledged: false,
      needsReview: false,
    },
  ])(
    'requires review only for the matching unacknowledged project: $key',
    ({ key, acknowledged, needsReview }) => {
      const initial = state([
        connectionSchema.parse(
          key.integration === 'local'
            ? {
                id: connectionIdSchema.parse('connection'),
                integration: 'local',
                name: 'Connection',
                builtIn: true,
                availability: { status: 'available' },
              }
            : {
                id: connectionIdSchema.parse('connection'),
                integration: 'github',
                name: 'Connection',
                builtIn: false,
                githubIdentity: { id: 'fixture-account', login: 'fixture' },
                availability: { status: 'available' },
              },
        ),
      ])
      const markup = renderConnections({
        ...initial,
        projects: [
          {
            ...neverReadProject(key, 'Project'),
            connectionId: connectionIdSchema.parse('connection'),
          },
        ],
        automation: {
          ...initial.automation,
          enabled: true,
          enabledProjects: [key],
          evidence: [
            {
              target: {
                map: {
                  project: { integration: 'local', projectId: projectIdSchema.parse('shared') },
                  mapId: mapIdSchema.parse('map'),
                },
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
        },
      })
      if (needsReview) {
        expect(markup).toMatch(
          /href="\/projects\/local\/shared\/settings"[^>]*>Automation needs review/,
        )
      } else {
        expect(markup).not.toContain('Automation needs review')
      }
    },
  )

  it.each(['missing ticket', 'missing map', 'missing Project'] as const)(
    'keeps exact durable review targets accessible with a %s',
    (missing) => {
      const initial = state([
        {
          id: connectionIdSchema.parse('local'),
          integration: 'local',
          name: 'Local files',
          builtIn: true,
          availability: { status: 'available' },
        },
      ])
      const ref: ProjectRef = {
        integration: 'local',
        projectId: projectIdSchema.parse('my workspace'),
      }
      const targetBaseMap = readableMap(ref, 'target/%2F#map', 'open', 2_000)
      if (targetBaseMap.resource.kind !== 'current-readable')
        throw new Error('Expected readable target Map fixture')
      const targetMap = {
        ...targetBaseMap,
        resource: {
          ...targetBaseMap.resource,
          observation: {
            ...targetBaseMap.resource.observation,
            value: {
              ...targetBaseMap.resource.observation.value,
              progress: { total: 0, completed: 0 },
            },
          },
        },
        tickets: [],
        frontier: [],
      }
      const target = {
        map: targetMap.ref,
        ticketId: ticketIdSchema.parse('ticket/%2F#id'),
      }
      const siblingMap = readableMap(ref, 'sibling')
      const siblingTicket = readableTicket(siblingMap, target.ticketId)
      const markup = renderConnections({
        ...initial,
        projects:
          missing === 'missing Project'
            ? []
            : [
                currentProject(ref.projectId, [
                  ...(missing === 'missing ticket' ? [targetMap] : []),
                  {
                    ...siblingMap,
                    tickets: [siblingTicket],
                    frontier: [siblingTicket.ref],
                    ticketsMembership:
                      siblingMap.ticketsMembership.kind === 'current-complete'
                        ? {
                            kind: 'current-complete',
                            observation: {
                              ...siblingMap.ticketsMembership.observation,
                              value: { members: [siblingTicket.ref] },
                            },
                          }
                        : siblingMap.ticketsMembership,
                  },
                ]),
              ],
        automation: {
          ...initial.automation,
          enabled: true,
          evidence: [
            interruption(target),
            interruption({ map: targetMap.ref, ticketId: ticketIdSchema.parse('second') }),
            interruption({
              map: { project: ref, mapId: mapIdSchema.parse('another') },
              ticketId: target.ticketId,
            }),
          ],
        },
      })
      expect(markup).toContain(
        'href="/projects/local/my%20workspace/maps/target%2F%252F%23map/tickets/ticket%2F%252F%23id"',
      )
      expect(markup).toContain(
        'href="/projects/local/my%20workspace/maps/target%2F%252F%23map/tickets/second"',
      )
      expect(markup).toContain(
        'href="/projects/local/my%20workspace/maps/another/tickets/ticket%2F%252F%23id"',
      )
      expect(markup).not.toContain(
        'href="/projects/local/my%20workspace/maps/sibling/tickets/ticket%2F%252F%23id"',
      )
      expect(markup).toMatch(/outcome[^<]*unknown/i)
    },
  )

  it('keeps acknowledged unknown evidence accessible without demanding review', () => {
    const initial = state([])
    const markup = renderConnections({
      ...initial,
      automation: {
        ...initial.automation,
        evidence: [
          interruption(
            {
              map: {
                project: {
                  integration: 'github',
                  projectId: projectIdSchema.parse('gone repository'),
                },
                mapId: mapIdSchema.parse('map'),
              },
              ticketId: ticketIdSchema.parse('ticket'),
            },
            true,
          ),
        ],
      },
    })
    expect(markup).toContain('href="/projects/github/gone%20repository/maps/map/tickets/ticket"')
    expect(markup).toMatch(/outcome[^<]*unknown/i)
    expect(markup).toMatch(/acknowledged/i)
    expect(markup).not.toContain('Automation needs review')
  })

  it.each(['degraded', 'unavailable'] as const)(
    'does not turn a readable Project into retained content when Connection health is %s',
    (status) => {
      const initial = state([
        {
          id: connectionIdSchema.parse('local'),
          integration: 'local',
          name: 'Local files',
          builtIn: true,
          availability: { status, observedAt: 2_000, cause: 'Connection check failed.' },
        },
      ])
      const markup = renderConnections({
        ...initial,
        projects: [currentProject('healthy Project')],
      })
      expect(markup).toContain('Connection check failed.')
      expect(markup).toContain(status === 'degraded' ? 'Observation degraded' : 'Unavailable')
      expect(markup).toContain('Current readable content.')
      expect(markup).toContain('1970-01-01T00:00:01.000Z')
      expect(markup).not.toContain('Showing the last successful content.')
    },
  )

  it('does not invent source actions or host controls when a GitHub Project has no supplied actions', () => {
    const initial = state([
      {
        id: connectionIdSchema.parse('github'),
        integration: 'github',
        name: 'GitHub',
        builtIn: false,
        githubIdentity: { id: 'account-1', login: 'test-account' },
        availability: { status: 'available' },
      },
    ])
    const registered = neverReadProject(
      { integration: 'github', projectId: projectIdSchema.parse('opaque repository') },
      'No supplied actions',
    )
    if (registered.integration !== 'github') throw new Error('Expected GitHub Project fixture')
    const withoutActions = {
      ...registered,
      source: {
        ...registered.source,
        url: 'https://source.example.test/repositories/canonical-id',
      },
      actions: [],
    }
    const markup = renderConnections({
      ...initial,
      projects: [withoutActions],
    })
    expect(markup).toContain('test/opaque repository')
    expect(markup).toContain('href="/projects/github/opaque%20repository/settings"')
    expect(markup).not.toContain('href="https://source.example.test/repositories/canonical-id"')
    expect(markup).not.toContain('href="https://example.test/test/opaque repository"')
    expect(markup).not.toContain('href="https://github.com/test/opaque')
    expect(markup).not.toContain('Open on GitHub')
    expect(markup).not.toContain('Open in VS Code')
    expect(markup).not.toContain('View source folder')
    expect(markup).not.toContain('Open Terminal')
  })

  it('offers project import for each connection, including built-in local connections', () => {
    const markup = renderConnections(
      state([
        {
          id: connectionIdSchema.parse('github/work'),
          integration: 'github',
          name: 'Work',
          builtIn: false,
          githubIdentity: { id: 'account-1', login: 'test-account' },
          availability: { status: 'available' },
        },
        {
          id: connectionIdSchema.parse('local'),
          integration: 'local',
          name: 'Local files',
          builtIn: true,
          availability: { status: 'available' },
        },
      ]),
    )
    expect(markup).toContain('href="/connections/github%2Fwork/projects/import"')
    expect(markup).toContain('href="/connections/local/projects/import"')
  })
  it('offers separate roadmap and registration destinations for a connection project', () => {
    const initial = state([
      {
        id: connectionIdSchema.parse('local'),
        integration: 'local',
        name: 'Local files',
        builtIn: true,
        availability: { status: 'available' },
      },
    ])
    const markup = renderConnections({
      ...initial,
      projects: [
        {
          ...neverReadProject(
            { integration: 'local', projectId: projectIdSchema.parse('my workspace') },
            'My workspace',
          ),
          actions: [
            {
              id: actionIdSchema.parse('roadmap'),
              label: 'Go to roadmap',
              kind: 'roadmap',
              href: '/projects/local/my%20workspace',
            },
            {
              id: actionIdSchema.parse('open-workspace'),
              label: 'Open in VS Code',
              kind: 'server-launch',
              operation: 'open-workspace',
              project: { integration: 'local', projectId: projectIdSchema.parse('my workspace') },
            },
            {
              id: actionIdSchema.parse('reveal-source'),
              label: 'View source folder',
              kind: 'server-launch',
              operation: 'reveal-source',
              project: { integration: 'local', projectId: projectIdSchema.parse('my workspace') },
            },
            {
              id: actionIdSchema.parse('open-terminal'),
              label: 'Open Terminal',
              kind: 'server-launch',
              operation: 'open-terminal',
              project: { integration: 'local', projectId: projectIdSchema.parse('my workspace') },
            },
          ],
        },
      ],
    })
    expect(markup).toContain('href="/projects/local/my%20workspace"')
    expect(markup).toContain('href="/projects/local/my%20workspace/settings"')
    expect(markup).toContain('Open in VS Code</button>')
    expect(markup).toContain('View source folder</button>')
    expect(markup).toContain('Open Terminal</button>')
  })

  it('offers source folder controls on GitHub projects as well as local projects', () => {
    const initial = state([
      {
        id: connectionIdSchema.parse('github'),
        integration: 'github',
        name: 'GitHub',
        builtIn: false,
        githubIdentity: { id: 'account-1', login: 'test-account' },
        availability: { status: 'available' },
      },
    ])
    const markup = renderConnections({
      ...initial,
      projects: [
        {
          ...neverReadProject(
            { integration: 'github', projectId: projectIdSchema.parse('acme/app') },
            'App',
          ),
          actions: [
            {
              id: actionIdSchema.parse('open-workspace'),
              label: 'Open in VS Code',
              kind: 'server-launch',
              operation: 'open-workspace',
              project: { integration: 'github', projectId: projectIdSchema.parse('acme/app') },
            },
            {
              id: actionIdSchema.parse('reveal-source'),
              label: 'View source folder',
              kind: 'server-launch',
              operation: 'reveal-source',
              project: { integration: 'github', projectId: projectIdSchema.parse('acme/app') },
            },
            {
              id: actionIdSchema.parse('open-terminal'),
              label: 'Open Terminal',
              kind: 'server-launch',
              operation: 'open-terminal',
              project: { integration: 'github', projectId: projectIdSchema.parse('acme/app') },
            },
            {
              id: actionIdSchema.parse('open-source'),
              label: 'Open on GitHub',
              kind: 'external-link',
              href: 'https://github.com/acme/app',
            },
          ],
        },
      ],
    })
    expect(markup).toContain('Open in VS Code</button>')
    expect(markup).toContain('View source folder</button>')
    expect(markup).toContain('Open Terminal</button>')
    expect(markup).toContain('href="https://github.com/acme/app"')
    expect(markup).toContain('Open on GitHub')
  })
})

describe('authorization grant navigation', () => {
  it.each(['current', 'historical'] as const)(
    'uses the published %s grant identity after a waiting operation outcome',
    (kind) => {
      const authorization = authorizationOperationSchema.parse({
        id: 'grant-operation',
        status: 'granted',
        connection: { kind, id: 'github/canonical', accountId: 'account-42' },
      })
      const result = commandResultSchema.parse({
        type: 'begin-github-authorization',
        operationId: 'grant-operation',
        phase: 'waiting',
        verificationUri: 'https://github.com/login/device',
        userCode: 'PREVIOUS-CODE',
        expiresAt: 60_000,
      })
      if (result.type !== 'begin-github-authorization')
        throw new Error('Expected authorization result')
      const markup = renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(AuthorizationPane, {
            authorization,
            presentation: resolveAuthorization(state([]), authorization),
            feedback: { result, previous: undefined, consumed: false },
            configurationVersion: configurationVersionSchema.parse(99),
            operation: {
              execute: async () => {
                throw new Error('Unexpected authorization effect')
              },
            },
            onClose() {},
            onResult() {},
            onFinished() {},
          }),
        ),
      )
      if (kind === 'current') {
        expect(markup).toContain('href="/connections/github%2Fcanonical"')
        expect(markup).toContain('account-42')
        expect(markup).not.toContain('configuration version 99')
      } else {
        expect(markup).not.toContain('href="/connections/github%2Fcanonical"')
      }
    },
  )
})
