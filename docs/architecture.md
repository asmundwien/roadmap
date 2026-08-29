# Architecture

## System shape

Roadmap is local-first, read-only, and designed for one user. Three workspace areas divide the system:

- `packages/contracts` defines the domain vocabulary (`Project`, `WayfinderMap`, `Ticket`, `ApplicationState`, queries, commands, and results) and strict runtime transport codecs under `@roadmap/contracts/codecs`.
- `apps/server` owns the coherent application state, persistence, integrations, and network boundary.
- `apps/web` renders application state and sends bounded queries and commands.

WebSocket carries full state replacements. HTTP carries bounded `query` and `execute` requests.

## Web application

`apps/web/src/store` is the SPA data layer. It handles full-state WebSocket replacement, HTTP queries and commands, epoch and sequence ordering across both transports, liveness, stale-state retention, command activity and errors, and reconnect backoff. `RoadmapProvider` and `useRoadmap` project the current roadmap to views. Views never fetch directly.

`apps/web/src/router.ts` owns navigation in the URL hash. `#/owner/repo/<map>` identifies the open map; another segment identifies the Panel selection. `PanelSelection` resolves against each live snapshot into `ResolvedSelection`. Components do not mirror URL state in `useState`.

`apps/web/src/views` contains the map view. The ledger in `map/ledger.tsx` and `map/geometry.ts` draws titles. Descriptive text lives in the docked Panel rendered by `map/panel.tsx`, not in an overlay. `map/sequence.ts` owns traversal order and out-of-scope display planning; `map/prose.tsx` renders Panel prose as Markdown. `project-screen.tsx` owns the map's roving-tabindex keyboard navigation.

## Server

`apps/server/src/application/application.ts` composes the transport-agnostic `RoadmapApplication`. It owns coherent `ApplicationState`, adapter generations, serialized configuration mutations, and the current source-blind roadmap. Its public interface is `start/current/subscribe/query/execute/stop`; callers and tests cross that seam.

`application/configuration.ts` owns the strict `roadmap.config.json` codec, live validation, and same-directory flush plus atomic-rename persistence. An invalid manual save leaves the last valid runtime active and blocks writes until the configuration is repaired.

Integration mechanics remain behind `github` and `local`; `wayfinder` contains tolerant parsing. `store.ts` composes one complete baseline slice per integration and keeps partial generations private. `change-feed.ts` derives source-blind events from consecutive complete snapshots.

`transport.ts` is the network boundary: strict-origin full-state WebSocket plus bounded HTTP query and command handlers. `main.ts` composes modules and binds loopback.

## Configuration and credentials

The root `.env.local` holds the public GitHub App identifiers. Device-flow credentials live in macOS Keychain. Credentials remain server-side and are unrepresentable in `roadmap.config.json`, `ApplicationState`, and the strict transport envelopes.

## Partial data

Data that may be incomplete is represented explicitly rather than looking whole. Existing examples include `ticketsTruncated`, `blockersTruncated`, `unreachable`, and `MapBody.missingSections`.
