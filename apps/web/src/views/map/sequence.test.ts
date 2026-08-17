import { describe, expect, it } from 'vitest'
import { ledgerSequence, SCOPE_INLINE_MAX, scopePlan } from './sequence.ts'
import { blocker, makeMap, ticket } from './test-fixtures.ts'

describe('scopePlan', () => {
  it('rides a small out-of-scope list inline as ⊘ stops in the fog band', () => {
    const map = makeMap([], { outOfScope: ['a', 'b', 'c'], notYetSpecified: ['mist'] })
    const plan = scopePlan(map)
    expect(plan.aggregated).toBe(false)
    expect(plan.scopeSet).toEqual(new Set(['a', 'b', 'c']))
    // Scope stops lead the fog band; the real fog follows.
    expect(plan.fogMap.body.notYetSpecified).toEqual(['a', 'b', 'c', 'mist'])
  })

  it('collapses a vast out-of-scope list to the one aggregate stop carrying the count', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(items.length).toBeGreaterThan(SCOPE_INLINE_MAX)
    const map = makeMap([], { outOfScope: items, notYetSpecified: ['mist'] })
    const plan = scopePlan(map)
    expect(plan.aggregated).toBe(true)
    expect(plan.scopeSet.size).toBe(0)
    expect(plan.fogMap.body.notYetSpecified).toEqual(['left off the map · 4 things', 'mist'])
  })

  it('strips inline markdown before deciding what is a scope stop', () => {
    const map = makeMap([], { outOfScope: ['A **bold** cut'] })
    expect(scopePlan(map).scopeSet).toEqual(new Set(['A bold cut']))
  })

  it('leaves a map with nothing out of scope and no fog untouched', () => {
    const map = makeMap([])
    expect(scopePlan(map).fogMap).toBe(map)
  })
})

describe('ledgerSequence', () => {
  it('walks the picture top to bottom: fog stops, ahead deepest-first, then covered by recency', () => {
    const map = makeMap(
      [
        ticket(2, 'frontier'),
        ticket(3, 'blocked', [blocker(2)]),
        ticket(4, 'closed', [], 100),
        ticket(5, 'closed', [], 200),
      ],
      { outOfScope: ['dropped'], notYetSpecified: ['mist'] },
    )
    // Scope stops lead the fog band, deeper open work sits above the takeable frontier, and
    // ground covered reads latest-first — exactly the on-screen order.
    expect(ledgerSequence(map)).toEqual([
      { kind: 'scope', text: 'dropped' },
      { kind: 'fog', text: 'mist' },
      { kind: 'ticket', number: 3 },
      { kind: 'ticket', number: 2 },
      { kind: 'ticket', number: 5 },
      { kind: 'ticket', number: 4 },
    ])
  })

  it('classifies the aggregate stop as scope-all, with no inline scope entries left', () => {
    const map = makeMap([ticket(2, 'frontier')], {
      outOfScope: ['a', 'b', 'c', 'd'],
      notYetSpecified: ['mist'],
    })
    expect(ledgerSequence(map)).toEqual([
      { kind: 'scope-all' },
      { kind: 'fog', text: 'mist' },
      { kind: 'ticket', number: 2 },
    ])
  })

  it('tells fog and inline scope stops apart even at the same band', () => {
    const map = makeMap([], { outOfScope: ['cut'], notYetSpecified: ['haze'] })
    const kinds = new Map(
      ledgerSequence(map).map((sel) => ['text' in sel ? sel.text : sel.kind, sel.kind]),
    )
    expect(kinds.get('cut')).toBe('scope')
    expect(kinds.get('haze')).toBe('fog')
  })
})
