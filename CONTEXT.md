# Roadmap

A live, read-only visualization of wayfinder-organized efforts on GitHub. The vocabulary here is
what the views render; the wayfinder ticket-state terms (`closed`, `blocked`, `claimed`,
`frontier`) are defined in code at `src/wayfinder/types.ts` and are not restated.

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
