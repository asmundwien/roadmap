# Docs app instructions

## Ownership

- Keep this app independent of Roadmap runtime state. Do not import web source, domain contracts, application providers, or server configuration.
- Preview components through public `@roadmap/ui` exports. Product encodings stay in `apps/web`; do not duplicate them here.
- Keep component contracts in their types and JSDoc, and token guides beside their token layers. Use catalog pages for live examples and consumer guidance, not duplicate specifications.
- Keep docs-app implementation and development details in this app's README. Root architecture describes module ownership and dependencies, not catalog internals.

## Navigation

- Use ordinary links for page navigation. Keep the URL as the only navigation state; preserve direct loads, refresh, and browser history. Hashes are only for anchors within a page.
- Render documentation and previews at build time. Add hydration only for React examples that need event handlers or state; keep provider-dependent examples within one React island.

## Styling

- Use colocated CSS Modules for every docs-owned stylesheet. Do not add global selectors, reset stylesheets, or `:global` rules.
- Use semantic `--sys-*` tokens for the shell, prose, and component previews. Only reference-value previews may read `--ref-*` directly.

## Verification

Follow the root repository checks. Also run `pnpm --filter @roadmap/docs build` and exercise affected pages in the browser. Keep runnable commands and local implementation details in README.md.
