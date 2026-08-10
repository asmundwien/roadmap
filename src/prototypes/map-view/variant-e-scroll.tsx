/**
 * PROTOTYPE — throwaway. Variant E: the scroll.
 *
 * The itinerary strip map (Matthew Paris, Ogilby): one ribbon read bottom-to-top toward a pinned
 * destination. The road behind is solid and runs through the stops already made — the decisions,
 * gists on hover. The road ahead is dashed; stops that share a rung are parallel, a blocked stop
 * says what it waits behind. Past the last charted stop the scroll simply is not drawn: a torn
 * edge, fog, and the destination vignette floating beyond it.
 *
 * Deliberately typographic where D is geometric — this take bets the ribbon's single axis carries
 * the journey without any graph at all.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { MapHead, STATE_META } from './chrome.tsx'
import { layerMap } from './layout.ts'
import type { VariantProps } from './variants.ts'

export const NAME = 'The scroll'

function jitter(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

export function VariantE({ map }: VariantProps) {
  const { closed, ahead } = layerMap(map)
  const gistByTitle = new Map(map.body.decisions.map((d) => [d.title, d.gist]))

  // Read bottom-to-top: the DOM renders the far end first, the journey's start last.
  const rungsAhead = [...ahead]
    .map((layer) => [...layer].sort((a, b) => a.number - b.number))
    .reverse()
  const walkedNewestFirst = [...closed].reverse()

  return (
    <div className="e-wrap">
      <MapHead map={map} />
      <div className="e-col">
        <div className="e-dest">
          <span className="e-flag" aria-hidden="true">
            ⚑
          </span>
          <p>{map.body.destination}</p>
        </div>

        <div className="e-fogzone" title="Uncharted — the scroll is not drawn here yet">
          {map.body.notYetSpecified.map((item, i) => (
            <span
              key={item}
              className="e-fog-patch"
              title={item}
              style={{
                left: `${12 + ((i * 0.618 + 0.3) % 1) * 60}%`,
                top: `${18 + ((jitter(i + 5) + 1) / 2) * 46}%`,
                width: `${7 + ((jitter(i + 11) + 1) / 2) * 5}rem`,
              }}
            />
          ))}
        </div>

        <div className="e-scroll">
          <section className="e-ahead">
            {rungsAhead.map((rung) => (
              <div key={rung.map((t) => t.number).join('-')} className="e-rung">
                {rung.map((ticket) => (
                  <Stop key={ticket.number} ticket={ticket} />
                ))}
              </div>
            ))}
          </section>

          <div className="e-you">
            <span aria-hidden="true">▲</span> you are here
          </div>

          <section className="e-walked">
            {walkedNewestFirst.map((ticket) => (
              <a
                key={ticket.number}
                className="e-stop-walked"
                href={ticket.url}
                title={
                  gistByTitle.has(ticket.title)
                    ? `${ticket.title} — ${gistByTitle.get(ticket.title)}`
                    : ticket.title
                }
              >
                <i aria-hidden="true">●</i>
                <span>{ticket.title}</span>
              </a>
            ))}
            <div className="e-setout">set out</div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Stop({ ticket }: { ticket: Ticket }) {
  const meta = STATE_META[ticket.state]
  const login = ticket.assignees[0]?.login
  const waits = ticket.blockedBy.filter((b) => b.isOpen)

  return (
    <a className={`e-stop is-${ticket.state}`} href={ticket.url}>
      <i aria-hidden="true" style={{ color: meta.color }}>
        {meta.glyph}
      </i>
      <span className="e-stop-title">{ticket.title}</span>
      <span className="e-stop-word" style={{ color: meta.color }}>
        {meta.word}
        {login !== undefined ? ` · ${login}` : ''}
      </span>
      {waits.length > 0 && (
        <span className="e-stop-waits" title={waits.map((b) => b.title).join(', ')}>
          after {waits[0]?.title}
          {waits.length > 1 ? ` +${waits.length - 1}` : ''}
        </span>
      )}
    </a>
  )
}
