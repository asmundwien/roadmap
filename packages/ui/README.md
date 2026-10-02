# @roadmap/ui

This workspace package contains presentational React components and shared design tokens. It has no dependency on domain types. Views interpret domain data and pass presentational props to the components.

## Setup

Load `@roadmap/ui/index.css` once at the application entry, before application styles. It provides shared tokens used by the components.

## Documentation

The standalone [docs app](../../apps/docs/README.md) previews this package's public exports. Component contracts live in their types and JSDoc; token-layer guides live beside the tokens.

## Example of usage

Import components exported by [`package.json`](./package.json). For example:

```tsx
import { Badge } from "@roadmap/ui/badge";

<Badge variant="info">Connected</Badge>;
```

`Button`s and `Link`s should be used appropriately, but for navigation styled as a button, import `ButtonLink` from `@roadmap/ui/button`.

Components that accept `className` preserve caller classes even when they match a local CSS Module key.

## Organization

Components, their CSS Modules, and their tests live together in `src/components/`. Component-specific styles stay with the component. Shared values and roles live under `src/styles/`; see the [reference](./src/styles/references/README.md) and [semantic](./src/styles/semantic/README.md) layer guides.
