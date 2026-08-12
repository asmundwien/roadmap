/**
 * PROTOTYPE — throwaway. Variant L: the unified ledger — K's grammar carried through the whole map.
 *
 * The round-three reaction: the ledger is the clearest by far, but its three designs (graph, fog,
 * goal) don't speak the same language. This take makes the graph's grammar carry everything: one
 * left-aligned gutter-and-text system in three sections — ground covered, charted ahead, fog —
 * with the trunk passing through all of them. History renders exactly like the future (rows on the
 * rail, titles in the column); HEAD is just where the rail turns from solid to dashed; fog items
 * are ghost rows — the drawn-elision idiom (jj's elided nodes) — dim but readable, under a light
 * haze instead of clouds; and the destination is the trunk's final stop, a flag node in the same
 * column as every other row.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { type Chain, chainWeight, decomposeChains } from './chains.ts'
import { MapHead, STATE_META } from './chrome.tsx'
import { StateMarker, truncate } from './git-skeleton.tsx'
import type { VariantProps } from './variants.ts'

export const NAME = 'The unified ledger'

const W = 1000
const GX = 150
const PITCH = 34
const ROW_H = 54
const BEHIND_ROW_H = 46
const FOG_ROW_H = 46
const PAD_TOP = 20
const PAD_BOTTOM = 44
const BEND = 40

function connector(a: { x: number; y: number }, b: { x: number; y: number }): string {
  if (Math.abs(a.x - b.x) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  return [
    `M ${a.x} ${a.y}`,
    `L ${a.x} ${b.y + BEND}`,
    `C ${a.x} ${b.y + BEND * 0.35}, ${b.x} ${b.y + BEND * 0.65}, ${b.x} ${b.y}`,
  ].join(' ')
}

interface Row {
  ticket: Ticket
  x: number
  y: number
}

export function VariantL({ map }: VariantProps) {
  const { closed, layers, chains, chainOf, depthOf, descCount } = decomposeChains(map)

  // Lane 0 is the trunk's own lane: the heaviest chain forked off HEAD continues it (J's spine
  // rule) so merges pull toward the trunk. Tributaries take lanes rightward, heaviest first.
  const headChains = chains.filter((c) => c.forkFrom === null)
  const spine = [...headChains].sort(
    (a, b) =>
      chainWeight(b, descCount) - chainWeight(a, descCount) ||
      (a.tickets[0]?.number ?? 0) - (b.tickets[0]?.number ?? 0),
  )[0]
  const laneIndex = new Map<Chain, number>()
  if (spine) laneIndex.set(spine, 0)
  const tributaries = chains
    .filter((c) => c !== spine)
    .sort(
      (a, b) =>
        chainWeight(b, descCount) - chainWeight(a, descCount) ||
        (a.tickets[0]?.number ?? 0) - (b.tickets[0]?.number ?? 0),
    )
  for (const [i, chain] of tributaries.entries()) laneIndex.set(chain, i + 1)
  const laneOf = (n: number): number => {
    const chain = chainOf.get(n)
    return chain ? (laneIndex.get(chain) ?? 0) : 0
  }
  const laneCount = Math.max(chains.length, 2)
  const textX = GX + laneCount * PITCH + 44

  const ordered = layers.flat()
  ordered.sort((a, b) => {
    const da = depthOf.get(a.number) ?? 0
    const db = depthOf.get(b.number) ?? 0
    if (da !== db) return da - db
    return laneOf(a.number) - laneOf(b.number) || a.number - b.number
  })

  // The vertical frame, top to bottom: destination row, fog section, ahead section, behind section.
  const fogItems = map.body.notYetSpecified
  const destY = PAD_TOP + 40
  const sepFog = PAD_TOP + 84
  const fogTopPad = 38
  const sepAhead = sepFog + fogTopPad + fogItems.length * FOG_ROW_H + 16
  const aheadHeight = 34 + ordered.length * ROW_H
  const sepBehind = sepAhead + aheadHeight
  const height = sepBehind + 38 + closed.length * BEHIND_ROW_H + PAD_BOTTOM

  const ghostY = (i: number) => sepFog + fogTopPad + i * FOG_ROW_H + 14
  const rowY = (i: number) => sepBehind - 30 - i * ROW_H
  const behindY = (j: number) => sepBehind + 38 + j * BEHIND_ROW_H

  const rows: Row[] = ordered.map((ticket, i) => ({
    ticket,
    x: GX + laneOf(ticket.number) * PITCH,
    y: rowY(i),
  }))
  const rowByNumber = new Map(rows.map((r) => [r.ticket.number, r]))
  const head = { x: GX, y: sepBehind }

  const behindNewestFirst = [...closed].reverse()
  const gistByTitle = new Map(map.body.decisions.map((d) => [d.title, d.gist]))

  const dependedOn = new Set(
    rows.flatMap((r) => r.ticket.blockedBy.filter((b) => b.isOpen).map((b) => b.number)),
  )
  const lastSpineRow = [...rows].reverse().find((r) => chainOf.get(r.ticket.number) === spine)

  return (
    <div>
      <MapHead map={map} />
      <div className="d-wrap">
        <svg
          className="d-svg"
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label={`The ledger of ${map.title}: ground covered, charted ahead, and fog, on one rail`}
        >
          <title>{map.title}</title>
          <defs>
            <linearGradient id="l-haze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--proto-ink)" stopOpacity="0.05" />
              <stop offset="0.55" stopColor="var(--proto-ink)" stopOpacity="0.035" />
              <stop offset="1" stopColor="var(--proto-ink)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* section boundaries */}
          <Section y={sepFog} label="fog · not yet specified" />
          <Section y={sepAhead} label="charted ahead" />
          <Section y={sepBehind} label="ground covered" />
          <rect x="0" y={sepFog} width={W} height={sepAhead - sepFog} fill="url(#l-haze)" />

          {/* the trunk's lane, one line through every section: dashed ahead, solid behind */}
          <line
            x1={GX}
            y1={lastSpineRow ? lastSpineRow.y : head.y}
            x2={GX}
            y2={destY + 14}
            stroke="var(--proto-muted)"
            strokeWidth="1.75"
            strokeOpacity="0.45"
            strokeDasharray="3 5"
            strokeLinecap="round"
          />
          {behindNewestFirst.map((ticket, j) => (
            <line
              key={`trunk-${ticket.number}`}
              x1={GX}
              y1={j === 0 ? head.y : behindY(j - 1)}
              x2={GX}
              y2={behindY(j)}
              stroke="var(--proto-ink)"
              strokeOpacity="0.55"
              strokeWidth={2 + (closed.length - j) * 0.3}
              strokeLinecap="round"
            />
          ))}
          {closed.length > 0 && (
            <line
              x1={GX}
              y1={behindY(closed.length - 1)}
              x2={GX}
              y2={behindY(closed.length - 1) + BEHIND_ROW_H * 0.7}
              stroke="var(--proto-ink)"
              strokeOpacity="0.55"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          {/* charted branch tips dissolve where the fog section begins */}
          {rows
            .filter(
              (r) => !dependedOn.has(r.ticket.number) && chainOf.get(r.ticket.number) !== spine,
            )
            .map(({ ticket, x, y }) => (
              <line
                key={`tip-${ticket.number}`}
                x1={x}
                y1={y}
                x2={x}
                y2={sepAhead + 26}
                stroke="var(--proto-muted)"
                strokeWidth="1.5"
                strokeOpacity="0.25"
                strokeDasharray="2 7"
                strokeLinecap="round"
              />
            ))}

          {/* the braid: forks off HEAD, straight rails through rows, merges into surviving rails */}
          {chains.map((chain) => {
            const first = chain.tickets[0]
            const last = chain.tickets[chain.tickets.length - 1]
            if (!first || !last) return null
            const firstRow = rowByNumber.get(first.number)
            const lastRow = rowByNumber.get(last.number)
            if (!firstRow || !lastRow) return null
            const parent =
              chain.forkFrom === null ? head : (rowByNumber.get(chain.forkFrom) ?? head)
            const claimed = first.state === 'claimed'
            return (
              <g key={`rail-${chain.id}`}>
                <path
                  d={connector({ x: parent.x, y: parent.y }, firstRow)}
                  fill="none"
                  stroke={claimed ? 'var(--state-claimed)' : 'var(--proto-muted)'}
                  strokeWidth="1.75"
                  strokeOpacity={claimed ? 0.7 : 0.5}
                  strokeDasharray={claimed ? '7 5' : '3 5'}
                  strokeLinecap="round"
                />
                {lastRow.y < firstRow.y && (
                  <line
                    x1={firstRow.x}
                    y1={firstRow.y}
                    x2={lastRow.x}
                    y2={lastRow.y}
                    stroke="var(--proto-muted)"
                    strokeWidth="1.75"
                    strokeOpacity="0.5"
                    strokeDasharray="3 5"
                    strokeLinecap="round"
                  />
                )}
              </g>
            )
          })}
          {rows.flatMap(({ ticket, x, y }) =>
            ticket.blockedBy
              .filter((b) => b.isOpen)
              .map((b) => {
                const from = rowByNumber.get(b.number)
                if (!from || Math.abs(from.x - x) < 1) return null
                return (
                  <path
                    key={`merge-${ticket.number}-${b.number}`}
                    d={connector(from, { x, y })}
                    fill="none"
                    stroke="var(--proto-muted)"
                    strokeWidth="1.75"
                    strokeOpacity="0.5"
                    strokeDasharray="3 5"
                    strokeLinecap="round"
                  />
                )
              }),
          )}

          {/* ahead rows */}
          {rows.map(({ ticket, x, y }) => {
            const meta = STATE_META[ticket.state]
            const login = ticket.assignees[0]?.login
            return (
              <a key={ticket.number} href={ticket.url}>
                <title>{ticket.title}</title>
                <StateMarker ticket={ticket} x={x} y={y} />
                <text
                  x={textX}
                  y={y + 4}
                  className={`k-row-title ${ticket.state === 'blocked' ? 'is-dim' : ''}`}
                >
                  {truncate(ticket.title, 46)}
                </text>
                <text x={textX} y={y + 19} className="d-node-word" fill={meta.color}>
                  {meta.glyph} {meta.word}
                  {login !== undefined ? ` · ${login}` : ''}
                </text>
              </a>
            )
          })}

          {/* behind rows — the same grammar, just already walked */}
          {behindNewestFirst.map((ticket, j) => (
            <a key={ticket.number} href={ticket.url}>
              <title>
                {ticket.title}
                {gistByTitle.has(ticket.title) ? ` — ${gistByTitle.get(ticket.title)}` : ''}
              </title>
              <circle cx={GX} cy={behindY(j)} r="5.5" fill="var(--proto-ink)" fillOpacity="0.7" />
              <text x={textX} y={behindY(j) + 4} className="l-behind-title">
                {truncate(ticket.title, 46)}
              </text>
              <text
                x={textX}
                y={behindY(j) + 19}
                className="d-node-word"
                fill="var(--state-closed)"
              >
                ● decided
              </text>
            </a>
          ))}

          {/* fog rows — ghost stops: suspected, dim, unconnected, readable */}
          {fogItems.map((item, i) => {
            const gx = GX + ((i * 0.618 + 0.35) % 1) * (laneCount - 1) * PITCH
            return (
              <g key={item}>
                <title>{item}</title>
                <circle
                  cx={gx}
                  cy={ghostY(i)}
                  r="6"
                  fill="none"
                  stroke="var(--proto-muted)"
                  strokeWidth="1.5"
                  strokeDasharray="2.5 3.5"
                  strokeOpacity="0.7"
                />
                <text x={textX} y={ghostY(i) + 4} className="l-fog-title">
                  {truncate(item, 52)}
                </text>
              </g>
            )
          })}

          {/* the destination — the trunk's final stop */}
          <text x={GX} y={destY + 7} textAnchor="middle" className="l-flag">
            ⚑
          </text>
          <foreignObject x={textX} y={destY - 18} width={W - textX - 28} height={64}>
            <p className="l-dest" title={map.body.destination}>
              {map.body.destination}
            </p>
          </foreignObject>
        </svg>
      </div>
    </div>
  )
}

function Section({ y, label }: { y: number; label: string }) {
  return (
    <>
      <line x1="24" y1={y} x2={W - 24} y2={y} stroke="var(--proto-hairline)" />
      <text x="26" y={y + 16} className="l-caption">
        {label}
      </text>
    </>
  )
}
