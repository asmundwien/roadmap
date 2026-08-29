# Roadmap

Roadmap is a local, read-only visualization of [wayfinder](https://github.com/mattpocock)-organized projects. It renders explicitly registered GitHub repositories and local workspaces as dependency maps, with the ground covered and unresolved fog visible together.

## Architecture

Roadmap is a pnpm workspace:

- `apps/web` is the Vite and React SPA.
- `apps/server` owns one coherent `ApplicationState` and all external integrations.
- `packages/contracts` provides the shared domain model and strict transport-envelope vocabulary.

The server sends full state replacements over WebSocket. Bounded HTTP requests carry queries and commands. The browser is a renderer over this state and never receives credentials.

See [docs/architecture.md](docs/architecture.md) for the implementation map and [CONTEXT.md](CONTEXT.md) for the domain language.

## Development

Roadmap requires Node.js 22 or newer. pnpm is provided through Corepack.

Copy `.env.example` to the repository-root `.env.local`, then start both applications:

```sh
pnpm dev
```

GitHub support uses the public `ROADMAP_GITHUB_APP_CLIENT_ID` and `ROADMAP_GITHUB_APP_SLUG` values. Device-flow credentials are stored in macOS Keychain; they are not environment secrets. Local projects work without the GitHub App values.

Available scripts are defined in the root and package-level `package.json` files. Run the standard repository checks from the root:

```sh
pnpm check
pnpm typecheck
pnpm test
```

Vitest currently runs in the Node environment. A component test that needs a DOM must add jsdom and Testing Library first.

## Stack

Vite, React 19, TypeScript, pnpm workspaces, Biome, and Vitest.
