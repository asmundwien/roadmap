import { describe, expect, it } from 'vitest'
import { buildLedger } from './geometry.ts'
import { blocker, makeMap, ticket } from './test-fixtures.ts'

const id = (value: number | string) => String(value)

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
    for (const node of nodes) {
      if (node.ticket.id === edge.from || node.ticket.id === edge.to) continue
      if (Math.abs(node.x - x) < 1 && node.y > top + 2 && node.y < bottom - 2)
        offenders.push(`${edge.key} rides through #${node.ticket.id}`)
    }
  }
  return offenders
}

const rowY = (ledger: ReturnType<typeof buildLedger>, n: number) =>
  ledger.rows.find((row) => row.ticket.id === id(n))?.y ?? Number.NaN
const rowX = (ledger: ReturnType<typeof buildLedger>, n: number) =>
  ledger.rows.find((row) => row.ticket.id === id(n))?.x
const closedRow = (ledger: ReturnType<typeof buildLedger>, n: number) =>
  ledger.closedRows.find((row) => row.ticket.id === id(n))

describe('buildLedger', () => {
  it('stacks charted-ahead rows by remaining distance: takeable at the bottom, deepest at the top', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
    ])
    const ledger = buildLedger(map)
    expect(rowY(ledger, 2)).toBeGreaterThan(rowY(ledger, 3))
    expect(rowY(ledger, 3)).toBeGreaterThan(rowY(ledger, 4))
    expect(rowY(ledger, 2)).toBeLessThan(ledger.sepBehind)
    expect(rowY(ledger, 4)).toBeGreaterThan(ledger.sepAhead)
  })

  it('gives the heaviest chain forked off HEAD the trunk lane, tributaries rightward', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
      ticket(5, 'frontier'),
    ])
    const ledger = buildLedger(map)
    expect(rowX(ledger, 2)).toBe(ledger.gutterX)
    expect(rowX(ledger, 3)).toBe(ledger.gutterX)
    expect(rowX(ledger, 4)).toBe(ledger.gutterX)
    expect(rowX(ledger, 5)).toBeGreaterThan(ledger.gutterX)
  })

  it('leaves a rootless takeable bare — no invented line to HEAD or the trunk', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
      ticket(5, 'frontier'),
    ])
    const ledger = buildLedger(map)
    expect(ledger.edges.filter((edge) => edge.to === id(5) && edge.kind !== 'tip')).toEqual([])
    expect(ledger.edges.find((edge) => edge.kind === 'tip' && edge.to === id(5))).toBeDefined()
  })

  it('lands a merge on the heavier rail and draws the lighter rail in as a merge edge', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(5, 'frontier'),
      ticket(7, 'blocked', [blocker(3), blocker(5)]),
    ])
    const ledger = buildLedger(map)
    expect(rowX(ledger, 7)).toBe(rowX(ledger, 3))
    const merge = ledger.edges.find((edge) => edge.kind === 'merge')
    expect(merge).toMatchObject({ from: id(5), to: id(7) })
  })

  it('counts a cross-project blocker as one step of depth but never draws or follows it', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2, true, 'other/repo')]),
    ])
    const ledger = buildLedger(map)
    expect(rowY(ledger, 3)).toBeLessThan(rowY(ledger, 2))
    expect(ledger.edges.some((edge) => edge.kind === 'merge')).toBe(false)
    expect(
      ledger.edges.filter((edge) => edge.kind === 'fork').every((edge) => edge.from === null),
    ).toBe(true)
    expect(ledger.blockersOf.get(id(3))).toBeUndefined()
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

  it('keeps later local completions nearest the active work when closure times are unavailable', () => {
    const ledger = buildLedger(
      makeMap([ticket(1, 'closed'), ticket(2, 'closed'), ticket(3, 'frontier')]),
    )

    expect(ledger.closedRows.map((row) => row.ticket.id)).toEqual([id(2), id(1)])
  })

  it('weaves ground covered: the last dependent inherits the rail, earlier ones branch out', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [blocker(2, false)], 200),
      ticket(4, 'closed', [blocker(2, false)], 300),
    ])
    const ledger = buildLedger(map)
    expect(closedRow(ledger, 2)?.x).toBe(ledger.gutterX)
    expect(closedRow(ledger, 4)?.x).toBe(ledger.gutterX)
    expect(closedRow(ledger, 3)?.x).toBeGreaterThan(ledger.gutterX)
    expect(ledger.edges.find((edge) => edge.kind === 'run')).toMatchObject({
      from: id(2),
      to: id(4),
    })
    expect(ledger.edges.find((edge) => edge.kind === 'merge')).toMatchObject({
      from: id(2),
      to: id(3),
    })
    expect(ledger.edges).toHaveLength(2)
  })

  it('forks a spawned chain off the non-research ticket that closed just before its creation', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(3, 'closed', [blocker(2, false)], 400),
      ticket(6, 'closed', [], 300, 150, 'research'),
      ticket(7, 'closed', [blocker(6, false)], 500),
      ticket(8, 'closed', [], 140, 0, 'research'),
    ])
    const ledger = buildLedger(map)
    expect(closedRow(ledger, 6)?.x).toBeGreaterThan(ledger.gutterX)
    const fork = ledger.edges.find((edge) => edge.kind === 'fork' && edge.to === id(6))
    expect(fork).toMatchObject({ from: id(2), isDependency: false })
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
    expect(closedRow(ledger, 5)?.x).toBe(ledger.gutterX)
    expect(ledger.laneCount).toBe(2)
  })

  it('keeps unconnected closed tickets edge-free, sharing the leftmost lane as log entries', () => {
    const map = makeMap([ticket(2, 'closed', [], 100), ticket(3, 'closed', [], 200)])
    const ledger = buildLedger(map)
    expect(ledger.closedRows.every((row) => row.x === ledger.gutterX)).toBe(true)
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
    const crossing = ledger.edges.find((edge) => edge.to === id(5))
    expect(crossing).toMatchObject({ kind: 'run', from: id(2), isDependency: true })
    expect(rowX(ledger, 5)).toBe(closedRow(ledger, 2)?.x)
    expect(ledger.blockersOf.get(id(5))).toContain(id(2))
    expect(ledger.dependentsOf.get(id(2))).toContain(id(5))
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
    expect(rowX(ledger, 5)).toBe(ledger.gutterX)
    expect(rowX(ledger, 6)).toBe(ledger.gutterX)
    expect(rowX(ledger, 4)).toBeGreaterThan(ledger.gutterX)
    const crossing = ledger.edges.filter((edge) => edge.from === id(3) && edge.to === id(5))
    expect(crossing).toHaveLength(1)
    expect(crossing[0]).toMatchObject({ kind: 'run', isDependency: true })
    expect(ledger.edges.find((edge) => edge.kind === 'merge' && edge.to === id(5))).toMatchObject({
      from: id(4),
    })
  })

  it('drops a merge a longer chain already implies — the Hasse rule', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3), blocker(2)]),
    ])
    const ledger = buildLedger(map)
    expect(ledger.edges.some((edge) => edge.from === id(2) && edge.to === id(4))).toBe(false)
    expect(ledger.blockersOf.get(id(4))).toContain(id(2))
  })

  it('cuts a rail into one segment per blocked-by pair, never one stroke past a node', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
    ])
    const ledger = buildLedger(map)
    const runs = ledger.edges.filter((edge) => edge.kind === 'run')
    expect(runs.map((edge) => [edge.from, edge.to])).toEqual([
      [id(2), id(3)],
      [id(3), id(4)],
    ])
    expect(runs.every((edge) => edge.isDependency)).toBe(true)
  })

  it('draws each blocked-by exactly once — a rail segment or a merge, never both', () => {
    const map = makeMap([
      ticket(2, 'frontier'),
      ticket(3, 'blocked', [blocker(2)]),
      ticket(4, 'blocked', [blocker(3)]),
      ticket(5, 'blocked', [blocker(2)]),
    ])
    const ledger = buildLedger(map)
    const pair = ledger.edges.filter((edge) => edge.from === id(2) && edge.to === id(5))
    expect(pair).toHaveLength(1)
    expect(pair[0]).toMatchObject({ kind: 'run', isDependency: true })
    expect(ledger.edges.filter((edge) => edge.from === id(2) && edge.to === id(3))).toHaveLength(1)
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
    const row5 = closedRow(ledger, 5)
    const row6 = ledger.rows.find((row) => row.ticket.id === id(6))
    expect(row5?.x).toBeGreaterThan(ledger.gutterX)
    expect(row6?.x).toBe(row5?.x)
    expect(ledger.edges.find((edge) => edge.to === id(6))).toMatchObject({
      kind: 'run',
      from: id(5),
    })
  })

  it('branches a mid-thread dependent out so the rail can continue to the later one', () => {
    const map = makeMap([
      ticket(2, 'closed', [], 100),
      ticket(6, 'closed', [blocker(2, false)], 200),
      ticket(14, 'closed', [blocker(6, false)], 300),
      ticket(15, 'frontier', [blocker(6, false)]),
    ])
    const ledger = buildLedger(map)
    expect(rowX(ledger, 15)).toBe(ledger.gutterX)
    expect(closedRow(ledger, 14)?.x ?? Number.NaN).toBeGreaterThan(ledger.gutterX)
    expect(ledger.edges.find((edge) => edge.to === id(15))).toMatchObject({
      kind: 'run',
      from: id(6),
    })
    expect(ledger.edges.find((edge) => edge.to === id(14))).toMatchObject({
      kind: 'merge',
      from: id(6),
    })
  })

  it('compresses lanes evenly once the braid outgrows ten, guarding the text column', () => {
    const spokes = Array.from({ length: 11 }, (_, index) =>
      ticket(2 + index, 'closed', [], 100 + index),
    )
    const hub = ticket(
      20,
      'closed',
      spokes.map((spoke) => blocker(spoke.id, false)),
      900,
    )
    const ledger = buildLedger(makeMap([...spokes, hub]))
    const xs = [...new Set(ledger.closedRows.map((row) => row.x))].sort((a, b) => a - b)
    expect(Math.max(...xs)).toBeLessThanOrEqual(ledger.gutterX + 340)
    const gaps = xs.slice(1).map((x, index) => x - (xs[index] ?? 0))
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
    expect(closedRow(ledger, 4)?.x).toBeGreaterThan(ledger.gutterX)
    expect(
      ledger.edges.find(
        (edge) => edge.kind === 'merge' && edge.to === id(6) && edge.from === id(4),
      ),
    ).toBeDefined()
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
    expect(ledger.edges.some((edge) => edge.kind === 'fork' && edge.to === id(19))).toBe(false)
    expect(ledger.edges.find((edge) => edge.to === id(19))).toMatchObject({
      kind: 'run',
      from: id(18),
    })
    expect(ledger.edges.some((edge) => edge.to === id(26))).toBe(false)
    expect(rowX(ledger, 26)).toBe(ledger.gutterX)
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
    expect(ledger.closedRows.map((row) => row.ticket.id)).toEqual(['2', '3'])
    expect(ledger.destination).toBe('Reach the end.')
    expect(ledger.fogRows[0]?.item).toBe('A foggy thing')
    expect(ledger.trunkSolid).not.toBeNull()
  })

  it('scatters fog across the gutter, clear of the trunk and the text column', () => {
    const map = makeMap([], { notYetSpecified: ['one', 'two', 'three', 'four', 'five'] })
    const ledger = buildLedger(map)
    for (const fog of ledger.fogRows) {
      expect(fog.x).toBeGreaterThan(ledger.gutterX + 9)
      expect(fog.x).toBeLessThan(ledger.textX - 9)
    }
  })

  it('marks empty fog and ground covered with placeholder lines, never a node', () => {
    const ledger = buildLedger(makeMap([]))
    expect(ledger.fogRows).toEqual([])
    expect(ledger.placeholders.map((placeholder) => placeholder.text)).toEqual([
      'no fog recorded',
      'nothing decided yet',
    ])
    expect(ledger.placeholders.map((placeholder) => placeholder.y)).toEqual(
      [...ledger.placeholders.map((placeholder) => placeholder.y)].sort((a, b) => a - b),
    )
  })

  it('collapses the charted-ahead section entirely when nothing is charted', () => {
    const ledger = buildLedger(makeMap([ticket(2, 'closed', [], 100)]))
    expect(ledger.sepAhead).toBe(ledger.sepBehind)
    expect(
      ledger.placeholders.some((placeholder) => placeholder.text === 'nothing charted ahead'),
    ).toBe(false)
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

  it('sits two-line ahead rows on the 52-unit pitch, single-line fog and covered rows on 40', () => {
    const map = makeMap(
      [
        ticket(2, 'frontier'),
        ticket(3, 'blocked', [blocker(2)]),
        ticket(4, 'blocked', [blocker(3)]),
        ticket(5, 'closed', [], 100),
        ticket(6, 'closed', [], 200),
        ticket(7, 'closed', [], 300),
      ],
      { notYetSpecified: ['one', 'two', 'three'] },
    )
    const ledger = buildLedger(map)
    const pitches = (ys: number[]) => {
      const sorted = [...ys].sort((a, b) => a - b)
      return sorted.slice(1).map((y, index) => y - (sorted[index] ?? Number.NaN))
    }
    expect(pitches(ledger.rows.map((row) => row.y))).toEqual([52, 52])
    expect(pitches(ledger.fogRows.map((row) => row.y))).toEqual([40, 40])
    expect(pitches(ledger.closedRows.map((row) => row.y))).toEqual([40, 40])
  })
})
