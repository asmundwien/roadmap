# Roadmap

Roadmap is a local, read-only view of projects organized with [wayfinder](https://github.com/mattpocock). It maps registered GitHub repositories and local workspaces, showing ground covered and fog together.

## Architecture

Roadmap is a pnpm workspace:

- `apps/web` is the Vite and React SPA.
- `apps/server` maintains the single `ApplicationState` and owns all external integrations.
- `packages/contracts` defines shared domain types and runtime codecs for transport messages.

The server sends full state replacements over WebSocket. HTTP carries queries and commands. The browser renders server state and never receives credentials.

See [docs/architecture.md](docs/architecture.md) for the implementation map and [CONTEXT.md](CONTEXT.md) for the domain language.

## Development

Roadmap requires Node.js 22 or newer. pnpm is provided through Corepack.

Copy `.env.example` to the repository-root `.env.local`, then start both applications:

```sh
pnpm dev
```

GitHub support uses the public `ROADMAP_GITHUB_APP_CLIENT_ID` and `ROADMAP_GITHUB_APP_SLUG` values. macOS Keychain stores device-flow credentials; environment files do not contain them. Local projects work without the GitHub App values.

Available scripts are defined in the root and package-level `package.json` files. Run the standard repository checks from the root:

```sh
pnpm check
pnpm typecheck
pnpm test
```

Vitest runs in Node. DOM tests need jsdom and Testing Library.

## Stack

Vite, React 19, TypeScript, pnpm workspaces, Biome, and Vitest.
