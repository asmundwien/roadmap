/**
 * PROTOTYPE — throwaway. Variant L: the unified ledger — K's grammar carried through the whole map.
 *
 * One left-aligned gutter-and-text system in three sections — fog, charted ahead, ground covered —
 * with the trunk's rail passing through all of them, solid behind and dashed ahead. Everything
 * obeys one scale: every node is the same 9px-radius family (closed a filled dot with a check, the
 * goal an amber dot with a flag, claimed half-filled, blocked hollow, takeable a diamond in a
 * glow), every section has the same padding rhythm and 52px row pitch, and every word — titles,
 * gists, captions, the destination — lives in the same text column. The destination block sizes
 * itself to its text, so the fog section starts below it rather than under it.
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
const ROW_H = 52
const SEC_PAD = 44
const SEC_BOTTOM = 28
const PAD_TOP = 20
const PAD_BOTTOM = 44
const BEND = 40
const DEST_LINE_H = 21

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

  // Lane 0 is the trunk's own lane: the heaviest chain forked off HEAD continues it, so merges
  // pull toward the trunk. Tributaries take lanes rightward, heaviest first.
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

  // The vertical frame, top to bottom: destination, fog, charted ahead, ground covered — every
  // section with the same rhythm: SEC_PAD to its first row, ROW_H pitch, SEC_BOTTOM after its last.
  const colWidth = W - textX - 28
  const destLines = Math.min(
    4,
    Math.max(2, Math.ceil(map.body.destination.length / (colWidth / 7.4))),
  )
  const destTextTop = PAD_TOP + 28
  const destY = destTextTop + 10
  const sepFog = destTextTop + destLines * DEST_LINE_H + 26

  const fogItems = map.body.notYetSpecified
  const ghostY = (i: number) => sepFog + SEC_PAD + i * ROW_H
  const sepAhead =
    sepFog + (fogItems.length > 0 ? SEC_PAD + (fogItems.length - 1) * ROW_H + SEC_BOTTOM : 56)

  const sepBehind =
    sepAhead + (ordered.length > 0 ? SEC_PAD + (ordered.length - 1) * ROW_H + SEC_BOTTOM : 56)
  const rowY = (i: number) => sepBehind - SEC_BOTTOM - i * ROW_H

  const behindY = (j: number) => sepBehind + SEC_PAD + j * ROW_H
  const height =
    sepBehind +
    (closed.length > 0 ? SEC_PAD + (closed.length - 1) * ROW_H + SEC_BOTTOM : 56) +
    PAD_BOTTOM

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
          aria-label={`The ledger of ${map.title}: fog, charted ahead, and ground covered, on one rail`}
        >
          <title>{map.title}</title>

          {/* section boundaries — captions live in the text column like every other word */}
          <Section y={sepFog} label="fog · not yet specified" textX={textX} />
          <Section y={sepAhead} label="charted ahead" textX={textX} />
          <Section y={sepBehind} label="ground covered" textX={textX} />

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
          {closed.length > 0 && (
            <line
              x1={GX}
              y1={head.y}
              x2={GX}
              y2={behindY(closed.length - 1) + ROW_H * 0.6}
              stroke="var(--proto-ink)"
              strokeOpacity="0.55"
              strokeWidth="2.5"
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

          {/* ground covered — the same grammar, already walked: a check, and what was won */}
          {behindNewestFirst.map((ticket, j) => {
            const gist = gistByTitle.get(ticket.title)
            return (
              <a key={ticket.number} href={ticket.url}>
                <title>
                  {ticket.title}
                  {gist !== undefined ? ` — ${gist}` : ''}
                </title>
                <circle cx={GX} cy={behindY(j)} r="10" fill="var(--proto-ink)" />
                <text x={GX} y={behindY(j) + 3.5} textAnchor="middle" className="l-check">
                  ✓
                </text>
                <text x={textX} y={behindY(j) + 4} className="l-behind-title">
                  {truncate(ticket.title, 46)}
                </text>
                <text x={textX} y={behindY(j) + 19} className="l-behind-gist">
                  {gist !== undefined ? truncate(gist, 76) : 'decided'}
                </text>
              </a>
            )
          })}

          {/* fog rows — ghost stops: suspected, dim, unconnected, readable */}
          {fogItems.map((item, i) => {
            const gx = GX + ((i * 0.618 + 0.35) % 1) * (laneCount - 1) * PITCH
            return (
              <g key={item}>
                <title>{item}</title>
                <circle
                  cx={gx}
                  cy={ghostY(i)}
                  r="9"
                  fill="none"
                  stroke="var(--proto-muted)"
                  strokeWidth="1.75"
                  strokeDasharray="2.5 4"
                  strokeOpacity="0.7"
                />
                <text x={textX} y={ghostY(i) + 4} className="l-fog-title">
                  {truncate(item, 52)}
                </text>
              </g>
            )
          })}

          {/* the destination — the trunk's final stop, and the one warm thing on the map */}
          <circle cx={GX} cy={destY} r="18" fill="var(--proto-goal)" fillOpacity="0.18" />
          <text x={GX} y={destY + 7} textAnchor="middle" className="l-flag">
            ⚑
          </text>
          <text x={textX} y={PAD_TOP + 14} className="l-goal-caption">
            the destination
          </text>
          <foreignObject
            x={textX}
            y={destTextTop}
            width={colWidth}
            height={destLines * DEST_LINE_H + 8}
          >
            <p className="l-dest" title={map.body.destination}>
              {map.body.destination}
            </p>
          </foreignObject>
        </svg>
      </div>
    </div>
  )
}

function Section({ y, label, textX }: { y: number; label: string; textX: number }) {
  return (
    <>
      <line x1="24" y1={y} x2={W - 24} y2={y} stroke="var(--proto-hairline)" />
      <text x={textX} y={y + 18} className="l-caption">
        {label}
      </text>
    </>
  )
}
