/**
 * PROTOTYPE — throwaway. Chain decomposition for the git-history takes (H / J / K).
 *
 * The research verdict (docs/research/commit-graph-layouts.md on research/commit-graph-layouts):
 * legibility comes from lane discipline — branches own persistent rails, and a merge sits ON the
 * rail of its heaviest incoming chain while the other rails visibly retire into it. This module
 * turns the ahead-of-HEAD DAG into those chains, deterministically: same map, same chains.
 */

import type { Ticket, WayfinderMap } from '../../wayfinder/types.ts'
import { layerMap, orderLayers } from './layout.ts'

export interface Chain {
  id: number
  /** In depth order — the first ticket is where the rail begins. */
  tickets: Ticket[]
  /** Ticket number the chain forks from; null means it forks off HEAD. */
  forkFrom: number | null
}

export interface ChainWork {
  closed: Ticket[]
  /** Ordered layers of open tickets, the deterministic processing order. */
  layers: Ticket[][]
  chains: Chain[]
  chainOf: Map<number, Chain>
  depthOf: Map<number, number>
  /** How many open tickets transitively wait on this one — the "weight" tiebreaker. */
  descCount: Map<number, number>
}

export function decomposeChains(map: WayfinderMap): ChainWork {
  const { closed, ahead, depthOf } = layerMap(map)
  const layers = orderLayers(ahead)
  const open = layers.flat()
  const openNumbers = new Set(open.map((t) => t.number))

  const dependents = new Map<number, number[]>()
  for (const t of open) {
    for (const b of t.blockedBy) {
      if (!b.isOpen || !openNumbers.has(b.number)) continue
      dependents.set(b.number, [...(dependents.get(b.number) ?? []), t.number])
    }
  }
  const descCount = new Map<number, number>()
  for (const t of open) {
    const seen = new Set<number>()
    const walk = (n: number) => {
      for (const k of dependents.get(n) ?? []) {
        if (!seen.has(k)) {
          seen.add(k)
          walk(k)
        }
      }
    }
    walk(t.number)
    descCount.set(t.number, seen.size)
  }

  const chains: Chain[] = []
  const chainOf = new Map<number, Chain>()
  const tipOf = new Map<Chain, number>()

  const weightOf = (chain: Chain): number =>
    chain.tickets.length + (descCount.get(tipOf.get(chain) ?? -1) ?? 0)

  for (const layer of layers) {
    for (const ticket of layer) {
      const openBlockers = ticket.blockedBy.filter((b) => b.isOpen && openNumbers.has(b.number))
      // A rail is free to continue only while the blocker is still its tip.
      const candidates = openBlockers
        .map((b) => chainOf.get(b.number))
        .filter(
          (c): c is Chain => c !== undefined && openBlockers.some((b) => b.number === tipOf.get(c)),
        )
      const unique = [...new Set(candidates)]
      unique.sort((a, b) => weightOf(b) - weightOf(a) || a.id - b.id)
      const surviving = unique[0]
      if (surviving) {
        surviving.tickets.push(ticket)
        chainOf.set(ticket.number, surviving)
        tipOf.set(surviving, ticket.number)
      } else {
        const chain: Chain = {
          id: chains.length,
          tickets: [ticket],
          forkFrom: openBlockers[0]?.number ?? null,
        }
        chains.push(chain)
        chainOf.set(ticket.number, chain)
        tipOf.set(chain, ticket.number)
      }
    }
  }

  return { closed, layers, chains, chainOf, depthOf, descCount }
}

/** The chain's weight once decomposition is done — tickets carried plus what waits on its head. */
export function chainWeight(chain: Chain, descCount: Map<number, number>): number {
  const first = chain.tickets[0]
  return chain.tickets.length + (first ? (descCount.get(first.number) ?? 0) : 0)
}
