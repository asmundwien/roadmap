# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

**Roadmap** — a live, read-only visualization of [wayfinder](https://github.com/mattpocock)-organized
projects on GitHub. It discovers every repo carrying a `wayfinder:map` issue and renders each effort
as a living map: the dependency graph of tickets alongside the decisions made and the fog ahead.

Read-only, solo user, local-first. v1 is a browser-only SPA you run with `pnpm dev` — **there is no
backend**, and adding one needs a decision on the map, not a commit.

## Commands

Run everything from the repo root; pnpm comes from corepack.

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

Vite + React 19 + TypeScript, pnpm, Biome for lint/format, Vitest for tests.

Vitest runs in the `node` environment and picks up `src/**/*.test.ts` — no DOM, because nothing has
needed one yet. The first component test that does should add jsdom and Testing Library then.

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

- `src/github/` — transport. `client.ts` (auth, GraphQL errors, REST ETag replay), `discovery.ts`
  (REST search for `wayfinder:map`), `map-query.ts` (the aliased GraphQL query and its batching).
- `src/wayfinder/` — domain. `types.ts` is the vocabulary; `map-body.ts` parses the map template
  tolerantly; `tickets.ts` derives `closed | blocked | claimed | frontier`; `from-github.ts` turns
  raw payloads into `Project[]`.
- `src/store/` — the poll loop and its React binding (`RoadmapProvider` / `useRoadmap`).

Two loops: maps every 90s, discovery every 5min. GraphQL polls can't be conditional (no ETag on
`POST /graphql`), so the only budget lever is the interval — the store stretches it when
`rateLimit.remaining` drops, and skips polling entirely while the tab is hidden.

Data that may be partial says so rather than looking whole: `ticketsTruncated`, `blockersTruncated`,
`unreachable`, and `MapBody.missingSections`. Keep that habit.

## How the work is organized

This repo is driven by a **wayfinder map** — [issue #1](https://github.com/asmundwien/roadmap/issues/1).
The map holds the destination, the decisions made so far, and the fog still ahead; its child issues
are the tickets. Before starting work, read the map and take a ticket from the frontier (open,
unblocked, unassigned). Use the `/wayfinder` skill rather than freelancing new work.

Note that this map carries **execution**, not just planning: its task tickets deliver working code.
