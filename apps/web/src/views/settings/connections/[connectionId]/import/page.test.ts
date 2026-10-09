import {
  configurationVersionSchema,
  connectionIdSchema,
  serverEpochSchema,
  stateSequenceSchema,
} from '@roadmap/contracts/identity'
import { type Connection, readyApplicationStateSchema } from '@roadmap/contracts/state'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import { ProjectImportPage } from './page'

function renderImport(connectionId: string, connection?: Connection, valid = true): string {
  const state = readyApplicationStateSchema.parse({
    phase: 'ready',
    mode: valid ? 'mutable' : 'read-only',
    serverEpoch: serverEpochSchema.parse('test'),
    stateSequence: stateSequenceSchema.parse(1),
    configurationVersion: configurationVersionSchema.parse(4),
    supportedIntegrations: [],
    connections: connection ? [connection] : [],

    projects: [],
    authorizationOperations: [],
    configuration: { valid, issues: [], notices: [] },
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
    capturedAt: 1,
  })
  const store: RoadmapStore = {
    subscribe: () => () => undefined,
    getSnapshot: () => ({
      transport: 'live',
      synchronization: 'synchronized',
      state,
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
      createElement(
        RoadmapProvider,
        { store },
        createElement(ProjectImportPage, { connectionId: connectionIdSchema.parse(connectionId) }),
      ),
    ),
  )
}

const local: Connection = {
  id: connectionIdSchema.parse('local'),
  integration: 'local',
  name: 'Local files',
  builtIn: true,
  availability: { status: 'available' },
}

it('explains the selected connection without offering a different one', () => {
  const markup = renderImport('local', local)
  expect(markup).toContain('Local files')
  expect(markup).not.toContain('<select')
})

describe('GitHub import', () => {
  const github: Connection = {
    id: connectionIdSchema.parse('github/work'),
    integration: 'github',
    name: 'Work account',
    builtIn: false,
    githubIdentity: { id: 'account-1', login: 'test-account' },
    availability: { status: 'authorization-required', cause: 'Authorization expired.' },
  }

  it('shows connection availability and workspace instructions', () => {
    const markup = renderImport(github.id, github)
    expect(markup).toContain('Work account')
    expect(markup).toContain('Authorization expired.')
    expect(markup).not.toContain('<select')
  })
})

it('blocks import when configuration needs repair', () => {
  const markup = renderImport('local', local, false)
  expect(markup).toContain('Configuration needs repair.')
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Validate and save<\/button>/)
})

it('does not offer registration for a missing connection', () => {
  const markup = renderImport('missing')
  expect(markup).toContain('Connection not found')
  expect(markup).not.toContain('Validate and save')
})
