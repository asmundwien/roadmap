# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

**Roadmap** — a live, read-only visualization of [wayfinder](https://github.com/mattpocock)-organized
projects on GitHub. It discovers every repo carrying a `wayfinder:map` issue and renders each effort
as a living map: the dependency graph of tickets alongside the decisions made and the fog ahead.

Read-only, solo user, local-first. The repo is a pnpm workspace: `apps/web` is the SPA, `apps/server`
owns one coherent `ApplicationState`, and `packages/contracts` (`@roadmap/contracts`) holds shared
domain and strict transport-envelope vocabulary. WebSocket sends full state replacements; bounded
HTTP requests carry queries and commands.

## Commands

Run everything from the repo root; pnpm comes from corepack. Root scripts cover repository-wide
workflows; target package-specific scripts on demand with `pnpm --filter <package> <script>`.

| Command          | What it does                              |
| ---------------- | ----------------------------------------- |
| `pnpm dev`       | Server (:8790) + Vite (:5173), together   |
| `pnpm build:web` | Typecheck then build the web application  |
| `pnpm typecheck` | Types only                                |
| `pnpm test`      | Vitest, once                              |
| `pnpm check`     | Biome lint + format check                 |
| `pnpm fix`       | Biome autofix + format                    |

Examples: `pnpm --filter @roadmap/web preview` and `pnpm --filter @roadmap/server test:watch`.

`pnpm check`, `pnpm typecheck`, and `pnpm test` all pass before anything is called done.

## Stack

Vite + React 19 + TypeScript, pnpm workspaces, Biome for lint/format (one root `biome.json`),
Vitest for tests.

Vitest runs in the `node` environment and picks up `apps/web/src/**/*.test.ts` — no DOM, because
nothing has needed one yet. The first component test that does should add jsdom and Testing Library
then.

`.env.local` stays at the repo root. The server reads secrets only from `ROADMAP_` values. The
browser sees no credentials; optional `VITE_ROADMAP_SERVER_URL` names the server HTTP origin
(default `http://localhost:8790`), from which the web store derives both HTTP endpoints and `/ws`.

## Conventions

- **Biome is the authority** on style — single quotes, no semicolons, 2-space indent, 100 columns.
  Don't hand-format; run `pnpm fix`.
- `any` and non-null assertions (`!`) are lint errors. Narrow properly, or make the type honest.
- `strict` plus `noUncheckedIndexedAccess` are on: indexing an array yields `T | undefined`.
- `console.log` warns; `console.error`/`warn`/`info` are allowed.
- Components are named exports (`export function App()`), not default exports.

## GitHub API

The registered-repository endpoints, authorization boundary, rate-limit strategy, and GraphQL map
query are documented in
**[docs/research/github-api-primitives.md](docs/research/github-api-primitives.md)**. Read it before
writing fetch code; do not re-derive it.

GitHub uses a maintainer-owned public GitHub App configured by
`ROADMAP_GITHUB_APP_CLIENT_ID` and `ROADMAP_GITHUB_APP_SLUG`. Device-flow credentials stay in
macOS Keychain; they never enter configuration, browser state, URLs, logs, health output, or wire
messages. Local-only startup remains supported when the App identifiers are absent.

## The data layer

Views never fetch. They read `useRoadmap()`; the SPA remains a pure renderer:

- `packages/contracts/` — the domain vocabulary (`Project`, `WayfinderMap`, `Ticket`,
  `ApplicationState`, queries, commands, results) plus strict runtime transport codecs under
  `@roadmap/contracts/codecs`.
- `apps/web/src/store/` — the SPA's whole data layer: full-state WebSocket replacement, bounded
  HTTP `query`/`execute`, epoch/sequence ordering across both wires, `transport` liveness
  (`connecting | live | disconnected`), stale-state retention, command activity/error state, and
  reconnect backoff. `RoadmapProvider` / `useRoadmap` project the roadmap for current views.
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

The server (`apps/server/src/`) is composed through `application/application.ts`: the deep,
transport-agnostic `RoadmapApplication` owns coherent `ApplicationState`, Adapter generations,
serialized configuration mutations, and the current source-blind roadmap. Its only public
Interface is `start/current/subscribe/query/execute/stop`; callers and tests cross that seam.
`application/configuration.ts` owns the strict `roadmap.config.json` codec, live validation, and
same-directory flush + atomic-rename persistence. Invalid manual saves leave the last valid runtime
active and gate writes until repaired.

Integration mechanics remain behind `github/` and `local/`; `wayfinder/` holds tolerant parsing.
`store.ts` composes one complete baseline Slice per Integration and keeps partial generations
private. `change-feed.ts` derives source-blind events from consecutive complete snapshots.
`transport.ts` is the one network Module: strict-origin full-state WebSocket plus bounded HTTP
query/command handlers. `main.ts` only composes Modules and binds loopback. Configuration and
credentials stay server-side; `roadmap.config.json` is gitignored and secrets are unrepresentable
in its codec, `ApplicationState`, and strict transport envelopes.

Data that may be partial says so rather than looking whole: `ticketsTruncated`, `blockersTruncated`,
`unreachable`, and `MapBody.missingSections`. Keep that habit.

## How the work is organized

This repo is driven by **wayfinder maps** — the closed maps ([v1 #1](https://github.com/asmundwien/roadmap/issues/1)
through the rest) are the history; the active effort is whatever `wayfinder:map` issue is open.
A map holds the destination, the decisions made so far, and the fog still
ahead; its child issues are the tickets. Before starting work, read the map and take a ticket from the frontier (open,
unblocked, unassigned). Use the `/wayfinder` skill rather than freelancing new work.

Note that this map carries **execution**, not just planning: its task tickets deliver working code.
