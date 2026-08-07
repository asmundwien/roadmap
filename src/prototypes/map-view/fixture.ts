/**
 * PROTOTYPE — throwaway. Fake `WayfinderMap` data for the map-view variants.
 *
 * Shaped from two real maps so density and edge structure are honest: gainstage's Walking Skeleton
 * (16 tickets, five layers deep, all four states present) and this repo's own map (7 tickets, all
 * four ticket types). The prototype runs off these instead of the live store — the read token is
 * still an open ticket, and a design question shouldn't wait on auth.
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

interface TicketSpec {
  n: number
  title: string
  type: TicketType
  closed?: boolean
  claimedBy?: string
  blockedBy?: number[]
}

interface MapSpec {
  owner: string
  repo: string
  number: number
  title: string
  destination: string
  decisions: [string, string][]
  notYetSpecified: string[]
  outOfScope: string[]
  tickets: TicketSpec[]
}

const GAINSTAGE: MapSpec = {
  owner: 'asmundwien',
  repo: 'gainstage',
  number: 1,
  title: 'Walking Skeleton — Wayfinder Map',
  destination:
    'The walking skeleton is specified: every decision needed before the first line of real code is made and recorded — engine stack, the architecture suggestions adopted or rejected as ADRs, domain language pinned — plus a buildable spec for the thinnest vertical slice: audio in → routed graph → one processor → audio out, driven by both a fader and a sentence.',
  decisions: [
    [
      'Research: agent-door protocol options',
      'bespoke JSON-RPC-over-WebSocket plus a thin MCP adapter; MCP alone cannot carry the live event stream',
    ],
    [
      'Research: real-time audio engine and I/O options on macOS',
      'build the data plane directly on Core Audio HAL/AUHAL; Rust and C++ equally viable, Swift control-plane-only',
    ],
    [
      'Research: GUI approach for a native-feeling macOS app',
      'native Swift hybrid first, Rust-native egui/Vizia co-first if the engine lands on Rust',
    ],
    [
      'Skeleton scope',
      'pure gain over a mono one-in-one-out path, a real tiny sentence resolver, author-attributed events, in-memory log only',
    ],
    [
      'Adopt or reject: command core with two thin doors',
      'adopted as law, amended — the core is deterministic with no intent intelligence; errors-as-values at the boundary',
    ],
  ],
  notYetSpecified: [
    'Session/event-log persistence — how the log is stored and what a durable session file is; waits on the engine stack choice.',
    'Audio-correctness harness — null tests, golden renders, latency budgets in CI; sharpens after the stack choice.',
    'Undo/reversibility mechanics — what "reversible" means per event type; sharpens once event sourcing is settled.',
  ],
  outOfScope: [
    'Third-party plugin hosting (VST/AU) and the processor ecosystem.',
    'Surround/immersive channel shapes — the skeleton speaks mono/stereo.',
    'Live-performance features.',
    'Business concerns: naming, licensing, distribution.',
  ],
  tickets: [
    { n: 2, title: 'Skeleton scope', type: 'grilling', closed: true },
    {
      n: 3,
      title: 'Research: real-time audio engine and I/O options on macOS',
      type: 'research',
      closed: true,
    },
    { n: 4, title: 'Research: agent-door protocol options', type: 'research', closed: true },
    {
      n: 5,
      title: 'Research: GUI approach for a native-feeling macOS app',
      type: 'research',
      closed: true,
    },
    {
      n: 6,
      title: 'Adopt or reject: command core with two thin doors',
      type: 'grilling',
      closed: true,
    },
    {
      n: 7,
      title: 'Adopt or reject: event-sourced session',
      type: 'grilling',
      claimedBy: 'asmundwien',
    },
    { n: 8, title: 'Adopt or reject: control plane / data plane split', type: 'grilling' },
    { n: 9, title: 'Adopt or reject: typed-graph routing fabric', type: 'grilling' },
    { n: 10, title: 'Adopt or reject: the processor contract', type: 'grilling' },
    { n: 11, title: 'Engine stack decision', type: 'grilling', blockedBy: [3, 8] },
    { n: 12, title: 'Agent door design', type: 'grilling', blockedBy: [4, 6, 11] },
    { n: 13, title: 'Human door design', type: 'grilling', blockedBy: [5, 11] },
    { n: 14, title: 'Pin the domain language', type: 'grilling', blockedBy: [6, 7, 8, 9, 10] },
    { n: 15, title: 'Walking-skeleton spec', type: 'grilling', blockedBy: [2, 11, 12, 13, 14] },
    { n: 16, title: 'Retire the founding documents', type: 'grilling', blockedBy: [15] },
    { n: 17, title: 'Attribution and identity model', type: 'grilling', blockedBy: [7] },
  ],
}

const ROADMAP: MapSpec = {
  owner: 'asmundwien',
  repo: 'roadmap',
  number: 1,
  title: 'Roadmap v1 — Wayfinder Map',
  destination:
    'Roadmap v1 is running locally: a Vite + React + TypeScript SPA that auto-discovers every wayfinder project on GitHub and, per map, renders a live read-only view of the effort — the dependency graph of tickets, the decisions made so far, and the fog still ahead.',
  decisions: [
    [
      'Research: reading wayfinder primitives from the browser',
      'no backend needed — CORS is open, and one GraphQL query per poll fetches every map inside rate limits',
    ],
    [
      'Scaffold the app',
      'the shell runs: Vite 8 + React 19 + TS 6 + pnpm + Biome, strict everywhere, token via .env.local',
    ],
    [
      'Build the data layer',
      'views never fetch — useRoadmap() hands them typed Project[] with every ticket state already derived',
    ],
  ],
  notYetSpecified: [
    'Notification when a frontier changes, beyond the in-app visual pulse.',
    'How deep closed-map history browsing goes beyond a simple list.',
    'Packaging: does this stay `pnpm dev`, or become a menu-bar app?',
    'The visual/animation language beyond what the prototype reactions settle.',
  ],
  outOfScope: [
    'Write actions — claiming, closing, or editing tickets from the tool; v1 observes.',
    'Hosting and multi-viewer sharing.',
    'Non-GitHub wayfinder trackers.',
  ],
  tickets: [
    {
      n: 2,
      title: 'Research: reading wayfinder primitives from the browser',
      type: 'research',
      closed: true,
    },
    { n: 4, title: 'Scaffold the app', type: 'task', closed: true },
    { n: 5, title: 'Build the data layer', type: 'task', closed: true },
    { n: 3, title: 'Prototype: the map view', type: 'prototype', claimedBy: 'asmundwien' },
    { n: 6, title: 'Build the project list', type: 'task' },
    { n: 8, title: 'Provision the GitHub read token', type: 'task' },
    { n: 7, title: 'Build the live map screen', type: 'task', blockedBy: [3, 5] },
  ],
}

function buildMap(spec: MapSpec): WayfinderMap {
  const nameWithOwner = `${spec.owner}/${spec.repo}`
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

  const decisions: Decision[] = spec.decisions.map(([title, gist], i) => ({
    title,
    url: issueUrl(spec.tickets[i]?.n ?? 0),
    gist,
    raw: `- [${title}](…) — ${gist}`,
  }))

  const body: MapBody = {
    raw: '',
    destination: spec.destination,
    notes: [],
    decisions,
    notYetSpecified: spec.notYetSpecified,
    outOfScope: spec.outOfScope,
    sections: [],
    missingSections: [],
  }

  const completed = tickets.filter((t) => t.state === 'closed').length
  return {
    owner: spec.owner,
    repo: spec.repo,
    nameWithOwner,
    number: spec.number,
    title: spec.title,
    url: issueUrl(spec.number),
    isOpen: true,
    body,
    tickets,
    frontier: frontierOf(tickets),
    progress: {
      total: tickets.length,
      completed,
      percentCompleted: Math.round((completed / tickets.length) * 100),
    },
    ticketsTruncated: false,
  }
}

export const FIXTURE_MAPS: WayfinderMap[] = [buildMap(GAINSTAGE), buildMap(ROADMAP)]
