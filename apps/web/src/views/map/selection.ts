import type { WayfinderMap } from '@roadmap/contracts'
import type { PanelSelection } from '@/router'
import { stripInlineMarkdown } from '@/views/shared/gist'

/** The pick resolved against a live map: fog and scope entries carry their text. */
export type ResolvedSelection =
  | { kind: 'map' }
  | { kind: 'ticket'; id: string }
  | { kind: 'fog'; text: string }
  | { kind: 'scope'; text: string }
  | { kind: 'scope-all' }

/**
 * Resolve the hash's pick against the live map. A vanished ticket or an index past the list's
 * end is no selection, not an error. A snapshot replace may have removed the item from the map.
 */
export function resolveSelection(
  map: WayfinderMap,
  selection: PanelSelection,
): ResolvedSelection | null {
  switch (selection.kind) {
    case 'map':
    case 'scope-all':
      return selection
    case 'ticket':
      return map.tickets.some((ticket) => ticket.id === selection.id) ? selection : null
    case 'fog': {
      const text = map.body.notYetSpecified.map(stripInlineMarkdown)[selection.index]
      return text !== undefined ? { kind: 'fog', text } : null
    }
    case 'scope': {
      const text = map.body.outOfScope.map(stripInlineMarkdown)[selection.index]
      return text !== undefined ? { kind: 'scope', text } : null
    }
  }
}

/**
 * The inverse of `resolveSelection`: a clicked item back into the index form the hash carries.
 * Returns null when the item's text is no longer on the map. A snapshot replace can race a click,
 * and a pick that can't be named honestly is not written at all.
 */
export function encodeSelection(map: WayfinderMap, item: ResolvedSelection): PanelSelection | null {
  switch (item.kind) {
    case 'map':
    case 'scope-all':
    case 'ticket':
      return item
    case 'fog': {
      const index = map.body.notYetSpecified.map(stripInlineMarkdown).indexOf(item.text)
      return index !== -1 ? { kind: 'fog', index } : null
    }
    case 'scope': {
      const index = map.body.outOfScope.map(stripInlineMarkdown).indexOf(item.text)
      return index !== -1 ? { kind: 'scope', index } : null
    }
  }
}

/**
 * Swap the current hash without growing history. The accordion re-pins its selection on every
 * toggle, and stepping back through each fold would make the back button useless. replaceState
 * fires no hashchange, so dispatch the event to keep `useRoute` subscribers live.
 */
export function replaceHash(hash: string): void {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
