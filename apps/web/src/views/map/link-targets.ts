import type { TicketId } from '@roadmap/contracts/identity'
import type { MapResource, TicketResource } from '@roadmap/contracts/state'
import { resourceObservation } from '@/resources/results'

export type ProseLinkTarget =
  | { kind: 'selection'; selection: { kind: 'map' } | { kind: 'ticket'; id: TicketId } }
  | { kind: 'href'; href: string }
  | { kind: 'disabled'; reason: string }

const LOCAL_LINK_DISABLED =
  'Local file links stay inside Roadmap only when they point at this map or one of its tickets.'

/**
 * Resolves one markdown href in the context of a specific map file or ticket file.
 *
 * Local same-map links open the map or a ticket; other local relative links are visibly inert.
 * GitHub and absolute links keep their real URL.
 */
export function resolveProseLink(
  map: MapResource,
  sourcePath: string | undefined,
  href: string | undefined,
): ProseLinkTarget | null {
  if (!href) return null
  if (href.startsWith('#')) return { kind: 'disabled', reason: LOCAL_LINK_DISABLED }
  if (isAbsoluteHref(href)) return { kind: 'href', href }
  if (map.ref.project.integration !== 'local') return null
  if (!sourcePath)
    return { kind: 'disabled', reason: 'The source path for this local reference is unavailable.' }

  const resolvedPath = resolveFileHref(sourcePath, href)
  if (!resolvedPath) return { kind: 'disabled', reason: LOCAL_LINK_DISABLED }
  const mapSource = resourceObservation(map.resource)?.value.source
  if (mapSource?.kind === 'file' && samePath(resolvedPath, mapSource.path))
    return { kind: 'selection', selection: { kind: 'map' } }

  const ticket = ticketBySourcePath(map.tickets, resolvedPath)
  if (ticket) return { kind: 'selection', selection: { kind: 'ticket', id: ticket.ref.ticketId } }

  return { kind: 'disabled', reason: LOCAL_LINK_DISABLED }
}

function ticketBySourcePath(tickets: TicketResource[], path: string): TicketResource | undefined {
  return tickets.find((ticket) => {
    const source = resourceObservation(ticket.resource)?.value.source
    return source?.kind === 'file' && samePath(path, source.path)
  })
}

function isAbsoluteHref(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href) || href.startsWith('//')
}

function resolveFileHref(sourcePath: string, href: string): string | null {
  try {
    const url = new URL(href, toFileUrl(sourcePath))
    if (url.protocol !== 'file:') return null
    return decodeURIComponent(url.pathname)
  } catch {
    return null
  }
}

function toFileUrl(path: string): string {
  return `file://${path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

function samePath(a: string, b: string): boolean {
  return stripTrailingSlash(a) === stripTrailingSlash(b)
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}
