import type { WayfinderMap } from '@roadmap/contracts'
import { deriveMapSignal, describeMapSignal } from './map-signal.ts'

/**
 * The progress signal: a strip of what's decided and what's open (same-hue meter, darker =
 * decided), then the fog past the charted edge as a textured gray tail — a different mark, not a
 * third segment, because fog counts patches rather than tickets. The counts are always written
 * out beside it, so the colors never carry the numbers alone.
 */
export function SignalMeter({ map }: { map: WayfinderMap }) {
  const signal = deriveMapSignal(map)
  const label = describeMapSignal(signal)
  const empty = signal.decided + signal.open + signal.fog === 0

  return (
    <div className="signal">
      {!empty && (
        <div className="signal-strip" role="img" aria-label={label}>
          {signal.decided > 0 && (
            <span className="signal-decided" style={{ flexGrow: signal.decided }} />
          )}
          {signal.open > 0 && <span className="signal-open" style={{ flexGrow: signal.open }} />}
          {signal.fog > 0 && <span className="signal-fog" style={{ flexGrow: signal.fog }} />}
        </div>
      )}
      <span className="signal-caption">
        {label}
        {map.ticketsTruncated && ' · partial'}
      </span>
    </div>
  )
}
