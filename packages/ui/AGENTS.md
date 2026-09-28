# UI package instructions

The root `AGENTS.md` also applies here. Read this package's `README.md` and the relevant token-layer README before changing shared styles.

- Keep components presentational. Do not import contracts or add domain vocabulary to this package, map domain states to component props in the consumer.
- Use CSS Modules for component styles. Resolve local names with `classnames/bind`; merge any caller-provided `className` without passing it through the module binding. Do not add or rely on global styling, keep component-specific styling local.
- Use semantic tokens for shared styling decisions. Keep raw values and roles in their respective token layers; do not copy token guidance into individual CSS files.
- Use named props types for exported components. Run the root checks and the package test script when changing behavior. Vitest processes CSS Modules with `css: true` so tests exercise actual scoped class names.
- Use compound components for flexible, composable APIs with independently configurable parts. Use props when the component has a simple, predictable set of variations.
- Write JSDoc for caller decisions, observable behavior, defaults, and accessibility; do not restate types, invent defaults, or document incidental implementation and CSS details.
- Do not use this package's `README.md` for component documentation; document component contracts in JSDoc or dedicated component docs.
