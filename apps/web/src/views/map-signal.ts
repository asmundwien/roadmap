import type { WayfinderMap } from '@roadmap/contracts'

/**
 * The numbers behind a map's progress signal: what's decided, what's still open, and how much
 * fog lies past the charted edge. Decided and open count tickets; fog counts the map's
 * Not-yet-specified patches — a coarser unit, which is why views draw it as a different mark
 * rather than a fourth ticket state.
 */
export interface MapSignal {
  decided: number
  open: number
  fog: number
}

export function deriveMapSignal(map: WayfinderMap): MapSignal {
  const decided = map.progress.completed
  return {
    decided,
    open: Math.max(0, map.progress.total - decided),
    fog: map.body.notYetSpecified.length,
  }
}

/** One line of prose for the signal, used as its label and its accessible name. */
export function describeMapSignal(signal: MapSignal): string {
  const parts = [
    `${signal.decided} decided`,
    `${signal.open} open`,
    signal.fog > 0 ? `${signal.fog} in fog` : null,
  ]
  return parts.filter((part) => part !== null).join(' · ')
}
