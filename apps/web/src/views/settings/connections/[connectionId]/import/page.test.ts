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
import { makeRoadmapSnapshot, makeRoadmapStore } from '@/views/map/test-fixtures'
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
  const store = makeRoadmapStore([], makeRoadmapSnapshot(state))
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

describe('GitHub import', () => {
  const github: Connection = {
    id: connectionIdSchema.parse('github/work'),
    integration: 'github',
    name: 'Work account',
    builtIn: false,
    githubIdentity: { id: 'account-1', login: 'test-account' },
    availability: { status: 'authorization-required', cause: 'Authorization expired.' },
  }

  it('reports the actual Connection availability cause', () => {
    const markup = renderImport(github.id, github)
    expect(markup).toContain('Authorization expired.')
  })
})

it('blocks registration but preserves folder selection when configuration needs repair', () => {
  const markup = renderImport('local', local, false)
  expect(markup).toMatch(/<button\b[^>]*disabled=""[^>]*>Validate and save<\/button>/)
  expect(markup).toMatch(/<button\b(?![^>]*disabled)[^>]*>Choose folder<\/button>/)
})

it('does not offer registration for a missing connection', () => {
  const markup = renderImport('missing')
  expect(markup).not.toContain('<form')
  expect(markup).not.toContain('<button')
})
