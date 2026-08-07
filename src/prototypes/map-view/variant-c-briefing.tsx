/**
 * PROTOTYPE — throwaway. Variant C: the briefing.
 *
 * The argument against drawing a graph at all. A map's real question is "what do I take next", and a
 * DAG answers it slowly — you have to find the frontier before you can read it. So: no geometry.
 * Takeable work is the whole top of the page, dependency chains collapse to a "waits on" phrase, and
 * progress is a single segmented meter. Everything else is a log, read newest-first.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { MapHead, STATE_META, StateGlyph } from './chrome.tsx'
import { layerMap } from './layout.ts'
import type { VariantProps } from './variants.ts'

export const NAME = 'Briefing (no graph)'

export function VariantC({ map }: VariantProps) {
  const { byNumber } = layerMap(map)
  const frontier = map.tickets.filter((t) => t.state === 'frontier')
  const claimed = map.tickets.filter((t) => t.state === 'claimed')
  const blocked = map.tickets.filter((t) => t.state === 'blocked')

  return (
    <div>
      <MapHead map={map}>
        <Meter map={map} />
      </MapHead>

      <div className="c-wrap">
        <div>
          <section className="c-section">
            <h2>Take one of these</h2>
            {frontier.length === 0 && (
              <p className="muted">Nothing takeable — every open ticket waits on another.</p>
            )}
            {frontier.map((ticket) => (
              <a className="c-take" key={ticket.number} href={ticket.url}>
                <div className="title">{ticket.title}</div>
                <div className="meta">
                  #{ticket.number} · {ticket.type} · unblocks {unblocks(ticket, map.tickets)}
                </div>
              </a>
            ))}
          </section>

          {claimed.length > 0 && (
            <section className="c-section">
              <h2>In hand</h2>
              <ul>
                {claimed.map((ticket) => (
                  <li className="c-row" key={ticket.number}>
                    <StateGlyph state="claimed" />
                    <span>
                      <a href={ticket.url}>{ticket.title}</a>
                      <span className="waits">
                        {' '}
                        — {ticket.assignees.map((a) => a.login).join(', ') || 'assigned'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="c-section">
            <h2>Waiting · {blocked.length}</h2>
            <ul>
              {blocked.map((ticket) => (
                <li className="c-row" key={ticket.number}>
                  <StateGlyph state="blocked" />
                  <span>
                    <a href={ticket.url}>{ticket.title}</a>
                    <br />
                    <span className="waits">
                      waits on{' '}
                      {ticket.blockedBy
                        .filter((b) => b.isOpen)
                        .map((b) => byNumber.get(b.number)?.title ?? `#${b.number}`)
                        .join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div>
          <section className="c-section">
            <h2>Decided · {map.body.decisions.length}</h2>
            {[...map.body.decisions].reverse().map((decision) => (
              <div className="c-decision" key={decision.title}>
                <a href={decision.url ?? map.url}>
                  <strong>{decision.title}</strong>
                </a>
                <div className="gist">{decision.gist}</div>
              </div>
            ))}
          </section>

          <section className="c-section c-fog">
            <h2>Fog · not yet specified</h2>
            <ul>
              {map.body.notYetSpecified.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="c-section c-fog">
            <h2>Out of scope</h2>
            <ul>
              {map.body.outOfScope.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function Meter({ map }: VariantProps) {
  const order = ['closed', 'claimed', 'frontier', 'blocked'] as const
  const counts = order.map((state) => ({
    state,
    n: map.tickets.filter((t) => t.state === state).length,
  }))

  return (
    <div>
      <div className="c-meter">
        {counts
          .filter((c) => c.n > 0)
          .map((c) => (
            <div
              key={c.state}
              style={{
                flex: c.n,
                background: STATE_META[c.state].color,
                opacity: c.state === 'closed' ? 0.55 : 1,
              }}
            />
          ))}
      </div>
      <div className="repo">
        {map.progress.completed} of {map.progress.total} decided · {map.body.notYetSpecified.length}{' '}
        patches of fog still uncharted
      </div>
    </div>
  )
}

/** How much a ticket is holding up — the only argument for taking one frontier ticket over another. */
function unblocks(ticket: Ticket, all: readonly Ticket[]): string {
  const downstream = all.filter((t) =>
    t.blockedBy.some((b) => b.isOpen && b.number === ticket.number),
  )
  if (downstream.length === 0) return 'nothing downstream'
  if (downstream.length === 1) return downstream[0]?.title ?? '1 ticket'
  return `${downstream.length} tickets`
}
