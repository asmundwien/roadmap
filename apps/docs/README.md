# @roadmap/docs

Standalone Vite/React catalog for the public components and design tokens in `@roadmap/ui`. It runs and builds without the Roadmap server, domain state, credentials, or environment configuration. Product encodings belong to the web application's `#/components` catalog.

## Development

Run these commands from the repository root:

```sh
pnpm --filter @roadmap/docs dev
pnpm --filter @roadmap/docs build
pnpm --filter @roadmap/docs preview
```

Development uses `http://localhost:5174`; the production preview uses `http://localhost:4174`. Both require their configured port to be available. The build writes static output to `apps/docs/dist`.

## Catalog implementation

`src/App.tsx` defines each page with an explicit pathname case and declares sidebar links directly. Paths such as `/tokens/reference` and `/components/mark` render one catalog page at a time. Ordinary links perform document navigation; the browser owns direct loads, refresh, and history. There is no routing dependency, generated route registry, or React navigation state.

The root path `/` opens the reference-token introduction. Unknown paths render a page-not-found screen with a link home. Each page sets its document title and marks its sidebar link with `aria-current="page"`. The brand links to `/`; the skip link uses `#catalog-content` only to focus the current page's main content.

Previews use public `@roadmap/ui` exports. Component types and JSDoc define their contracts; the catalog demonstrates them rather than maintaining a second prose specification. Token introductions render the README files beside the reference and semantic token layers through `src/catalog/markdown.tsx`.

`src/main.tsx` loads `@roadmap/ui/index.css` once and attaches local classes from `document.module.css` to `html` and `body`. The shell, prose renderer, and previews each own colocated CSS Modules.

## Static hosting

The build has one HTML entry, not a generated HTML file for each page. Serve `dist` with a fallback that returns `dist/index.html` for documentation path requests while serving assets normally. Without that fallback, direct loads and refreshes at paths such as `/components/mark` fail before React runs. Vite's development and preview servers already provide this fallback.

## Verification

Run `pnpm check`, `pnpm typecheck`, and `pnpm test` from the repository root, then build this app. Exercise affected catalog pages in the browser, including direct pathname loads, refresh, history navigation, and unknown paths. Verify the production build with the preview command.
