import type { Ticket, WayfinderMap } from '@roadmap/contracts'
import type { ResolvedSelection } from '../../router.ts'

export type ProseLinkTarget =
  | { kind: 'selection'; selection: ResolvedSelection }
  | { kind: 'href'; href: string }
  | { kind: 'disabled'; reason: string }

const LOCAL_LINK_DISABLED =
  'Local file links stay inside Roadmap only when they point at this map or one of its tickets.'

/**
 * Resolves one markdown href in the context of a specific map file or ticket file.
 *
 * Local same-map links become panel selections; all other local relative links are visibly inert,
 * by ticket decision. GitHub and absolute links keep their real URL.
 */
export function resolveProseLink(
  map: WayfinderMap,
  sourcePath: string | undefined,
  href: string | undefined,
): ProseLinkTarget | null {
  if (!href) return null
  if (href.startsWith('#')) return { kind: 'disabled', reason: LOCAL_LINK_DISABLED }
  if (isAbsoluteHref(href)) return { kind: 'href', href }
  if (map.project.integration !== 'local' || !sourcePath) return null

  const resolvedPath = resolveFileHref(sourcePath, href)
  if (!resolvedPath) return { kind: 'disabled', reason: LOCAL_LINK_DISABLED }
  if (map.sourcePath && samePath(resolvedPath, map.sourcePath))
    return { kind: 'selection', selection: { kind: 'map' } }

  const ticket = ticketBySourcePath(map.tickets, resolvedPath)
  if (ticket) return { kind: 'selection', selection: { kind: 'ticket', id: ticket.id } }

  return { kind: 'disabled', reason: LOCAL_LINK_DISABLED }
}

function ticketBySourcePath(tickets: Ticket[], path: string): Ticket | undefined {
  return tickets.find((ticket) => ticket.sourcePath && samePath(path, ticket.sourcePath))
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
  return `file://${encodeURI(path)}`
}

function samePath(a: string, b: string): boolean {
  return stripTrailingSlash(a) === stripTrailingSlash(b)
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}
