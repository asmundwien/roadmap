# Architecture

## System shape

Roadmap is a local-first, read-only application for one user. The repository has five workspace areas:

- `packages/contracts` defines domain types such as `Project`, `WayfinderMap`, `Ticket`, and `ApplicationState`. It also provides runtime codecs for transport messages through `@roadmap/contracts/codecs`.
- `packages/ui` provides domain-independent presentational components and design tokens through the `@roadmap/ui` workspace package.
- `apps/server` owns application state, persistence, integrations, and network access.
- `apps/web` renders application state and sends queries and commands.
- `apps/docs` owns the standalone catalog for public `@roadmap/ui` components and tokens.

WebSocket carries full state replacements. HTTP carries `query` and `execute` requests.

## Web application

`apps/web/src/store` is the SPA data layer. It replaces local state with complete WebSocket snapshots and sends HTTP queries and commands. It also handles epoch and sequence ordering, transport liveness, stale-state retention, command status and errors, and capped reconnect backoff.

`RoadmapProvider` and `useRoadmap` expose the current roadmap to views. Views never fetch directly.

`apps/web/src/main.tsx` mounts React Router 8.4's declarative `BrowserRouter`. `App.tsx` declares `Routes` and `Route` elements. `apps/web/src/router.ts` exports canonical route patterns and resource path helpers built with the library's `generatePath`.

| Path | Resource |
| --- | --- |
| `/` | Overview |
| `/connections` | Connections |
| `/connections/:connectionId` | Connection details |
| `/connections/:connectionId/projects/import` | Connection-scoped Project import |
| `/projects/:integration/:projectId` | Project's current map |
| `/projects/:integration/:projectId/settings` | Project settings |
| `/projects/:integration/:projectId/maps/:mapId` | Pinned map |
| `/projects/:integration/:projectId/maps/:mapId/tickets/:ticketId` | Ticket details on a pinned map |
| `/components` | Domain component catalog |

Navigation state belongs to the URL pathname, search, and fragment, without `useState` mirrors. Unknown paths and integrations other than `github` or `local` render "Page not found" instead of Overview. Old hash routes are unsupported; there is no compatibility redirect.

Resource adapters use the router's `pathParams` helper to match the original encoded pathname with the library's `matchPath`, then decode each captured parameter once. This preserves opaque IDs, including literal `%2F`, which React Router's already-decoded route parameters can otherwise collapse into slashes.

`apps/web/src/navigation.tsx` provides the app-local internal `Link`, `ButtonLink`, and `NavbarBrand`. It combines shared UI styles with React Router's `useHref` and `useLinkClickHandler`, retaining native anchor behavior for modified clicks, targets, and downloads. Views import internal links from `@/navigation` and keep native `@roadmap/ui` anchors for external and source URLs. `packages/ui` remains router-independent.

A production web host must return the SPA HTML for application navigation paths so direct loads and refreshes work. API endpoints and asset requests must bypass this fallback. This deployment requirement does not imply that a production host has been verified.

The map area lives in `apps/web/src/views/map`. `page.tsx` resolves the registered Project, live map, and URL-selected ticket from application state. `map-navigation.tsx` groups live maps and closed history. `map-container.tsx` owns the React Flow viewport and pan, zoom, and fit controls; `graph.ts` projects real blocked-by relationships and uses Dagre for layout. `ticket-node.tsx` renders ticket and unresolved or external blocker nodes. Closed tickets remain in the graph, with arrows from blockers to dependent tickets.

`ticket-modal.tsx` opens the URL-selected ticket in the shared native Modal. It retains ticket bodies, metadata, blockers, source links, Automation evidence, and eligible Automation controls. Opening a ticket pushes a pathname that pins its map and selects the ticket. Closing the Modal or returning to map prose replaces that history entry with the pinned map pathname, so Back does not reopen the closed ticket. Back and Forward otherwise restore the URL-selected map and ticket. `map-content.tsx` renders complete raw map Markdown inline below the graph, with a structured fallback when raw content is absent. `prose.tsx` renders Markdown and resolves references within the current Project and map: local ticket links open ticket details, map references return to map prose, and external references use available source links. Unresolvable local references explain why they cannot be opened. Missing tickets, incomplete blockers or map sections, warnings, and unavailable Projects or maps remain explicit rather than disappearing.

Application component styles use CSS Modules. Components resolve local class names with `classnames/bind`. Reusable styling belongs to shared components, not shared stylesheet imports. React Flow also imports its required vendor stylesheet for graph rendering and viewport controls.

Each routable area under `apps/web/src/views` has a `page.tsx` entry point. `App` routes the Connections list, `settings/connections/[connectionId]/page.tsx`, and its connection-scoped `import/page.tsx` independently. The detail page selects the Connection and composes sibling Details and Manage connection sections. Each section reads its own live state and owns its own commands, busy state, and errors. The import page registers a Project through the selected Connection. `shared/` and `shell/` are support areas, not pages.

The web catalog at `/components` documents components that are tightly coupled to the domain. These components map domain state to presentational props, and builds on agnostic content from `@roadmap/ui`.

React functions use named `...Props` types instead of inline object annotations.

Web source files use `@/` for imports outside their current directory. The alias maps to `apps/web/src`; sibling imports remain relative. TypeScript imports omit `.ts` and `.tsx` extensions.

## Documentation application

`apps/docs` consumes the public `@roadmap/ui` exports and token-layer guides. It owns catalog composition, navigation, and presentation behind a standalone static site, with no dependency on web source, domain contracts, application providers, or server configuration. Product encodings remain in `apps/web`.

## Server

`apps/server/src/application/application.ts` composes the transport-agnostic `RoadmapApplication`. It owns a consistent `ApplicationState`, adapter generations, serialized configuration changes, and the current roadmap without exposing adapter mechanics. Its public interface is `start/current/subscribe/query/execute/stop`; callers and tests use only that interface.

`application/configuration.ts` owns the strict `roadmap.config.json` codec and live validation. It writes through a temporary file in the same directory, flushes it, and atomically renames it. An invalid manual save leaves the last valid runtime active and blocks writes until the configuration is repaired.

Integration-specific code lives in `github` and `local`; `wayfinder` parses data tolerantly. The Local adapter discovers every `.wayfinder/<map-id>/map.md`, reads its sibling `tickets/` directory, and uses map frontmatter `status` to separate live maps from history. `store.ts` waits for one complete Slice from every Adapter before publishing a snapshot and keeps partial generations private. `change-feed.ts` derives source-blind events from consecutive complete snapshots.

`application/automation-database.ts` owns the strict schema version 3 Automation database. It
persists immutable opportunities and append-only events atomically, rejects invalid histories, and
replays valid history into current public evidence. An AFK Classification Verdict projects a queued
Wayfinder Session before launch admission; interruption acknowledgement remains evidence without
changing the unknown outcome. `application/automation.ts` owns event-driven reconciliation and
process launch behavior. Classification stays in one global lane; Wayfinder Sessions use one lane
per Project so separate Projects can run concurrently. Queued Sessions survive disabled Project
Automation. Reconciliation chooses a currently eligible Session without exposing a position or
ordering promise. Every transition is appended before its process side effect.

An unacknowledged interrupted Session blocks only its Project. Roadmap removes that Project from
Automation enablement. Project settings render the ordinary switch off and disabled, with an explicit
acknowledgement-and-enable action and a ticket link when the target resolves in live state. The
existing enable command appends acknowledgement of each specific unknown event before persisting
enablement, so either persistence failure remains fail-closed. Acknowledgement does not change the
unknown outcome. Public Automation evidence distinguishes queued, launching, running, terminal, and
outcome-unknown states, preserves each admitted stage's `automatic` or `override` reason, and marks
whether an unknown Session outcome has been acknowledged.

`transport.ts` is the network boundary. It provides a full-state WebSocket with strict origin checks and HTTP handlers for queries and commands. Request bodies cannot exceed 64 KiB. `main.ts` composes modules and binds loopback.

## Configuration and credentials

The root `.env.local` holds the public GitHub App identifiers. Device-flow credentials live in macOS Keychain. The schemas for `roadmap.config.json`, `ApplicationState`, and transport messages do not allow credentials.

## Partial data

The model marks incomplete data explicitly. Existing examples include `ticketsTruncated`, `blockersTruncated`, `unreachable`, and `MapBody.missingSections`.
