# Ticket mark

`TicketMark` is the application's visual encoding of a ticket's state and type. It renders one complete SVG icon at one of three supported sizes.

## Interface

```tsx
<TicketMark state={ticket.state} type={type} size="large" />
```

The component accepts only product facts and its size:

- `state` is a `TicketState`.
- `type` is a `TicketType`.
- `size` is `large`, `medium`, or `small`.

Callers do not select colors, fills, glyphs, corners, SVG coordinates, or paths.

## Visual encoding

Ticket state controls the main color and fill:

| State | Label | Fill |
| --- | --- | --- |
| `blocked` | Blocked | Outline |
| `frontier` | Takeable | Full |
| `claimed` | Claimed | Half |
| `closed` | Decided | Full |

Ticket type controls the glyph, accent color, and number of corner strokes:

| Type | Glyph | Corners |
| --- | --- | ---: |
| `untyped` | `·` | 0 |
| `research` | `R` | 1 |
| `prototype` | `P` | 2 |
| `grilling` | `G` | 3 |
| `task` | `T` | 4 |

A closed ticket replaces the type glyph with a check mark. Its type remains visible through the corner strokes.

## Sizes

All sizes use the same SVG structure and normalized `32 × 32` view box. Size changes the root SVG dimensions, not its content.

| Size | Use |
| --- | --- |
| `large` | Primary ticket mark on the map |
| `medium` | Secondary mark beside map status text |
| `small` | Inline mark beside HTML text |

Do not remove glyphs or corner strokes at smaller sizes. Any future optical adjustment belongs inside `TicketMark` and must preserve the `state`, `type`, and `size` interface.

## Placement

`TicketMark` owns its local SVG coordinate system. The consumer owns placement.

HTML consumers place it through normal layout:

```tsx
<Badge variant={stateMeta.variant}>
  <TicketMark state={ticket.state} type={type} size="small" />
  {stateMeta.word}
</Badge>
```

SVG consumers translate a wrapper to the required map coordinate:

```tsx
<g transform={`translate(${x} ${y})`}>
  <TicketMark state={ticket.state} type={type} size="large" />
</g>
```

Do not add map coordinates to `TicketMark`. The icon must not know where a row, tooltip, or map node places it.

## Color tokens

`apps/web/src/styles/component-colors.css` defines the component tokens. State tokens color the face and glyph. Type tokens color the corner strokes. Every component token aliases a semantic color role.

The component does not read reference colors, legacy `--variant-*` variables, or map-specific aliases.

## Accessibility

The icon is decorative because each application use has an adjacent state label or an accessible ticket-row label. `TicketMark` therefore sets `aria-hidden="true"` and `focusable="false"`. Consumers must provide the ticket meaning in text or in the containing control's accessible name.
