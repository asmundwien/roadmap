import type { ProjectKey, WayfinderMap } from '@roadmap/contracts'
import { useMemo, useSyncExternalStore } from 'react'
import { stripInlineMarkdown } from './views/gist.ts'

/**
 * Hash routing, hand-rolled. Five screens still do not justify a router dependency, and hash URLs
 * keep `pnpm dev` and `pnpm preview` working with zero server configuration. If the app grows past
 * this, swapping in a real router is contained to this file and the links built from the hash
 * builders below.
 *
 * The project is the unit of navigation: `#/projects/<integration>/<project-id>` opens a project
 * on its active map, and `.../maps/<map-id>` pins a specific map so the selection survives a
 * refresh. The pinned map may carry one more segment naming the Panel's item — `/map`,
 * `/ticket/<id>`, `/fog/<i>`, `/scope/<i>`, or `/scope-all` — so the hash is the ONLY store of
 * what the Panel shows.
 */
export type Route =
  | { screen: 'projects' }
  | { screen: 'project-settings' }
  | { screen: 'connection-settings' }
  | { screen: 'automation-settings' }
  | {
      screen: 'project'
      project: ProjectKey
      selected: string | null
      selection: PanelSelection | null
    }

/**
 * The Panel's pick as the hash carries it. Fog patches and scope entries are title-less body
 * bullets, so they travel as list indices and resolve back to text against the live snapshot on
 * every render (`resolveSelection`) — never a stored object.
 */
export type PanelSelection =
  | { kind: 'map' }
  | { kind: 'ticket'; id: string }
  | { kind: 'fog'; index: number }
  | { kind: 'scope'; index: number }
  | { kind: 'scope-all' }

/** The pick resolved against a live map: fog and scope entries carry their text. */
export type ResolvedSelection =
  | { kind: 'map' }
  | { kind: 'ticket'; id: string }
  | { kind: 'fog'; text: string }
  | { kind: 'scope'; text: string }
  | { kind: 'scope-all' }

const PROJECTS: Route = { screen: 'projects' }
export const overviewHash = '#/'
export const projectSettingsHash = '#/settings/projects'
export const connectionSettingsHash = '#/settings/connections'
export const automationSettingsHash = '#/settings/automation'

/** Anything that doesn't parse falls back to the project list — a bad URL is not an error state. */
export function parseHash(hash: string): Route {
  if (hash === projectSettingsHash) return { screen: 'project-settings' }
  if (hash === connectionSettingsHash) return { screen: 'connection-settings' }
  if (hash === automationSettingsHash) return { screen: 'automation-settings' }
  const bare = /^#\/projects\/([^/]+)\/([^/]+)$/.exec(hash)
  if (bare) {
    const project = parseProjectKey(bare[1], bare[2])
    if (!project) return PROJECTS
    return {
      screen: 'project',
      project,
      selected: null,
      selection: null,
    }
  }

  const pinned = /^#\/projects\/([^/]+)\/([^/]+)\/maps\/([^/]+)(\/.+)?$/.exec(hash)
  if (!pinned) return PROJECTS
  const [, integration, projectId, mapId, rest] = pinned
  if (!mapId) return PROJECTS
  const project = parseProjectKey(integration, projectId)
  const decodedMap = decodePart(mapId)
  if (!project || decodedMap === null) return PROJECTS
  if (rest === undefined) {
    return {
      screen: 'project',
      project,
      selected: decodedMap,
      selection: null,
    }
  }
  const selection = parseSelection(rest)
  if (selection === null) return PROJECTS
  return {
    screen: 'project',
    project,
    selected: decodedMap,
    selection,
  }
}

function parseProjectKey(
  integration: string | undefined,
  encodedId: string | undefined,
): ProjectKey | null {
  if (!encodedId || (integration !== 'github' && integration !== 'local')) return null
  const id = decodePart(encodedId)
  return id === null ? null : { integration, id }
}

function parseSelection(rest: string): PanelSelection | null {
  if (rest === '/map') return { kind: 'map' }
  if (rest === '/scope-all') return { kind: 'scope-all' }
  const indexed = /^\/(fog|scope)\/(\d+)$/.exec(rest)
  if (indexed) {
    const [, kind, digits] = indexed
    if (!kind || !digits) return null
    const value = Number(digits)
    return kind === 'fog' ? { kind: 'fog', index: value } : { kind: 'scope', index: value }
  }
  const ticket = /^\/ticket\/([^/]+)$/.exec(rest)
  if (!ticket) return null
  const decoded = decodePart(ticket[1])
  return decoded === null ? null : { kind: 'ticket', id: decoded }
}

/** The project on its active map — where a selection is not worth pinning. */
export function projectHash(project: ProjectKey): string {
  return `#/projects/${project.integration}/${encodePart(project.id)}`
}

/** The project with one map pinned open, so the selection survives a refresh. */
export function mapHash(map: Pick<WayfinderMap, 'project' | 'id'>): string {
  return `${projectHash(map.project)}/maps/${encodePart(map.id)}`
}

/** The pinned map with one item picked open in the Panel. */
export function selectionHash(
  map: Pick<WayfinderMap, 'project' | 'id'>,
  selection: PanelSelection,
): string {
  const base = mapHash(map)
  switch (selection.kind) {
    case 'map':
      return `${base}/map`
    case 'scope-all':
      return `${base}/scope-all`
    case 'ticket':
      return `${base}/ticket/${encodePart(selection.id)}`
    case 'fog':
      return `${base}/fog/${selection.index}`
    case 'scope':
      return `${base}/scope/${selection.index}`
  }
}

/**
 * Resolve the hash's pick against the live map. Anything that doesn't resolve — a vanished
 * ticket, an index past the list's end — is no selection, not an error: a snapshot replace may
 * legitimately have pulled the item out from under the URL.
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
 * Null when the item's text is no longer on the map — a snapshot replace can race a click, and a
 * pick that can't be named honestly is not written at all.
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
 * Swap the current hash without growing history — the accordion re-pins its selection on every
 * toggle, and stepping back through each fold would make the back button useless. replaceState
 * fires no hashchange, so the event is dispatched by hand to keep `useRoute` subscribers live.
 */
export function replaceHash(hash: string): void {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
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

function encodePart(value: string): string {
  return encodeURIComponent(value)
}

function decodePart(value: string | undefined): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
