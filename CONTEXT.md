# Roadmap

A live visualization of wayfinder-organized efforts on GitHub and in local workspaces. The vocabulary
here is what the views render; the wayfinder ticket-state terms (`closed`, `blocked`, `claimed`,
`frontier`) are not restated.

## Language

**Roadmap**:
A route being travelled through partly-charted territory toward a pinned destination. Mechanically
it has three features, and a view lacking any one of them is not a roadmap: a direction of travel,
a behind/ahead asymmetry (ground covered drawn as a trace, not restyled future), and drawn
ignorance (fog rendered distinctly from confident empty canvas).
_Avoid_: pipeline, board, backlog, dashboard

**Ground covered**:
The closed tickets and the decisions they produced, drawn as an accumulating trace of the route
already travelled.
_Avoid_: done column, completed items

**Fog**:
What the effort knows it cannot yet see, drawn distinctly from known empty territory.
Fog has extent on screen, not magnitude.
_Avoid_: remaining work, backlog, todo

**Progress**:
The accumulation of ground covered, set beside visible fog. Past-only by definition: fog makes any
denominator unknowable, so progress is never a fraction, a percentage, or a distance-to-go.
_Avoid_: percent complete, completion, burn-down

**Destination**:
What reaching the end of a map looks like, pinned in view as the thing travelled toward, not a
status to compute.
_Avoid_: goal state, 100%

**Active map**:
The most recently updated open map a Project can establish from complete current source evidence.
When the required evidence is unavailable or incomplete, the active map is uncertain and the last
trustworthy map order remains visible without promoting a secondary map.
_Avoid_: current map, default map, main map

**Change feed**:
Notifications of map appearances, ticket claims and closures, and frontier changes that Roadmap can
establish from source observations. Unreadable or incomplete evidence does not erase known history;
changing a source begins a new comparison baseline for that Project without reporting false activity.
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
The permission for one Classification Run or Wayfinder Session, based on current eligible source
evidence and independent configuration, authorization, Workspace, command, and opportunity limits.
Each stage records either automatic enablement or a one-stage Automation override as its reason;
retained display content never grants admission.
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
The state of a project whose maps are all closed, between efforts with its trace intact.
It is a legitimate visible state, not an error or an empty case.
_Avoid_: archived, inactive, finished, empty

**Integration**:
The kind of source through which a Project reaches Roadmap, GitHub or local Markdown. Each Project
has exactly one Integration, shown at Project level rather than on each map or ticket.
_Avoid_: source, provider, backend, connector

**Connection**:
A configured instance of one Integration. It carries the identity and authorization context through
which registered Projects reach that Integration; one Connection may serve several Projects.
_Avoid_: account, credential, adapter instance

**Authoritative server session**:
The server session whose roadmap facts the browser currently accepts. A session's identity does not
imply that it is earlier or later than another session.
_Avoid_: latest server, newest epoch

**Synchronization**:
The browser's relationship to authoritative roadmap facts. Not-ready means no real state has been
accepted. Synchronized means the browser has established current authority. Retained means it still
shows previously accepted facts without current synchronization. This is separate from Connection
degradation and Project reachability.
_Avoid_: socket liveness, Connection health, empty roadmap

**Completion unknown**:
An operation whose trustworthy outcome is unavailable even though its effects may have occurred.
Transport recovery or unrelated roadmap changes do not settle it. Only evidence specific to the
operation can establish a relevant fact; missing evidence does not prove failure.
_Avoid_: failed command, retryable command

**Project registration**:
Roadmap's durable declaration of a Project's identity, Connection, source, and local Workspace,
with separately editable presentation metadata. Temporary source or Workspace unavailability does
not unregister the Project.
_Avoid_: discovered project, bookmark

**Source observation**:
Evidence about a named Project, map, ticket, or their membership at the source. An actual new
own-scope read can establish readable content despite an unavailable parent, but cannot establish
the missing parent evidence needed for active order or Automation admission.
_Avoid_: fresh snapshot, successful empty result

**Observation provenance**:
The source identity and read context that establish which Project, map, or ticket an observation
describes. Retained observations preserve their original successful-read time rather than acquiring
the time of a later failure or display update.
_Avoid_: publication time, freshness guess

**Source read identity**:
The identity and order of an actual named source read within one source binding, independent of its
clock time or payload. Replayed evidence and cached reinterpretation preserve that identity rather
than establish another read.
_Avoid_: publication sequence, freshness timestamp, public receipt

**Source binding**:
The source authority lifetime for a Project's admitted Connection and repository or canonical Local
source. Replacement begins independent read authority while earlier evidence remains historical trace.
_Avoid_: display name, public resource owner, cache generation

**Never observed**:
A registered or known resource identity for which Roadmap has no actual successful content read.
It has no invented graph, prose, source destination, or successful-read time.
_Avoid_: empty resource, unavailable trace

**Current readable**:
A resource with an actual current own-scope successful read. Readable incomplete content keeps
its raw prose, warnings, and unknown facts rather than becoming unreadable or empty.
_Avoid_: complete resource, eligible resource

**Retained unavailable**:
A previously read resource whose current read evidence is unavailable. Its last successful content,
source destination, provenance, and successful-read time remain inspectable without becoming fresh.
_Avoid_: fresh resource, discarded resource

**Proven absent**:
A resource whose absence follows an actual trustworthy source proof, with any previously read trace
preserved. New readable content or new current membership explicitly naming that identity establishes
reappearance; failed or partial listing omissions and replayed older evidence cannot erase the proof.
_Avoid_: inaccessible, unreadable, missing alias

**Membership evidence**:
A source observation of which maps belong to a Project or which tickets belong to a map. Complete
membership can prove an omitted known identity absent; a new current complete or partial membership
can prove an explicitly included identity has reappeared, without proving its content readable.
_Avoid_: content collection, known identity list

**Last trustworthy map order**:
The open and closed map ordering established by complete current required source evidence.
Uncertainty preserves that order; newly readable content remains addressable without acquiring a position.
_Avoid_: guessed order, filtered active map


**Capability**:
An optional source affordance, such as a link to the original ticket. Its absence is not an error.
_Avoid_: feature flag, extension point

**Registry**:
The historical hand-edited list of Local Projects that Roadmap imports into Project registrations.
It is not the current authority for registered Projects.
_Avoid_: current project list, steady-state configuration

**Workspace**:
The local directory associated with a registered Project for host actions and Wayfinder Sessions.
For Local Projects it is also the source directory and need not use Git; for GitHub Projects its
identity must match the remote repository, whose readability is a separate fact.
_Avoid_: optional checkout

**Degraded**:
The state of a Connection whose observations have repeatedly failed while Roadmap retains known
Project trace. Its last successful observation time does not advance on failure. Connection
usability and Project reachability are separate facts; Degraded does not prove a Project readable.
_Avoid_: unavailable Project, disconnected

**Unreachable**:
A registered Project or known resource whose current source read is unavailable. Any actual
last-known trace remains visible at the same selected identity; never-read resources have no trace,
and inaccessible source evidence does not prove absence.
_Avoid_: missing, deleted

**Badge**:
A short inline label whose text carries its meaning. It may label a ticket state, project
Integration, or another compact fact; color only reinforces its content.
_Avoid_: status tag, source label, origin tag

**Ticket Modal**:
The detail view for one selected ticket, including its body, blockers, and Automation evidence.
_Avoid_: Panel, drawer, sidebar

**Selection**:
The map or ticket pick preserved in the URL. A ticket selection identifies the ticket whose details
are open within the selected map.
_Avoid_: active item, highlight, focus (an input mechanism, not the pick)

**Item link**:
A reference to a ticket or its source. A ticket on the selected map opens its details; a reference
outside that map uses an available source link rather than identifying a different local ticket.
_Avoid_: blocker chip, related issue, cross-reference
