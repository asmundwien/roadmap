import { describe, expect, it } from 'vitest'
import type { WayfinderMap } from '../wayfinder/types.ts'
import { deriveMapSignal, describeMapSignal } from './map-signal.ts'

function mapWith(overrides: {
  total: number
  completed: number
  notYetSpecified?: string[]
}): WayfinderMap {
  return {
    owner: 'someone',
    repo: 'somewhere',
    nameWithOwner: 'someone/somewhere',
    number: 1,
    title: 'A map',
    url: 'https://github.com/someone/somewhere/issues/1',
    isOpen: true,
    body: {
      raw: '',
      destination: '',
      notes: [],
      decisions: [],
      notYetSpecified: overrides.notYetSpecified ?? [],
      notYetSpecifiedNote: '',
      outOfScope: [],
      sections: [],
      missingSections: [],
    },
    tickets: [],
    frontier: [],
    progress: {
      total: overrides.total,
      completed: overrides.completed,
      percentCompleted: overrides.total === 0 ? 0 : (overrides.completed / overrides.total) * 100,
    },
    ticketsTruncated: false,
  }
}

describe('deriveMapSignal', () => {
  it('splits tickets into decided and open, and counts fog patches', () => {
    const signal = deriveMapSignal(
      mapWith({ total: 7, completed: 4, notYetSpecified: ['a', 'b', 'c'] }),
    )
    expect(signal).toEqual({ decided: 4, open: 3, fog: 3 })
  })

  it('handles a map with no tickets and no fog', () => {
    expect(deriveMapSignal(mapWith({ total: 0, completed: 0 }))).toEqual({
      decided: 0,
      open: 0,
      fog: 0,
    })
  })

  it('never reports negative open tickets, even on inconsistent progress data', () => {
    expect(deriveMapSignal(mapWith({ total: 2, completed: 5 })).open).toBe(0)
  })
})

describe('describeMapSignal', () => {
  it('reads as a sentence fragment', () => {
    expect(describeMapSignal({ decided: 4, open: 3, fog: 2 })).toBe('4 decided · 3 open · 2 in fog')
  })

  it('omits fog when there is none, but always names decided and open', () => {
    expect(describeMapSignal({ decided: 0, open: 0, fog: 0 })).toBe('0 decided · 0 open')
  })
})
