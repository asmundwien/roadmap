import { useMemo, useSyncExternalStore } from 'react'

/**
 * Hash routing, hand-rolled. Two screens don't justify a router dependency, and hash URLs keep
 * `pnpm dev` and `pnpm preview` working with zero server configuration. If the app grows past
 * this, swapping in a real router is contained to this file and the links built from the hash
 * builders below.
 *
 * The project is the unit of navigation: `#/owner/repo` opens a project on its active map, and
 * `#/owner/repo/<n>` pins a specific map so the selection survives a refresh.
 */
export type Route =
  | { screen: 'projects' }
  | { screen: 'project'; owner: string; repo: string; selected: number | null }

const PROJECTS: Route = { screen: 'projects' }

/** Anything that doesn't parse falls back to the project list — a bad URL is not an error state. */
export function parseHash(hash: string): Route {
  const match = /^#\/([^/]+)\/([^/]+)(?:\/(\d+))?$/.exec(hash)
  if (!match) return PROJECTS
  const [, owner, repo, number] = match
  if (!owner || !repo) return PROJECTS
  return { screen: 'project', owner, repo, selected: number ? Number(number) : null }
}

/** The project on its active map — where a selection is not worth pinning. */
export function projectHash(project: { owner: string; repo: string }): string {
  return `#/${project.owner}/${project.repo}`
}

/** The project with one map pinned open, so the selection survives a refresh. */
export function mapHash(map: { owner: string; repo: string; number: number }): string {
  return `#/${map.owner}/${map.repo}/${map.number}`
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
