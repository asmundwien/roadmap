/** The `wayfinder:<type>` label a ticket carries. `untyped` covers a ticket carrying none. */
export type TicketType = 'research' | 'prototype' | 'grilling' | 'task' | 'untyped'

/**
 * A ticket's position relative to the frontier.
 *
 * - `closed` — resolved; its answer is on the map.
 * - `blocked` — open, but at least one blocker is still open.
 * - `claimed` — open and unblocked, but a session has assigned it to itself.
 * - `frontier` — open, unblocked, unclaimed: the edge of the known, and the only takeable state.
 */
export type TicketState = 'closed' | 'blocked' | 'claimed' | 'frontier'

export interface Assignee {
  login: string
  avatarUrl: string
  url: string
}

/** One end of a blocked-by edge. Carries its repo, so cross-repo edges stay legible. */
export interface Blocker {
  number: number
  title: string
  url: string
  nameWithOwner: string
  isOpen: boolean
}

export interface Ticket {
  number: number
  title: string
  url: string
  /** The issue body as written — markdown, unrendered; empty when the issue has none. */
  body: string
  type: TicketType
  state: TicketState
  /** Independent of `state`, which collapses them: a ticket can be blocked *and* claimed. */
  isClaimed: boolean
  isBlocked: boolean
  /** When the ticket was created, ms since epoch — the provenance signal: a rootless ticket was
   * spawned by whatever ticket's resolution immediately preceded its creation. */
  createdAt: number
  /** When the ticket closed, ms since epoch; null while it is open. */
  closedAt: number | null
  assignees: Assignee[]
  blockedBy: Blocker[]
  /** True when the ticket has more blockers than one page returned. */
  blockersTruncated: boolean
}

/** One entry in the map's Decisions-so-far index: a gist plus a pointer to the ticket holding it. */
export interface Decision {
  title: string
  url: string | null
  gist: string
  /** The bullet as written, so a line that defies parsing is still rendered faithfully. */
  raw: string
}

/** A `##` block of the map body, kept verbatim alongside the parse so drift stays inspectable. */
export interface MapSection {
  heading: string
  text: string
  items: string[]
}

/**
 * The map body parsed against the wayfinder template — tolerantly. Every field degrades to empty
 * rather than throwing, unrecognised headings survive in `sections`, and the raw body is kept.
 */
export interface MapBody {
  raw: string
  destination: string
  notes: string[]
  decisions: Decision[]
  /** Fog patches — bullets only. Prose in this section is commentary, not a patch. */
  notYetSpecified: string[]
  /** Prose in Not-yet-specified when it carries no bullets — usually "no fog remains". */
  notYetSpecifiedNote: string
  outOfScope: string[]
  /** Every `##` section in document order, recognised or not. */
  sections: MapSection[]
  /** Template sections that were absent — the drift signal a view may want to surface. */
  missingSections: string[]
}

export interface MapProgress {
  total: number
  completed: number
  percentCompleted: number
}

export interface WayfinderMap {
  owner: string
  repo: string
  nameWithOwner: string
  number: number
  title: string
  url: string
  isOpen: boolean
  /** Last activity on the map issue, ms since epoch — recency picks a project's active map. */
  updatedAt: number
  /** When the map issue closed, ms since epoch; null while it is open. */
  closedAt: number | null
  body: MapBody
  tickets: Ticket[]
  /** Open, unblocked, unclaimed tickets in map order — what a session can take right now. */
  frontier: Ticket[]
  progress: MapProgress
  /** True when the map has more children than one page returned; the graph is then partial. */
  ticketsTruncated: boolean
}

/**
 * A repo, with its maps. A project can hold several: open ones live, closed ones as history.
 * `openMaps` is ordered most recently updated first — the head is the **active map**, any others
 * are live but secondary. `closedMaps` is ordered most recently closed first.
 */
export interface Project {
  nameWithOwner: string
  owner: string
  repo: string
  isPrivate: boolean
  openMaps: WayfinderMap[]
  closedMaps: WayfinderMap[]
}

/** A `wayfinder:map` issue found by discovery — enough to address it, not yet its content. */
export interface MapRef {
  owner: string
  repo: string
  nameWithOwner: string
  number: number
}

/** GitHub's self-reported GraphQL budget, echoed by every query that asks for it. */
export interface RateLimit {
  cost: number
  remaining: number
  limit: number
  resetAt: string
}

/**
 * The whole roadmap state at an instant — what the server owns and broadcasts. Full-snapshot
 * replace: the wire never carries patches; diffing is the server's internal concern.
 */
export interface Snapshot {
  /** When the server assembled this snapshot, ms since epoch. */
  capturedAt: number
  projects: Project[]
  /** Discovered maps the map query returned nothing for — deleted, renamed, or now invisible. */
  unreachable: MapRef[]
  /** The budget as of the last GraphQL fetch; null before the first one reports. */
  rateLimit: RateLimit | null
}

/** Everything the server sends over the WebSocket. Today that is one message: the snapshot. */
export type ServerMessage = { type: 'snapshot'; snapshot: Snapshot }
