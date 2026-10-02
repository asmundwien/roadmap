import type { ApplicationState, Connection, ProjectKey } from '@roadmap/contracts'
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

  it.each<{ key: ProjectKey; acknowledged: boolean; needsReview: boolean }>([
    { key: { integration: 'local', id: 'shared' }, acknowledged: false, needsReview: true },
    { key: { integration: 'local', id: 'shared' }, acknowledged: true, needsReview: false },
    { key: { integration: 'local', id: 'other' }, acknowledged: false, needsReview: false },
    { key: { integration: 'github', id: 'shared' }, acknowledged: false, needsReview: false },
  ])(
    'requires review only for the matching unacknowledged project: $key',
    ({ key, acknowledged, needsReview }) => {
      const initial = state([
        {
          id: 'connection',
          integration: key.integration,
          name: 'Connection',
          builtIn: key.integration === 'local',
          availability: { status: 'available' },
        },
      ])
      const markup = renderConnections({
        ...initial,
        projects: [
          {
            key,
            connectionId: 'connection',
            locator:
              key.integration === 'local'
                ? { integration: 'local', path: '/tmp/project' }
                : { integration: 'github', repositoryId: '42', nameWithOwner: 'acme/project' },
            workspace: { path: '/tmp/project' },
            name: 'Project',
            availability: { status: 'available', observedAt: 1_000 },
            openMaps: [],
            closedMaps: [],
            warnings: [],
            actions: [],
          },
        ],
        automation: {
          ...initial.automation,
          enabled: true,
          enabledProjects: [key],
          evidence: [
            {
              target: {
                project: { integration: 'local', id: 'shared' },
                mapId: 'map',
                ticketId: 'ticket',
              },
              classification: { status: 'running', admission: 'automatic' },
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
          /href="#\/settings\/projects\/local\/shared"[^>]*>Automation needs review/,
        )
      } else {
        expect(markup).not.toContain('Automation needs review')
      }
    },
  )

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
  it('offers project import for each connection, including built-in local connections', () => {
    const markup = renderConnections(
      state([
        {
          id: 'github/work',
          integration: 'github',
          name: 'Work',
          builtIn: false,
          availability: { status: 'available' },
        },
        {
          id: 'local',
          integration: 'local',
          name: 'Local files',
          builtIn: true,
          availability: { status: 'available' },
        },
      ]),
    )
    expect(markup).toContain('href="#/settings/connections/github%2Fwork/import"')
    expect(markup).toContain('href="#/settings/connections/local/import"')
    expect(markup.match(/Import project/g)).toHaveLength(2)
  })
  it('offers separate roadmap and registration destinations for a connection project', () => {
    const initial = state([
      {
        id: 'local',
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
          key: { integration: 'local', id: 'my workspace' },
          connectionId: 'local',
          locator: { integration: 'local', path: '/tmp/my-workspace' },
          workspace: { path: '/tmp/my-workspace' },
          name: 'My workspace',
          availability: { status: 'available', observedAt: 1_000 },
          openMaps: [],
          closedMaps: [],
          warnings: [],
          actions: [
            { id: 'open-workspace', label: 'Open in VS Code', kind: 'server-launch' },
            { id: 'reveal-source', label: 'View source folder', kind: 'server-launch' },
            { id: 'open-terminal', label: 'Open Terminal', kind: 'server-launch' },
          ],
        },
      ],
    })
    expect(markup).toContain('href="#/projects/local/my%20workspace"')
    expect(markup).toContain('Go to roadmap')
    expect(markup).toContain('href="#/settings/projects/local/my%20workspace"')
    expect(markup).not.toContain('Open Project')
    expect(markup).toContain('Open in VS Code</button>')
    expect(markup).toContain('View source folder</button>')
    expect(markup).toContain('Open Terminal</button>')
  })

  it('offers source folder controls on GitHub projects as well as local projects', () => {
    const initial = state([
      {
        id: 'github',
        integration: 'github',
        name: 'GitHub',
        builtIn: false,
        availability: { status: 'available' },
      },
    ])
    const markup = renderConnections({
      ...initial,
      projects: [
        {
          key: { integration: 'github', id: 'acme/app' },
          connectionId: 'github',
          locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'acme/app' },
          workspace: { path: '/tmp/app', gitIdentity: '42' },
          name: 'App',
          availability: { status: 'available', observedAt: 1_000 },
          openMaps: [],
          closedMaps: [],
          warnings: [],
          actions: [
            { id: 'open-workspace', label: 'Open in VS Code', kind: 'server-launch' },
            { id: 'reveal-source', label: 'View source folder', kind: 'server-launch' },
            { id: 'open-terminal', label: 'Open Terminal', kind: 'server-launch' },
            {
              id: 'open-source',
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
