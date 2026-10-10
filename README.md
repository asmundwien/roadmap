# Roadmap

Roadmap is a local view of projects organized with [wayfinder](https://github.com/mattpocock). It reads GitHub and local source maps and tickets, and supports configuration, authorization, host actions, and opt-in Automation.

## Architecture

Roadmap is a pnpm workspace:

- `apps/web` is the Vite and React SPA.
- `apps/server` maintains the single `ApplicationState` and owns all external integrations.
- [apps/docs](apps/docs/README.md) is the standalone catalog for shared components and design tokens.
- `packages/contracts` owns authoritative browser-safe Zod 4 schemas and inferred external types through four exports: `identity`, `state`, `operations`, and `wire`. Backend domain, persisted intent, credentials, and durable events remain server-private.
- `packages/ui` is the design system: tokens and presentational components, with no domain knowledge.

The server sends full state replacements over WebSocket. HTTP carries queries and commands. Only a validated baseline from the current socket generation establishes browser authority. HTTP captures that authority when a request starts and cannot seed startup state. A valid different-session HTTP outcome can initiate fresh WebSocket synchronization, but cannot replace state itself. The browser never receives credentials.

Before the first authoritative state, the provider shows an explicit waiting status rather than a fabricated empty roadmap. Previously accepted facts remain visible through disconnect and reconnect, with a retained-state status until a valid baseline establishes synchronization. An open socket alone is not synchronization. Server Connection degradation and Project reachability remain separate facts.

The shared browser workflow owner captures current accepted readiness, policy, and configuration version when dispatch starts. Configuration mutations share one pending revision scope; refresh and native actions contend only on the same canonical Project. Views keep local drafts, not duplicate command or transport-error policy. Feedback distinguishes local refusal, attributable pre-admission rejection, decoded application outcome, and completion unknown. Closing a pane or dismissing feedback does not settle uncertainty. A newer snapshot is not a universal receipt. There is no automatic HTTP retry, replay, or native completion inference.

`state.projects` is the sole public Project and read-resource collection. Each Project carries its scoped identity, Connection association, management facts, source metadata, maps, tickets, reachability, and provenance. Map and Project views do not join registrations or raw roadmap Projects. Retained content keeps its actual graph, prose, and source links; incomplete readable content, never-observed resources, unavailability, proven absence, and known-empty membership remain distinct.

See [docs/architecture.md](docs/architecture.md) for private-to-public translation, shared workflow policy, variants, export and import rules, compiler projects, verification commands, and proof limits. [CONTEXT.md](CONTEXT.md) defines the domain language. HTTP outcomes are state-free; correlated committed registration and repair results supply canonical resource destinations rather than submitted-path identity guesses.

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

GitHub support uses the public `ROADMAP_GITHUB_APP_CLIENT_ID` and `ROADMAP_GITHUB_APP_SLUG` values. macOS Keychain stores device-flow credentials; environment files do not contain them. Local projects work without the GitHub App values.

Available scripts are defined in the root and package-level `package.json` files. Run the standard repository checks from the root:

```sh
pnpm check
pnpm typecheck
pnpm test
pnpm knip
```

`pnpm check` includes the repository architecture gate. `pnpm typecheck` includes separate contract/browser/server compilation and public-export positive and invalid-construction fixtures. To run the boundary checks or build the actual browser app directly:

```sh
pnpm architecture
node scripts/check-contract-types.mjs
pnpm --filter @roadmap/web build
```

The web production build checks resolved modules before tree shaking for Node, server, credential, and host-launch dependencies. The root `pnpm build` script invokes itself recursively; it is not the browser build command. These commands describe the installed gates, not a record that the final checks passed. Runtime observation and schema validation do not prove host-effect completion, deployment fallback, or durable Session chronology.

Vitest runs in Node. DOM tests need jsdom and Testing Library.

The shared-resource browser regression uses disposable source/configuration files, the actual public application and HTTP/WebSocket transport, and harmless GitHub/host/Automation substitutes:

```sh
pnpm install
pnpm exec playwright install chromium
pnpm test:resource-results-browser
node scripts/resource-results-browser.mjs --serve-only
node scripts/resource-results-browser.mjs --screenshots /tmp/roadmap-resource-results-visual
```

`--serve-only` prints the fixture URL and control endpoint for interactive inspection. `--screenshots` captures scenario PNGs during the complete run and cannot be combined with `--serve-only`. `--executable-path` or `CHROMIUM_EXECUTABLE_PATH` selects an installed Chromium. See the resource browser proof section in [docs/architecture.md](docs/architecture.md) for scenario contracts and proof limits. These commands do not claim an observed test result or native effect completion.

The workflow browser regression exercises current open-pane gates, both settlement orders, canonical navigation, retained drafts, per-attempt uncertainty, authorization phases, and independent durable Automation evidence:

```sh
pnpm test:workflows-browser
pnpm test:workflows-browser --screenshots /tmp/roadmap-workflow-proof
node scripts/workflows-browser.mjs --serve-only
```

The complete runner uses temporary files and harmless host/provider/process substitutes. `--essential-only` runs just the first concurrency regression; it is not the complete workflow proof. Direct-node serve-only handles SIGINT and SIGTERM and reports cleanup before exit.


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

Navigation uses URL pathnames. Old hash routes are unsupported and are not redirected. Unknown paths and invalid integrations show "Page not found".

Production hosting must serve the SPA HTML for navigation requests at these paths, including direct loads and refreshes. Exclude API endpoints and asset requests from this fallback. This is a deployment requirement, not a claim that a production host has been verified.

The project map is available at `/projects/:integration/:projectId`. Choose a live map or closed history in the grouped navigation. The dependency graph includes closed tickets and has pan, zoom, and fit controls. Select a ticket to open its details and Automation controls in the shared Modal; the URL preserves the selected map and ticket. Complete map prose appears inline below the graph, with a structured fallback when raw Markdown is unavailable. Partial and unavailable data remain explicit.

## Stack

Vite, Astro, React 19, React Router 8.4 with declarative `BrowserRouter`, TypeScript, pnpm workspaces, Biome, and Vitest.
