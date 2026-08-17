import type { WayfinderMap } from '@roadmap/contracts'
import type { ResolvedSelection } from '../../router.ts'
import { stripInlineMarkdown } from '../gist.ts'
import { buildLedger } from './geometry.ts'

/** What a click on the map means — everything the Panel can show except the map's own prose. */
export type LedgerSelection = Exclude<ResolvedSelection, { kind: 'map' }>

/** Past this, inline ⊘ stops give way to the one aggregate stop. */
export const SCOPE_INLINE_MAX = 3

/** The shared out-of-scope display decision: inline items, or the one aggregate stop, and the
 * fog-extended map that geometry lays out. One computation feeds render and sequence alike. */
export interface ScopePlan {
  aggregated: boolean
  aggLabel: string
  scopeSet: Set<string>
  fogMap: WayfinderMap
}

export function scopePlan(map: WayfinderMap): ScopePlan {
  const scopeItems = map.body.outOfScope.map(stripInlineMarkdown)
  const aggregated = scopeItems.length > SCOPE_INLINE_MAX
  const aggLabel = `left off the map · ${scopeItems.length} things`
  const scopeSet = new Set(aggregated ? [] : scopeItems)
  const scopeDisplay = aggregated ? [aggLabel] : scopeItems
  const fogMap =
    scopeDisplay.length === 0
      ? map
      : {
          ...map,
          body: { ...map.body, notYetSpecified: [...scopeDisplay, ...map.body.notYetSpecified] },
        }
  return { aggregated, aggLabel, scopeSet, fogMap }
}

/**
 * Every clickable stop on the map in on-screen top-to-bottom order — what the Panel's prev/next
 * buttons walk. Derived from the same geometry the render uses (sorted by row y), so the order
 * always matches the picture.
 */
export function ledgerSequence(map: WayfinderMap): LedgerSelection[] {
  const { aggregated, aggLabel, scopeSet, fogMap } = scopePlan(map)
  const ledger = buildLedger(fogMap)
  const entries: { y: number; sel: LedgerSelection }[] = [
    ...ledger.fogRows.map(({ item, y }) => ({
      y,
      sel:
        aggregated && item === aggLabel
          ? { kind: 'scope-all' as const }
          : scopeSet.has(item)
            ? { kind: 'scope' as const, text: item }
            : { kind: 'fog' as const, text: item },
    })),
    ...ledger.rows.map(({ ticket, y }) => ({
      y,
      sel: { kind: 'ticket' as const, number: ticket.number },
    })),
    ...ledger.closedRows.map(({ ticket, y }) => ({
      y,
      sel: { kind: 'ticket' as const, number: ticket.number },
    })),
  ]
  return entries.sort((a, b) => a.y - b.y).map((entry) => entry.sel)
}
