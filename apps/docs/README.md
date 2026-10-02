# @roadmap/docs

Standalone Astro catalog for the public components and design tokens in `@roadmap/ui`, with React previews.

## Development

Run these commands from the repository root:

```sh
pnpm --filter @roadmap/docs dev
pnpm --filter @roadmap/docs build
pnpm --filter @roadmap/docs preview
```

## Catalog implementation

Files under `src/pages/` define routes through Astro's conventions. Sidebar provides links for site navigation.

Previews use public `@roadmap/ui` exports. Component types and JSDoc define their contracts; the catalog demonstrates them rather than maintaining a second prose specification. Token introductions render the README files beside the reference and semantic token layers through `src/catalog/markdown.tsx` for a single source of truth.

The layout loads `@roadmap/ui/index.css` once and attaches local classes from `document.module.css` to `html` and `body`. The shell, prose renderer, and previews each own colocated CSS Modules. React renders previews at build time; only the modal and toggle pages use `client:load` for stateful interactions. Native links and text inputs need no hydration. Keep provider-dependent previews together within one React island.
