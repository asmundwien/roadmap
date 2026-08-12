/**
 * PROTOTYPE — throwaway. Fixture projects for the stride/card variants (issue #12).
 *
 * The four scenarios the ticket names, as fiction with honest density:
 * - gainstage — the long journey: three closed maps behind an active one, expired fog on a stride.
 * - sentence-mixer — a single-map project: the map child rendered bare, no accordion chrome.
 * - fieldnotes — resting: every map closed, the trace at rest.
 * - gainstage-site — the anomaly: two open maps, one active, one live-but-secondary.
 *
 * Dates are display-ready strings because the live types carry none yet — if the winning anatomy
 * needs close/update dates, adding them to the data layer belongs to the build ticket.
 */

import { deriveTicketState, frontierOf } from '../../wayfinder/tickets.ts'
import type {
  Blocker,
  Decision,
  MapBody,
  Ticket,
  TicketType,
  WayfinderMap,
} from '../../wayfinder/types.ts'

export interface StrideMap extends WayfinderMap {
  /** Display-ready close date for a closed map; null while open. */
  closedAt: string | null
  /** Display-ready recency note; among open maps, the freshest is the active one. */
  updatedAt: string
}

export interface StrideProject {
  nameWithOwner: string
  owner: string
  repo: string
  isPrivate: boolean
  /** Journey order: closed maps earliest-first, open-but-secondary next, the active map last. */
  maps: StrideMap[]
  /** The most recently updated open map; null for a resting project. */
  active: StrideMap | null
  /** One line for the switcher: which scenario this project exercises. */
  scenario: string
}

interface TicketSpec {
  n: number
  title: string
  type: TicketType
  closed?: boolean
  claimedBy?: string
  blockedBy?: number[]
}

interface MapSpec {
  number: number
  title: string
  destination: string
  notes?: string[]
  decisions: [string, string][]
  notYetSpecified: string[]
  outOfScope: string[]
  tickets: TicketSpec[]
  closedAt?: string
  updatedAt: string
}

function buildMap(owner: string, repo: string, spec: MapSpec): StrideMap {
  const nameWithOwner = `${owner}/${repo}`
  const issueUrl = (n: number) => `https://github.com/${nameWithOwner}/issues/${n}`
  const byNumber = new Map(spec.tickets.map((t) => [t.n, t]))

  const tickets: Ticket[] = spec.tickets.map((t) => {
    const blockedBy: Blocker[] = (t.blockedBy ?? []).map((n) => {
      const blocker = byNumber.get(n)
      return {
        number: n,
        title: blocker?.title ?? `#${n}`,
        url: issueUrl(n),
        nameWithOwner,
        isOpen: blocker?.closed !== true,
      }
    })
    const isClaimed = t.claimedBy !== undefined
    const hasOpenBlockers = blockedBy.some((b) => b.isOpen)
    return {
      number: t.n,
      title: t.title,
      url: issueUrl(t.n),
      type: t.type,
      state: deriveTicketState({ isOpen: t.closed !== true, isClaimed, hasOpenBlockers }),
      isClaimed,
      isBlocked: hasOpenBlockers,
      assignees:
        t.claimedBy === undefined
          ? []
          : [
              {
                login: t.claimedBy,
                avatarUrl: `https://github.com/${t.claimedBy}.png`,
                url: `https://github.com/${t.claimedBy}`,
              },
            ],
      blockedBy,
      blockersTruncated: false,
    }
  })

  const titleToNumber = new Map(spec.tickets.map((t) => [t.title, t.n]))
  const decisions: Decision[] = spec.decisions.map(([title, gist]) => ({
    title,
    url: issueUrl(titleToNumber.get(title) ?? 0),
    gist,
    raw: `- [${title}](…) — ${gist}`,
  }))

  const body: MapBody = {
    raw: '',
    destination: spec.destination,
    notes: spec.notes ?? [],
    decisions,
    notYetSpecified: spec.notYetSpecified,
    notYetSpecifiedNote: spec.notYetSpecified.length === 0 ? 'No fog remains.' : '',
    outOfScope: spec.outOfScope,
    sections: [],
    missingSections: [],
  }

  const completed = tickets.filter((t) => t.state === 'closed').length
  return {
    owner,
    repo,
    nameWithOwner,
    number: spec.number,
    title: spec.title,
    url: issueUrl(spec.number),
    isOpen: spec.closedAt === undefined,
    body,
    tickets,
    frontier: frontierOf(tickets),
    progress: {
      total: tickets.length,
      completed,
      percentCompleted: tickets.length === 0 ? 0 : Math.round((completed / tickets.length) * 100),
    },
    ticketsTruncated: false,
    closedAt: spec.closedAt ?? null,
    updatedAt: spec.updatedAt,
  }
}

function buildProject(
  owner: string,
  repo: string,
  scenario: string,
  specs: MapSpec[],
): StrideProject {
  const maps = specs.map((spec) => buildMap(owner, repo, spec))
  const open = maps.filter((m) => m.isOpen)
  return {
    nameWithOwner: `${owner}/${repo}`,
    owner,
    repo,
    isPrivate: true,
    maps,
    // Journey order puts the active map last by construction; no date math in a fixture.
    active: open.length > 0 ? (open[open.length - 1] ?? null) : null,
    scenario,
  }
}

/** All-closed ticket lists for history maps — titles in, closed grilling/research tickets out. */
function closedTickets(from: number, titles: string[]): TicketSpec[] {
  return titles.map((title, i) => ({
    n: from + i,
    title,
    type: title.startsWith('Research:') ? ('research' as const) : ('grilling' as const),
    closed: true,
  }))
}

// ---------------------------------------------------------------- gainstage — the long journey

const GS_SKELETON: MapSpec = {
  number: 1,
  title: 'Walking skeleton — Wayfinder Map',
  closedAt: 'Nov 2025',
  updatedAt: 'Nov 2025',
  destination:
    'The walking skeleton is specified: every decision needed before the first line of real code is made and recorded — engine stack, the architecture suggestions adopted or rejected as ADRs, domain language pinned — plus a buildable spec for the thinnest vertical slice.',
  decisions: [
    [
      'Research: real-time audio engine and I/O options on macOS',
      'build the data plane directly on Core Audio HAL/AUHAL; Rust and C++ equally viable, Swift control-plane-only',
    ],
    [
      'Research: agent-door protocol options',
      'bespoke JSON-RPC-over-WebSocket plus a thin MCP adapter; MCP alone cannot carry the live event stream',
    ],
    [
      'Skeleton scope',
      'pure gain over a mono one-in-one-out path, a real tiny sentence resolver, author-attributed events, in-memory log only',
    ],
    [
      'Adopt or reject: command core with two thin doors',
      'adopted as law, amended — the core is deterministic with no intent intelligence',
    ],
    [
      'Engine stack decision',
      'Rust engine, Swift shell; the FFI line is the control plane and nothing else crosses it',
    ],
    [
      'Pin the domain language',
      'graph, node, door, event, sentence — recorded in CONTEXT.md with avoid-lists',
    ],
    [
      'Walking-skeleton spec',
      'audio in, routed graph, one processor, audio out — driven by both a fader and a sentence',
    ],
  ],
  notYetSpecified: [],
  outOfScope: ['Third-party plugin hosting.', 'Surround and immersive channel shapes.'],
  tickets: closedTickets(2, [
    'Research: real-time audio engine and I/O options on macOS',
    'Research: agent-door protocol options',
    'Skeleton scope',
    'Adopt or reject: command core with two thin doors',
    'Adopt or reject: event-sourced session',
    'Adopt or reject: control plane / data plane split',
    'Adopt or reject: typed-graph routing fabric',
    'Adopt or reject: the processor contract',
    'Engine stack decision',
    'Agent door design',
    'Human door design',
    'Pin the domain language',
    'Attribution and identity model',
    'Walking-skeleton spec',
    'Retire the founding documents',
  ]),
}

const GS_ENGINE: MapSpec = {
  number: 18,
  title: 'Engine bring-up — Wayfinder Map',
  closedAt: 'Feb 2026',
  updatedAt: 'Feb 2026',
  destination:
    'The skeleton makes sound: Core Audio in and out through the routed graph, pure gain end to end, driven live from both doors with author-attributed events in the log.',
  decisions: [
    [
      'Choose the buffer contract',
      'fixed 128-frame blocks at the graph boundary; the HAL adapter owns reblocking',
    ],
    [
      'Adopt or reject: lock-free command queue',
      'adopted — a bounded SPSC ring per direction; allocation only on the control plane',
    ],
    [
      'Engine crate layout',
      'three crates: hal, graph, doors — and the graph knows neither neighbour',
    ],
    [
      'First processor: pure gain',
      'one param, smoothed per block; the contract test is the null test',
    ],
    [
      'Error surface at the doors',
      'errors-as-values over the wire; the engine never panics across the FFI line',
    ],
  ],
  notYetSpecified: [
    'Latency budgets enforced in CI — never sharpened before the effort closed.',
    'A golden-render corpus beyond the two seed sessions.',
  ],
  outOfScope: ['Any second processor.'],
  tickets: closedTickets(19, [
    'Choose the buffer contract',
    'Adopt or reject: lock-free command queue',
    'Engine crate layout',
    'First processor: pure gain',
    'Error surface at the doors',
    'Bring up the HAL adapter',
    'Wire the doors to the running graph',
    'The null-test harness',
  ]),
}

const GS_SESSION: MapSpec = {
  number: 31,
  title: 'The session file — Wayfinder Map',
  closedAt: 'Jun 2026',
  updatedAt: 'Jun 2026',
  destination:
    'A session survives the app: the event log persists to a durable session file that reopens byte-identical, with undo defined per event type.',
  decisions: [
    [
      'Research: event-log serialization formats',
      'length-prefixed JSON lines win — append-only, greppable, versioned per line',
    ],
    [
      'The session file is the log',
      'no snapshot section in v1; reopen replays, and replay must be deterministic',
    ],
    [
      'Undo semantics per event type',
      'every event carries its inverse; non-invertible events are forbidden by the contract',
    ],
    ['Autosave cadence', 'append on every committed event; fsync batched at 250ms'],
    [
      'Migration story',
      'a version line at head; readers refuse forward versions rather than guessing',
    ],
  ],
  notYetSpecified: [],
  outOfScope: ['Cloud sync of session files.'],
  tickets: closedTickets(32, [
    'Research: event-log serialization formats',
    'The session file is the log',
    'Undo semantics per event type',
    'Autosave cadence',
    'Migration story',
    'Build persistence behind the log',
  ]),
}

const GS_SURFACE: MapSpec = {
  number: 40,
  title: 'The mixing surface — Wayfinder Map',
  updatedAt: 'today',
  notes: [
    'Execution override: this map carries the build — the surface ships behind a flag.',
    'Skills for tickets: /grilling + /domain-modeling for decisions, dataviz for the meters.',
  ],
  destination:
    'The first real surface: a channel strip per graph node — fader, meter, mute — rendered native, driven by the same events as the sentence door, resizable without a relayout decision per frame.',
  decisions: [
    [
      'Research: metering ballistics',
      'PPM-style attack with RMS overlay; ballistics live engine-side so every door sees the same meter',
    ],
    ['Strip anatomy', 'fader, meter, mute, name — sends and EQ wait for the routing surface'],
    [
      'Layout engine choice',
      'plain AppKit constraints over a custom layout pass; the strip count stays small',
    ],
    [
      'Adopt or reject: view-model per strip',
      'adopted — the strip renders a projection, never engine state directly',
    ],
  ],
  notYetSpecified: [
    'Solo-in-place semantics once buses exist.',
    'Keyboard traversal of the surface.',
    'What the surface does while the engine is offline.',
  ],
  outOfScope: ['Skinning and themes.', 'Touch gestures beyond scroll.'],
  tickets: [
    { n: 41, title: 'Research: metering ballistics', type: 'research', closed: true },
    { n: 42, title: 'Strip anatomy', type: 'grilling', closed: true },
    { n: 43, title: 'Layout engine choice', type: 'grilling', closed: true },
    { n: 44, title: 'Adopt or reject: view-model per strip', type: 'grilling', closed: true },
    {
      n: 45,
      title: 'Meter drawing: layer per strip or one canvas',
      type: 'grilling',
      claimedBy: 'asmundwien',
    },
    { n: 46, title: 'Fader law and automation touch', type: 'grilling' },
    { n: 47, title: 'Prototype: the strip at three densities', type: 'prototype' },
    { n: 48, title: 'Mute and solo interaction model', type: 'grilling', blockedBy: [46] },
    { n: 49, title: 'Surface-to-engine event contract', type: 'grilling', blockedBy: [45, 46] },
    { n: 50, title: 'The resize story', type: 'task', blockedBy: [49] },
    { n: 51, title: 'Ship the surface behind a flag', type: 'task', blockedBy: [49, 50] },
  ],
}

// ---------------------------------------------------------------- sentence-mixer — single map

const SM_SPEAKABLE: MapSpec = {
  number: 1,
  title: 'Speakable mixes — Wayfinder Map',
  updatedAt: '3 days ago',
  notes: [
    'The grammar stays a tiny CFG — see the intent-grammar research doc before extending it.',
  ],
  destination:
    'A mix you can speak: the sentence door understands level, pan, and mute intents over named channels, with a dry-run mode that narrates what would change before it does.',
  decisions: [
    [
      'Research: intent grammar shapes',
      'a tiny CFG beats an LLM pass for the three verbs; ambiguity is an error, not a guess',
    ],
    [
      'Name resolution',
      'channels resolve by exact name then unique prefix; ambiguity lists candidates verbatim',
    ],
  ],
  notYetSpecified: [
    'Whether intents batch into one undo step.',
    'A vocabulary for relative changes.',
  ],
  outOfScope: ['Voice input — text sentences only.'],
  tickets: [
    { n: 2, title: 'Research: intent grammar shapes', type: 'research', closed: true },
    { n: 3, title: 'Name resolution', type: 'grilling', closed: true },
    { n: 4, title: 'Dry-run narration format', type: 'grilling', claimedBy: 'asmundwien' },
    { n: 5, title: 'Pan verb semantics', type: 'grilling' },
    { n: 6, title: 'Error sentences', type: 'grilling' },
    { n: 7, title: 'Compound sentences', type: 'grilling', blockedBy: [5] },
    { n: 8, title: 'Wire the door end to end', type: 'task', blockedBy: [4, 7] },
  ],
}

// ---------------------------------------------------------------- fieldnotes — resting

const FN_CAPTURE: MapSpec = {
  number: 1,
  title: 'Capture pipeline — Wayfinder Map',
  closedAt: 'Aug 2025',
  updatedAt: 'Aug 2025',
  destination:
    'Notes leave the field: photos and voice memos land in one inbox with capture-time metadata intact, however they were taken.',
  decisions: [
    [
      'Research: iOS share-sheet limits',
      'the share extension gets originals with EXIF; shortcuts strip GPS — extension wins',
    ],
    ['Inbox format', 'a dated folder of originals plus one sidecar JSON per item; no database'],
    [
      'Voice memo handling',
      'transcribe at capture with on-device speech; the audio stays the source of truth',
    ],
    [
      'Dedupe rule',
      'content hash over pixels and samples, not files — re-shares collapse silently',
    ],
  ],
  notYetSpecified: [],
  outOfScope: ['Android capture.'],
  tickets: closedTickets(2, [
    'Research: iOS share-sheet limits',
    'Inbox format',
    'Voice memo handling',
    'Dedupe rule',
    'Build the capture extension',
  ]),
}

const FN_PUBLISHING: MapSpec = {
  number: 9,
  title: 'Publishing loop — Wayfinder Map',
  closedAt: 'Jan 2026',
  updatedAt: 'Jan 2026',
  destination:
    'The inbox empties itself: a weekly review pass turns kept items into posts on the static site, and the loop runs without dread.',
  decisions: [
    ['Review cadence', 'weekly, timeboxed, newest-first; anything twice-skipped auto-archives'],
    ['Post format', 'one markdown file per item, sidecar promoted to front matter'],
    [
      'Research: static host options',
      'stays on Pages; the build is fast enough and the domain is already there',
    ],
    ['Archive semantics', 'archived items keep their sidecars; nothing is deleted, only demoted'],
  ],
  notYetSpecified: ['A monthly digest post assembled from the weeks — sketched, never entered.'],
  outOfScope: ['Comments and syndication.'],
  tickets: closedTickets(10, [
    'Review cadence',
    'Post format',
    'Research: static host options',
    'Archive semantics',
    'Build the review pass',
  ]),
}

// ---------------------------------------------------------------- gainstage-site — two open maps

const SITE_SKELETON: MapSpec = {
  number: 1,
  title: 'Site skeleton — Wayfinder Map',
  closedAt: 'Apr 2026',
  updatedAt: 'Apr 2026',
  destination:
    'gainstage.app exists: a static site with the pitch, a changelog fed from releases, and a place for docs to land.',
  decisions: [
    ['Stack', 'Astro on Pages; content collections for the changelog'],
    [
      'Research: changelog from releases',
      'a build-time fetch of GitHub releases; no webhook, the site rebuilds nightly',
    ],
    ['Information architecture', 'three pages: pitch, changelog, docs shell — nothing speculative'],
  ],
  notYetSpecified: [],
  outOfScope: ['A blog.'],
  tickets: closedTickets(2, [
    'Stack',
    'Research: changelog from releases',
    'Information architecture',
    'Ship the skeleton',
  ]),
}

const SITE_DESIGN: MapSpec = {
  number: 7,
  title: 'Design refresh — Wayfinder Map',
  updatedAt: '12 days ago',
  destination:
    'The site looks like the product: the visual language of the surface carried to the web — type, spacing, and the meter-green accent.',
  decisions: [['Type ramp', 'the mono of the surface for numbers only; text stays system sans']],
  notYetSpecified: ['Motion, if any.'],
  outOfScope: [],
  tickets: [
    { n: 8, title: 'Type ramp', type: 'grilling', closed: true },
    { n: 9, title: 'Color tokens from the app palette', type: 'grilling' },
    { n: 10, title: 'Prototype: the landing hero', type: 'prototype' },
    { n: 11, title: 'Dark mode parity', type: 'grilling', blockedBy: [9] },
    { n: 13, title: 'Apply the refresh site-wide', type: 'task', blockedBy: [10, 11] },
  ],
}

const SITE_LAUNCH: MapSpec = {
  number: 20,
  title: 'Launch content — Wayfinder Map',
  updatedAt: 'yesterday',
  destination:
    'Launch day reads ready: the pitch rewritten against the real surface, three walkthrough clips, and a press kit that answers the first ten questions.',
  decisions: [
    [
      'The spine of the pitch',
      'lead with the sentence door, not the graph — the demo writes the copy',
    ],
    ['Clip tooling', 'screen-record the real app; no motion-graphics pass for launch'],
  ],
  notYetSpecified: ['Where launch feedback lands — issues, a form, or nothing.'],
  outOfScope: ['Paid placement.'],
  tickets: [
    { n: 21, title: 'The spine of the pitch', type: 'grilling', closed: true },
    { n: 22, title: 'Clip tooling', type: 'grilling', closed: true },
    { n: 23, title: 'Write the pitch page', type: 'task', claimedBy: 'asmundwien' },
    { n: 24, title: 'Storyboard the three clips', type: 'task' },
    { n: 25, title: 'Press kit contents', type: 'grilling', blockedBy: [23] },
    { n: 26, title: 'Record and cut the clips', type: 'task', blockedBy: [22, 24] },
  ],
}

export const FIXTURE_PROJECTS: StrideProject[] = [
  buildProject('asmundwien', 'gainstage', 'long history + active', [
    GS_SKELETON,
    GS_ENGINE,
    GS_SESSION,
    GS_SURFACE,
  ]),
  buildProject('asmundwien', 'sentence-mixer', 'single map', [SM_SPEAKABLE]),
  buildProject('asmundwien', 'fieldnotes', 'resting', [FN_CAPTURE, FN_PUBLISHING]),
  buildProject('asmundwien', 'gainstage-site', 'two open maps', [
    SITE_SKELETON,
    SITE_DESIGN,
    SITE_LAUNCH,
  ]),
]
