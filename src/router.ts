import { useMemo, useSyncExternalStore } from 'react'

/**
 * Hash routing, hand-rolled. Two screens don't justify a router dependency, and hash URLs keep
 * `pnpm dev` and `pnpm preview` working with zero server configuration. If the app grows past
 * this, swapping in a real router is contained to this file and the links built from `mapHash`.
 */
export type Route =
  | { screen: 'projects' }
  | { screen: 'map'; owner: string; repo: string; number: number }

const PROJECTS: Route = { screen: 'projects' }

/** Anything that doesn't parse falls back to the project list — a bad URL is not an error state. */
export function parseHash(hash: string): Route {
  const match = /^#\/map\/([^/]+)\/([^/]+)\/(\d+)$/.exec(hash)
  if (!match) return PROJECTS
  const [, owner, repo, number] = match
  if (!owner || !repo || !number) return PROJECTS
  return { screen: 'map', owner, repo, number: Number(number) }
}

export function mapHash(map: { owner: string; repo: string; number: number }): string {
  return `#/map/${map.owner}/${map.repo}/${map.number}`
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getHash(): string {
  return window.location.hash
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash)
  return useMemo(() => parseHash(hash), [hash])
}
