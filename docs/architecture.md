# Architecture

## System shape

Roadmap is a local-first application for one user. It reads source maps and tickets, but configuration, authorization, host actions, and opt-in Automation can have effects. The repository has five workspace areas:

- `packages/contracts` owns browser-safe authoritative Zod 4 operation schemas in `@roadmap/contracts/operations` and HTTP request/rejection schemas and decoders in `@roadmap/contracts/wire`. `Query` and `Command` are inferred from those schemas and exported through the existing package facade. It also defines domain types such as `Project`, `WayfinderMap`, `Ticket`, and `ApplicationState`.
- `packages/ui` provides domain-independent presentational components and design tokens through the `@roadmap/ui` workspace package.
- `apps/server` owns application state, persistence, integrations, and network access.
- `apps/web` renders application state and sends queries and commands.
- `apps/docs` owns the standalone catalog for public `@roadmap/ui` components and tokens.

WebSocket carries full state replacements. HTTP carries `query` and `execute` requests.

## Web application

`apps/web/src/store` is the SPA data layer. It accepts complete state replacements under current-generation authority, sends HTTP queries and commands, and owns synchronization, socket liveness, retained facts, command status and errors, and capped reconnect backoff.

`RoadmapProvider` owns the store start effect and subscribes even while initial children are gated. Before any authoritative state exists it renders an explicit waiting status, not empty Projects, default configuration, or a fabricated capture time. Once real state exists, children remain mounted through disconnect and reconnect. `useRoadmap` exposes the actual state fields, a real `capturedAt`, existing query and execute methods, and `synchronization: 'synchronized' | 'retained'`. Views never fetch directly.

### Browser authority and synchronization

The contract for [What establishes the authoritative server session across HTTP and WebSocket?](https://github.com/asmundwien/roadmap/issues/107) separates state authority from operation delivery. Each new socket has a distinct generation. Only the first validated state from the current generation establishes its authoritative server session. Socket open alone proves no application synchronization. Epoch identifiers are opaque identities, not clocks; sequence numbers are comparable only within the same established epoch.

`RoadmapStore.getSnapshot` retains transport and command activity and represents application synchronization as a discriminated union:

- `synchronization: 'not-ready'` requires `state: null`.
- `synchronization: 'synchronized'` requires a real `ApplicationState` accepted under the current generation.
- `synchronization: 'retained'` requires a previously accepted `ApplicationState` without current-generation synchronization.

Socket liveness is independently `connecting`, `live`, or `disconnected`. A live socket can still be not-ready or retained while awaiting a valid baseline. The provider exposes a global retained-state status even in that case. Browser synchronization says nothing about server Connection degradation or Project reachability; a synchronized snapshot can contain either.

Every HTTP request captures its authority at invocation: the current socket generation and its established baseline identity, or no authority if that generation has no baseline. Settlement never supplies missing request-start provenance. An independently valid operation outcome remains usable even when its enclosed state cannot be accepted. Queries currently carry no state and retain the HTTP admission and delivery semantics below.

| Event and provenance | State authority and ordering | Synchronization |
| --- | --- | --- |
| Startup with no accepted state | No epoch or state is established. HTTP cannot seed either. | Not-ready. |
| Current socket opens, or sends an invalid or withheld baseline | Opening and invalid input establish no authority. | Not-ready, or retained if prior facts exist. |
| First valid state on the current socket generation | Establish its epoch. A different epoch may replace prior facts without comparing sequence numbers across epochs. | Synchronized. |
| Later state on the established current socket, same epoch | Accept only a strictly greater sequence; equal or older state leaves the accepted maximum intact. | Synchronized. |
| Later state on the established current socket, different epoch | Ignore it; the same socket cannot establish a successor epoch. | Unchanged. |
| Reconnect baseline, same epoch, equal or older sequence | Establish the new generation's authority but retain the previous maximum state. | Synchronized after that valid baseline. |
| Reconnect baseline, same epoch, newer sequence | Establish the new generation's authority and advance the state. | Synchronized. |
| Reconnect baseline, different epoch | Establish the new generation's epoch and accept its baseline; no epoch chronology is inferred. | Synchronized. |
| HTTP outcome started under still-current established authority, same epoch | Its state may advance only at a strictly greater sequence. Equal or older state does not regress facts. | Unchanged. |
| HTTP outcome started under still-current established authority, different epoch | Return the valid outcome but never adopt its enclosed state. Retire the socket generation and start a fresh one to obtain a valid authoritative baseline. | Retained until the fresh baseline. |
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

The map area lives in `apps/web/src/views/map`. `page.tsx` resolves the registered Project, live map, and URL-selected ticket from application state. `map-navigation.tsx` groups live maps and closed history. `map-container.tsx` owns the React Flow viewport and pan, zoom, and fit controls; `graph.ts` projects real blocked-by relationships and uses Dagre for layout. `ticket-node.tsx` renders ticket and unresolved or external blocker nodes. Closed tickets remain in the graph, with arrows from blockers to dependent tickets.

`ticket-modal.tsx` opens the URL-selected ticket in the shared native Modal. It retains ticket bodies, metadata, blockers, source links, Automation evidence, and eligible Automation controls. Opening a ticket pushes a pathname that pins its map and selects the ticket. Closing the Modal or returning to map prose replaces that history entry with the pinned map pathname, so Back does not reopen the closed ticket. Back and Forward otherwise restore the URL-selected map and ticket. `map-content.tsx` renders complete raw map Markdown inline below the graph, with a structured fallback when raw content is absent. `prose.tsx` renders Markdown and resolves references within the current Project and map: local ticket links open ticket details, map references return to map prose, and external references use available source links. Unresolvable local references explain why they cannot be opened. Missing tickets, incomplete blockers or map sections, warnings, and unavailable Projects or maps remain explicit rather than disappearing.

Application component styles use CSS Modules. Components resolve local class names with `classnames/bind`. Reusable styling belongs to shared components, not shared stylesheet imports. React Flow also imports its required vendor stylesheet for graph rendering and viewport controls.

Each routable area under `apps/web/src/views` has a `page.tsx` entry point. `App` routes the Connections list, `settings/connections/[connectionId]/page.tsx`, and its connection-scoped `import/page.tsx` independently. The detail page selects the Connection and composes sibling Details and Manage connection sections. Each section reads its own live state and owns its own commands, busy state, and errors. The import page registers a Project through the selected Connection. `shared/` and `shell/` are support areas, not pages.

The web catalog at `/components` documents components that are tightly coupled to the domain. These components map domain state to presentational props, and builds on agnostic content from `@roadmap/ui`.

React functions use named `...Props` types instead of inline object annotations.

Web source files use `@/` for imports outside their current directory. The alias maps to `apps/web/src`; sibling imports remain relative. TypeScript imports omit `.ts` and `.tsx` extensions.

## Documentation application

`apps/docs` consumes the public `@roadmap/ui` exports and token-layer guides. It owns catalog composition, navigation, and presentation behind a standalone static site, with no dependency on web source, domain contracts, application providers, or server configuration. Product encodings remain in `apps/web`.

## Server

`apps/server/src/application/application.ts` composes the transport-agnostic `RoadmapApplication`. Its public interface is `start/current/subscribe/query/execute/stop`. It serializes configuration mutations, manages credentials and account-scoped authorization usability, and publishes the existing public application state through `application/projection.ts`.

`configuration/document.ts` owns the strict version 6 `roadmap.config.json` intent codec, storage, file watching, and migration from versions 1 through 5. Persisted intent contains no runtime proofs or provider clients. Invalid manual input retains the committed runtime and inhibits admission and configuration writes until repaired.

`projects/registry.ts` is a private candidate and refinement owner, not active configuration authority. It produces immutable candidates with separate source and Workspace admissions. `observation/coordinator.ts` activates candidates after replacement owners have scoped baseline evidence, commits the registry and observation together, and retires replaced owners. Integration readers in `github/observer.ts` and `local/observer.ts` implement `SourceObserver`; `wayfinder` parses source content. They produce private attempts from `observation/source.ts`, not public Projects, maps, or tickets. `change-feed.ts` compares committed scoped attempts for notifications, not public snapshots.

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

| Source evidence | Commit and interpretation |
| --- | --- |
| Readable observation | Commit the validated named scope with its actual attempt and successful-read times. Incomplete content retains raw prose, warnings, and unknown blockers. |
| Transient, provider execution, response-read, or malformed-response failure | Record the named failed attempt and retain its prior successful content and source time. Failure is not a fresh empty observation. |
| HTTP 401 or rejected credential | Record proven authorization loss. Do not infer it from a generic 403. |
| Missing or expired credentials, or a mismatched Connection account | Record the specific authorization requirement without claiming a provider rejection or repository identity mismatch. |
| Credential access unavailable before a provider request | Record access unavailability without inventing a network, provider-execution, or successful-read result. |
| HTTP 403/404, missing alias, or null provider resource | Record ambiguous access failure, not deletion. |
| Local root, enumeration, or file failure | Keep the filesystem operation and ENOENT, EACCES, or other error category. A known file's ENOENT is not membership or deletion proof. |
| Complete successful parent membership | Prove only that omitted maps or tickets are absent from that parent scope. Keep their identities and last-known trace. |

Partial success commits by named scope. A readable sibling can advance while a failed alias or file retains its own history. Failed or incomplete enumeration retains prior membership and cannot certify a fresh empty collection. Scope constructors reject cross-parent content, contradictory provenance or provider identity, duplicate members, invalid absence proofs, and fabricated successful time on failures. Public failure descriptions are fixed safe text, not raw provider exceptions.

GitHub readers validate unknown responses instead of trusting `graphql<T>` assertions. Before cross-repository blockers are projected, the SourceObserver pool refreshes current names for admitted repositories and resolves provider identity to the existing opaque Project key. Renames change source names, not registered identity or Workspace proof. Unregistered source references remain explicitly external; unidentified references remain unresolved. They cannot become registered keys by copying a repository name. The public blocker union has one Zod schema in `packages/contracts/src/blocker.ts`, with its inferred type and decoder available through the supported contracts entrypoints.

Known unavailable or scoped-absent maps and tickets remain addressable. They are not fresh admission evidence. Missing membership, unreadable active-map evidence, incomplete tickets, and unknown blockers prevent Automation admission. `MapProgress` is `null` when aggregate counts are unknown. Map and Overview consumers display unknown counts instead of zero and continue to render retained graph and ticket prose under the pinned URL.

Source health reports genuine successful-read times and retained source times. Attempt time, coordinator commit time, and public publication time are separate and do not make retained content fresh. Failure can advance attempt evidence without advancing the last successful source read.

### Notification comparison

The Change feed consumes committed source attempts with configured presentation metadata and per-Project baseline classification. It retains comparison evidence across failed reads, omitted scopes, and incomplete membership. An unknown first membership establishes a quiet baseline rather than a successful empty collection. Only explicit proven absence or complete successful parent membership removes known presence. Ticket absence can produce a frontier departure; map absence removes that map's comparison and does not invent ticket claim or close events. Reappearance uses the resulting presence history.

Initial activation is quiet. A changed source establishes a new baseline only for the affected Project; unrelated sources keep their comparison evidence. Recovery after failure compares against retained evidence instead of treating recovered content as an empty-to-full transition. Map IDs are scoped by Project, and ticket IDs by Project and map. JSON tuple keys preserve opaque IDs without delimiter ambiguity. Automation consumes committed observation directly and does not depend on notification events.

### Implemented module boundaries and remaining cutovers

The implemented source-lifetime modules are `projects/registry.ts`, `configuration/document.ts`, `observation/source.ts`, `observation/coordinator.ts`, the Local and GitHub observers, `automation/model.ts`, `automation/database.ts`, `automation/engine.ts`, `application/projection.ts`, and the application composition root. Registry intent and refinements do not use public Snapshot comparison as admission authority. Projection owns the existing public presentation model; Automation derives admission from private committed attempts.

The obsolete whole-Adapter Slice/store composition is removed. ResourceCatalog, the full public state/schema/export replacement, permanent repository-wide dependency enforcement, and the remaining lifecycle cutover belong to issues 110, 112, and 111 respectively. The current modules do not claim those future boundaries are complete. Generic UI, documentation application, and URL ownership remain unchanged.

### Automation

`automation/database.ts` owns the strict schema version 3 Automation database. It persists immutable opportunities and append-only events, rejects invalid histories, and replays them into current evidence. An AFK Classification Verdict projects a queued Wayfinder Session before launch admission. `automation/engine.ts` reconciles committed observation and launches processes. Classification has one global lane; Wayfinder Sessions have one lane per Project. Queued Sessions survive disabled Project Automation and have no promised order.

The engine appends the stage reservation before launch, requires storage-confirmed durability, then validates current source, configuration, authorization, Workspace, command, and reservation ownership again. If dependencies changed during append, it records a nonlaunch result and never starts the process. Recorded reservation evidence is not proof that a process launched.

The activation-safety regressions cover both input receipt before commit and input receipt during a held append. For each Harness stage, the held-append schedule commits enabled configuration first, waits for append entry, receives the disabled replacement, then requires a durable reservation and known nonlaunch without a process effect. Both Harness Commands render GitHub map and ticket URLs for a Connection-bound GitHub source while using its admitted local Workspace; `application/automation.test.ts` covers both prompts.

Both configuration and Automation storage write a same-directory temporary file, sync and close it, rename it, then sync the parent directory. Failure before rename leaves the old file authoritative. Rename followed by failure to confirm directory sync means replacement occurred but durability is unconfirmed. A close failure after successful directory sync does not undo confirmed durability. Unconfirmed Automation append installs the observed database but faults launch admission; unconfirmed configuration replacement activates the replacement facts but inhibits Automation and reports persistence failure rather than pretending the old input survived.

An unacknowledged interrupted Session blocks only its Project. Roadmap removes that Project from
Automation enablement. Project settings render the ordinary switch off and disabled, with an explicit
acknowledgement-and-enable action and a ticket link when the target resolves in live state. The
existing enable command appends acknowledgement of each specific unknown event before persisting
enablement, so either persistence failure remains fail-closed. Acknowledgement does not change the
unknown outcome. Public Automation evidence distinguishes queued, launching, running, terminal, and
outcome-unknown states, preserves each admitted stage's `automatic` or `override` reason, and marks
whether an unknown Session outcome has been acknowledged. Acknowledgement names the exact unknown event and does not prove completion, launch success, or recovery.

Host actions reprove the current Workspace, capture its admission dependencies, and synchronously revalidate current configuration validity, shutdown, committed dependencies, and relevant pending changes immediately before invoking the host adapter. This final check follows all awaited proof and activation work. Presentation-only changes do not revoke the proof. Canonical occupancy collisions deny host authority, including collisions discovered during reproof; GitHub remote source access remains independent.

GitHub authorization identifies and validates the account before staging credentials in Keychain, then persists and activates Connection intent. A failed new Connection save discards its staged credentials when no committed Connection owns them. Configuration success is not reported before credential and admission synchronization. Credentials never cross the persisted intent or browser contract.

`transport.ts` owns HTTP acceptance, bounded body reading, JSON parsing, request decoding, application dispatch, outgoing validation and serialization, and response writes and failures. It also provides a full-state WebSocket with exact origin checks. `main.ts` composes modules and binds loopback.

### HTTP admission and delivery

Queries use `POST /api/query`; commands use `POST /api/command`. HTTP and WebSocket require the exact configured Origin. Commands additionally require a loopback peer. HTTP operations require the `application/json` media type and strict request fields, including nested registration candidates and Workspaces. The browser-safe operations and wire modules have no Node or server imports. Schema validation is the authority for request types, not a handwritten request interface or Boolean-check codec.

The browser generates a fresh UUID with `crypto.randomUUID()` for each HTTP attempt and sends it as `X-Roadmap-Request-Id`. Allowed-origin CORS preflight permits that header. This identifier is call-local correlation, not identity, authorization, chronology, deduplication, or a durable receipt. Nonbrowser clients may omit it. The server includes a syntactically valid supplied UUID in a rejection, or uses `null` when it is absent or invalid. Requests do not follow redirects.

Admission occurs when the transport invokes the public `RoadmapApplication.query` or `RoadmapApplication.execute` method. Expected failures before that invocation return the strict rejection envelope `{ type: 'request-rejected', request: 'query' | 'command', requestId: string | null, reason, message }`. It has no state or application outcome. No fabricated state or application-shaped rejection stands in for non-admission.

| Failure | Response when possible | Consumer meaning |
| --- | --- | --- |
| Pre-admission Origin or command peer denial | Rejection with reason `origin` or `peer`, HTTP 403 | Definitive non-admission only if the browser can read and attribute it. Origin denial omits CORS, so the browser normally observes an unreadable response and remains uncertain. |
| Pre-admission wrong method or media type | Rejection with reason `method`, HTTP 405, or `media-type`, HTTP 415 | Attributable decoded rejection proves non-admission. |
| Pre-admission declared or streamed body overflow | Rejection with reason `too-large`, HTTP 413, and connection close | Attributable decoded rejection proves non-admission. |
| Pre-admission invalid JSON or request schema | Rejection with reason `malformed-json` or `malformed-envelope`, HTTP 400 | Attributable decoded rejection proves non-admission. |
| Pre-admission body interruption | Rejection with reason `interrupted`, HTTP 400, if a response is still possible | A disconnected peer cannot be promised a response. An unreadable or lost response remains uncertain to the consumer. |
| Admitted application rejection | Legal query result or command outcome with HTTP 200 | An application-level rejection, not a transport admission failure. |
| Unexpected decode, dispatch, outgoing validation, serialization, or write failure | Safe generic HTTP 500 transport error, or connection termination | Not a non-admission proof. After invocation, application effects may have occurred. |
| Consumer-observed response loss, malformed reply, wrong attribution, wrong status, or illegal result meaning | No trustworthy delivery result | Completion remains unknown, even if the server finished writing or performed an effect. |

The browser accepts non-admission only when `decodeRequestRejection` decodes the exact envelope and its request family, attempt UUID, and reason-specific HTTP status all match. A generic readable 4xx or 5xx is insufficient. The browser constructs the local `RequestNotAdmitted` value `{ kind: 'not-admitted', ok: false, rejection, error: { code: 'admission-failed', message } }`. Query and command delivery include this value; it has no state and leaves live state intact. Command activity publishes `admission-failed` rather than reporting an uncertain application outcome.

Admitted replies must have HTTP 200, pass the outgoing result decoder, and have legal result meaning for the requested operation. A successful result for another operation or a valid-looking outcome with the wrong HTTP status is not trustworthy. Uncertain command delivery reports `transport-failed` and does not synthesize a replacement state. There are no automatic HTTP retries, replay, or receipts.

The default body cap is 64 KiB. The transport buffers at most the cap, rejects declared excess before reading the body, and stops consuming on the first streamed excess without waiting for EOF or draining unbounded input. It pauses input, sends HTTP 413 with `Connection: close` when possible, and closes the socket after response flush. Request and response error handlers contain late stream errors, peer close, synchronous write throws, and asynchronous write failures.

Diagnostics contain fixed safe categories, never raw request values, credentials, or exception messages and causes. Request decoder issues report paths and categories rather than input values. Outgoing application state and results must pass strict decoding both as objects and after JSON serialization, so getters or `toJSON` cannot introduce credentials into an otherwise accepted reply.

### Operation evidence and completion uncertainty

Delivery evidence and state authority answer different questions. Accepting an operation outcome does not require accepting its enclosed state, and accepting authoritative state does not prove completion of an earlier operation.

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Attributable, decoded pre-admission rejection with matching request family, UUID, and status | This HTTP attempt did not reach application admission. | An application outcome or a result for another attempt. |
| Decoded HTTP 200 application outcome with legal meaning for the requested operation | That operation's reported outcome, including application-level rejection. | Authority to adopt its state outside the request-start provenance rules. |
| Lost, unreadable, malformed, wrongly attributed, or otherwise untrustworthy response | Completion unknown; effects may already have occurred. | Non-admission, failure, or permission to replay. |
| Relevant canonical configuration identity or version in authoritative state | Only the relevant current configuration fact, such as the targeted identity or version now being present. | A universal receipt, attribution of that fact to a lost attempt, or unrelated host-effect completion. |
| Durable Automation evidence for the exact opportunity and stage | Only that stage's recorded admission or stage facts. | Another stage's admission, process success beyond recorded evidence, or completion of an unrelated command. |
| A newer snapshot, unrelated sequence advance, or a live socket | State advancement or transport liveness under their respective contracts. | Receipt or completion of an uncertain operation. |
| A lost host-launch reply without an operation-specific durable trace | Completion stays unknown even after synchronization. | Whether the host effect occurred; absence of a trace is not failure evidence. |

These limits describe the meaning of existing evidence, not an automatic reconciliation policy. The browser does not retry or replay an uncertain operation, infer failure after reconnect, or convert arbitrary live state into a receipt.

### Contracts ownership and remaining cutover

The operations and wire schemas replace the obsolete query/command request codecs without aliases. Unrelated legacy state and result codecs remain in `@roadmap/contracts/codecs` for their owning public-read cutover; outgoing validation still uses them. The scoped ingress change does not replace the entire public read model or install the selected dependency-cruiser/import-rule enforcement. Those changes belong to the public-read execution ticket.

`operations.ts` defines strict objects and discriminated unions with Zod 4; `z.output` supplies the public operation types. `wire.ts` owns the strict query and command envelopes, rejection envelope, decoders, UUID validation, and rejection status policy. These modules accept only supported own-data request fields, not inherited discriminators or fields.

## Configuration and credentials

The root `.env.local` holds the public GitHub App identifiers. Device-flow credentials live in macOS Keychain. The schemas for `roadmap.config.json`, `ApplicationState`, and transport messages do not allow credentials.

## Partial data

Source completeness belongs to each private observation scope. Public projections retain `ticketsComplete`, `blockersComplete`, `unreachable`, and `MapBody.missingSections`; unknown aggregate progress is `null`. A readable incomplete document, a failed read, and proven absence are different facts. None implies permission to discard known trace.
