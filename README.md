# Roadmap

Roadmap is a local, read-only view of projects organized with [wayfinder](https://github.com/mattpocock). It maps registered GitHub repositories and local workspaces, showing ground covered and fog together.

## Architecture

Roadmap is a pnpm workspace:

- `apps/web` is the Vite and React SPA.
- `apps/server` maintains the single `ApplicationState` and owns all external integrations.
- [apps/docs](apps/docs/README.md) is the standalone catalog for shared components and design tokens.
- `packages/contracts` defines shared domain types and runtime codecs for transport messages.
- `packages/ui` is the design system: tokens and presentational components, with no domain knowledge.

The server sends full state replacements over WebSocket. HTTP carries queries and commands. The browser renders server state and never receives credentials.

See [docs/architecture.md](docs/architecture.md) for the implementation map and [CONTEXT.md](CONTEXT.md) for the domain language.

## Development

Roadmap requires Node.js 22.12.0 or newer. pnpm is provided through Corepack.

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

Vitest runs in Node. DOM tests need jsdom and Testing Library.

The project map is available at `#/projects/<integration>/<project-id>`. Choose a live map or closed history in the grouped navigation. The dependency graph includes closed tickets and has pan, zoom, and fit controls. Select a ticket to open its details and Automation controls in the shared Modal; the URL preserves the selected map and ticket. Complete map prose appears inline below the graph, with a structured fallback when raw Markdown is unavailable. Partial and unavailable data remain explicit.

## Stack

Vite, Astro, React 19, TypeScript, pnpm workspaces, Biome, and Vitest.
