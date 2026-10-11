# Architecture

## System shape

Roadmap is a local-first application for one user. It reads source maps and tickets, but configuration, authorization, host actions, and opt-in Automation can have effects. The repository has five workspace areas:

- `packages/contracts` owns authoritative browser-safe Zod 4 external schemas and their inferred types. Its only package exports are `@roadmap/contracts/identity`, `/state`, `/operations`, and `/wire`. Internal resource, blocker, action, and own-data helpers are cohesive schema modules, not additional public exports or backend domain owners.
- `packages/ui` provides domain-independent presentational components and design tokens through the `@roadmap/ui` workspace package.
- `apps/server` owns application state, persistence, integrations, and network access.
- `apps/web` renders application state and sends queries and commands.
- `apps/docs` owns the standalone catalog for public `@roadmap/ui` components and tokens.

WebSocket carries full state replacements. HTTP carries `query` and `execute` requests.

## Web application

`createRoadmapStore` in `apps/web/src/store` is the single authoritative SPA read owner. It accepts coherent full-state replacements under current-generation authority, sends state-free HTTP queries and commands, and owns transport synchronization, socket liveness, retained accepted facts, and capped reconnect backoff. It integrates the shared workflow owner without granting that owner server admission or source authority.

`RoadmapProvider` owns observation acquisition in its effect, independently of data readers and routes. It subscribes only to the readable-content gate and readiness/status selection, not whole application content or command activity. Before any readable authoritative state exists it renders explicit lifecycle/waiting status, not empty Projects, default configuration, version zero, or a fabricated capture time. Once readable state exists, consumers remain mounted through disconnect, reconnect, and later lifecycle messages without readable content.

Views read through the required `useRoadmap(selector)` facade and never fetch directly. The selector receives `RoadmapViewState`, including actual read fields, real `capturedAt`, lifecycle, effective synchronization, stable named `workflows`, and immutable `workflowState`. Raw query/execute methods remain a transport test interface on `RoadmapStore`, not view capabilities. There is no no-argument overload or broad-hook compatibility wrapper.

### Client subscriptions

The external store uses `use-sync-external-store/with-selector` for React subscriptions. The binding owns selection memoization and reuse under supplied equality. Application code owns semantic equality, decoding, session provenance, and observation acquisition and release. Context distributes the stable store instance, not mutable application state.

`RoadmapStore.getSnapshot` and `subscribe` remain the transport test seam. Publications are cached immutable snapshots: repeated reads without publication return the same object, and neither callers nor later transitions mutate an earlier publication. Command-only publications preserve the accepted `ApplicationState` identity. Complete validated replacements remain atomic; selection does not split the authoritative root into writable slices.

The binding computes a selection before comparing the snapshot React observes. Default selected semantic equality compares JSON-compatible records and arrays by value and methods by reference. It retains the last selected result reference across independently decoded full replacements when the selected facts are equal, including newly allocated derived records. A changed selected fact invalidates that reference; selecting publication time, lifecycle, or synchronization includes those facts in equality. Selectors must be pure and must not omit facts their consumer needs. This guarantee concerns store-driven selected updates, not parent-driven renders or elimination of selector computation. Reference equality alone and shallow comparison cannot preserve nested selections across separately decoded equal payloads.

### Client ownership and lifetime

| Fact or work | Owner | Constraint |
| --- | --- | --- |
| Public `ApplicationState` and source/resource truth | Server application and its committed private owners | Browser adopts schema-validated replacements atomically; it cannot reconstruct private admission or invent source success. |
| Accepted read publication and retained readable state | `RoadmapStore` | Current-generation epoch/sequence authority controls adoption. Retention preserves real trace, not current readiness or permission. |
| Transport liveness, synchronization, socket generations, reconnect resources | `RoadmapStore`, acquired by provider effect | Subscriptions only observe. The application owner stays active when routes have no readers. |
| Command construction, conflict policy, attempt transitions, and operation feedback | `apps/web/src/workflows/workflows.ts`, integrated by `RoadmapStore` | Named workflows capture current accepted policy before dispatch. Attempts cannot modify server read facts or establish effect completion from unrelated state. |
| Form drafts, pane visibility, confirmation, and copy state | Actual view-local presentation | Folder cancellation and failures preserve the draft. Pane closure does not dispose shared attempts. |
| Resource selection | URL pathname, search, and fragment | No store or workflow mirror silently substitutes another Project, map, or ticket. |
| Derived lookup indexes and pure resource results | `apps/web/src/resources/results.ts`, consuming accepted read facts and scoped URL identity | Pure calculations have no independently writable facts, resource cache, or second authority. |

`start()` acquires observation and returns an idempotent release. Multiple acquisitions share the active observation; releasing one does not dispose another's ownership. Repeating a release cannot decrement ownership twice. Adding/removing subscribers neither acquires nor releases observation. Last-owner cleanup retires authority, reports disconnected, retains actual accepted facts, closes the socket, and clears reconnect timers. React StrictMode setup/cleanup/setup may retire one generation and acquire another, but must not leave duplicate active sockets or reconnect timers. Retired callbacks cannot affect their successor. Navigating through `/components` or an unknown route does not end provider ownership.

`apps/web/src/resources/results.ts` owns shared pure resource lookup and presentation over the accepted read fields. It does not interpret lifecycle or transport synchronization; the provider and store own those facts. The shared workflow owner interprets state-free operation evidence without mutating server read facts, inferring a receipt from unrelated publication, mirroring URL selection, or automatically replaying commands.


SSR has no established product requirement and is out of scope. The client-only SPA uses no query cache or hydration authority. A future SSR decision would require separately agreed hosting, request-isolated state serialization, and matching server/client hydration snapshots. Folder selection remains explicit user interaction, never a cache entry subject to automatic mount, focus, reconnect, retry, or replay.



### Shared workflow policy

`apps/web/src/workflows/workflows.ts` owns command construction, dispatch-time policy, attempt transitions, canonical destinations, and authorization reconciliation. The store supplies current accepted facts and delivery through its transport interface. The owner has no socket, fetch, React, view, persistence, or host implementation dependency.

| Pending scope | Contending workflows | Independent work |
| --- | --- | --- |
| Shared configuration revision | Connection authorization, rename/removal; Project registration, rename/removal/Workspace repair; global and Project Automation preferences | Refresh, native actions, selectors, and eligible overrides do not share this client lock. |
| Canonical Project | Refresh and native actions on the same scoped Project | Other Projects may overlap, including a configuration write targeting another Project. |
| Folder interaction | All Workspace selections | Configuration and resource workflows may overlap. Selection requires synchronized ready state, but read-only configuration does not prevent it. |
| Classification process | Classification overrides across Projects | Wayfinder overrides use their own scope. |
| Wayfinder Project | Wayfinder overrides for the same Project | Other eligible Projects may overlap. |

Pending attempts hold their scope until delivery settles. A conflict creates a `not-dispatched` attempt rather than a queue entry. The actual server still serializes Commands other than refresh and rechecks admission at its queue turn. Client overlap is not a promise of parallel server execution or independent Project configuration versions.

Every named Command captures the latest accepted configuration version and synchronized ready/mutable policy immediately before dispatch. Views neither manufacture a version nor close over a pane-opening version. Current public actions, authorization, Automation eligibility, and enablement guide client gates; the server may still reject an external revision or policy change after capture. There is no automatic rebase, replay, or resubmission.

Attempts distinguish `pending`, local `not-dispatched`, attributable `not-admitted`, decoded application `rejected`, operation-specific `acknowledged`, and `completion-unknown`. Acknowledgement can mean a failed authorization phase or degraded refresh; it does not mean source success or durable process completion. Returned mutation results retain `committed` versus `committed-unconfirmed` durability. Field feedback maps canonical validation fields to the relevant form without discarding general errors.

The latest created attempt owns ordinary feedback for its operation and canonical scope. Late settlement cannot replace a newer attempt. Every earlier unknown remains recorded and visible through its scoped uncertainty list. Dismissal changes visibility only, not the unknown result. Closing a pane, unrelated success or rejection, newer snapshots, and reconnect do not settle uncertainty. An explicit user attempt may run again after pending ends; the previous unknown remains unknown and server admission still applies.

Authorization command result phases and accepted authorization state are distinct. Accepted state uses waiting, granted, or terminal with a specific terminal outcome. The owner consumes acknowledged phase replacement when accepted evidence matches or supersedes it, including waiting-to-denied cycles and unchanged terminal receipts. A locally refused retry/cancel cannot consume the previous phase. Current grants link the canonical Connection/account; historical grants cannot authorize a replacement account.

Registration and Workspace repair use the committed result's canonical Project and Workspace, not a submitted-path lookup. Only a valid correlated result for the initiating operation and subject can provide a confirmed destination. Rejected, lost, unreadable, or mismatched responses cannot navigate as committed success. Folder selection returns selected/cancelled interaction truth; cancellation and failure preserve local drafts. Native actions send only a scoped Project and finite operation, never executable or trusted path authority. Durable Automation admission, Verdict, Process result, Session report, and acknowledged-unknown evidence remain independent.


Workflows are independent of rendering, provider/store implementation, transport construction, and server internals. Views use workflow policy and shared resource results.


### Browser authority and synchronization

State authority is separate from operation delivery. Each new socket has a distinct generation. Only the first validated state from the current generation establishes its authoritative server session. Socket open alone proves no application synchronization. Epoch identifiers are opaque identities, not clocks; sequence numbers are comparable only within the same epoch. A retired socket callback cannot publish, replace a baseline, or regain synchronization.

`RoadmapStore.getSnapshot` retains transport, accepted read facts, and immutable workflow attempts. Its readonly `state` is a real readable `ApplicationState` or `null`, independently of the latest accepted lifecycle and authority high-water sequence. Effective synchronization is a discriminated union:

- `synchronization: 'not-ready'` requires `state: null`, even if a validated lifecycle publication has established current-generation authority.
- `synchronization: 'synchronized'` requires readable state, established current-generation authority, and the latest accepted lifecycle to be `ready`.
- `synchronization: 'retained'` requires readable state when current-generation authority is absent or the latest accepted lifecycle is not `ready`.

Effective synchronization is separate from socket liveness and the consumer's readable-content gate. A validated lifecycle-only `idle`, `starting`, or terminal publication can establish transport authority without providing readable application resources. With no prior readable state, the provider reports that lifecycle and waits. After readable content has been accepted, such a publication preserves the last readable state and mounted consumers, exposes the actual latest lifecycle, and reports retained synchronization. A successor with no payload keeps the predecessor's trace only as historical resource facts, not successor readiness or current source evidence. A ready `mutable` or `read-only` publication supplies actual configuration and resource evidence; unavailable sources can still be a truthful ready baseline.

The store snapshot records lifecycle as a correlated object or `null` before any accepted publication. Ready requires `{ phase: 'ready', mode }`; failed requires `{ phase: 'failed', cause }`; other variants carry their actual phase. Only an accepted current-generation publication changes this lifecycle fact. The readable `useRoadmap` view exposes non-null lifecycle, independently of the retained content it renders. The accepted authority high-water sequence is tracked separately from that older readable content: an older ready publication cannot undo a newer accepted lifecycle publication. Disconnect, command activity, and obsolete socket or HTTP callbacks cannot fabricate a lifecycle transition.

Socket liveness is independently `connecting`, `live`, or `disconnected`. A live socket can still be not-ready or retained while awaiting a valid baseline. The provider exposes global lifecycle/retained-state status even in that case. Server readiness, transport synchronization, Connection health, and Project/resource reachability are different facts. Neither ready lifecycle nor a synchronized socket proves that every source is available, complete, fresh, or known empty. Retained display grants no server interaction admission.

Every HTTP request captures its authority before publication or awaiting delivery. It records the current socket generation and its established baseline identity, or no authority if that generation has no baseline. Settlement never supplies missing request-start provenance. Query and command outcomes are state-free. An independently valid operation outcome remains usable even when its producer epoch differs from accepted read authority. HTTP never establishes or replaces read facts.

| Event and provenance | State authority and ordering | Synchronization |
| --- | --- | --- |
| Startup with no accepted state | No epoch or state is established. HTTP cannot seed either. | Not-ready. |
| Current socket opens, or sends an invalid or withheld baseline | Opening and invalid input establish no authority. | Not-ready, or retained if prior facts exist. |
| First valid state on the current socket generation | Establish its epoch and accept its lifecycle/high-water sequence. A different epoch replaces authority without comparing sequences across epochs; absent readable payload preserves only historical read facts. | Synchronized if and only if the latest accepted lifecycle is ready and state is readable; otherwise retained with readable state, or not-ready without it. |
| Later state on the established current socket, same epoch | Accept only a strictly greater sequence; equal or older input leaves accepted lifecycle and high-water sequence intact. | Synchronized if and only if the latest accepted lifecycle is ready and state is readable; otherwise retained with readable state, or not-ready without it. |
| Later state on the established current socket, different epoch | Ignore it; the same socket cannot establish a successor epoch. | Unchanged. |
| Reconnect baseline, same epoch, equal or older sequence | Establish the new generation's authority but retain the previous accepted lifecycle/high-water maximum and readable state. | Synchronized if and only if the retained latest lifecycle is ready and state is readable; otherwise retained with readable state, or not-ready without it. |
| Reconnect baseline, same epoch, newer sequence | Establish the new generation's authority and advance accepted lifecycle/high-water sequence; adopt readable payload if supplied. | Synchronized if and only if the latest accepted lifecycle is ready and state is readable; otherwise retained with readable state, or not-ready without it. |
| Reconnect baseline, different epoch | Establish the new generation's epoch and accept its lifecycle/high-water baseline; no epoch chronology is inferred. Without readable payload, older trace remains historical. | Synchronized if and only if the latest accepted lifecycle is ready and state is readable; otherwise retained with readable state, or not-ready without it. |
| HTTP outcome started under still-current established authority, same epoch | Return its operation truth without adopting state or advancing the accepted sequence, even when its producer sequence is higher. | Unchanged. |
| HTTP outcome started under still-current established authority, different epoch | Return the valid outcome. Retire the socket generation and start a fresh one to obtain a validated authoritative baseline; retain existing facts meanwhile. | Retained with readable state, otherwise not-ready, until a fresh baseline determines effective synchronization. |
| HTTP outcome started before a baseline, under retired authority, before stop/restart, or under otherwise obsolete authority | Return the independently valid outcome without changing state or triggering synchronization. | Unchanged. |
| Callback from a retired socket generation | Ignore it; it cannot establish authority, replace state, or change current transport status. | Unchanged. |
| Current socket disconnects, store stops, or reconnect begins | Retire current authority and retain any accepted facts. | Retained with state, otherwise not-ready. |

An unknown command completion survives socket state transitions. Reopening a socket or accepting a newer state does not clear that uncertainty. There is no automatic completion reconciliation, HTTP retry, replay, or receipt mechanism.

`apps/web/src/main.tsx` mounts React Router 8.4's declarative `BrowserRouter`. `App.tsx` declares `Routes` and `Route` elements. `apps/web/src/router.ts` exports canonical route patterns and resource path helpers built with the library's `generatePath`.

| Path | Resource |
| --- | --- |
| `/` | Overview |
| `/connections` | Connections |
| `/connections/:connectionId` | Connection details |
| `/connections/:connectionId/projects/import` | Connection-scoped Project import |
| `/projects/:integration/:projectId` | Project's current map |
| `/projects/:integration/:projectId/settings` | Project settings |
| `/projects/:integration/:projectId/maps/:mapId` | Pinned map |
| `/projects/:integration/:projectId/maps/:mapId/tickets/:ticketId` | Ticket details on a pinned map |
| `/components` | Domain component catalog |

Navigation state belongs to the URL pathname, search, and fragment, without `useState` mirrors. Unknown paths and integrations other than `github` or `local` render "Page not found" instead of Overview. Old hash routes are unsupported; there is no compatibility redirect.

Resource adapters use the router's `pathParams` helper to match the original encoded pathname with the library's `matchPath`, then decode each captured parameter once. This preserves opaque IDs, including literal `%2F`, which React Router's already-decoded route parameters can otherwise collapse into slashes.

`apps/web/src/navigation.tsx` provides the app-local internal `Link`, `ButtonLink`, and `NavbarBrand`. It combines shared UI styles with React Router's `useHref` and `useLinkClickHandler`, retaining native anchor behavior for modified clicks, targets, and downloads. Views import internal links from `@/navigation` and keep native `@roadmap/ui` anchors for external and source URLs. `packages/ui` remains router-independent.

A production web host must return the SPA HTML for application navigation paths so direct loads and refreshes work. API endpoints and asset requests must bypass this fallback. This deployment requirement does not imply that a production host has been verified.

The map area lives in `apps/web/src/views/map`. `App` parses opaque route parameters once and supplies the complete scoped selection. `page.tsx` calls `resolveSelection` through `useRoadmap`; it does not join Project collections or select a replacement locally. The result supplies exact Project/map/ticket lookup, trustworthy default selection, grouped navigation, content, warnings, source destinations, and Automation facts. `map-container.tsx` owns the React Flow viewport and its pan, zoom, and fit controls. The retained pure `graph.ts` projector accepts the selected `MapResource` and uses Dagre for layout. `ticket-node.tsx` renders ticket and unresolved or external blocker nodes with shared tracker/blocker interpretation. Closed tickets remain in the graph, with arrows from blockers to dependent tickets.

`ticket-modal.tsx` opens the URL-selected ticket in the shared native Modal. It retains ticket bodies, metadata, blockers, source links, Automation evidence, and eligible Automation controls. Opening a ticket pushes a pathname that pins its map and selects the ticket. Closing the Modal or returning to map prose replaces that history entry with the pinned map pathname, so Back does not reopen the closed ticket. Back and Forward otherwise restore the URL-selected map and ticket. `map-content.tsx` renders complete raw map Markdown inline below the graph, with a structured fallback when raw content is absent. `prose.tsx` renders Markdown and resolves references within the current Project and map: local ticket links open ticket details, map references return to map prose, and external references use available source links. Unresolvable local references explain why they cannot be opened. Missing tickets, incomplete blockers or map sections, warnings, and unavailable Projects or maps remain explicit rather than disappearing.

### Shared resource results

`apps/web/src/resources/results.ts` is the app-local public interface for pure consumer results. `ConsumerRead` is a readonly `Pick<ReadyApplicationState, 'projects' | 'connections' | 'automation' | 'configuration' | 'supportedIntegrations' | 'authorizationOperations'>`. Consumers call it inside `useRoadmap(selector)` after the provider's readable-content gate. It owns neither acquisition nor a writable result store. Server projection remains the sole authority for source success, completeness, trustworthy absence, provenance, and admission.

`resolveProject` returns a missing scoped identity with a message and durable Automation facts, or a known presentation result with explicit management identity/locator/Workspace facts, Connection summary, availability, observation destination, current source destination, grouped map summaries, journey, aggregate counts, activity, and supplied capabilities. `presentProjects` owns portfolio grouping and attention. Neither exposes a raw Project or Connection wrapper for consumers to reinterpret. Counts preserve source aggregates beyond fetched tickets, unknown counts remain `null`, and known zero remains zero. Recency uses actual source activity or explicit unknown activity. Connection attention reports Connection health, not that all dependent Projects are retained.

`resolveConnection` owns exact Connection lookup, independent health label/cause/time, dependent Project results, related and current accepted authorization, and integration installation/setup/registration context. `presentConnections` supplies list/setup presentation. `resolveAuthorization` interprets accepted live authorization only; returned-operation feedback reconciliation and pure registration draft/error helpers retain their separate owners. Explicit registration identity facts support command construction without restoring a raw presentation model.

Lookup `missing` means the requested identity has no entry in the accepted collection. A known entry's resource availability preserves `never-observed`, `current-readable`, `retained-unavailable`, or `proven-absent`, including actual absence proof and optional historical trace. These are not interchangeable with lookup failure, known-empty membership, readable incomplete content, Connection degradation, or no accepted browser state. `resourceObservation` chooses actual current success, retained success, or historical success where supplied. Availability messages retain safe causes, attempt/source times, completeness and Local/GitHub provenance. Source destinations are explicit `link` with `href`, `file` with `path`, or `absent`. A current management destination and historical observed destination can differ; missing lookup never fabricates a source capability. Repair is offered based on absence of the supplied open-Workspace action, not client-derived admission.

`resolveSelection(read, { project, map, ticket })` returns `pinned`, `default-current`, `default-closed`, `no-trustworthy-default`, or `known-empty`. Explicit map/ticket identities remain pinned even when missing or proven absent. They never fall back to a sibling. With no pin, only server `activeMap: known-current` selects the current map. Server `known-empty` permits the first trustworthy closed map, or known-empty presentation when none exists. Uncertain current ordering supplies no default, though known historical/unplaced maps remain explicit navigation choices. These are conservative agent interaction defaults, not execution eligibility or new source authority.

Map results expose content and the actual `MapResource` for the retained graph and `link-targets.ts` projectors. Ticket results retain the requested scope even when missing and supply content, source, tracker/type labels, independent blocked/claimed facts, decision gist, blockers, and Automation. Markdown link projection still resolves real same-map Local source paths and preserves absolute/GitHub URLs; unsupported relative Local references stay visibly disabled. Raw Markdown, incomplete sections, warnings and unknown blockers remain available instead of becoming complete empty data.

Graph blocker nodes preserve the projector's merged blocker title, exact source destination, state, and graph-supplied scope. Shared presentation adds target tracker and availability separately rather than replacing those merged facts. A registered target in another map can therefore remain external to this graph. Graph nodes and the ticket Modal render evidence-aware type labels and separate blocked/claimed labels, including closed tickets; display placement does not erase either fact.

`presentProjects` interprets Automation once and returns it as `portfolio.automation`, which Overview consumes. Its per-Project results share that interpreted evidence. Standalone `resolveProject` filters evidence by the complete Project identity before interpretation. Tracker glyphs retain `ticketTypeOf` semantics while type labels preserve missing, unknown, or conflicting type evidence.

`presentAutomation` and scoped results own durable evidence lookup independently of target membership. Every interruption carries its exact target and known/missing Project/map/ticket messages, so simultaneous interruptions remain reachable after resources disappear. Classification and Session expose separate labelled admission, Verdict, Process result, report, reason, and acknowledgement facts as their actual stages permit. Queued Sessions say "No launch admission". Acknowledged outcome-unknown remains unknown. Global enabled/availability, Project preference, evidence, and server controls remain independent. Controls preserve server `eligible`, `ineligible`, or `absent` and exact reasons; tracker state, graph display, Connection health, and retained content cannot manufacture eligibility.

Shared resource results supply map/ticket/prose/blocker/source journeys, Project settings, Connections detail/list/setup/import/launch presentation, and Overview. Graph/link projectors and draft/error/operation-feedback helpers own their separate presentation responsibilities. Generic UI and standalone docs have no runtime-domain dependencies.



Application component styles use CSS Modules. Components resolve local class names with `classnames/bind`. Reusable styling belongs to shared components, not shared stylesheet imports. React Flow also imports its required vendor stylesheet for graph rendering and viewport controls.

Each routable area under `apps/web/src/views` has a `page.tsx` entry point. `App` routes the Connections list, `settings/connections/[connectionId]/page.tsx`, and its connection-scoped `import/page.tsx` independently. The detail page selects the Connection and composes sibling Details and Manage connection sections. Sections select current scoped workflow feedback and invoke named actions through `useRoadmap`; they retain only local drafts and presentation state. The import page registers a Project through the selected Connection. `shared/` and `shell/` are support areas, not pages.

The web catalog at `/components` documents components that are tightly coupled to the domain. These components map domain state to presentational props, and builds on agnostic content from `@roadmap/ui`.

React functions use named `...Props` types instead of inline object annotations.

Web source files use `@/` for imports outside their current directory. The alias maps to `apps/web/src`; sibling imports remain relative. TypeScript imports omit `.ts` and `.tsx` extensions.

## Documentation application

`apps/docs` consumes the public `@roadmap/ui` exports and token-layer guides. It owns catalog composition, navigation, and presentation behind a standalone static site, with no dependency on web source, domain contracts, application providers, or server configuration. Product encodings remain in `apps/web`.

## Server

`apps/server/src/application/application.ts` composes the transport-agnostic `RoadmapApplication`. Its operation facade is `start/current/subscribe/query/execute/stop`, with required `diagnostics()` for lifecycle and committed resource counts. It serializes configuration mutations, manages credentials and account-scoped authorization usability, and publishes the existing public application state through `application/projection.ts`.

`configuration/document.ts` owns the strict version 6 `roadmap.config.json` intent codec, storage, file watching, and migration from versions 1 through 5. Persisted intent contains no runtime proofs or provider clients. Invalid manual input retains the committed runtime and inhibits admission and configuration writes until repaired.

`projects/registry.ts` is a private candidate and refinement owner, not active configuration authority. It produces immutable candidates with separate source and Workspace admissions. `observation/coordinator.ts` activates candidates after replacement owners have scoped baseline evidence, commits the registry and observation together, and retires replaced owners. Integration readers in `github/observer.ts` and `local/observer.ts` implement `SourceObserver`; `wayfinder` parses source content. They produce private attempts from `observation/source.ts`, not public Projects, maps, or tickets. `change-feed.ts` compares committed scoped attempts for notifications, not public snapshots.

### Application lifecycle and admission

The application owns one private lifecycle union. Ready carries a required `mutable` or `read-only` mode; failed carries a fixed safe startup cause. Lifecycle does not derive from socket state, Project reachability, or the presence of retained content.

| Phase | Start contract and transitions | Stop contract | New interaction admission |
| --- | --- | --- | --- |
| `idle` | The first start synchronously enters `starting` and registers the startup promise before initialization runs. | Stop enters `stopping` without initializing the application. | Commands and interaction queries reject. |
| `starting` | Concurrent starts return the same promise. Successful initialization enters `ready`; startup failure enters `failed` and joins cleanup before rejecting. | Stop immediately revokes ownership and joins startup and all acquired owners. Interrupted startup cannot report success. | Commands and interaction queries reject. |
| `ready` | Repeated start returns the original successful promise. Configuration validity selects `mutable` or `read-only` without restarting owners. | Stop synchronously enters `stopping` and revokes new effects. | Queries may begin; commands require valid, nonpending configuration and their operation-specific guards. |
| `stopping` | Start rejects; no continuation can restore ready authority. | Concurrent stops share the same drain promise and its success or failure. | Commands and interaction queries reject. |
| `stopped` | Start rejects. | Repeated stop returns the same settled promise, including any cleanup error. | Commands and interaction queries reject. |
| `failed` | Start rejects. The startup promise joins partial-owner cleanup before it rejects. | Stop joins the same cleanup and reaches `stopped`; cleanup failure remains observable. | Commands and interaction queries reject. |

Ready requires resolved configuration load and validation, credential/admission synchronization, coherent initial source baselines, durable Automation recovery, and the startup mutation lane to settle. A baseline can truthfully report an unavailable source. Ready does not require every registered Project to be reachable. Invalid configuration can reach diagnostic `read-only` readiness; it is not a valid-empty configuration success. Invalid manual replacement retains last-valid committed resources and disables configuration mutation, host effects, automatic Automation, and Automation overrides until repair.

Entering the serialized command queue is not application admission. The command checks ready phase, configuration validity, pending inputs, expected version, and operation guards when its queue turn runs. A command queued while ready but reached after stop rejects without beginning an effect. Native folder-selector queries recheck ready phase in their owned task immediately before invoking the selector. Explicit selection, cancellation, and failure remain separate results. `read-only` readiness permits the selector query but not commands.

Already-begun selectors and host launches join application shutdown rather than receive fabricated cancellation or rollback. Effects not yet invoked must still pass their final ownership and dependency guard. Begun configuration writes drain and report the actual persistence result. Source and authorization work drain under their owners but cannot commit late baselines, install late credentials, settle authorization state, schedule new timers, or publish after ownership revocation.

`current()` reads retained state and `diagnostics()` reads lifecycle and committed catalog facts independently of interaction admission. Neither starts a selector, admits a command, or proves readiness. Subscriptions registered before readiness receive no initial fabricated state; ready publication provides the first baseline. Stopping and failed applications do not publish new subscription callbacks. Terminal cleanup may update retained diagnostic state without a live publication.

At the first terminal cleanup entry, the application captures the last public state as retained evidence. Terminal projection preserves its already-public authorization operations, not private placeholders from an unfinished authorization begin. It preserves actual Connection availability only when Connection ID, Integration, and canonical GitHub account still match. New or changed accounts report unavailable with a no-evidence cause, not a process-readiness failure. A saved document can change Connection metadata or account rows without granting readiness or settling late authorization.

### Joined lifetime owners

| Owner | Acquisitions and joined cleanup |
| --- | --- |
| Application | Registers startup and interaction/background tasks before execution; owns configuration and observation subscriptions, mutation and credential-write lanes, authorization timers, device polling, token refresh, and aggregate cleanup. Stop clears authorization timers, unsubscribes publications, and joins startup, the lanes, and in-flight tasks. Awaited authorization continuations revalidate ownership before installing results. |
| Configuration document | Owns load, migration, file watcher, debounce timer, and serialized read/write work. Application cleanup keeps it open until begun writes and interrupted-Project disablement finish, then joins document stop. Deferred load cannot acquire a live watcher or subscription after terminal cleanup. |
| Observation coordinator | Owns committed and staged source owners, activation, retired-owner disposal, observerless recovery timers and running reproof, and GitHub pool shutdown. Stop retires active and pending owners and joins activation, recovery, and disposal, including candidates acquired before a deferred baseline finishes. |
| Local observer | Owns watcher acquisition, debounce/reconciliation/recovery timers, baseline, refresh, watcher callbacks, and serialized source reads. Stop closes its watcher and joins tasks and the read chain. The continuation after an awaited path check cannot acquire a watcher after stop. Watcher disposal errors propagate. |
| GitHub observer and pool | Own per-source baselines/read chains and shared Connection pacing, provider requests, pending reads, cache, and active topology. Stop joins pending and active reads and request work; retired callbacks cannot publish or rejoin active topology. |
| Automation engine | Owns database recovery, reservations and append lane, launch-acquisition tasks, the Classification process, and durable interruption evidence. Stop joins startup, append and launch acquisition, stops its owned Classification process, and records an actual terminal Classification result when available or honest unknown evidence otherwise. Active Wayfinder Sessions receive durable unknown interruption evidence, not invented failure or completion. |

Partially acquired owners follow the same cleanup on startup failure. Clearing a timer alone is not a drain. Cleanup waits for work already started by that timer and for late acquisition to either fail its ownership check or dispose through the registered owner. The shared stop result collects disposal and persistence failures rather than report unconditional success.

### Liveness, readiness, and network shutdown

While the transport accepts requests, `GET /health` returns HTTP 200 liveness with lifecycle and diagnostics. `GET /ready` returns HTTP 200 only for `ready`, including its `mutable` or `read-only` mode, and HTTP 503 for `idle`, `starting`, `stopping`, `stopped`, or `failed`. These claims are distinct from source health. Unknown, degraded, authorization-required, or legitimately unavailable Projects do not by themselves mean the process failed.

Diagnostics derive from the committed application catalog, never main's latest constructed or pending source owner. `projects` counts registered Projects in that catalog; `unavailable` counts Projects with retained-unavailable or actual failed never-observed source evidence; `absent` counts proven-absent Projects. These are Project counts, not failed reads, maps, or Connections. `maps` sums current complete map memberships across committed Projects. If any membership is unknown, incomplete, or unavailable, `maps` is `null`, not zero or a count of retained maps. Before a catalog commit all four counts are `null`. A pending replacement baseline cannot replace the committed diagnostic counts. `clients` is the transport's current WebSocket count.

WebSocket upgrade can succeed during startup, but the transport withholds the initial state until application readiness. It sends no prebaseline empty/default state and suppresses broadcasts after transport close or application ownership revocation. Socket open proves transport liveness only.

`main.ts` installs SIGINT and SIGTERM handlers before listener startup and interruptible application start. The first shutdown closes listener admission, begins transport close, revokes application admission, and joins application drain, transport closure, listener closure, and its subscription cleanup. Repeated signals share that shutdown task. Transport close revokes bodies not yet dispatched, joins accepted request tasks and response flush or failure, removes upgrade/subscription ownership, terminates WebSocket connections, then reaps newly idle HTTP connections. Listener closure also joins; an already-admitted response is not force-closed merely to make shutdown finish.

Startup or shutdown failure sets `process.exitCode = 1` and reports fixed safe text. Main does not force a successful process exit. There is no shutdown deadline, rollback of host or credential effects, automatic request retry, or supervision/termination of already-launched external Wayfinder Sessions. Durable Process result, Session report, and tracker facts retain their independent meanings.

### Registration, activation, and source lifetimes

A Local registration has one canonical Workspace path, which is also its source path. Local admission requires a readable, searchable directory, not Git or an existing map. Repair or saved-source reproof at the exact same resolved canonical path needs no Git-history identity. Rebinding to a different canonical path requires the recorded Git-history identity. Case-insensitive duplicate detection on macOS does not prove that differently cased resolved paths are the same directory. A verified canonical path can establish occupancy even when identity checks deny Workspace and source authority.

The registry trims a Local directory basename before allocating its Project ID or checking ID collisions. An empty trimmed basename uses `local-project`. Configuration preserves literal canonical filesystem paths, including trailing whitespace in directory names. Saved intent and cached admission use the same allocated identity. Public-application regressions in `application/registration.test.ts` cover these names, normalized-ID collisions, and save/stop/recreate/reproof with a real configuration document and Local observer.

GitHub source access and Workspace proof are independent refinements. Source access binds the Connection account and stable repository ID to a provider reader. Workspace proof binds a local Git worktree to that repository. A missing or colliding Workspace denies host use without discarding valid remote GitHub observation. Admission obtains Connection access once and shares it with its source and Workspace checks; the observer consumes verified input rather than repeating provider admission preflight.

A successfully inspected GitHub worktree establishes canonical occupancy even when repository matching or Connection authorization denies its Workspace proof. The admission result carries that inspected path separately from authority; the registry validates the canonical path and remembers it for collision checks. Failed filesystem inspection establishes no occupancy. Public-application regressions in `application/workspace-occupancy.test.ts` use real Git roots and symlink aliases to require zero host effects for both denial cases while preserving independently authorized remote observation.

Before a worktree-dependent host effect, the application reproves canonical Workspace occupancy. Its final guard includes every inspected Project and Connection, so pending registration or Workspace changes cannot bypass a collision through a symlink. Invalid configuration and shutdown also prevent the effect. Presentation-only renames remain allowed.

Registry preparation reuses admission evidence whose dependencies have not changed. The coordinator independently reuses each source owner whose source dependency is unchanged. A display rename or unrelated Project update does not replace every observer. GitHub source owners share Connection-level request pacing, cache, and rate budget through the observer pool. Pending owners can collect baseline evidence but cannot publish active state or alter active pool topology before commit. Retired callbacks cannot regain authority.

The application records admission-affecting input as pending when it arrives, before its serialized mutation runs. Queued reversions remain pending too; comparing only with the currently committed input would miss them. Committed attempts, validity, pending inputs, and account-scoped authorization usability remain separate facts. Authorization facts use Connection and account identity, so an old account's failure cannot authorize or disable a different account.

Each token refresh belongs to the credential bundle that started it. Credential writes and cache installation share one serialized mutation lane. A superseded refresh cannot revoke a replacement authorization or overwrite its persisted bundle; its observer request resolves against current credentials instead. A same-account authorization grant does not advance source-observation time.

Source-access failures distinguish `network`, `malformed-response`, and `unavailable` from `authorization-required`, `rejected-credential`, and `account-mismatch`. The coordinator supervises only committed sources without an admitted observer. GitHub operational access reproof runs every 30 seconds; Local filesystem reproof backs off from two to ten seconds. Manual refresh can reprove either observerless source. Recovery uses the application mutation lane and checks that its starting registry is still current before activation. Once input is admitted, the SourceObserver owns cadence and recovery. Shutdown clears supervision timers and joins running reproof; the coordinator does not add a second poller for admitted sources.

The GitHub pool's admitted-source interval begins at 30 seconds and follows Connection budget and failure backoff. Manual refresh of an active GitHub source reads the active owners sharing its Connection. Local observers debounce filesystem changes, reconcile every five minutes, and supervise unavailable paths with recovery backoff from two to ten seconds. These are observer lifetimes, not whole-configuration polling generations.

### Configuration input classification

| Change | Input classification | Activation and notification comparison |
| --- | --- | --- |
| Project or Connection display name | Presentation only | Reproject committed facts; retain observers and comparison evidence. |
| Automation enablement, preferences, or Harness Commands | Policy | Revalidate affected admission; retain source observers and comparison evidence. |
| Project registration or removal | Topology | Add or retire affected owners; establish a quiet baseline only for new or changed sources. |
| Local Workspace repair | Source and host input | Reprove identity. Reuse an unchanged canonical source; replace only a changed admitted source input. |
| GitHub Workspace repair | Host input | Reprove repository and canonical occupancy; retain unchanged remote observer and source evidence. |
| Connection account or source-access change | Access and source input | Revalidate affected scope; activate its configuration and source baseline together. Same-account token rotation does not itself prove observation success. |
| Invalid manual configuration | Admission validity | Retain honest last-valid observations; reject mutation, automatic admission, overrides, and host effects until repaired. |

### Source evidence and scoped retention

`observation/source.ts` owns source scopes, refined content, provenance, completeness, failure categories, and constructors. Unknown input must pass its semantic refinement before publication. The owner reuses neutral `Integration` and `ProjectKey` types, but does not import public Project, map, ticket, or Snapshot models as source authority.

Each Local or GitHub source observer owns an increasing private `readSequence`. It issues a positive safe integer when an actual named filesystem or provider operation starts. Failed attempts receive identities too. One provider response may establish several scopes with the same number; complete-membership absence copies its parent's number. Constructors preserve supplied identity. Cached replay, blocker reinterpretation, and policy or display reprojection never allocate a read. Actual reads with identical payloads and equal clock times still have different identities.

The coordinator publishes a private `sourceBindings` map alongside committed attempts. Each Project maps to its source owner's stable opaque token. Reused owners retain their token; real replacement owners receive another. The catalog compares sequences only within that token. Replacement preserves historical payloads, membership history, known identities, and trustworthy display order, but resets retired-owner readable authority, absence, and positive-membership barriers. A replacement baseline at an earlier clock time cannot lose to retired evidence.

`resources/catalog.ts` is the single server-private owner of keyed current evidence, last actual success, sticky absence, known identities, complete membership history, and trustworthy display ordering. Its only methods are synchronous `commit` and `current`; it performs no IO and reads no clock. It derives payload-bearing types from the private attempt union, not public DTOs. The application commits it immediately after coordinator commit, before publication and Automation reconciliation. Pure projection and Automation read that identical catalog snapshot. Neither keeps another retained-resource index.

| Resource phase | Required evidence and content |
| --- | --- |
| Never observed | Registered or encountered identity with no successful payload. A real failure may explain the missing read. No graph, prose, source destination, or successful time is invented. |
| Current readable | The actual own-scope observation, payload, completeness, provenance, and source times. Readable incomplete Markdown stays in this phase. |
| Retained unavailable | The actual last successful observation plus safe current unavailability evidence. Inherited failure preserves the failing ancestor's scope and provenance. |
| Proven absent | An actual typed absence proof and time, plus either no known trace or the actual last successful trace. Absence removes membership authority, never historical content. |

Map and ticket collections preserve every known scoped identity. Current complete membership, current incomplete membership with optional last complete evidence, unavailable membership with optional last complete evidence, and never-observed membership are separate facts. Complete membership proves absence for omitted known children. Failed or incomplete membership cannot prove absence through omission. A genuinely new own-scope success or newer current parent membership explicitly including the child establishes reappearance. Incomplete membership certifies only the identities it explicitly includes. Replayed older membership, success, or absence cannot reverse newer evidence.

Membership reappearance does not establish readable child content or advance its successful-read time. A failed reappearing child becomes retained unavailable with its actual last successful graph, prose, source destination, and provenance plus the current safe read failure. A child without a successful read becomes never observed with that failure. Ordering and Automation admission still require complete current readable evidence; membership alone cannot promote a readable sibling or admit work. Catalog precedence uses actual source evidence, not publication time or a guessed filesystem identity.

A genuinely new child read remains current-readable even if required parent content or membership fails. A repeated old child attempt under a newer ancestor failure becomes retained-unavailable. Same-key recovery replaces payload, source destination, warnings, completeness, and provenance, even when the new read has the same timestamp and content. Cached reinterpretation can correct the matching historical payload without becoming a new read or crossing an absence or failure barrier. Replaying unchanged evidence cannot alternate its resource phase.

The catalog establishes known-current or known-empty active order only with complete current Project and map membership evidence, every present map's complete content and known counts/status, and complete ticket membership and ticket/blocker evidence. Open maps sort by descending source `updatedAt`, then map ID. Closed maps sort by descending `closedAt` or `updatedAt`, then map ID. Uncertainty retains the earlier trustworthy open and closed order, including its private source evidence. Newly read maps remain addressable but acquire no order position under uncertainty. Complete trustworthy absence can establish a new order after all remaining scopes qualify.

Public `state.projects` is the sole Project and resource collection in a ready state. Project observations contain no maps; map observations contain no tickets. Publication `capturedAt` belongs directly to `ApplicationState`, not a second `roadmap` model. `application/projection.ts` explicitly constructs public metadata without private read sequences or source binding tokens. Ordinary catalog projection translates phase, source metadata, safe cause, and actual evidence without owning retention. Terminal saved-document translation is stateless: unchanged bindings keep actual catalog facts; changed bindings keep only actual successful content and membership history with no current evidence. It invents no failed attempt, attempt time, or provenance and adds no second lifetime authority. Internal `packages/contracts/src/resources.ts`, exported through `/state`, strictly validates resource payloads, own-scope times, scopes, provenance, current source binding, and ordering qualification. Public timestamps describe actual times; they do not infer chronology between scopes. Registration and Workspace management warnings remain independent of source warnings.

| Source evidence | Commit and interpretation |
| --- | --- |
| Readable observation | Commit the validated named scope with its actual attempt and successful-read times. Incomplete content retains raw prose, warnings, and unknown blockers. |
| Transient, provider execution, response-read, or malformed-response failure | Record the named failed attempt and retain its prior successful content and source time. Failure is not a fresh empty observation. |
| HTTP 401 or rejected credential | Record proven authorization loss. Do not infer it from a generic 403. |
| Missing or expired credentials, or a mismatched Connection account | Record the specific authorization requirement without claiming a provider rejection or repository identity mismatch. |
| Credential access unavailable before a provider request | Record access unavailability without inventing a network, provider-execution, or successful-read result. |
| HTTP 403/404, missing alias, or null provider resource | Record ambiguous access failure, not deletion. |
| Local root, enumeration, or file failure | Keep the filesystem operation and ENOENT, EACCES, or other error category. A known file's ENOENT is not membership or deletion proof. |
| Complete successful parent membership | Prove omitted maps or tickets absent from that parent scope. New current membership explicitly including a child supersedes older absence, even when the list is incomplete. Keep its identity and last-known trace without claiming a successful child read. |

Partial success commits by named scope. A readable sibling can advance while a failed alias or file retains its own history. Failed or incomplete enumeration retains prior membership and cannot certify a fresh empty collection. Scope constructors reject cross-parent content, contradictory provenance or provider identity, duplicate members, invalid absence proofs, and fabricated successful time on failures. Public failure descriptions are fixed safe text, not raw provider exceptions.

GitHub readers validate unknown responses instead of trusting `graphql<T>` assertions. Before cross-repository blockers are projected, the SourceObserver pool refreshes current names for admitted repositories and resolves provider identity to the existing opaque Project key. Renames change source names, not registered identity or Workspace proof. Unregistered source references remain explicitly external; unidentified references remain unresolved. They cannot become registered keys by copying a repository name. The public blocker union has one Zod schema in `packages/contracts/src/blocker.ts`, with its inferred type and decoder available through the supported contracts entrypoints.

Known unavailable or proven-absent maps and tickets remain selectable at their pinned URLs. A retained payload keeps its real graph, raw prose, source destination, and successful-read time, but grants no admission permission. Never-read and absent-without-trace identities have no content to render. Unknown aggregate progress is `null`, not zero. Automation requires known-current active order, current-readable complete required resources, complete explicit membership, known statuses, and complete blocker evidence.

Source health reports genuine successful-read times and retained source times. Attempt time, coordinator commit time, and public publication time are separate and do not make retained content fresh. Failure can advance attempt evidence without advancing the last successful source read.

### Notification comparison

The Change feed consumes committed source attempts with configured presentation metadata and per-Project baseline classification. It retains comparison evidence across failed reads, omitted scopes, and incomplete membership. An unknown first membership establishes a quiet baseline rather than a successful empty collection. Only explicit proven absence or complete successful parent membership removes known presence. Ticket absence can produce a frontier departure; map absence removes that map's comparison and does not invent ticket claim or close events. Reappearance uses the resulting presence history.

Initial activation is quiet. A changed source establishes a new baseline only for the affected Project; unrelated sources keep their comparison evidence. Recovery after failure compares against retained evidence instead of treating recovered content as an empty-to-full transition. Map IDs are scoped by Project, and ticket IDs by Project and map. JSON tuple keys preserve opaque IDs without delimiter ambiguity. Notification presentation order comes from the sole `state.projects` resource collection. Automation reads the committed private catalog and does not depend on notification events.

### Implemented module boundaries

The implemented source-lifetime modules include `projects/registry.ts`, `configuration/document.ts`, `observation/source.ts`, `observation/coordinator.ts`, the Local and GitHub observers, `resources/catalog.ts`, the Automation modules, pure `application/projection.ts`, and the application composition root. Registry intent and refinements do not use public snapshot comparison as admission authority. The catalog alone owns resource retention, membership, and ordering. Automation reads that catalog's current evidence and keeps its independent policy, authorization, Workspace, command, and durable-history obligations.


### Automation

`automation/database.ts` owns the strict schema version 3 Automation database. It persists immutable opportunities and append-only events, rejects invalid histories, and replays them into current evidence. An AFK Classification Verdict projects a queued Wayfinder Session before launch admission. `automation/engine.ts` reconciles the committed catalog and launches processes. Classification has one global lane; Wayfinder Sessions have one lane per Project. Queued Sessions survive disabled Project Automation and have no promised order. Durable historical targets remain addressable after live registration or source membership disappears.

The engine appends the stage reservation before launch, requires storage-confirmed durability, then validates current source, configuration, authorization, Workspace, command, and reservation ownership again. If dependencies changed during append, it records a nonlaunch result and never starts the process. Recorded reservation evidence is not proof that a process launched.

The activation-safety regressions cover both input receipt before commit and input receipt during a held append. For each Harness stage, the held-append schedule commits enabled configuration first, waits for append entry, receives the disabled replacement, then requires a durable reservation and known nonlaunch without a process effect. Both Harness Commands render GitHub map and ticket URLs for a Connection-bound GitHub source while using its admitted local Workspace; `application/automation.test.ts` covers both prompts.

The private Classification and Session stdout contracts each have one Zod 4 strict-object schema. Their result types use schema inference; the injected draft-2020-12 JSON Schema and serialized prompt payload derive from that same owner. The decoders parse unknown JSON and return validated schema output. Independent AJV interpreters exercise the delivered schemas at reason boundaries, including Unicode code points, and real harmless processes consume their injected stdin before returning Classification and Session evidence. Missing or corrupt Classification schema delivery yields a failed process result and no Session launch. Per-Project Session nonoverlap and per-opportunity causal history are requirements; ticket-winner order and HTTP/WebSocket cross-channel delivery order are not.

Both configuration and Automation storage write a same-directory temporary file, sync and close it, rename it, then sync the parent directory. Failure before rename leaves the old file authoritative. Rename followed by failure to confirm directory sync means replacement occurred but durability is unconfirmed. A close failure after successful directory sync does not undo confirmed durability. Unconfirmed Automation append installs the observed database but faults launch admission. Unconfirmed configuration replacement installs the replacement facts and inhibits Automation; it does not pretend the old input survived.

Stopping does not undo a configuration write already begun. A drained mutation returns its operation-specific canonical subject and actual configuration version with `commit: 'committed'` or `commit: 'committed-unconfirmed'`. Its HTTP outcome contains no diagnostic state. `current()` separately reflects the actual saved document during stopping, without coordinator activation or publication. Unchanged source bindings retain their catalog evidence; new or changed bindings receive no fabricated current evidence. Terminal diagnostics inhibit Automation and host launch, and stopped source owners remain retired.

A failed or conflicted write retains the prior actual document and returns rejection without an invented commit. An unconfirmed replacement reports usable replacement truth, not confirmed-success navigation or a claim that nothing was saved. Cleanup retains these persistence facts for its own write. After admitted writes and Automation interruption recording drain, the application removes each unacknowledged interrupted Session's Project from Automation enablement through its owned configuration document write, then stops that document. The disablement uses the latest document whose begun write actually replaced the file, not a stale pre-write version, and updates document diagnostics from its actual persistence result.

Cleanup does not overwrite invalid or externally pending configuration, a conflicted document, or a replacement with unconfirmed durability merely to make shutdown appear successful. If interrupted-Project disablement cannot safely complete, or its write conflicts, fails, or remains unconfirmed, stop rejects with retained safe diagnostic notice. It still joins document disposal and the other owners. An uncertain interruption remains unknown and blocks its Project on recovery; failure to confirm disk disablement is not permission to launch or a claim that the external Session stopped.

An unacknowledged interrupted Session blocks only its Project. Roadmap removes that Project from
Automation enablement. Project settings render the ordinary switch off and disabled, with an explicit
acknowledgement-and-enable action and a ticket link when the target resolves in live state. The
existing enable command appends acknowledgement of each specific unknown event before persisting
enablement, so either persistence failure remains fail-closed. Acknowledgement does not change the
unknown outcome. Public Automation evidence distinguishes queued, launching, running, terminal, and
outcome-unknown states, preserves each admitted stage's `automatic` or `override` reason, and marks
whether an unknown Session outcome has been acknowledged. Acknowledgement names the exact unknown event and does not prove completion, launch success, or recovery.

Host actions reprove the current Workspace, capture its admission dependencies, and synchronously revalidate current configuration validity, shutdown, committed dependencies, and relevant pending changes immediately before invoking the host adapter. This final check follows all awaited proof and activation work. Presentation-only changes do not revoke the proof. Canonical occupancy collisions deny host authority, including collisions discovered during reproof; GitHub remote source access remains independent.

GitHub authorization identifies and validates the account before staging credentials in Keychain, then persists and activates Connection intent. A failed new Connection save discards its staged credentials when no committed Connection owns them. While application ownership remains active, configuration success is not reported before credential and admission synchronization. A write that finishes during shutdown follows the persistence-only result contract without settling late authorization. Credentials never cross the persisted intent or browser contract.

`transport.ts` owns HTTP acceptance, bounded body reading, JSON parsing, request decoding, application dispatch, outgoing validation and serialization, and response writes and failures. It also provides a full-state WebSocket with exact origin checks. `main.ts` composes modules and binds loopback.

### HTTP admission and delivery

Queries use `POST /api/query`; commands use `POST /api/command`. HTTP and WebSocket require the exact configured Origin. Commands additionally require a loopback peer. HTTP operations require the `application/json` media type and strict request fields, including nested registration candidates and Workspaces. The browser-safe operations and wire modules have no Node or server imports. Schema validation is the authority for request types, not a handwritten request interface or Boolean-check codec.

Every HTTP request envelope requires a branded UUID `correlationId`. The browser generates it with `crypto.randomUUID()` and also sends it as `X-Roadmap-Request-Id`; transport requires matching header and body correlation before dispatch. Allowed-origin CORS preflight permits that header. Response envelopes repeat the correlation. This identifier is call-local correlation, not subject identity, authorization, chronology, deduplication, or a durable receipt. Rejection attribution uses a syntactically valid supplied header UUID, or `null` when absent or invalid. Requests do not follow redirects.

Transport dispatch begins when its request lifetime admits a decoded request and invokes public `RoadmapApplication.query` or `RoadmapApplication.execute`. This is not application effect admission. A queued command still checks phase and policy when its turn runs, and a selector query checks ready phase immediately before invocation. Expected transport failures before dispatch return the strict rejection envelope `{ type: 'request-rejected', request: 'query' | 'command', requestId: string | null, reason, message }`. It has no state or application outcome. No fabricated state or application-shaped rejection stands in for non-dispatch.

| Failure | Response when possible | Consumer meaning |
| --- | --- | --- |
| Pre-admission Origin or command peer denial | Rejection with reason `origin` or `peer`, HTTP 403 | Definitive non-admission only if the browser can read and attribute it. Origin denial omits CORS, so the browser normally observes an unreadable response and remains uncertain. |
| Pre-admission wrong method or media type | Rejection with reason `method`, HTTP 405, or `media-type`, HTTP 415 | Attributable decoded rejection proves non-admission. |
| Pre-admission declared or streamed body overflow | Rejection with reason `too-large`, HTTP 413, and connection close | Attributable decoded rejection proves non-admission. |
| Pre-admission invalid JSON or request schema | Rejection with reason `malformed-json` or `malformed-envelope`, HTTP 400 | Attributable decoded rejection proves non-admission. |
| Pre-admission body interruption | Rejection with reason `interrupted`, HTTP 400, if a response is still possible | A disconnected peer cannot be promised a response. An unreadable or lost response remains uncertain to the consumer. |
| Dispatched application rejection | Legal query result or command outcome with HTTP 200 | An application-level rejection, not a transport rejection or proof that an effect began. |
| Unexpected decode, dispatch, outgoing validation, serialization, or write failure | Safe generic HTTP 500 transport error, or connection termination | Not a non-admission proof. After invocation, application effects may have occurred. |
| Consumer-observed response loss, malformed reply, wrong attribution, wrong status, or illegal result meaning | No trustworthy delivery result | Completion remains unknown, even if the server finished writing or performed an effect. |

The browser accepts non-admission only when `decodeRequestRejection` decodes the exact envelope and its request family, attempt UUID, and reason-specific HTTP status all match. A generic readable 4xx or 5xx is insufficient. The browser constructs the local `RequestNotAdmitted` value `{ kind: 'not-admitted', ok: false, rejection, error: { code: 'admission-failed', message } }`. Query and command delivery include this value; it has no state and leaves live state intact. Command activity publishes `admission-failed` rather than reporting an uncertain application outcome.

Admitted replies must have HTTP 200 and decode against the initiating query or command, its correlation, and its exact scoped subject, including application rejections. A valid union member for another operation, a different subject or correlation, or an otherwise valid reply with the wrong HTTP status cannot acknowledge this request. Uncertain delivery reports local `transport-failed` without fabricated producer metadata or replacement state. There are no automatic HTTP retries, replay, or receipts.

The default body cap is 64 KiB. The transport buffers at most the cap, rejects declared excess before reading the body, and stops consuming on the first streamed excess without waiting for EOF or draining unbounded input. It pauses input, sends HTTP 413 with `Connection: close` when possible, and closes the socket after response flush. Request and response error handlers contain late stream errors, peer close, synchronous write throws, and asynchronous write failures.

Diagnostics contain fixed safe categories, never raw request values, credentials, or exception messages and causes. Request decoder issues report paths and categories rather than input values. Outgoing application state and results must pass strict decoding both as objects and after JSON serialization, so getters or `toJSON` cannot introduce credentials into an otherwise accepted reply.

### Public operation contract

`/operations` is the schema and inferred-type authority for `Query`, `Command`, `QueryResult`, `CommandResultFor<C>`, and `CommandOutcomeFor<C>`. Every command requires `expectedConfigurationVersion`. Outcomes require `operation`, a tagged `subject`, `serverEpoch`, `stateSequence`, and either `ok: true` with the operation-specific result or `ok: false` with `SafeError`. A successful command's `result.type` equals its initiating `command.type`. Subject matching checks exact scoped identity in both successes and rejections; brands alone do not prove runtime parent equality. Producer provenance describes where the outcome was produced, not a state replacement or durable receipt.

The table lists every public operation. `commit` means the actual `configurationVersion` and `commit: 'committed' | 'committed-unconfirmed'`; `phase` means the authorization payload described below. Connection, Project, authorization, registration, Automation, and ticket subjects are tagged objects, not display-name or submitted-path lookups.

| Operation | Required outcome subject | Successful acknowledgement and effect |
| --- | --- | --- |
| `select-workspace` | `none` | `selected` with `path`, or `cancelled` without a path. Interaction only. |
| `begin-github-authorization` | `none` | New `operationId` and actual resulting phase. Begins the device-flow attempt. |
| `reauthorize-github-connection` | `connection` with `connectionId` | `operationId` and actual resulting phase for that configured Connection. |
| `retry-github-authorization` | `authorization` with `operationId` | Same operation's actual retried phase, not a promise of waiting. |
| `cancel-github-authorization` | `authorization` with `operationId` | Actual resulting phase; a completed grant remains granted. |
| `rename-connection` | `connection` with `connectionId` | Canonical `connectionId` and commit. |
| `remove-connection` | `connection` with `connectionId` | Canonical `connectionId` and commit. Does not revoke provider authorization. |
| `register-project` | `registration` with `integration` and `connectionId` | Canonical `project`, `connectionId`, `workspacePath`, and commit. |
| `rename-project` | `project` with scoped `project` | Canonical `project` and commit. |
| `repair-project-workspace` | `project` with scoped `project` | Same canonical `project`, admitted `workspacePath`, and commit. |
| `remove-project` | `project` with scoped `project` | Canonical `project` and commit. Does not delete its source. |
| `set-automation-enabled` | `automation` | Actual `enabled` and policy commit. |
| `set-project-automation-enabled` | `project` with scoped `project` | Canonical `project`, actual `enabled`, and policy commit, preserving exact interruption acknowledgement. |
| `start-automation-override` | `ticket` with scoped `target` and `stage` | Canonical `target`, requested `stage`, `admission: 'override'`, and `status: 'admitted'`. Confirmed durable admission only. |
| `refresh-project` | `project` with scoped `project` | Canonical `project` and actual committed source `attempt`. |
| `launch-project-operation` | `project` with scoped `project` | Canonical `project`, finite `operation`, and `status: 'invoked'`. Host invocation completed only. |

Registration consumes the canonical Project returned by admission even when the submitted Workspace path resolves to different bytes. Repair retains Project identity and returns its canonical Workspace. Rejected mutations invent neither a commit nor a Project. A `committed-unconfirmed` mutation exposes the actual replacement version and subject, but consumers must not show confirmed-success feedback or navigate as if durability were confirmed. No receipt, replay, or submitted-path matching repairs uncertainty.

Removal feedback belongs to a page-level operation owner that survives the affected Connection or Project leaving authoritative state. A confirmed removal may navigate; an unconfirmed removal retains its canonical subject, actual replacement version, and durability warning without portraying the absent resource as current.

Authorization results have a flat `phase` discriminator and an `operationId`. `waiting` requires `verificationUri`, `userCode`, and `expiresAt`. `granted` requires canonical `connection: { connectionId, accountId }` and `configurationVersion`. `denied` and `failed` require `SafeError`; `expired` and `cancelled` have no fabricated failure payload. Begin, reauthorization, retry, and cancellation acknowledge the actual resulting phase, including immediate failure or an already-completed grant. Cancellation does not imply credential revocation or rollback. Private authorization facts remain authoritative; state projection and operation translation do not create competing workflows.

Authorization consumers retain a phase result only until the authoritative operation first supersedes it. Consumption is permanent for that feedback, so an identical later denial cannot reactivate an earlier waiting code. Connection-scoped controls do not retain another Connection's feedback across route changes. Published current grants supply their canonical Connection and account for navigation; consumers report a grant commit version only when an actual granted outcome supplies it.

Folder selection distinguishes non-error cancellation from `selection-failed` and lifecycle rejection. Selected path bytes are not trimmed and are not trusted Workspace identity or permission for later launch. The registration owner still resolves and proves the candidate. This interaction is not cached, retried, or replayed as a resource query.

Selector feedback and Workspace validation errors are independent. Cancellation never hides a later required-folder or admission error. A stopped application's `not-supported` response is lifecycle rejection, not a native selector failure.

Refresh reaches the active committed Local or GitHub source owner independently of host effects. `attempt` includes actual `attemptedAt` and source `provenance`. `observed` includes completed `observedAt` only when all named scopes establish complete successful evidence; an identical successful read may advance that time without inventing content change. `degraded` includes a safe `cause` and actual Project root success time as `observedAt`. It prefers the prior captured catalog time, or uses the current successful root time when no prior success exists. This does not establish a complete fresh source read. A nested failed scope's `attemptedAt` and the root's `observedAt` belong to different scopes, so their ordering is not constrained. `failed` includes a safe `cause` without fabricated successful time. `proven-absent` includes actual absence-proof time. Partial nested failures cannot become success merely because the root read or reconciliation completed. Authorization, access, and observation failures remain distinguishable from successful source observation and durable configuration commit.

An observerless manual refresh checks current source admission before it acknowledges an attempt. Recoverable unavailable sources run reproof; a proven authorization-required source reports a new failed attempt without contacting GitHub or inventing regained access. Repeated missing-Workspace failures carry the requested reproof's actual time and a new read sequence, not cached startup evidence. Pending admission that prevents the check produces rejection rather than a fabricated refresh result.

The private `HostOperation` union contains only `select-workspace`, `open-workspace`, `open-terminal`, and `reveal-source`. Launch variants carry canonical private Project identity and a server-resolved trusted Workspace path, never whole application state, configuration, credentials, browser executables, or browser arguments. The `HostExecutor` interpreter exhausts that union and alone constructs executable and arguments. Workspace reproof and the final current-dependency guard precede dispatch. Selection returns selected/cancelled; launch returns invocation evidence only. Source refresh is not a host operation. Native invocation proves neither completion in the external application nor a durable Automation Session. Automation override admission instead names the exact ticket and stage with actual durable admission evidence.

Public actions are usable variants: roadmap links and external links require `href`; server launches require a canonical Project and one of `open-workspace`, `open-terminal`, or `reveal-source`. UI icon mapping does not interpret arbitrary action IDs or duplicate server admission policy.


### Operation evidence and completion uncertainty

Delivery evidence and state authority answer different questions. Operation outcomes contain no `ApplicationState`; accepting their operation truth never grants read authority. Accepting authoritative state does not prove completion of an earlier operation.

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Attributable, decoded pre-admission rejection with matching request family, UUID, and status | This HTTP attempt did not reach application admission. | An application outcome or a result for another attempt. |
| Decoded HTTP 200 application outcome with matching operation, correlation, and canonical subject | That operation's reported outcome, including application-level rejection. | Read authority or a receipt for another attempt. |
| Lost, unreadable, malformed, wrongly attributed, or otherwise untrustworthy response | Completion unknown; effects may already have occurred. | Non-admission, failure, or permission to replay. |
| Relevant canonical configuration identity or version in authoritative state | Only the relevant current configuration fact, such as the targeted identity or version now being present. | A universal receipt, attribution of that fact to a lost attempt, or unrelated host-effect completion. |
| Durable Automation evidence for the exact opportunity and stage | Only that stage's recorded admission or stage facts. | Another stage's admission, process success beyond recorded evidence, or completion of an unrelated command. |
| A newer snapshot, unrelated sequence advance, or a live socket | State advancement or transport liveness under their respective contracts. | Receipt or completion of an uncertain operation. |
| A lost host-launch reply without an operation-specific durable trace | Completion stays unknown even after synchronization. | Whether the host effect occurred; absence of a trace is not failure evidence. |

These limits describe the meaning of existing evidence, not an automatic reconciliation policy. The browser does not retry or replay an uncertain operation, infer failure after reconnect, or convert arbitrary live state into a receipt.

### Public contracts and translation ownership

The backend domain is private. Sharing an immutable neutral identity does not make a public DTO authoritative for source admission, Workspace proof, retention, authorization, or durable replay.

| Fact | Private domain and persisted authority | Public translation and external schema |
| --- | --- | --- |
| Project intent, Connection intent, and Workspace admission | `projects/registry.ts` refines private candidates; `configuration/document.ts` owns version 6 persisted intent and migration. | `projectApplicationState` in `application/projection.ts` translates committed intent and admissions to Project management facts and Integration-specific Connections. `/state` owns their external variants. |
| Source reads, membership, absence, and retained content | `observation/source.ts` refines private attempts; `SourceObserver` implementations supply evidence; `observation/coordinator.ts` commits activation; `resources/catalog.ts` alone retains resources. | `projectApplicationState` consumes the committed `ResourceCatalogSnapshot` and constructs public scoped resources. `/state` exports resource schemas without private tokens or read sequences. |
| Authorization and credentials | Application-owned device flow and account-scoped credential admission own runtime truth; the credential vault owns secret storage. | Projection publishes waiting, granted, and terminal authorization evidence through `/state`. Waiting requires verification URI, user code, and expiry. Granted requires a canonical Connection/account receipt marked current or historical. Denied and failed require a safe cause; expired and cancelled are separate outcomes. |
| Automation opportunities and stage evidence | `automation/model.ts` owns private variants; `automation/database.ts` owns version 3 persisted events and legal replay; `automation/engine.ts` owns reservation and launch admission. | Projection translates replayed evidence to `/state` Classification and Session variants without private event identity. Durable targets need not exist in current Projects. |
| Queries, commands, and application outcomes | `RoadmapApplication` owns interaction admission; `createApplicationOperations` translates private refresh, Workspace, selector, and launch interfaces. | `/operations` owns inferred request/result/error schemas, canonical subjects, and operation-specific result checks. All outcomes are state-free with producer epoch and sequence. |
| HTTP and WebSocket messages | `transport.ts` admits requests, dispatches through `RoadmapApplication`, and validates outgoing objects and serialized JSON. | `/wire` owns envelopes, all unknown-input decoders, request rejection, UUID validation, and rejection status policy. It composes `/state` and `/operations`, rather than maintaining separate DTO declarations. |

Private production owners may import `/identity` for identical semantic meanings. Only `application/application.ts`, `application/projection.ts`, `application/operations.ts`, and `transport.ts` translate public formats. Projection imports state, never operations or wire. Operation translation imports operations, never state or wire directly. Application composition is transport-independent and cannot import wire. Transport imports only wire and the `RoadmapApplication` facade, not private owners. Main wires concrete adapters into private interfaces; policy does not import their implementations or persistence factories.

`identity` contains distinct branded Connection, Project, map, ticket, authorization-operation, correlation, epoch, sequence, and configuration-version meanings. `ProjectRef` includes Integration and Project ID; `MapRef` requires its Project; `TicketRef` requires its map and Project. IDs remain opaque and routes decode them once, without slug restrictions. An admitted key is not a source name, display label, or Workspace path. Brands prevent cross-kind construction, not runtime existence, arbitrary parent equality, filesystem identity, or chronology. Epochs are identities; sequence order applies only within an established epoch.

One public Project contains its Connection association, Integration-specific source and management facts, actions, resource evidence, map membership, maps with canonical tickets, display order, and active-map result. Local and GitHub locators and provenance cannot be interchanged. Link actions require `href`; server-launch actions require a canonical Project and a finite supported operation. Lifecycle state distinguishes idle, starting, ready with mutable/read-only mode, stopping, stopped, and failed with retained evidence where applicable. Resource results distinguish never-observed, current-readable, retained-unavailable, and proven-absent with or without historical trace. Membership completeness and active-map known-empty/current/unknown results remain separate from resource readability.

Local registered blocker IDs stay within their originating map, including missing and retained targets. GitHub issue IDs use repository-wide lookup, with ambiguous matches remaining unresolved. Current Project source destinations and source actions reuse observed GitHub names and URLs only when the canonical repository ID matches the configured binding. Retired bindings keep their metadata in historical resource observations, not the replacement Project's destination.

Map `frontier` contains scoped `TicketRef` values. Consumers resolve them against that map's canonical tickets. Private source, Automation, and persisted owners use private models rather than public DTOs as their domain authority. The four supported package leaves are the public schema interface.

Strict own-data decoding starts at `unknown`, rejects undeclared fields and inherited discriminators, and applies resource and whole-state refinement. It checks unique canonical identities and memberships, parent scopes, actual Connection association, Integration/source agreement, current binding provenance, open/closed placement, display ordering, frontier consistency, and ticket-type evidence. Missing type evidence requires `labels: []`; nonempty unrecognized or conflicting labels use their corresponding variants. Incomplete ticket collections may retain larger source aggregate counts. Claimed and blocked remain independent facts even when display placement chooses blocked. Unknown blockers remain unknown.

A completed AFK Classification requires a queued or later Wayfinder Session. Every Session requires a completed AFK Classification. Queued Sessions have no admission; launching, running, finished, launch-failed, and outcome-unknown Sessions carry their actual automatic/override admission. Process result, Session report, and tracker facts need not agree. Acknowledged outcome-unknown remains unknown. Public variant validation cannot prove correspondence to a real durable history; private replay owns legal transitions. Schemas also cannot establish truthful absence, successful IO, atomic activation, actual Session chronology, readiness, or effect completion. Attempt, last successful read, retained successful time, and publication time retain different meanings.

### Compiler projects

Contracts compile in `packages/contracts/tsconfig.json` against ES2023 with `types: []`, without DOM or Node ambient types. Web source compiles separately in `apps/web/tsconfig.app.json` against ES2023/DOM and `vite/client`, without Node ambient types. The private server uses `apps/server/tsconfig.json` with ES2024, Node ambient types, and NodeNext resolution. Vite configuration has its own Node project.


Run the installed repository gates from the root:

```sh
pnpm check
pnpm typecheck
pnpm test
pnpm knip
pnpm --filter @roadmap/web build
```

`pnpm check` runs Biome. `pnpm test` runs the workspace application test suites.

`pnpm typecheck` runs project compilation and Astro checking. Runtime schemas and their application tests still validate decoded shapes and scoped relationships.

Use `pnpm --filter @roadmap/web build` for the production browser build. The root `build` script recursively invokes itself and is not production-browser evidence.


## Configuration and credentials

The root `.env.local` holds the public GitHub App identifiers. Device-flow credentials live in macOS Keychain. The schemas for `roadmap.config.json`, `ApplicationState`, and transport messages do not allow credentials.

## Partial data

Completeness belongs to each own-scope observation and each membership result. Public resources preserve raw `MapBody` content, missing sections, warnings, actual provenance and source time, and ticket `blockersComplete`. Unknown aggregate progress is `null`. An incomplete readable document stays current-readable; a failed read retains only real prior success; complete trustworthy membership can prove absence. None permits discarding known trace or treating retained display as current admission evidence.

## Verification

Changes require a regression at the responsible module's interface, migration of affected callers and contracts, and an exercise of the changed runtime behavior. Run the standard repository checks listed above.

Tests protect promised meaning, security and causal ordering. They must not freeze copied schema representation, handwritten method-list order, minimum publication counts, arbitrary ticket winners or ordering between separate HTTP and WebSocket channels. Preserve complete named workflow exercise, immutable prior publications, accepted read/current policy identity, explicit request/effect counts, per-Project Session nonoverlap, exactly consumed opportunity identities and durable start/running/terminal order within each opportunity. WebSocket publication and correlated HTTP reply each retain their own meaning without a global cross-wire order.

### Invariant matrix

Paths in server rows are under `apps/server/src/`; application suites are under `application/`. The matrix maps runtime invariants to their test owners.

| Responsibility | Required invariant and proof owner |
| --- | --- |
| Coherent observation | `application.test.ts`, `source-continuity.test.ts`, `source-binding-continuity.test.ts` and `source-evidence.test.ts` capture every deferred activation/recovery publication. Active unrelated sources keep updating; old owner callbacks cannot displace the successor. Neutral rename/enablement/Workspace repair preserves remote observation lifetime; source changes require a coherent candidate baseline. |
| Source provenance and acquisition | `source-time.test.ts`, `source-read-identity.test.ts`, `source-access.test.ts`, GitHub connection/source suites and actual Local reader/parser suites distinguish successful own-scope reads, attempts and publication. Identical/equal-clock successful reads count; failures, credential rotation and unrelated publication do not invent freshness. Parent metadata and incomplete child membership remain independent. Private binding/read sequence never enters public output. Include failed batches/pagination, malformed responses, HTTP-200 GraphQL errors and parser refinement. |
| Scoped registration and Workspace admission | `registration.test.ts`, `workspace-occupancy.test.ts`, `activation-safety.test.ts` use canonical temporary paths/Git identity and real application admission. Normalized collision-safe Local identity survives saved-document restart and changed map content. Aliases and repairs preserve intended scope; wrong repository/account/history is denied. Denied or unauthorized Projects still occupy their canonical Workspace. Reproof after queued invalidation/alias/stop denies host effects; neutral rename is a positive control. Source capability does not imply host authority. |
| Retained resource and absence truth | `resource-retention.test.ts`, `resource-admission.test.ts`, source continuity/read-identity and public-source suites distinguish current-readable, retained-unavailable, never-observed, known-empty and proven-absent. Actual root/directory/file failures and ENOENT/reappearance preserve raw trace. Trustworthy complete membership alone proves absence/order; no failed-head promotion, opaque-ID guess or stale admission. Readable incomplete Markdown remains raw with unknown counts/blockers; claimed and blocked facts may coexist. |
| Ingress, output and operation meaning | `transport.test.ts`, `ingress-contract.test.ts`, `operation-contract.test.ts`, `operation-outcomes.test.ts` reject malformed/inherited/accessor/extra fields, exact-limit violations, wrong Origin/loopback/method/media type or correlation before invocation; later valid requests recover. Pre/post-admission faults, interrupted bodies, response writes and revalidation never invent nonexecution or expose secrets. HTTP carries operation/subject/correlation and producer epoch/sequence, never ApplicationState. Canonical selected/cancelled folder and finite invoked host outcomes remain distinct. |
| Read authority and uncertain delivery | `session-authority.test.ts`, web `roadmap-store.test.ts` and `operation-delivery.test.ts` protect both previously unseen predecessor orders, established predecessor settlement, equal/older/newer high-water and retired callbacks. Only a valid still-current request's differing-epoch outcome requests a fresh socket; HTTP never advances reads. Prebaseline, obsolete, unreadable, wrong family/subject/status/correlation replies cannot synchronize. Independently valid replies settle attempts even when their producer is retired. Unknown remains per attempt across dismissal/reconnect/unrelated results; the application does not replay. |
| Automation admission and reservation | `automation.test.ts`, `activation-safety.test.ts`, `resource-admission.test.ts` exercise Classification/Wayfinder and automatic/override modes. Override bypasses enablement only. Current readiness/evidence/configuration/Workspace and per-opportunity eligibility govern effects. Held append requires entered barrier, no pre-release reservation, exact durable reservation then same-opportunity known nonlaunch after revocation, zero effects and restart no-repeat. Early queued disablement never enters append; neutral changes permit safe effects. Failed or uncertain reservation never launches. |
| Durable truth and independent outcomes | `configuration.test.ts`, `automation-database.test.ts`, live/drained outcome and GitHub connection suites inject actual document faults. Precommit preserves old bytes; postrename preserves committed truth with explicit uncertain durability, matching version/disk/restart and later recovery. Vault precedes config; only precommit orphan credentials may be removed. Replay rejects orphan/duplicate/repeated terminal/wrong acknowledgement/cross-stage history. Admission, Verdict, process, Session report and tracker remain independent; queued means no admission, acknowledged unknown stays unknown, exit9 plus completed report is legal, absent targets retain evidence. |
| Injected stdout authority | Classification and Session contract owners infer authoritative types and emitted JSON Schema from their strict schemas; actual engine/interpreter callers use those types. No handwritten parallel result interface, AJV generic or type assertion certifies agreement. Independent AJV interpreter controls establish injected accept/refuse behavior, and harmless actual process stdin establishes Classification contract delivery. Session delivery is separate. Schema-copy equality alone proves neither delivery nor behavioral equivalence. |
| Terminal lifecycle | `lifecycle.test.ts`, `source-lifecycle.test.ts`, actual Local observer late-acquisition, `automation-lifecycle.test.ts`, GitHub authorization overlaps, `transport-lifecycle.test.ts` and transport close suites join late load/candidates, watchers, recovery/append, admitted selectors/host work, credential tasks, owned classifier and response flush/listener/socket closure. Stop-before-start is terminal; repeated calls share settled success/failure. Queued callback is not admission; no late publication/reacquisition occurs. Invalid configuration can be read-only ready, not mutable ready. External launched Sessions remain deliberately unmanaged and unknown after retirement. |
| Decoder shapes and relations | `blocker-contract.test.ts`, `public-source-contract.test.ts`, `operation-contract.test.ts` plus actual scoped Local/replay suites reject wrong Connection/Integration/source, nested cross-parent refs, duplicate canonical identities/membership, inconsistent placement/order/frontier and missing/contradictory ticket evidence. Accept equal leaf IDs under different parents, missing labels `[]`, legitimate unknown/conflicting variants, aggregate counts beyond fetched children and unknown blockers. Refine authorization/action/resource/lifecycle/stage payloads, independent evidence, safe current/historical destinations and exact operation families. Own-data checks do not evaluate accessors or disclose secret values. |
| Workflow policy | Web `workflows/workflows.test.ts`, `store/operation-delivery.test.ts`, and application operation/transport tests protect command policy, scoped attempts, authorization phases, canonical destinations, and uncertain delivery. |

### Allowed dependency directions

The public package exports exactly `identity`, `state`, `operations` and `wire`. Identity cannot depend on state; state cannot depend on operations; operations cannot depend on wire. Supported leaves, not root/codecs/private deep or relative internals, are the consumer interface. Contracts cannot import Node/server/web/UI. Contract compilation has `types=[]` and ES2023 without DOM/Node; web compilation has ES2023/DOM and actual Vite types with no Node declarations; private server compilation uses its ES2024 NodeNext/Node graph.

Web provider/store consumes public wire; pure resource results consume identity/state, not React/router/store/views/UI/wire/operations/workflows. Pure workflows consume supported public policy vocabulary, not provider/store/views/React/UI/wire or server internals. Views consume provider/workflows and pure results, not transport construction or facade execution/version capture. Private policy uses private models and supported ports, not public DTOs, composition or concrete adapters. Source adapters do not import other providers. Projection consumes public state; operations consumes public operations; the application facade has no wire dependency; transport consumes application/public wire rather than private owners. Server does not import web/UI/docs. Generic UI is domain-independent; docs consumes UI, not Roadmap runtime state. Production does not import test fixtures. Avoid dependency cycles, including type-only cycles.

These dependency directions are design conventions. Standard compiler checks, runtime schema validation, and application tests verify their respective contracts.

