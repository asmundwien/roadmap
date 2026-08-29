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
The stream of domain events derived by diffing consecutive snapshots of roadmap state. Source-blind
by construction: which Integration or observation mechanism found a change is invisible to
consumers. Triggers subscribe to the feed, never to transports.
_Avoid_: integration event stream, event log, activity feed

**Automation**:
The opt-in path that may classify and hand one eligible frontier task to Wayfinder. Global and
Project enablement admit automatic triggers; an Automation override admits one stage without them.
An AFK Classification Verdict queues its Wayfinder Session; launching it remains a separate
admission. Automation records durable evidence without promising queue order or managed execution.
_Avoid_: scheduler, autonomous mode, ordered queue

**Automation override**:
A human-triggered Classification Run or Wayfinder Session for one eligible opportunity. It admits
that stage without global or Project enablement, but later automatic stages still require both.
Eligibility, verdict, and per-opportunity attempt limits remain unchanged.
_Avoid_: manual flow, forced run

**Automation admission**:
The reason a Classification Run or Wayfinder Session was allowed: either effective global and
Project enablement (`automatic`) or a human's one-stage Automation override (`override`). Each
stage records its own admission; a Classification override does not admit its later handoff.
_Avoid_: trigger source, execution mode

**Automation opportunity**:
One Project, map, and ticket identity that Roadmap may classify once and, after an AFK result, hand
to one Wayfinder Session once. Edits and frontier re-entry do not create a new opportunity.
_Avoid_: job, retry candidate, fingerprint

**Classification Run**:
The single-lane assessment of one eligible Automation opportunity through the configured
Classification Harness Command. Its strict result is a Classification Verdict.
_Avoid_: classifier event, triage job

**Classification Verdict**:
The durable AFK, HITL, or unable result of one Classification Run. AFK alone admits a Wayfinder
Session. The Verdict is Automation evidence attached to its ticket, not tracker state.
_Avoid_: tracker status, Verdict label, human override

**Wayfinder Session**:
The agent process Roadmap may launch once for an AFK Automation opportunity from the registered
Workspace. An AFK verdict first queues the Session without admitting it. A Project has at most one
launching or running Automation-owned Session; different Projects may have active Sessions
concurrently. A recorded Session marks autonomous handling or an attempt at it, whether automatic
Automation or an Automation override admitted its launch; ordinary human Wayfinder work remains
the unmarked default.
_Avoid_: Execution Run, worker, managed agent

**Queued Wayfinder Session**:
The durable pre-admission state derived from an AFK Classification Verdict. It has no queue position
or ordering promise, survives disabled Project Automation, and records no Automation admission
until reconciliation or an override admits its launch.
_Avoid_: queue item, next Session, priority

**Interrupted Wayfinder Session**:
A Session that was launching or running when Roadmap stopped or restarted before recording terminal
evidence. Its outcome remains unknown. The interruption disables Automation for that Project until
the existing Project enable control records acknowledgement; acknowledged evidence remains unknown.
_Avoid_: failed Session, recovered Session, retryable Session

**Session report**:
The Wayfinder Session's structured terminal claim: completed, stopped, or failed, with a reason.
Process exit and tracker state remain independent facts; Roadmap derives no combined outcome from
them.
_Avoid_: exit status, tracker result, mismatch

**Process result**:
The durable observation that an Automation-owned process exited with a code or ended by signal.
Legacy evidence that never recorded this fact says unavailable rather than inventing one. It does
not interpret the Session report or tracker state.
_Avoid_: outcome, success, Session status

**Automation status effect**:
A compact, durable mark added to a ticket node when Automation evidence exists. It leaves the
ticket type chip and tracker-state marker intact; ordinary human work has no status effect.
_Avoid_: Automation icon, agent state

**Automation database**:
Roadmap's server-owned durable record of immutable Automation opportunities and ordered,
append-only Automation events. Replaying the events derives current Automation evidence, including
queued Sessions and whether an unknown Session outcome was acknowledged. Event sequence is
authoritative, while recorded timestamps are descriptive. Events are retained permanently.
_Avoid_: Run history, ordered queue, tracker state

**Harness Command**:
A globally configured literal executable, argument list, and prompt-delivery method launched
without a shell. Automation has one Classification command and one Wayfinder Session command;
per-Project command profiles do not exist.
_Avoid_: Project command, command profile, automation hook

**Resting**:
The state of a project whose maps are all closed — between efforts, its trace intact. A legitimate,
visible state, not an error or an empty case.
_Avoid_: archived, inactive, finished, empty

**Integration**:
The kind of source a project reaches roadmap through — GitHub, local markdown. A project has
exactly one, named by a tag on the wire (`github`, `local`); the badge shows it at project level
and it is invisible everywhere below.
_Avoid_: source, provider, backend, connector

**Connection**:
A configured instance of one Integration. It carries the identity and authorization context through
which registered Projects reach that Integration; one Connection may serve several Projects.
_Avoid_: account, credential, adapter instance

**Project registration**:
Roadmap's durable declaration of one Project: an immutable admitted coupling of Connection,
Integration-specific locator, and required Workspace, plus separately editable presentation
metadata. Runtime unavailability never unregisters it.
_Avoid_: discovered project, registry entry, bookmark

**Adapter**:
The code-role counterpart of an integration: the server module satisfying the seam's interface for
one integration, with everything source-specific — transports, watching, cadence, budget valves —
hidden behind it. Views never meet adapters; they see integrations.
_Avoid_: plugin, driver, service

**Slice**:
One adapter's whole contribution to the snapshot — its projects and its unreachables, delivered
entire whenever the adapter decides something changed. The store composes slices; it never fetches.
_Avoid_: partial snapshot, patch, delta

**Capability**:
Something an integration may express but need not — linking out is the canonical example. A
capability is optional data on the wire, never an optional method at the seam; absence renders
gracefully, it is not an error.
_Avoid_: feature flag, extension point

**Registry**:
The historical hand-edited `local-projects.json` input. Configuration migration imports it once;
Project registrations are authoritative afterward, and Integration Adapters never read it.
_Avoid_: current project list, steady-state configuration

**Workspace**:
The required local directory in every Project registration. Roadmap admits it only after proving
that it belongs to the registration's locator through its Connection. A moved Workspace may be
repaired only by proving the same Project identity. Wayfinder-map presence is a separate fact.
_Avoid_: optional checkout, source path

**Degraded**:
The state of a Connection whose observations have repeatedly failed while Roadmap retains its last
successful Project data. The Connection carries the last successful observation time; its Projects
remain available until a source-specific hard failure proves otherwise.
_Avoid_: unavailable Project, disconnected

**Unreachable**:
The state of a registered Project or known map that cannot currently be read. It remains visible
with a plain cause and any last-known roadmap trace rather than disappearing; recovery updates the
same identity. A never-read Project can be Unreachable with no maps.
_Avoid_: missing, deleted (the cause may be unknown)

**Badge**:
The project-level marker naming a project's integration — provenance made visible exactly once,
invisible everywhere below the project.
_Avoid_: source label, origin tag

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
