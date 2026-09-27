# Architecture

## System shape

Roadmap is a local-first, read-only application for one user. The code is split across four workspace areas:

- `packages/contracts` defines domain types such as `Project`, `WayfinderMap`, `Ticket`, and `ApplicationState`. It also provides runtime codecs for transport messages through `@roadmap/contracts/codecs`.
- `packages/ui` is the design system: presentational components and the design tokens they read, published as `@roadmap/ui`. It depends on no domain type.
- `apps/server` owns application state, persistence, integrations, and network access.
- `apps/web` renders application state and sends queries and commands.

WebSocket carries full state replacements. HTTP carries `query` and `execute` requests.

## Web application

`apps/web/src/store` is the SPA data layer. It replaces local state with complete WebSocket snapshots and sends HTTP queries and commands. It also handles epoch and sequence ordering, transport liveness, stale-state retention, command status and errors, and capped reconnect backoff.

`RoadmapProvider` and `useRoadmap` expose the current roadmap to views. Views never fetch directly.

`apps/web/src/router.ts` owns navigation in the URL hash. `#/owner/repo/<map>` identifies the open map; another segment identifies the Panel selection. `PanelSelection` resolves against each live snapshot into `ResolvedSelection`. Components do not mirror URL state in `useState`.

`apps/web/src/views` groups screens by area. The map area lives in `map/`; `map/ledger.tsx` and `map/geometry.ts` draw titles. Descriptive text lives in the docked Panel rendered by `map/panel.tsx`, not in an overlay. `map/sequence.ts` owns traversal order and decides which out-of-scope items to display. `map/prose.tsx` renders Panel prose as Markdown. `map/project-screen.tsx` owns the map's roving-tabindex keyboard navigation.

Each routable area under `apps/web/src/views` has a `page.tsx` entry point. Page modules select data and compose named sections; section implementation stays in sibling files. `shared/` and `shell/` are support areas, not pages.

`views/catalog/page.tsx` composes separate reference sections for colors, typography, dimensions, and motion. Catalog previews read `--ref-*` directly to compare literal values; product views continue to read semantic tokens.

Reusable UI lives in `packages/ui`, with each component's implementation, styles, and tests in its own folder. The package has no barrel: each component is its own export subpath, so views import `@roadmap/ui/badge`, `@roadmap/ui/mark`, `@roadmap/ui/variant`, and so on, and never reach into its folders by file path. Components carry no domain types or domain vocabulary: they use the shared `Variant` color vocabulary and their own presentational props. `Mark` is the diamond primitive, and views own the encoding that drives it. `views/shared/ticket-presentation.ts` maps ticket state and type onto mark props and state words, `views/shared/destination-mark.tsx` draws the Wayfinder destination in the goal color, and `views/map/automation-presentation.ts` maps each Automation stage onto a variant. The catalog at `#/components` documents the token layers and supported component variants.

`packages/ui/src/styles` holds four token families: color, space, typography, and motion. Reference values live in `styles/references/` as `colors.css`, `spacing.css`, `typography.css`, and `motion.css`. Tokens generally run from reference values through semantic roles to component parts; role-specific layout widths start at the semantic layer. `tokens.css` imports the layers in that order. Spacing and typography reference steps have semantic names; palette steps retain numeric names. Typography tokens do not define letter spacing. `apps/web/src/main.tsx` loads `@roadmap/ui/tokens.css` before `index.css`. Components read `--comp-*`, product views read `--sys-*`, and the semantic layer and catalog previews read `--ref-*`. Component stylesheets hold no literal dimension, type value, or duration; the exceptions are media-query widths, which custom properties cannot express, and the mark's viewBox geometry. `index.css` keeps the legacy color aliases that unmigrated views still read and defines no measurement of its own.

`packages/ui` styles every component with CSS Modules: each folder holds `<component>.module.css`, and the class names inside are local and unprefixed, since the module already scopes them. Components bind the module once with `classnames/bind` as `cx` and compose only their own class names through it. A caller's `className` is a foreign name and is merged with plain `cn`, so a local name can never rewrite it. A class name that no rule defines is not emitted, so the markup carries no dead hooks, and `packages/ui/vitest.config.ts` sets `css: true` so tests resolve real scoped names instead of stubs. Nothing outside the package can select into a component: a view that needs to place a component passes `className` where the component accepts one, or the component reads a `--comp-*` token the context overrides.

React functions use named `...Props` types instead of inline object annotations. Dynamic class composition in `apps/web` uses `classnames` imported as `cn`; modules do not define class-name helper functions.

Web source files use `@/` for imports outside their current directory. The alias maps to `apps/web/src`; sibling imports remain relative. TypeScript imports omit `.ts` and `.tsx` extensions.

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
Automation enablement. The web switch therefore renders off; turning it on appends acknowledgement
of each specific unknown event before persisting enablement, so either persistence failure remains
fail-closed. Public Automation evidence distinguishes queued, launching, running, terminal, and
outcome-unknown states, preserves each admitted stage's `automatic` or `override` reason, and marks
whether an unknown Session outcome has been acknowledged.

`transport.ts` is the network boundary. It provides a full-state WebSocket with strict origin checks and HTTP handlers for queries and commands. Request bodies cannot exceed 64 KiB. `main.ts` composes modules and binds loopback.

## Configuration and credentials

The root `.env.local` holds the public GitHub App identifiers. Device-flow credentials live in macOS Keychain. The schemas for `roadmap.config.json`, `ApplicationState`, and transport messages do not allow credentials.

## Partial data

The model marks incomplete data explicitly. Existing examples include `ticketsTruncated`, `blockersTruncated`, `unreachable`, and `MapBody.missingSections`.
