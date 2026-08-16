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
| `pnpm dev`       | Vite dev server (http://localhost:5173)   |
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

`.env.local` stays at the repo root — the web app reaches it via `envDir` in its Vite config, and
the server will read the same file.

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

Auth is a personal access token injected via Vite env — copy `.env.example` to `.env.local`. Never
persist the token to `localStorage`, and never deploy a production build anywhere: the token would
ship inside the bundle.

## The data layer

Views never fetch. They read `useRoadmap()` and get a snapshot; everything below it is already built:

- `packages/contracts/` — the domain vocabulary (`Project`, `WayfinderMap`, `Ticket`, states…),
  imported everywhere as `@roadmap/contracts`.
- `apps/web/src/github/` — transport. `client.ts` (auth, GraphQL errors, REST ETag replay),
  `discovery.ts` (REST search for `wayfinder:map`), `map-query.ts` (the aliased GraphQL query and
  its batching).
- `apps/web/src/wayfinder/` — domain logic. `map-body.ts` parses the map template tolerantly;
  `tickets.ts` derives `closed | blocked | claimed | frontier`; `from-github.ts` turns raw payloads
  into `Project[]`.
- `apps/web/src/store/` — the poll loop and its React binding (`RoadmapProvider` / `useRoadmap`).

Two loops: maps every 90s, discovery every 5min. GraphQL polls can't be conditional (no ETag on
`POST /graphql`), so the only budget lever is the interval — the store stretches it when
`rateLimit.remaining` drops, and skips polling entirely while the tab is hidden.

The server (`apps/server/src/`) carries its own copy of `github/` and `wayfinder/` — the copy in
`apps/web` dies when the SPA hands over to the socket ([#21](https://github.com/asmundwien/roadmap/issues/21)).
On top of them: `store.ts` (the one snapshot both funnels feed, with coalescing invalidation),
`invalidation.ts` (delivery payload → refetch decision, per `docs/research/webhook-path.md` §2),
`webhook.ts` (best-effort HMAC, dedup, ACK-fast receiver), `relay.ts` (smee subscription,
reconcile on reconnect), `socket.ts` (full-snapshot WebSocket broadcast), `main.ts` (composition:
baseline sweep, then relay, then a 5-minute reconciler stretched by the rate-limit valve).

Data that may be partial says so rather than looking whole: `ticketsTruncated`, `blockersTruncated`,
`unreachable`, and `MapBody.missingSections`. Keep that habit.

## How the work is organized

This repo is driven by **wayfinder maps** — [v1 (issue #1)](https://github.com/asmundwien/roadmap/issues/1)
is the closed history; [v3: live events (issue #16)](https://github.com/asmundwien/roadmap/issues/16)
is the active effort. A map holds the destination, the decisions made so far, and the fog still
ahead; its child issues are the tickets. Before starting work, read the map and take a ticket from the frontier (open,
unblocked, unassigned). Use the `/wayfinder` skill rather than freelancing new work.

Note that this map carries **execution**, not just planning: its task tickets deliver working code.
