import { describe, expect, it } from 'vitest'
import type {
  Blocker,
  MapBody,
  Ticket,
  TicketState,
  TicketType,
  WayfinderMap,
} from '../../wayfinder/types.ts'
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

function ticket(
  number: number,
  state: TicketState,
  blockedBy: Blocker[] = [],
  closedAt: number | null = null,
  createdAt = 0,
  type: TicketType = 'task',
): Ticket {
  return {
    number,
    title: `Ticket ${number}`,
    url: `https://example.test/${HOME}/${number}`,
    type,
    state,
    isClaimed: state === 'claimed',
    isBlocked: blockedBy.some((b) => b.isOpen),
    createdAt,
    closedAt,
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
    updatedAt: 0,
    closedAt: null,
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

/** Every straight vertical (a rail or a merge's drop) riding through an unrelated node's center. */
function passThroughs(ledger: ReturnType<typeof buildLedger>): string[] {
  const nodes = [...ledger.rows, ...ledger.closedRows]
  const offenders: string[] = []
  for (const edge of ledger.edges) {
    const m = edge.path.match(/^M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)/)
    if (!m || m[1] !== m[3]) continue
    const x = Number(m[1])
    const top = Math.min(Number(m[2]), Number(m[4]))
    const bottom = Math.max(Number(m[2]), Number(m[4]))
    for (const n of nodes) {
      if (n.ticket.number === edge.from || n.ticket.number === edge.to) continue
      if (Math.abs(n.x - x) < 1 && n.y > top + 2 && n.y < bottom - 2)
        offenders.push(`${edge.key} rides through #${n.ticket.number}`)
    }
  }
  return offenders
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

  it('leaves a rootless takeable bare — no invented line to HEAD or the trunk', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
      ticket(5, 'frontier'),
    ])
    const ledger = buildLedger(map)
    // 5 has no recorded relations, so no stroke claims one: only its tip toward the fog.
    expect(ledger.edges.filter((e) => e.to === 5 && e.kind !== 'tip')).toEqual([])
    expect(ledger.edges.find((e) => e.kind === 'tip' && e.to === 5)).toBeDefined()
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
    expect(ledger.blockersOf.get(3)).toBeUndefined()
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
    expect(second.closedRows).toEqual(first.closedRows)
    expect(second.edges).toEqual(first.edges)
    expect(second.blockersOf).toEqual(first.blockersOf)
    expect(second.dependentsOf).toEqual(first.dependentsOf)
  })

  it('weaves ground covered: the last dependent inherits the rail, earlier ones branch out', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [blocker(2, false)], 200),
      ticket(4, 'closed', [blocker(2, false)], 300),
    ])
    const ledger = buildLedger(map)
    const row = (n: number) => ledger.closedRows.find((r) => r.ticket.number === n)
    // 2's thread holds lane 0 until its last dependent (4) inherits it; 3 branched out earlier.
    expect(row(2)?.x).toBe(ledger.gutterX)
    expect(row(4)?.x).toBe(ledger.gutterX)
    expect(row(3)?.x).toBeGreaterThan(ledger.gutterX)
    expect(ledger.edges.find((e) => e.kind === 'run')).toMatchObject({ from: 2, to: 4 })
    expect(ledger.edges.find((e) => e.kind === 'merge')).toMatchObject({ from: 2, to: 3 })
    expect(ledger.edges).toHaveLength(2)
  })

  it('forks a spawned chain off the non-research ticket that closed just before its creation', () => {
    const map = makeMap([
      // The trunk: a task resolved at 100, its dependent at 400.
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [blocker(2, false)], 400),
      // Research created at 150 — right after the task closed — then resolved by its subagent.
      ticket(6, 'closed', [], 300, 150, 'research'),
      ticket(7, 'closed', [blocker(6, false)], 500),
      // A research decoy that closed nearer the creation moment: research never spawns.
      ticket(8, 'closed', [], 140, 0, 'research'),
    ])
    const ledger = buildLedger(map)
    const row = (n: number) => ledger.closedRows.find((r) => r.ticket.number === n)
    expect(row(6)?.x).toBeGreaterThan(ledger.gutterX)
    const fork = ledger.edges.find((e) => e.kind === 'fork' && e.to === 6)
    expect(fork).toMatchObject({ from: 2, isDependency: false })
  })

  it('reuses a freed lane instead of growing the graph rightward', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [], 150),
      ticket(4, 'closed', [blocker(2, false), blocker(3, false)], 200),
      ticket(5, 'closed', [], 250, 240),
      ticket(6, 'closed', [blocker(5, false)], 300),
    ])
    const ledger = buildLedger(map)
    const row = (n: number) => ledger.closedRows.find((r) => r.ticket.number === n)
    // Both lanes freed at the 2+3 → 4 merge, so 5's new thread reclaims the leftmost —
    // the graph never grows a third column while old ones sit empty.
    expect(row(5)?.x).toBe(ledger.gutterX)
    expect(ledger.laneCount).toBe(2)
  })

  it('keeps unconnected closed tickets edge-free, sharing the leftmost lane as log entries', () => {
    const map = makeMap([ticket(2, 'closed', [], 100), ticket(3, 'closed', [], 200)])
    const ledger = buildLedger(map)
    expect(ledger.closedRows.every((r) => r.x === ledger.gutterX)).toBe(true)
    expect(ledger.edges).toHaveLength(0)
  })

  it('threads a closed blocker’s rail across HEAD into the open ticket it unblocked', () => {
    const map = makeMap([
      ticket(7, 'closed', [], 100),
      ticket(8, 'closed', [blocker(7, false)], 300),
      ticket(2, 'closed', [], 150),
      ticket(3, 'frontier'),
      ticket(5, 'frontier', [blocker(2, false)]),
    ])
    const ledger = buildLedger(map)
    // 2's thread waits for 5, so 5 inherits its lane — one rail crossing the separator...
    const crossing = ledger.edges.find((e) => e.to === 5)
    expect(crossing).toMatchObject({ kind: 'run', from: 2, isDependency: true })
    expect(ledger.rows.find((r) => r.ticket.number === 5)?.x).toBe(
      ledger.closedRows.find((r) => r.ticket.number === 2)?.x,
    )
    // ...and hovering either end relates them.
    expect(ledger.blockersOf.get(5)).toContain(2)
    expect(ledger.dependentsOf.get(2)).toContain(5)
  })

  it('continues the trunk across HEAD: the last decision’s dependent inherits lane 0', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [blocker(2, false)], 200),
      ticket(4, 'frontier'),
      ticket(5, 'blocked', [blocker(4), blocker(3, false)]),
      ticket(6, 'blocked', [blocker(5)]),
    ])
    const ledger = buildLedger(map)
    const x = (n: number) => ledger.rows.find((r) => r.ticket.number === n)?.x
    // 5 is what closing 3 unblocked, so lane 0 reads 2 → 3 → HEAD → 5 → 6: one road...
    expect(x(5)).toBe(ledger.gutterX)
    expect(x(6)).toBe(ledger.gutterX)
    expect(x(4)).toBeGreaterThan(ledger.gutterX)
    // ...whose crossing of HEAD is one real dependency edge, drawn once.
    const crossing = ledger.edges.filter((e) => e.from === 3 && e.to === 5)
    expect(crossing).toHaveLength(1)
    expect(crossing[0]).toMatchObject({ kind: 'run', isDependency: true })
    // 4 retires into 5 as an ordinary merge from its tributary lane.
    expect(ledger.edges.find((e) => e.kind === 'merge' && e.to === 5)).toMatchObject({ from: 4 })
  })

  it('drops a merge a longer chain already implies — the Hasse rule', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3), blocker(2)]),
    ])
    const ledger = buildLedger(map)
    // The rail draws 2 → 3 → 4, so the direct 2 → 4 shortcut adds no order — no edge...
    expect(ledger.edges.some((e) => e.from === 2 && e.to === 4)).toBe(false)
    // ...but hover still knows: the raw graph keeps the shortcut.
    expect(ledger.blockersOf.get(4)).toContain(2)
  })

  it('cuts a rail into one segment per blocked-by pair, never one stroke past a node', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
    ])
    const ledger = buildLedger(map)
    const runs = ledger.edges.filter((e) => e.kind === 'run')
    expect(runs.map((e) => [e.from, e.to])).toEqual([
      [2, 3],
      [3, 4],
    ])
    expect(runs.every((e) => e.isDependency)).toBe(true)
  })

  it('draws each blocked-by exactly once — a rail segment or a merge, never both', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
      ticket(5, 'blocked', [blocker(2)]),
    ])
    const ledger = buildLedger(map)
    // 5 is 2's last dependent, so it inherits the rail; 3 branched out with a merge earlier.
    const pair = ledger.edges.filter((e) => e.from === 2 && e.to === 5)
    expect(pair).toHaveLength(1)
    expect(pair[0]).toMatchObject({ kind: 'run', isDependency: true })
    expect(ledger.edges.filter((e) => e.from === 2 && e.to === 3)).toHaveLength(1)
  })

  it('flows a finished side-thread straight into the open work it unblocked', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [blocker(2, false)], 200),
      ticket(4, 'closed', [], 120),
      ticket(5, 'closed', [blocker(4, false)], 130),
      ticket(6, 'frontier', [blocker(5, false)]),
    ])
    const ledger = buildLedger(map)
    // 4 → 5 rides its own lane, and 6 inherits it — the thread crosses HEAD as one rail,
    // with no decorative stroke faking a convergence at HEAD.
    const row5 = ledger.closedRows.find((r) => r.ticket.number === 5)
    const row6 = ledger.rows.find((r) => r.ticket.number === 6)
    expect(row5?.x).toBeGreaterThan(ledger.gutterX)
    expect(row6?.x).toBe(row5?.x)
    expect(ledger.edges.find((e) => e.to === 6)).toMatchObject({ kind: 'run', from: 5 })
  })

  it('branches a mid-thread dependent out so the rail can continue to the later one', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(6, 'closed', [blocker(2, false)], 200),
      ticket(14, 'closed', [blocker(6, false)], 300),
      // 15 also waits on 6 and arrives last, so IT inherits 6's rail; 14 branched out.
      ticket(15, 'frontier', [blocker(6, false)]),
    ])
    const ledger = buildLedger(map)
    expect(ledger.rows.find((r) => r.ticket.number === 15)?.x).toBe(ledger.gutterX)
    expect(ledger.closedRows.find((r) => r.ticket.number === 14)?.x ?? Number.NaN).toBeGreaterThan(
      ledger.gutterX,
    )
    expect(ledger.edges.find((e) => e.to === 15)).toMatchObject({ kind: 'run', from: 6 })
    expect(ledger.edges.find((e) => e.to === 14)).toMatchObject({ kind: 'merge', from: 6 })
  })

  it('compresses lanes evenly once the braid outgrows ten, guarding the text column', () => {
    // Eleven independent closed spokes all feeding one hub: every spoke earns a lane.
    const spokes = Array.from({ length: 11 }, (_, i) => ticket(2 + i, 'closed', [], 100 + i))
    const hub = ticket(
      20,
      'closed',
      spokes.map((s) => blocker(s.number, false)),
      900,
    )
    const ledger = buildLedger(makeMap([...spokes, hub]))
    const xs = [...new Set(ledger.closedRows.map((r) => r.x))].sort((a, b) => a - b)
    // The lane field never exceeds its budget...
    expect(Math.max(...xs)).toBeLessThanOrEqual(ledger.gutterX + 340)
    // ...and the squeeze is uniform: every gap between adjacent lanes is the same.
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] ?? 0))
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0] ?? 0, 6)
    expect(gaps[0] ?? 0).toBeLessThan(34)
  })

  it('lets a log entry that feeds an open ticket braid onto its own lane, edge drawn', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [blocker(2, false)], 200),
      ticket(4, 'closed', [], 150),
      ticket(5, 'frontier'),
      ticket(6, 'blocked', [blocker(5), blocker(4, false)]),
    ])
    const ledger = buildLedger(map)
    // 4 feeds open 6, so it is no longer a mute log entry: it earns a lane off the trunk...
    const row4 = ledger.closedRows.find((r) => r.ticket.number === 4)
    expect(row4?.x).toBeGreaterThan(ledger.gutterX)
    // ...and its lineage up to 6 is drawn rather than silently swallowed by the trunk.
    expect(ledger.edges.find((e) => e.kind === 'merge' && e.to === 6 && e.from === 4)).toBeDefined()
  })

  it('anchors a takeable by its real origin below the line, never a fork off HEAD on top', () => {
    const map = makeMap([
      ticket(7, 'closed', [], 100),
      ticket(8, 'closed', [blocker(7, false)], 300),
      ticket(18, 'closed', [], 150),
      ticket(19, 'frontier', [blocker(18, false)]),
      ticket(26, 'frontier'),
      ticket(27, 'blocked', [blocker(26)]),
    ])
    const ledger = buildLedger(map)
    // 19 inherits 18's thread — one rail, nothing decorative beside it...
    expect(ledger.edges.some((e) => e.kind === 'fork' && e.to === 19)).toBe(false)
    expect(ledger.edges.find((e) => e.to === 19)).toMatchObject({ kind: 'run', from: 18 })
    // ...while rootless 26 starts bare on a lane freed below the line — no line to HEAD.
    expect(ledger.edges.some((e) => e.to === 26)).toBe(false)
    expect(ledger.rows.find((r) => r.ticket.number === 26)?.x).toBe(ledger.gutterX)
  })

  it('never lets a drawn line pass through a node it does not touch', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [blocker(2, false)], 110),
      ticket(4, 'closed', [blocker(2, false)], 120),
      ticket(5, 'closed', [blocker(2, false)], 130),
      ticket(6, 'closed', [blocker(3, false), blocker(4, false), blocker(5, false)], 200),
      ticket(7, 'closed', [], 150),
      ticket(8, 'frontier', [blocker(6, false), blocker(7, false)]),
      ticket(9, 'frontier'),
    ])
    const ledger = buildLedger(map)
    expect(passThroughs(ledger)).toEqual([])
  })

  it('orders ground covered by completion time — latest at the top, whatever the map order', () => {
    const map = makeMap([ticket(2, 'closed', [], 200), ticket(3, 'closed', [], 100)], {
      destination: 'Reach **the** [end](https://example.test).',
      notYetSpecified: ['A [foggy](https://example.test) `thing`'],
    })
    const ledger = buildLedger(map)
    expect(ledger.closedRows.map((r) => r.ticket.number)).toEqual([2, 3])
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

  it('marks empty fog and ground covered with placeholder lines, never a node', () => {
    const ledger = buildLedger(makeMap([]))
    expect(ledger.fogRows).toEqual([])
    expect(ledger.placeholders.map((p) => p.text)).toEqual([
      'no fog recorded',
      'nothing decided yet',
    ])
    expect(ledger.placeholders.map((p) => p.y)).toEqual(
      [...ledger.placeholders.map((p) => p.y)].sort((a, b) => a - b),
    )
  })

  it('collapses the charted-ahead section entirely when nothing is charted', () => {
    const ledger = buildLedger(makeMap([ticket(2, 'closed', [], 100)]))
    // No band, no placeholder — fog flows straight into ground covered at one separator.
    expect(ledger.sepAhead).toBe(ledger.sepBehind)
    expect(ledger.placeholders.some((p) => p.text === 'nothing charted ahead')).toBe(false)
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
    expect(ledger.sepAhead).toBe(ledger.sepBehind)
  })
})
