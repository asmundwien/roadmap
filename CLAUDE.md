# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

**Roadmap** — a live, read-only visualization of [wayfinder](https://github.com/mattpocock)-organized
projects on GitHub. It discovers every repo carrying a `wayfinder:map` issue and renders each effort
as a living map: the dependency graph of tickets alongside the decisions made and the fog ahead.

Read-only, solo user, local-first. The repo is a pnpm workspace: `apps/web` is the SPA, `apps/server`
is the v3 server (owns the snapshot: webhook invalidations + a reconciling poll feed one in-memory
state, broadcast whole over WebSocket at `/ws`), and `packages/contracts` (`@roadmap/contracts`)
holds the shared domain vocabulary — exactly what crosses the WebSocket.

## Commands

Run everything from the repo root; pnpm comes from corepack. The root scripts delegate into the
workspaces, so the names below are unchanged from the single-package days.

| Command          | What it does                              |
| ---------------- | ----------------------------------------- |
| `pnpm dev`       | Server (:8790) + Vite (:5173), together   |
| `pnpm build`     | Typecheck (`tsc -b`) then production build |
| `pnpm preview`   | Serve the production build                |
| `pnpm typecheck` | Types only                                |
| `pnpm test`      | Vitest, once                              |
| `pnpm test:watch`| Vitest in watch mode                      |
| `pnpm check`     | Biome lint + format check                 |
| `pnpm fix`       | Biome autofix + format                    |

`pnpm check`, `pnpm typecheck`, and `pnpm test` all pass before anything is called done.

## Stack

Vite + React 19 + TypeScript, pnpm workspaces, Biome for lint/format (one root `biome.json`),
Vitest for tests.

Vitest runs in the `node` environment and picks up `apps/web/src/**/*.test.ts` — no DOM, because
nothing has needed one yet. The first component test that does should add jsdom and Testing Library
then.

`.env.local` stays at the repo root — the server loads it directly, and the web app reaches it via
`envDir` in its Vite config. Every secret in it is `ROADMAP_`-prefixed, never `VITE_`: the browser
sees no credentials, only (optionally) `VITE_ROADMAP_SERVER_URL` when the socket moves off the
default `ws://localhost:8790/ws`.

## Conventions

- **Biome is the authority** on style — single quotes, no semicolons, 2-space indent, 100 columns.
  Don't hand-format; run `pnpm fix`.
- `any` and non-null assertions (`!`) are lint errors. Narrow properly, or make the type honest.
- `strict` plus `noUncheckedIndexedAccess` are on: indexing an array yields `T | undefined`.
- `console.log` warns; `console.error`/`warn`/`info` are allowed.
- Components are named exports (`export function App()`), not default exports.

## GitHub API

Everything the data layer needs was established up front — endpoints, CORS, auth, rate-limit
budget, ETag behaviour, and the single GraphQL query that fetches a whole map with all its
blocked-by edges: **[docs/research/github-api-primitives.md](docs/research/github-api-primitives.md)**.
Read it before writing fetch code; don't re-derive it.

Auth is a personal access token read by the server as `ROADMAP_GITHUB_TOKEN` — copy `.env.example`
to `.env.local`. The token never enters the browser: only the server talks to GitHub, and nothing
`VITE_`-prefixed carries a secret. Local-only remains the deal — nothing here is deployed.

## The data layer

Views never fetch. They read `useRoadmap()` and get a snapshot; the SPA is a pure renderer:

- `packages/contracts/` — the domain vocabulary (`Project`, `WayfinderMap`, `Ticket`, states…,
  plus `Snapshot`/`ServerMessage`, the wire), imported everywhere as `@roadmap/contracts`.
- `apps/web/src/store/` — the SPA's whole data layer: a WebSocket subscription
  (`roadmap-store.ts`) with wholesale snapshot replace, a `connection` state
  (`connecting | live | disconnected`), and auto-reconnect with backoff; server down keeps the
  last snapshot on screen, honestly marked stale. `RoadmapProvider` / `useRoadmap` bind it to
  React.
- `apps/web/src/router.ts` — the hash owns ALL URL state: `#/owner/repo/<map>` pins the open map
  and one more segment (`/map`, `/ticket/<n>`, `/fog/<i>`, `/scope/<i>`, `/scope-all`) names the
  Panel's selection. `PanelSelection` (as the hash carries it) resolves against the live snapshot
  on every render into `ResolvedSelection` — no `useState` mirrors of the URL anywhere.
- `apps/web/src/views/` — the panel-era map view (anatomy terms in `CONTEXT.md`: Panel, Selection,
  Hover, Item link, aggregate scope stop): the ledger (`map/ledger.tsx` + `map/geometry.ts`) draws
  titles only; every descriptive text lives in the **Panel** (`map/panel.tsx`), the docked column
  fed by the router's resolved selection — never an overlay. `map/sequence.ts` holds the pure
  logic (on-screen prev/next order, the out-of-scope display plan), `map/prose.tsx` renders all
  Panel prose as markdown (`react-markdown` + `remark-gfm`, no rehype plugins). The whole
  navigation is one roving-tabindex composite owned by `project-screen.tsx`: Tab lands on one
  item, arrows move the shared hover, Space/Enter select.

Everything that talks to GitHub lives in the server (`apps/server/src/`): `github/` (transport —
auth, GraphQL errors, REST ETag replay, discovery search, the aliased map query), `wayfinder/`
(domain logic — tolerant map-body parsing, ticket-state derivation, payload → `Project[]`).
On top of them: `store.ts` (the one snapshot both funnels feed, with coalescing invalidation),
`invalidation.ts` (delivery payload → refetch decision, per `docs/research/webhook-path.md` §2),
`webhook.ts` (best-effort HMAC, dedup, ACK-fast receiver), `relay.ts` (smee subscription,
reconcile on reconnect), `socket.ts` (full-snapshot WebSocket broadcast), `change-feed.ts` (the
trigger seam: consecutive snapshots diffed into source-blind domain events; the baseline is
observed, never diffed), `notify.ts` (the feed's first subscriber — terminal-notifier banners for
agent actions: claimed and completed), `main.ts` (composition: baseline sweep, then relay, then a
5-minute reconciler stretched by the rate-limit valve).

Data that may be partial says so rather than looking whole: `ticketsTruncated`, `blockersTruncated`,
`unreachable`, and `MapBody.missingSections`. Keep that habit.

## How the work is organized

This repo is driven by **wayfinder maps** — the closed maps ([v1 #1](https://github.com/asmundwien/roadmap/issues/1)
through the rest) are the history; the active effort is whatever `wayfinder:map` issue is open.
A map holds the destination, the decisions made so far, and the fog still
ahead; its child issues are the tickets. Before starting work, read the map and take a ticket from the frontier (open,
unblocked, unassigned). Use the `/wayfinder` skill rather than freelancing new work.

Note that this map carries **execution**, not just planning: its task tickets deliver working code.
