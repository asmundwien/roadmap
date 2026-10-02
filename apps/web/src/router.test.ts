import { describe, expect, it } from 'vitest'
import {
  componentsHash,
  connectionHash,
  connectionSettingsHash,
  mapHash,
  type PanelSelection,
  parseHash,
  projectHash,
  projectRegistrationHash,
  selectionHash,
} from './router'

const PROJECT = { integration: 'github' as const, id: 'asmundwien/roadmap' }

describe('parseHash', () => {
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
    ['#/projects/github/me%2Frepo/maps/11/map', { kind: 'map' }],
    ['#/projects/github/me%2Frepo/maps/11/scope-all', { kind: 'scope-all' }],
    ['#/projects/github/me%2Frepo/maps/11/ticket/42', { kind: 'ticket', id: '42' }],
    ['#/projects/github/me%2Frepo/maps/11/fog/0', { kind: 'fog', index: 0 }],
    ['#/projects/github/me%2Frepo/maps/11/scope/3', { kind: 'scope', index: 3 }],
    [
      '#/projects/local/microsoft-risiko/maps/.wayfinder%2Fazure-strategy-leadership-deck%2Fmap.md/ticket/T-17',
      { kind: 'ticket', id: 'T-17' },
    ],
  ])('reads the panel selection segment %s', (hash, selection) => {
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

  it.each<PanelSelection>([
    { kind: 'map' },
    { kind: 'scope-all' },
    { kind: 'ticket', id: '7' },
    { kind: 'fog', index: 2 },
    { kind: 'scope', index: 0 },
  ])('round-trips what selectionHash builds for %o', (selection) => {
    const ref = { project: { integration: 'github' as const, id: 'someone/a-repo' }, id: '42' }
    expect(parseHash(selectionHash(ref, selection))).toEqual({
      screen: 'project',
      project: ref.project,
      selected: '42',
      selection,
    })
  })
})
