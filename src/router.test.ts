import { describe, expect, it } from 'vitest'
import { mapHash, parseHash } from './router.ts'

describe('parseHash', () => {
  it('reads a map route', () => {
    expect(parseHash('#/map/asmundwien/roadmap/1')).toEqual({
      screen: 'map',
      owner: 'asmundwien',
      repo: 'roadmap',
      number: 1,
    })
  })

  it.each(['', '#', '#/', '#/map', '#/map/owner/repo', '#/map/owner/repo/not-a-number'])(
    'falls back to the project list for %j',
    (hash) => {
      expect(parseHash(hash)).toEqual({ screen: 'projects' })
    },
  )

  it('round-trips what mapHash builds', () => {
    const ref = { owner: 'someone', repo: 'a-repo', number: 42 }
    expect(parseHash(mapHash(ref))).toEqual({ screen: 'map', ...ref })
  })
})
