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
import {
  type Connection,
  connectionSchema,
  type ReadyApplicationState,
  readyApplicationStateSchema,
} from '@roadmap/contracts/state'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import { neverReadProject } from '@/views/overview/test-fixtures'
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
  const store: RoadmapStore = {
    subscribe: () => () => undefined,
    getSnapshot: () => ({
      transport: 'live',
      synchronization: 'synchronized',
      state: validatedState,
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

describe('ConnectionSettings', () => {
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
              id: actionIdSchema.parse('open-workspace'),
              label: 'Open in VS Code',
              kind: 'server-launch',
              operation: 'open-workspace',
            },
            {
              id: actionIdSchema.parse('reveal-source'),
              label: 'View source folder',
              kind: 'server-launch',
              operation: 'reveal-source',
            },
            {
              id: actionIdSchema.parse('open-terminal'),
              label: 'Open Terminal',
              kind: 'server-launch',
              operation: 'open-terminal',
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
            },
            {
              id: actionIdSchema.parse('reveal-source'),
              label: 'View source folder',
              kind: 'server-launch',
              operation: 'reveal-source',
            },
            {
              id: actionIdSchema.parse('open-terminal'),
              label: 'Open Terminal',
              kind: 'server-launch',
              operation: 'open-terminal',
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
