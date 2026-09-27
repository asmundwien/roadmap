# Semantic tokens

Semantic tokens name a value's purpose across the interface. For example, a background role and its readable foreground express a relationship that stays meaningful when their values change with the color scheme. Prefer mapping roles to reference values where practical.

Put shared roles here. Raw value catalogs belong in `../references/`; decisions specific to one component or interaction state belong with that component.

This follows [Material's system token model](https://m3.material.io/foundations/design-tokens/overview). [MUI's palette guide](https://mui.com/material-ui/customization/palette/) illustrates role-based colors and contrasting text; its theme API and token names are not this project's CSS API.
