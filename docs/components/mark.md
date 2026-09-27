# Mark

`Mark` is the diamond icon primitive in `packages/ui/src/components/mark/mark.tsx`, exported from `@roadmap/ui/mark`. It renders one complete SVG at one of three sizes and knows nothing about tickets, Automation, or any other domain concept.

## Interface

```tsx
<Mark size="large" variant="info" fill="half" glyph="P" corners={2} accent="warning" />
```

- `size` is `large`, `medium`, or `small`.
- `variant` is a `Variant` and colors the face and glyph.
- `fill` is `solid`, `half`, or `outline`.
- `glyph` is an optional single character.
- `corners` is `0` through `4` and draws that many corner strokes.
- `accent` is an optional `Variant` that colors the corner strokes.

A solid face knocks the glyph out in the surface color. The other fills draw the glyph in the variant color with a surface halo, so it stays legible over a two-tone or empty face.

## Encoding lives in views

`Mark` carries no meaning. Each view owns a table that maps its own facts onto mark props, so one concept cannot render two ways at two callsites.

`views/shared/ticket-presentation.ts` holds the ticket encoding and `views/shared/ticket-mark.tsx` applies it. State chooses the color and the fill; type chooses the glyph, the corner count, and the accent color:

| State | Word | Variant | Fill |
| --- | --- | --- | --- |
| `blocked` | blocked | `danger` | outline |
| `frontier` | takeable | `success` | solid |
| `claimed` | claimed | `info` | half |
| `closed` | decided | `muted` | solid |

| Type | Glyph | Corners | Accent |
| --- | --- | ---: | --- |
| `untyped` | `·` | 0 | `neutral` |
| `research` | `R` | 1 | `success` |
| `prototype` | `P` | 2 | `warning` |
| `grilling` | `G` | 3 | `danger` |
| `task` | `T` | 4 | `accent` |

A decided ticket replaces its type glyph with a check mark. Its type stays visible through the corner strokes.

`views/map/automation-presentation.ts` holds the Automation encoding in `AUTOMATION_VARIANT`: classification is `highlight` and wayfinder is `info`. An Automation tag is a medium mark, solid, with the stage glyph and no corners. The legend badges read the same constant, so a stage color changes in one place. Wayfinder and a claimed ticket resolve to the same color; the glyph and the slot carry the difference.

## Placement

`Mark` owns its local coordinate system and the consumer owns placement. HTML consumers place it through normal layout. SVG consumers translate a wrapper:

```tsx
<g transform={`translate(${x} ${y})`}>
  <Mark size="large" {...props} />
</g>
```

Do not add map coordinates to `Mark`. `MEDIUM_MARK_EXTENT` exports half the drawn width of a medium mark for views that lay out around one, such as the Automation ribbon in `ticket-node.tsx`.

## Tokens

`mark.module.css` reads semantic color roles for its surface and variants, a semantic spacing step for the inline margin, and a semantic font weight for the glyph. It does not read reference tokens or view-level aliases such as `--state-blocked`. Stroke widths and the glyph size stay literal in the CSS Module: they are viewBox units that scale with the drawing, not layout dimensions.

## Accessibility

The icon is decorative: every use has an adjacent state label or an accessible row label. `Mark` sets `aria-hidden="true"` and `focusable="false"`, so consumers must carry the meaning in text or in the containing control's accessible name.
