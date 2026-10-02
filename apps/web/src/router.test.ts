import { describe, expect, it } from 'vitest'
import {
  componentsHash,
  connectionHash,
  connectionSettingsHash,
  mapHash,
  parseHash,
  projectHash,
  projectRegistrationHash,
  selectionHash,
} from './router'

const PROJECT = { integration: 'github' as const, id: 'asmundwien/roadmap' }

describe('parseHash', () => {
  it('preserves encoded local project, map path, and ticket IDs', () => {
    const project = { integration: 'local' as const, id: 'work / café#1' }
    const map = { project, id: '.wayfinder/release 2/map.md' }
    const selection = { kind: 'ticket' as const, id: 'tickets/a b#2.md' }
    expect(projectHash(project)).toBe('#/projects/local/work%20%2F%20caf%C3%A9%231')
    expect(mapHash(map)).toBe(
      '#/projects/local/work%20%2F%20caf%C3%A9%231/maps/.wayfinder%2Frelease%202%2Fmap.md',
    )
    expect(selectionHash(map, selection)).toBe(
      '#/projects/local/work%20%2F%20caf%C3%A9%231/maps/.wayfinder%2Frelease%202%2Fmap.md/ticket/tickets%2Fa%20b%232.md',
    )
    expect(parseHash(selectionHash(map, selection))).toEqual({
      screen: 'project',
      project,
      selected: map.id,
      selection,
    })
    expect(parseHash(mapHash(map))).toEqual({
      screen: 'project',
      project,
      selected: map.id,
      selection: null,
    })
  })

  it.each([
    '#/projects/local/%',
    '#/projects/unknown/project',
    '#/projects/local/project/maps/%E0%A4%A',
    '#/projects/local/project/maps/map/ticket/%',
    '#/projects/local/project/maps/map/ticket/',
    '#/projects/local/project/maps/map/ticket/id/extra',
    '#/projects/local/project/maps/map/map',
    '#/projects/local/project/maps/map/fog/0',
    '#/projects/local/project/maps/map/scope/0',
    '#/projects/local/project/maps/map/scope-all',
    '#/projects/local/project/maps/map/',
    '#/projects/local/project/ticket/id',
    '#/v2/projects/local/project',
    '#/v2/projects/local/project/maps/map',
    '#/v2/projects/local/project/maps/map/ticket/id',
  ])('rejects malformed or retired routes %s', (hash) => {
    expect(parseHash(hash)).toEqual({ screen: 'projects' })
  })

  it.each([
    [componentsHash, { screen: 'components' }],
    [connectionSettingsHash, { screen: 'connection-settings' }],
  ])('reads the management route %s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route)
  })
  it('falls back to Overview for the removed Projects settings list', () => {
    expect(parseHash('#/settings/projects')).toEqual({ screen: 'projects' })
  })
  it('routes an encoded connection ID to its management page', () => {
    expect(connectionHash('github/work')).toBe('#/settings/connections/github%2Fwork')
    expect(parseHash('#/settings/connections/github%2Fwork')).toEqual({
      screen: 'connection',
      connectionId: 'github/work',
    })
    expect(parseHash('#/settings/connections/%E0%A4%A')).toEqual({ screen: 'projects' })
  })
  it('routes a connection-scoped project import without treating it as connection management', () => {
    expect(parseHash('#/settings/connections/github%2Fwork/import')).toEqual({
      screen: 'project-import',
      connectionId: 'github/work',
    })
    expect(parseHash('#/settings/connections/%E0%A4%A/import')).toEqual({ screen: 'projects' })
  })
  it('routes each encoded project key to its registration page', () => {
    expect(projectRegistrationHash(PROJECT)).toBe('#/settings/projects/github/asmundwien%2Froadmap')
    expect(parseHash('#/settings/projects/github/asmundwien%2Froadmap')).toEqual({
      screen: 'project-registration',
      project: PROJECT,
    })
    expect(
      parseHash(projectRegistrationHash({ integration: 'local', id: 'my workspace' })),
    ).toEqual({
      screen: 'project-registration',
      project: { integration: 'local', id: 'my workspace' },
    })
    expect(parseHash('#/settings/projects/github/%E0%A4%A')).toEqual({ screen: 'projects' })
  })
  it('reads a bare project route as the active map', () => {
    expect(parseHash('#/projects/github/asmundwien%2Froadmap')).toEqual({
      screen: 'project',
      project: PROJECT,
      selected: null,
      selection: null,
    })
  })

  it('reads a pinned map selection', () => {
    expect(parseHash('#/projects/github/asmundwien%2Froadmap/maps/11')).toEqual({
      screen: 'project',
      project: PROJECT,
      selected: '11',
      selection: null,
    })
  })

  it.each([
    ['#/projects/github/me%2Frepo/maps/11/ticket/42', { kind: 'ticket', id: '42' }],
    [
      '#/projects/local/microsoft-risiko/maps/.wayfinder%2Fazure-strategy-leadership-deck%2Fmap.md/ticket/T-17',
      { kind: 'ticket', id: 'T-17' },
    ],
  ])('reads the ticket selection segment %s', (hash, selection) => {
    expect(parseHash(hash)).toEqual({
      screen: 'project',
      project:
        hash.indexOf('/local/') === -1
          ? { integration: 'github', id: 'me/repo' }
          : { integration: 'local', id: 'microsoft-risiko' },
      selected:
        hash.indexOf('/local/') === -1 ? '11' : '.wayfinder/azure-strategy-leadership-deck/map.md',
      selection,
    })
  })

  it.each([
    '',
    '#',
    '#/',
    '#/owner',
    '#/projects',
    '#/projects/github',
    '#/projects/github/owner%2Frepo/not-a-map',
    '#/map/owner/repo/1',
    // A selection segment needs a pinned map in front of it.
    '#/projects/github/owner%2Frepo/map',
    '#/projects/github/owner%2Frepo/ticket/4',
    // Garbled selection segments are bad URLs, not partial ones.
    '#/projects/github/owner%2Frepo/maps/11/bogus',
    '#/projects/github/owner%2Frepo/maps/11/ticket',
    '#/projects/github/owner%2Frepo/maps/11/fog/-1',
    '#/projects/nope/owner%2Frepo',
    '#/projects/github/%E0%A4%A/maps/1',
  ])('falls back to the project list for %j', (hash) => {
    expect(parseHash(hash)).toEqual({ screen: 'projects' })
  })

  it('round-trips what projectHash builds', () => {
    const ref = { integration: 'github' as const, id: 'someone/a-repo' }
    expect(parseHash(projectHash(ref))).toEqual({
      screen: 'project',
      project: ref,
      selected: null,
      selection: null,
    })
  })

  it('builds a clean stable-id route for local projects', () => {
    const ref = { integration: 'local' as const, id: 'microsoft-risiko' }
    expect(projectHash(ref)).toBe('#/projects/local/microsoft-risiko')
    expect(parseHash(projectHash(ref))).toEqual({
      screen: 'project',
      project: ref,
      selected: null,
      selection: null,
    })
  })

  it('round-trips what mapHash builds', () => {
    const ref = { project: { integration: 'github' as const, id: 'someone/a-repo' }, id: '42' }
    expect(parseHash(mapHash(ref))).toEqual({
      screen: 'project',
      project: ref.project,
      selected: '42',
      selection: null,
    })
  })

  it('round-trips the ticket modal route', () => {
    const selection = { kind: 'ticket' as const, id: '7' }
    const ref = { project: { integration: 'github' as const, id: 'someone/a-repo' }, id: '42' }
    expect(parseHash(selectionHash(ref, selection))).toEqual({
      screen: 'project',
      project: ref.project,
      selected: '42',
      selection,
    })
  })
})
