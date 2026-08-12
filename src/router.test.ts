import { describe, expect, it } from 'vitest'
import { mapHash, parseHash, projectHash } from './router.ts'

describe('parseHash', () => {
  it('reads a bare project route as the active map', () => {
    expect(parseHash('#/asmundwien/roadmap')).toEqual({
      screen: 'project',
      owner: 'asmundwien',
      repo: 'roadmap',
      selected: null,
    })
  })

  it('reads a pinned map selection', () => {
    expect(parseHash('#/asmundwien/roadmap/11')).toEqual({
      screen: 'project',
      owner: 'asmundwien',
      repo: 'roadmap',
      selected: 11,
    })
  })

  it.each(['', '#', '#/', '#/owner', '#/owner/repo/not-a-number', '#/map/owner/repo/1'])(
    'falls back to the project list for %j',
    (hash) => {
      expect(parseHash(hash)).toEqual({ screen: 'projects' })
    },
  )

  it('round-trips what projectHash builds', () => {
    const ref = { owner: 'someone', repo: 'a-repo' }
    expect(parseHash(projectHash(ref))).toEqual({ screen: 'project', ...ref, selected: null })
  })

  it('round-trips what mapHash builds', () => {
    const ref = { owner: 'someone', repo: 'a-repo', number: 42 }
    expect(parseHash(mapHash(ref))).toEqual({
      screen: 'project',
      owner: 'someone',
      repo: 'a-repo',
      selected: 42,
    })
  })
})
