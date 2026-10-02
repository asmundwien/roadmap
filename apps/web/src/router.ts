import type { ProjectKey, WayfinderMap } from '@roadmap/contracts'
import { useMemo, useSyncExternalStore } from 'react'

/**
 * Hash routing, hand-rolled. These screens still do not justify a router dependency, and hash URLs
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
  | { screen: 'project-registration'; project: ProjectKey }
  | { screen: 'connection-settings' }
  | { screen: 'connection'; connectionId: string }
  | { screen: 'project-import'; connectionId: string }
  | { screen: 'components' }
  | {
      screen: 'project'
      project: ProjectKey
      selected: string | null
      selection: PanelSelection | null
    }

/**
 * The Panel's pick as the hash carries it. Fog patches and scope entries travel as list indices.
 * The map screen resolves those indices against the live snapshot on every render.
 */
export type PanelSelection =
  | { kind: 'map' }
  | { kind: 'ticket'; id: string }
  | { kind: 'fog'; index: number }
  | { kind: 'scope'; index: number }
  | { kind: 'scope-all' }

const PROJECTS: Route = { screen: 'projects' }
export const overviewHash = '#/'
export function projectRegistrationHash(project: ProjectKey): string {
  return `#/settings/projects/${project.integration}/${encodePart(project.id)}`
}
export const connectionSettingsHash = '#/settings/connections'
export function connectionHash(connectionId: string): string {
  return `${connectionSettingsHash}/${encodePart(connectionId)}`
}
export function projectImportHash(connectionId: string): string {
  return `${connectionHash(connectionId)}/import`
}
export const componentsHash = '#/components'

function parseConnectionRoute(hash: string): Route | null {
  const match = /^#\/settings\/connections\/([^/]+)$/.exec(hash)
  if (!match) return null
  const connectionId = decodePart(match[1])
  return connectionId === null ? PROJECTS : { screen: 'connection', connectionId }
}
function parseProjectImportRoute(hash: string): Route | null {
  const match = /^#\/settings\/connections\/([^/]+)\/import$/.exec(hash)
  if (!match) return null
  const connectionId = decodePart(match[1])
  return connectionId === null ? PROJECTS : { screen: 'project-import', connectionId }
}

function parseProjectRegistrationRoute(hash: string): Route | null {
  const match = /^#\/settings\/projects\/([^/]+)\/([^/]+)$/.exec(hash)
  if (!match) return null
  const project = parseProjectKey(match[1], match[2])
  return project ? { screen: 'project-registration', project } : PROJECTS
}

/** Anything that doesn't parse falls back to the project list — a bad URL is not an error state. */
export function parseHash(hash: string): Route {
  if (hash === connectionSettingsHash) return { screen: 'connection-settings' }
  const settingsRoute =
    parseProjectRegistrationRoute(hash) ??
    parseProjectImportRoute(hash) ??
    parseConnectionRoute(hash)
  if (settingsRoute) return settingsRoute
  if (hash === componentsHash) return { screen: 'components' }
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
