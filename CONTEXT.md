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
