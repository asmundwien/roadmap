/**
 * PROTOTYPE — throwaway. Variant A: the subway map.
 *
 * Space is topology. Left to right is dependency order: the ground already covered in one band, then
 * a column per remaining layer of open blockers, then the fog. The frontier is the first open column
 * and it glows, so "what can I take" is a *position* on the page rather than something you look up.
 * Parallel tracks read as parallel rows; a chain reads as a run of columns.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { MapHead, StateGlyph } from './chrome.tsx'
import { layerMap } from './layout.ts'
import type { VariantProps } from './variants.ts'

export const NAME = 'Subway map'

export function VariantA({ map }: VariantProps) {
  const { closed, ahead, byNumber } = layerMap(map)
  const bands = ahead.map((layer, depth) => ({
    key: layer.map((t) => t.number).join('-'),
    title: depth === 0 ? 'The frontier' : `${depth} step${depth > 1 ? 's' : ''} beyond`,
    layer,
  }))

  return (
    <div>
      <MapHead map={map} />
      <div className="a-scroll">
        <div className="a-rail">
          <section className="a-band">
            <div className="a-band-title">Travelled · {closed.length} decided</div>
            {closed.map((ticket) => (
              <Station key={ticket.number} ticket={ticket} />
            ))}
          </section>

          {bands.map((band) => (
            <section className="a-band" key={band.key}>
              <div className="a-band-title">{band.title}</div>
              {band.layer.map((ticket) => (
                <div key={ticket.number}>
                  <Station ticket={ticket} />
                  {ticket.isBlocked && (
                    <div className="a-waits">
                      waits on{' '}
                      {ticket.blockedBy
                        .filter((b) => b.isOpen)
                        .map((b) => byNumber.get(b.number)?.title ?? `#${b.number}`)
                        .join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}

          <section className="a-band a-fog">
            <div className="a-band-title">Fog</div>
            <ul>
              {map.body.notYetSpecified.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function Station({ ticket }: { ticket: Ticket }) {
  return (
    <a className={`a-station is-${ticket.state}`} href={ticket.url}>
      <StateGlyph state={ticket.state} />
      <span>
        {ticket.title}
        <br />
        <span className="a-num">
          #{ticket.number} · {ticket.type}
          {ticket.assignees[0] && ` · ${ticket.assignees[0].login}`}
        </span>
      </span>
    </a>
  )
}
