# Roadmap

Roadmap is a local view of projects organized with [wayfinder](https://github.com/mattpocock). It reads GitHub and local source maps and tickets, and supports configuration, authorization, host actions, and opt-in Automation.

## Architecture

Roadmap is a pnpm workspace:

- `apps/web` is the Vite and React SPA.
- `apps/server` maintains the single `ApplicationState` and owns all external integrations.
- [apps/docs](apps/docs/README.md) is the standalone catalog for shared components and design tokens.
- `packages/contracts` owns authoritative browser-safe Zod 4 schemas and inferred external types through four exports: `identity`, `state`, `operations`, and `wire`. Backend domain, persisted intent, credentials, and durable events remain server-private.
- `packages/ui` provides design tokens and presentational components.

The server sends full state replacements over WebSocket. HTTP carries queries and commands. A validated state from the current socket generation establishes browser authority. Credentials stay server-side.

The provider shows a waiting status until the first authoritative state arrives. Accepted content remains visible through disconnect and reconnect, with a retained-state status until synchronization completes.

Shared workflow policy coordinates configuration mutations and Project-scoped actions. Views own local drafts. Feedback distinguishes local refusal, pre-admission rejection, application outcomes, and uncertain completion.

`state.projects` contains the public Project and resource collection. Each Project carries its scoped identity, Connection association, management facts, source metadata, maps, tickets, reachability, and provenance. Views distinguish readable content, retained content, incomplete data, unavailable resources, proven absence, and known-empty collections.

See [docs/architecture.md](docs/architecture.md) for module ownership, transport contracts, workflow policy, and verification commands. [CONTEXT.md](CONTEXT.md) defines the domain language.

## Development

Roadmap requires Node.js 22.22.0 or newer. pnpm is provided through Corepack.

Copy `.env.example` to the repository-root `.env.local`, then start all development apps:

```sh
pnpm dev
```

`pnpm dev` starts all apps:

- apps/server: `http://localhost:8790`
- apps/web: `http://localhost:5173`
- apps/docs: `http://localhost:5174`

GitHub support uses the public `ROADMAP_GITHUB_APP_CLIENT_ID` and `ROADMAP_GITHUB_APP_SLUG` values. macOS Keychain stores device-flow credentials. Local projects need only their source directories.

Available scripts are defined in the root and package-level `package.json` files. Run the standard repository checks from the root:

```sh
pnpm check
pnpm typecheck
pnpm test
pnpm knip
```

`pnpm check` runs Biome. `pnpm typecheck` runs workspace TypeScript compilation and Astro checking. To build the browser app directly:

```sh
pnpm --filter @roadmap/web build
```

Vitest runs in Node. DOM tests need jsdom and Testing Library.

## Navigation

Canonical application paths are:

| Path | Page |
| --- | --- |
| `/` | Overview |
| `/connections` | Connections |
| `/connections/:connectionId` | Connection details |
| `/connections/:connectionId/projects/import` | Import projects through a Connection |
| `/projects/:integration/:projectId` | Project map |
| `/projects/:integration/:projectId/settings` | Project settings |
| `/projects/:integration/:projectId/maps/:mapId` | Pinned map |
| `/projects/:integration/:projectId/maps/:mapId/tickets/:ticketId` | Ticket details on a pinned map |
| `/components` | Domain component catalog |

Navigation uses URL pathnames. Unknown paths and invalid integrations show "Page not found".

Production hosting must serve the SPA HTML for navigation requests at these paths, including direct loads and refreshes. Route API endpoints and asset requests separately.

The project map is available at `/projects/:integration/:projectId`. Choose a live map or closed history in the grouped navigation. The dependency graph includes closed tickets and has pan, zoom, and fit controls. Select a ticket to open its details and Automation controls in the shared Modal; the URL preserves the selected map and ticket. Complete map prose appears inline below the graph, with a structured fallback when raw Markdown is unavailable. Partial and unavailable data remain explicit.

## Stack

Vite, Astro, React 19, React Router 8.4 with declarative `BrowserRouter`, TypeScript, pnpm workspaces, Biome, and Vitest.
