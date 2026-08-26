# Roadmap

Roadmap is a local, read-only visualization of [wayfinder](https://github.com/mattpocock)-organized
projects. It renders explicitly registered GitHub repositories and local workspaces as dependency
maps, with the ground covered and unresolved fog visible together. GitHub Connections use a
read-only GitHub App device flow, and all credentials stay in macOS Keychain.

## Development

Copy `.env.example` to `.env.local`, then run `pnpm dev`. GitHub support requires the public App
client ID and slug; Local projects work without them. The active implementation effort is the open
issue labelled `wayfinder:map`.
