# Roadmap

A live, read-only visualization of wayfinder-organized efforts on GitHub. The vocabulary here is
what the views render; the wayfinder ticket-state terms (`closed`, `blocked`, `claimed`,
`frontier`) are defined in code at `packages/contracts` and are not restated.

## Language

**Roadmap**:
A route being travelled through partly-charted territory toward a pinned destination. Mechanically
it has three features, and a view lacking any one of them is not a roadmap: a direction of travel,
a behind/ahead asymmetry (ground covered drawn as a trace, not restyled future), and drawn
ignorance (fog rendered distinctly from confident empty canvas).
_Avoid_: pipeline, board, backlog, dashboard

**Ground covered**:
The route already travelled — the closed tickets and the decisions they produced, drawn as an
accumulating trace behind the traveller.
_Avoid_: done column, completed items

**Fog**:
What the effort knows it cannot yet see — undrawn territory ahead, visible as ignorance but never
measured. Fog has extent on screen, not magnitude.
_Avoid_: remaining work, backlog, todo

**Progress**:
The accumulation of ground covered, set beside visible fog. Past-only by definition: fog makes any
denominator unknowable, so progress is never a fraction, a percentage, or a distance-to-go.
_Avoid_: percent complete, completion, burn-down

**Destination**:
What reaching the end of a map looks like — pinned in view as the thing travelled toward, not a
status to compute.
_Avoid_: goal state, 100%

**Active map**:
The map a project is currently travelling — its most recently updated open map. A project aspires
to one open map at a time; when several are open, one is active and the others are live but
secondary. A project's future past its active map is not fog — it is unimagined, and nothing is
drawn there.
_Avoid_: current map, default map, main map

**Change feed**:
The stream of domain events — a ticket closed, a frontier changed, a map appeared — derived by
diffing consecutive snapshots of roadmap state. Source-blind by construction: whether a change was
caught by a webhook or a reconciling sweep is invisible to consumers. Triggers subscribe to the
feed, never to transports.
_Avoid_: webhook stream, event log, activity feed

**Resting**:
The state of a project whose maps are all closed — between efforts, its trace intact. A legitimate,
visible state, not an error or an empty case.
_Avoid_: archived, inactive, finished, empty

**Panel**:
The docked column that eats the page — the map view's one detail layer. It flexes in beside the
map and takes its width from it, so the map stays clickable and pick after pick opens without a
close in between. The map itself renders titles only; every descriptive text lives here.
_Avoid_: drawer, modal, overlay, sidebar

**Selection**:
The URL-pinned pick the Panel shows — carried as the hash's selection segment, resolved against
the live snapshot on every render, never mirrored in component state. One selection per screen;
activating the selected item again deselects it and the Panel folds shut.
_Avoid_: active item, highlight, focus (an input mechanism, not the pick)

**Hover**:
The one entity shared by mouse and keyboard, owned by whichever hand moved last — the row under
the pointer, or the focused row while the keyboard drives. It lights the hovered ticket's
dependency lineage; an arrow press steps from wherever the entity currently sits.
_Avoid_: mouseover, focus ring (each is one hand's half of it)

**Item link**:
The one presentation of a referenced item wherever the Panel mentions one: the title over the
item's state — glyph and word in the map's colors, exactly as the ledger's rows say it. A
reference to a ticket on this map selects it; anything beyond links out to GitHub.
_Avoid_: blocker chip, related issue, cross-reference

**Aggregate scope stop**:
The single ⊘ stop a vast out-of-scope list collapses to, carrying the count, so scope can never
drown the fog — the Panel holds the full list. Only a small list rides the fog band as inline ⊘
stops.
_Avoid_: overflow indicator, "+N more", show-more row
