import { applicationStateCodec } from '@roadmap/contracts/codecs'
import { describe, expect, test } from 'vitest'

function applicationWithProgress(progress: unknown, ticketsComplete = false) {
  const project = { integration: 'github', id: 'opaque-repository' }
  const ticket = {
    id: '2',
    body: '',
    typeEvidence: { kind: 'missing', labels: [] },
    state: 'closed',
    isClaimed: false,
    isBlocked: false,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
  }
  return {
    serverEpoch: 'test',
    stateSequence: 0,
    configurationVersion: 0,
    supportedIntegrations: [],
    connections: [],
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
    roadmap: {
      capturedAt: 1,
      unreachable: [],
      projects: [
        {
          key: project,
          name: 'owner/repo',
          warnings: [],
          closedMaps: [],
          openMaps: [
            {
              project,
              id: '1',
              isOpen: true,
              updatedAt: 1,
              body: {
                raw: 'Readable source map',
                destination: '',
                notes: [],
                decisions: [],
                notYetSpecified: [],
                notYetSpecifiedNote: '',
                outOfScope: [],
                sections: [],
                missingSections: [],
              },
              tickets: [ticket],
              frontier: [],
              progress,
              ticketsComplete,
              warnings: [],
            },
          ],
        },
      ],
    },
  }
}

describe('source progress public boundary', () => {
  test('round-trips unknown upstream totals as null on a readable incomplete map', () => {
    const input = applicationWithProgress(null)
    const decoded = applicationStateCodec.decode(JSON.parse(JSON.stringify(input)))
    expect(decoded).toEqual({ ok: true, value: input })
    if (!decoded.ok) throw new Error('Expected unknown progress to decode')
    const map = decoded.value.roadmap.projects[0]?.openMaps[0]
    expect(map?.progress).toBeNull()
    expect(map?.ticketsComplete).toBe(false)
    expect(map?.body.raw).toBe('Readable source map')
    expect(applicationStateCodec.decode(JSON.parse(JSON.stringify(decoded.value)))).toEqual(decoded)
  })

  test('preserves numeric progress for a complete fetched ticket collection', () => {
    const input = applicationWithProgress({ total: 1, completed: 1 }, true)
    expect(applicationStateCodec.decode(JSON.parse(JSON.stringify(input)))).toEqual({
      ok: true,
      value: input,
    })
  })

  test('accepts known upstream totals beyond an incomplete fetched subset', () => {
    const input = applicationWithProgress({ total: 40, completed: 17 })
    const decoded = applicationStateCodec.decode(JSON.parse(JSON.stringify(input)))
    expect(decoded).toEqual({ ok: true, value: input })
    if (!decoded.ok) throw new Error('Expected known upstream progress to decode')
    const map = decoded.value.roadmap.projects[0]?.openMaps[0]
    expect(map?.tickets).toHaveLength(1)
    expect(map?.progress).toEqual({ total: 40, completed: 17 })
    expect(map?.ticketsComplete).toBe(false)
  })

  test('refuses malformed counts without inventing an aggregate', () => {
    expect(
      applicationStateCodec.decode(applicationWithProgress({ total: -1, completed: 0 })).ok,
    ).toBe(false)
  })

  test('requires the progress field even when totals are unknown', () => {
    const input = applicationWithProgress(null)
    const project = input.roadmap.projects[0]
    const original = project?.openMaps[0]
    if (!project || !original) throw new Error('Expected a map in the progress fixture')
    const { progress: _progress, ...map } = original
    const withoutProgress = {
      ...input,
      roadmap: { ...input.roadmap, projects: [{ ...project, openMaps: [map] }] },
    }
    expect(applicationStateCodec.decode(withoutProgress).ok).toBe(false)
  })
})
