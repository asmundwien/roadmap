import { describe, expect, it } from 'vitest'
import type { Blocker, MapBody, Ticket, TicketState, WayfinderMap } from '../../wayfinder/types.ts'
import { buildLedger } from './geometry.ts'

const HOME = 'me/repo'

function blocker(number: number, isOpen = true, nameWithOwner = HOME): Blocker {
  return {
    number,
    title: `Ticket ${number}`,
    url: `https://example.test/${nameWithOwner}/${number}`,
    nameWithOwner,
    isOpen,
  }
}

function ticket(number: number, state: TicketState, blockedBy: Blocker[] = []): Ticket {
  return {
    number,
    title: `Ticket ${number}`,
    url: `https://example.test/${HOME}/${number}`,
    type: 'task',
    state,
    isClaimed: state === 'claimed',
    isBlocked: blockedBy.some((b) => b.isOpen),
    assignees: [],
    blockedBy,
    blockersTruncated: false,
  }
}

function body(overrides: Partial<MapBody> = {}): MapBody {
  return {
    raw: '',
    destination: 'The destination.',
    notes: [],
    decisions: [],
    notYetSpecified: [],
    notYetSpecifiedNote: '',
    outOfScope: [],
    sections: [],
    missingSections: [],
    ...overrides,
  }
}

function makeMap(tickets: Ticket[], bodyOverrides: Partial<MapBody> = {}): WayfinderMap {
  return {
    owner: 'me',
    repo: 'repo',
    nameWithOwner: HOME,
    number: 1,
    title: 'Test map',
    url: `https://example.test/${HOME}/1`,
    isOpen: true,
    body: body(bodyOverrides),
    tickets,
    frontier: tickets.filter((t) => t.state === 'frontier'),
    progress: {
      total: tickets.length,
      completed: tickets.filter((t) => t.state === 'closed').length,
      percentCompleted: 0,
    },
    ticketsTruncated: false,
  }
}

describe('buildLedger', () => {
  it('stacks charted-ahead rows by remaining distance: takeable at the bottom, deepest at the top', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
    ])
    const ledger = buildLedger(map)
    const y = (n: number) => ledger.rows.find((r) => r.ticket.number === n)?.y ?? Number.NaN
    expect(y(2)).toBeGreaterThan(y(3))
    expect(y(3)).toBeGreaterThan(y(4))
    expect(y(2)).toBeLessThan(ledger.sepBehind)
    expect(y(4)).toBeGreaterThan(ledger.sepAhead)
  })

  it('gives the heaviest chain forked off HEAD the trunk lane, tributaries rightward', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
      ticket(5, 'frontier'),
    ])
    const ledger = buildLedger(map)
    const x = (n: number) => ledger.rows.find((r) => r.ticket.number === n)?.x
    expect(x(2)).toBe(ledger.gutterX)
    expect(x(3)).toBe(ledger.gutterX)
    expect(x(4)).toBe(ledger.gutterX)
    expect(x(5)).toBeGreaterThan(ledger.gutterX)
  })

  it('lands a merge on the heavier rail and draws the lighter rail in as a merge edge', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(5, 'frontier'),
      ticket(7, 'blocked', [blocker(3), blocker(5)]),
    ])
    const ledger = buildLedger(map)
    const x = (n: number) => ledger.rows.find((r) => r.ticket.number === n)?.x
    expect(x(7)).toBe(x(3))
    const merge = ledger.edges.find((e) => e.kind === 'merge')
    expect(merge).toMatchObject({ from: 5, to: 7 })
  })

  it('counts a cross-repo blocker as one step of depth but never draws or follows it', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2, true, 'other/repo')]),
    ])
    const ledger = buildLedger(map)
    const rowOf = (n: number) => ledger.rows.find((r) => r.ticket.number === n)
    // Ticket 3 is genuinely blocked, so it sits a layer above the frontier...
    expect(rowOf(3)?.y).toBeLessThan(rowOf(2)?.y ?? Number.NaN)
    // ...but the same-number ticket in this repo is a stranger: no edge, no hover neighbour.
    expect(ledger.edges.some((e) => e.kind === 'merge')).toBe(false)
    expect(ledger.edges.filter((e) => e.kind === 'fork').every((e) => e.from === null)).toBe(true)
    expect(ledger.neighbors.get(3)).toBeUndefined()
  })

  it('is deterministic: the same snapshot builds the same ledger', () => {
    const map = makeMap([
      ticket(2, 'closed'),
      ticket(3, 'frontier'),
      ticket(4, 'claimed'),
      ticket(5, 'blocked', [blocker(3), blocker(4)]),
      ticket(6, 'blocked', [blocker(5)]),
    ])
    const first = buildLedger(map)
    const second = buildLedger(map)
    expect(second.rows).toEqual(first.rows)
    expect(second.edges).toEqual(first.edges)
    expect(second.chainIdOf).toEqual(first.chainIdOf)
  })

  it('lists ground covered newest first and strips markdown from fog and destination', () => {
    const map = makeMap([ticket(2, 'closed'), ticket(3, 'closed')], {
      destination: 'Reach **the** [end](https://example.test).',
      notYetSpecified: ['A [foggy](https://example.test) `thing`'],
    })
    const ledger = buildLedger(map)
    expect(ledger.closedRows.map((r) => r.ticket.number)).toEqual([3, 2])
    expect(ledger.destination).toBe('Reach the end.')
    expect(ledger.fogRows[0]?.item).toBe('A foggy thing')
    expect(ledger.trunkSolid).not.toBeNull()
  })

  it('scatters fog across the gutter, clear of the trunk and the text column', () => {
    const map = makeMap([], {
      notYetSpecified: ['one', 'two', 'three', 'four', 'five'],
    })
    const ledger = buildLedger(map)
    for (const fog of ledger.fogRows) {
      expect(fog.x).toBeGreaterThan(ledger.gutterX + 9)
      expect(fog.x).toBeLessThan(ledger.textX - 9)
    }
  })

  it('marks every empty section with a placeholder line, never a node', () => {
    const ledger = buildLedger(makeMap([]))
    expect(ledger.fogRows).toEqual([])
    expect(ledger.placeholders.map((p) => p.text)).toEqual([
      'no fog recorded',
      'nothing charted ahead',
      'nothing decided yet',
    ])
    expect(ledger.placeholders.map((p) => p.y)).toEqual(
      [...ledger.placeholders.map((p) => p.y)].sort((a, b) => a - b),
    )
  })

  it('shows the fog section’s prose as the empty note instead of a ghost node', () => {
    const map = makeMap([ticket(2, 'frontier')], {
      notYetSpecifiedNote: '*(No known fog remains — the route is fully ticketed.)*',
    })
    const ledger = buildLedger(map)
    expect(ledger.fogRows).toEqual([])
    expect(ledger.placeholders[0]?.text).toBe(
      '(No known fog remains — the route is fully ticketed.)',
    )
  })

  it('survives an empty map: sections and trunk render with nothing on them', () => {
    const ledger = buildLedger(makeMap([]))
    expect(ledger.rows).toEqual([])
    expect(ledger.closedRows).toEqual([])
    expect(ledger.trunkSolid).toBeNull()
    expect(ledger.height).toBeGreaterThan(0)
    expect(ledger.sepFog).toBeLessThan(ledger.sepAhead)
    expect(ledger.sepAhead).toBeLessThan(ledger.sepBehind)
  })
})
