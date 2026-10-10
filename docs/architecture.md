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

`createRoadmapStore` in `apps/web/src/store` is the single authoritative SPA read owner. It accepts coherent full-state replacements under current-generation authority, sends state-free HTTP queries and commands, and owns transport synchronization, socket liveness, retained accepted facts, aggregate command activity, and capped reconnect backoff. It does not own server admission or source evidence.

`RoadmapProvider` owns observation acquisition in its effect, independently of data readers and routes. It subscribes only to the readable-content gate and readiness/status selection, not whole application content or command activity. Before any readable authoritative state exists it renders explicit lifecycle/waiting status, not empty Projects, default configuration, version zero, or a fabricated capture time. Once readable state exists, consumers remain mounted through disconnect, reconnect, and later lifecycle messages without readable content.

Views read through the required `useRoadmap(selector)` facade and never fetch directly. The selector receives `RoadmapViewState`, including actual read fields, real `capturedAt`, lifecycle, effective synchronization, and stable query/execute methods. There is no no-argument overload or broad-hook compatibility wrapper.

### Client owner and subscription decision

The [Who owns client state and observation, and does a library earn its place?](https://github.com/asmundwien/roadmap/issues/114) cutover deepens the external store and uses the maintained `use-sync-external-store/with-selector` React binding. The decision consumes the immutable [Data-layer client-state guarantees](https://github.com/asmundwien/roadmap/blob/b347a37b2308ab31ab0be8ec93db4426508ad0bd/docs/research/data-layer-client-state-guarantees.md) from [What do React selection, Redux Toolkit, TanStack Query and SSR actually guarantee here?](https://github.com/asmundwien/roadmap/issues/106), whose primary sources were accessed on 2026-10-08. That research establishes mechanisms, not the application owner or a speedup.

| Candidate | Responsibility it can own | Decision and remaining application obligations |
| --- | --- | --- |
| Deepened external store with maintained selector binding | One immutable accepted read root, transport authority/lifetime, and selected subscriptions at the existing public seam. The binding owns concurrent selection memoization and reuse under supplied equality. | Chosen. Authority and lifecycle branching stay local to the store; views do not repeat them. Application code still owns semantic equality, decoding, session provenance, and acquisition/release. |
| Redux Toolkit with React Redux | Toolkit can own an immutable root and reducer transitions; React Redux supplies pure selectors and custom equality. | Not adopted. There is no repeated reducer/action branching here that this pair removes. Returning a separately decoded full replacement is valid, but Immer does not deep-deduplicate it. Socket generations, observation lifetime, lifecycle retention, and outcome authority still require application policy. Redux remains a viable alternative if cohesive reducer-owned transitions become a concrete need. |
| TanStack Query, including a single streaming cache entry | Query owns keyed repeatable fetch resources, structural sharing of JSON-compatible data, and observer selection. Streaming setup and cleanup can be application-owned. | Not adopted. There is no independent fetch resource to own alongside the coherent full-state stream. Splitting that stream introduces cross-key coherence rules; mirroring it creates a second authority. A single entry would still need the same epoch/lifetime policy. Mount/focus/reconnect refetch and query retry defaults do not fit the native folder-selection interaction. Mutations do not retry by default, but that default does not establish command completion. |
| Direct React state/Context or base `useSyncExternalStore` | Context can distribute a stable owner; base external-store subscriptions compare cached snapshots with `Object.is`. | Context carries the store instance, not mutable application state. Context state updates notify all consumers. Selecting after a base broad subscription is not selected notification, and allocating derived snapshots on each read violates snapshot caching. Bespoke concurrent selector memoization would duplicate the maintained binding's responsibility. |

The choice is about ownership, transition locality, public-interface testing, and enforceable dependencies. Avoided imports, migration size, and production line count do not decide it. The handwritten transport/authority owner remains necessary under every candidate. Semantic comparison adds work for selected values; no payload, selector-cost, rendering, or scaling bottleneck has been measured, and no performance gain is claimed.

`RoadmapStore.getSnapshot` and `subscribe` remain the transport test seam. Publications are cached immutable snapshots: repeated reads without publication return the same object, and neither callers nor later transitions mutate an earlier publication. Command-only publications preserve the accepted `ApplicationState` identity. Complete validated replacements remain atomic; selection does not split the authoritative root into writable slices.

The binding computes a selection before comparing the snapshot React observes. Default selected semantic equality compares JSON-compatible records and arrays by value and methods by reference. It retains the last selected result reference across independently decoded full replacements when the selected facts are equal, including newly allocated derived records. A changed selected fact invalidates that reference; selecting publication time, lifecycle, or synchronization includes those facts in equality. Selectors must be pure and must not omit facts their consumer needs. This guarantee concerns store-driven selected updates, not parent-driven renders or elimination of selector computation. Reference equality alone and shallow comparison cannot preserve nested selections across separately decoded equal payloads.

### Client ownership and lifetime

| Fact or work | Owner | Constraint |
| --- | --- | --- |
| Public `ApplicationState` and source/resource truth | Server application and its committed private owners | Browser adopts schema-validated replacements atomically; it cannot reconstruct private admission or invent source success. |
| Accepted read publication and retained readable state | `RoadmapStore` | Current-generation epoch/sequence authority controls adoption. Retention preserves real trace, not current readiness or permission. |
| Transport liveness, synchronization, socket generations, reconnect resources | `RoadmapStore`, acquired by provider effect | Subscriptions only observe. The application owner stays active when routes have no readers. |
| Aggregate command activity | `RoadmapStore` | Current shared activity remains until the later per-attempt workflow cutover; it is not read authority or universal feedback for every attempt. |
| Operation attempts, feedback, notices, and form drafts | Actual view-local or page-level operation owner | Removal feedback survives disappearance of its target. Drafts and presentation stay local unless a concrete workflow lifetime requires retention elsewhere. |
| Resource selection | URL pathname, search, and fragment | No store or workflow mirror silently substitutes another Project, map, or ticket. |
| Derived lookup indexes and pure resource results | Pure consumers of the accepted read state and scoped URL identity | Memoization caches calculations, not independently writable facts or a second resource authority. |

`start()` acquires observation and returns an idempotent release. Multiple acquisitions share the active observation; releasing one does not dispose another's ownership. Repeating a release cannot decrement ownership twice. Adding/removing subscribers neither acquires nor releases observation. Last-owner cleanup retires authority, reports disconnected, retains actual accepted facts, closes the socket, and clears reconnect timers. React StrictMode setup/cleanup/setup may retire one generation and acquire another, but must not leave duplicate active sockets or reconnect timers. Retired callbacks cannot affect their successor. Navigating through `/components` or an unknown route does not end provider ownership.

The interface to future shared pure resource results is immutable `RoadmapViewState` plus scoped resource identity. Results derive lifecycle, reachability, content, absence, and durable evidence from the sole public collection, without joining removed authorities. Future per-attempt workflow policy can own attempt state and interpret state-free operation evidence; it cannot mutate server read facts, infer a receipt from unrelated publication, mirror URL selection, or automatically replay commands. This decision does not implement that later policy.

The clean cutover removes the no-argument broad `useRoadmap` subscription and every affected caller, test/prototype use, and compatibility path. It replaces provider whole-content/command subscriptions with gate/status selection and removes mutable publication exposure and disposal that can invalidate another acquisition. It retains the already-shipped deletion of reader-owned observation and fabricated initial defaults. There is no parallel authoritative cache, duplicated writable Project collection, mirrored URL selection, obsolete owner alias, or automatic interaction replay. State-free HTTP outcomes and the existing session-authority rules remain intact.

SSR has no established product requirement and is out of scope. The client-only SPA uses no query cache or hydration authority. A future SSR decision would require separately agreed hosting, request-isolated state serialization, and matching server/client hydration snapshots. Folder selection remains explicit user interaction, never a cache entry subject to automatic mount, focus, reconnect, retry, or replay.

The proof obligation crosses both the store interface and the actual mounted provider/App/router/public-application/HTTP/WebSocket seam. It includes subscription churn, repeated ownership, StrictMode and disposal, equal selected results during command-only and full-replacement publications, truthful initial/lifecycle/source states, pinned graph/Modal/prose DOM identity and local draft retention, successor content, and successor configuration-conflict feedback without rollback. The permanent portable browser fixture uses temporary configuration and Local Markdown with harmless host substitutes; selected-consumer probes belong only in its fixture entry. The common proof matrix in [What public read model is sufficient and has one authority for each fact?](https://github.com/asmundwien/roadmap/issues/112) still applies, including supported browser-safe leaves, positive/negative import and type checks, actual production graph/output inspection, and independent UI/docs. Current scoped evidence follows; historical verification records below remain historical.

The permanent runner is `scripts/client-owner-browser.mjs`, invoked from the repository root with Playwright:

```sh
pnpm install
pnpm exec playwright install chromium
pnpm test:client-owner-browser
```

The root script runs `node scripts/client-owner-browser.mjs`. Vite uses the actual `apps/web` root with fixture-only entry/dependency resolution, not a substitute application root. The server canonicalizes its temporary root with `realpath`, so filesystem identity checks also work on platforms whose temporary directory is a symlink. `--serve-only` emits the fixture URL and control endpoint for an interactive browser visual proof. `--executable-path` or `CHROMIUM_EXECUTABLE_PATH` can select an already installed browser without a machine-specific fixture path. The fixture owns temporary configuration/source storage and harmless host substitutes, not production configuration, credentials, native effects, or Automation launches.

### Exercised client-owner evidence

The complete permanent browser runner passed all eight schedule groups on Node 26.8.1 and Chromium 156 from the current Playwright installation. It observed three harmless host invocations and zero folder-selector invocations. The schedules cover mounted selected-result stability, initial waiting and malformed/withheld state, unavailable sources, subscriber churn and StrictMode, retained pinned graph/prose/open Modal and local draft identity, successor content and conflict feedback without rollback, reader-free routes, and disposal. The default runner completed cleanup. Separately, direct `node scripts/client-owner-browser.mjs --serve-only` exited with code 0 on SIGINT and left its owned port without a listener. This does not claim package-manager-wrapper signal-exit guarantees.

Disposable visual proof also inspected actual waiting, graph, open Modal, retained display, and successor content with the local draft preserved. When the browser helper's screenshot call timed out, a raw page screenshot supplied the visual evidence. Fixture setup failures were corrected without weakening the actual assertions; the full permanent run, not those failed setups or screenshots alone, supplies the regression result.

| Verification | Observed result |
| --- | --- |
| Source tests | Passed 1,447 server, 264 web, and 27 UI tests. |
| Typecheck and public consumer proofs | Passed both browser/server consumers with 177 exports, seven decoders, 122 invalid constructions, and six new client cases. |
| Architecture gate | Passed five production graphs, two positive consumer graphs, 45 intended-diagnostic refusals, 47 detector/options tests, and six actual-config build fixtures. |
| Unused-code gate | `pnpm knip` passed. |
| Actual web production build | Passed with 716 resolved modules before tree shaking and 717 transformed modules. The 865,768-byte JavaScript chunk retains the large-chunk warning. |
| Actual emitted JavaScript | Matched the final chunk and inspected 488 module entries. No forbidden Node/private-server/credential/host implementation code appeared; the maintained selector package is included. |
| Changed-file language-service diagnostics | No errors; Biome warnings remain. Reference-service requests repeatedly timed out despite reload, so no completed reference-service result is claimed. |

The semantic deletions are the broad no-argument hook and its compatibility paths, provider whole-content/command subscriptions, and mutable publication exposure. Idempotent shared acquisition remains intact; final cleanup now reports disconnected rather than connecting. The earlier removal of reader-owned observation and fabricated initial defaults remains intact. The cutover adds no second authoritative cache, URL mirror, or automatic replay. Generic UI and standalone docs remain independent. Selected-result identity is an observed correctness contract, not a render-speed claim.

Counts include all new or relocated handwritten application source within the original server/web/contracts boundary. They exclude declarations, tests/specs, explicit test fixtures, styles, generated output, and dependencies. Nonblank physical lines and UTF-8 bytes use the existing comparison method without changed exclusions or minification.

| Application production comparison | Files | Nonblank lines | UTF-8 bytes |
| --- | ---: | ---: | ---: |
| Original map baseline `7e70e897` | 85 | 13,616 | 489,864 |
| Before client-owner cutover `e465d347` | 100 | 23,936 | 876,921 |
| Current client-owner implementation | 100 | 24,183 | 885,723 |

Application production increased by 247 lines and 8,802 bytes, with no file-count change. Immutable publication, lifecycle/high-water separation, shared observation ownership, and semantic selection justify the added responsibility; no net production-code reduction is claimed.

| Separate evidence/build responsibility | Before files / lines / bytes | Current files / lines / bytes |
| --- | --- | --- |
| Source tests and fixtures | 69 / 45,544 / 1,681,194 | 69 / 45,951 / 1,697,059 |
| Build/gate owners outside original source roots | 16 / 1,333 / 51,759 | 16 / 1,401 / 54,753 |
| Outside-source proof tests and fixtures | 134 / 4,569 / 140,243 | 138 / 6,127 / 200,344 |

The outside-source proof increase includes the permanent runner and three fixtures. Documentation is a separate resolution-report category; this section does not pin a final aggregate while evidence documents are still changing. Protected real configuration and Automation files changed externally during this task, so completion makes no byte-unchanged claim about them. The fixture did not use those files or re-enable Automation. This evidence resolves only the scoped client-owner implementation, not later workflow or final-integration tickets.


### Browser authority and synchronization

The contract for [What establishes the authoritative server session across HTTP and WebSocket?](https://github.com/asmundwien/roadmap/issues/107) separates state authority from operation delivery. Each new socket has a distinct generation. Only the first validated state from the current generation establishes its authoritative server session. Socket open alone proves no application synchronization. Epoch identifiers are opaque identities, not clocks; sequence numbers are comparable only within the same established epoch.

`RoadmapStore.getSnapshot` retains transport and command activity. Its readonly `state` is a real readable `ApplicationState` or `null`, independently of the latest accepted lifecycle and authority high-water sequence. Effective synchronization is a discriminated union:

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

The map area lives in `apps/web/src/views/map`. `page.tsx` resolves the registered Project and the exact URL-selected map and ticket from `state.projects`. Resource phases determine whether actual content exists. Navigation uses the catalog's last trustworthy open/closed identity order and a separate historical or unplaced group. It never promotes a sibling because the selected map failed. `map-container.tsx` owns the React Flow viewport and its pan, zoom, and fit controls. `graph.ts` projects real blocked-by relationships and uses Dagre for layout. `ticket-node.tsx` renders ticket and unresolved or external blocker nodes. Closed tickets remain in the graph, with arrows from blockers to dependent tickets.

`ticket-modal.tsx` opens the URL-selected ticket in the shared native Modal. It retains ticket bodies, metadata, blockers, source links, Automation evidence, and eligible Automation controls. Opening a ticket pushes a pathname that pins its map and selects the ticket. Closing the Modal or returning to map prose replaces that history entry with the pinned map pathname, so Back does not reopen the closed ticket. Back and Forward otherwise restore the URL-selected map and ticket. `map-content.tsx` renders complete raw map Markdown inline below the graph, with a structured fallback when raw content is absent. `prose.tsx` renders Markdown and resolves references within the current Project and map: local ticket links open ticket details, map references return to map prose, and external references use available source links. Unresolvable local references explain why they cannot be opened. Missing tickets, incomplete blockers or map sections, warnings, and unavailable Projects or maps remain explicit rather than disappearing.

Application component styles use CSS Modules. Components resolve local class names with `classnames/bind`. Reusable styling belongs to shared components, not shared stylesheet imports. React Flow also imports its required vendor stylesheet for graph rendering and viewport controls.

Each routable area under `apps/web/src/views` has a `page.tsx` entry point. `App` routes the Connections list, `settings/connections/[connectionId]/page.tsx`, and its connection-scoped `import/page.tsx` independently. The detail page selects the Connection and composes sibling Details and Manage connection sections. Each section reads its own live state and owns its own commands, busy state, and errors. The import page registers a Project through the selected Connection. `shared/` and `shell/` are support areas, not pages.

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

### Implemented module boundaries and remaining cutovers

The implemented source-lifetime modules include `projects/registry.ts`, `configuration/document.ts`, `observation/source.ts`, `observation/coordinator.ts`, the Local and GitHub observers, `resources/catalog.ts`, the Automation modules, pure `application/projection.ts`, and the application composition root. Registry intent and refinements do not use public snapshot comparison as admission authority. The catalog alone owns resource retention, membership, and ordering. Automation reads that catalog's current evidence and keeps its independent policy, authorization, Workspace, command, and durable-history obligations.

The obsolete whole-Adapter Slice/store composition and projection/admission resource reconstruction are removed. The lifecycle cutover also removes the application's independent started/stopping flags and main's latest-Adapter diagnostic/refresh authority. One lifecycle union now determines phase authority; committed application diagnostics replace pending-owner reads. Owned task drains replace timer-clearing-only cleanup and pre-await-only acquisition guards. Main's unconditional successful exit is removed. These are removed authorities and behavior, not rename counters or a claim of net production-line savings.

The public-read cutover installs the single Project projection, inferred schemas, four-leaf exports, and permanent repository dependency gates described below. The operation contract adds correlated canonical subjects and effect-specific, state-free outcomes. Generic UI, documentation application, and URL ownership remain unchanged. Installed gates are not evidence that a final verification run passed.

### Automation

`automation/database.ts` owns the strict schema version 3 Automation database. It persists immutable opportunities and append-only events, rejects invalid histories, and replays them into current evidence. An AFK Classification Verdict projects a queued Wayfinder Session before launch admission. `automation/engine.ts` reconciles the committed catalog and launches processes. Classification has one global lane; Wayfinder Sessions have one lane per Project. Queued Sessions survive disabled Project Automation and have no promised order. Durable historical targets remain addressable after live registration or source membership disappears.

The engine appends the stage reservation before launch, requires storage-confirmed durability, then validates current source, configuration, authorization, Workspace, command, and reservation ownership again. If dependencies changed during append, it records a nonlaunch result and never starts the process. Recorded reservation evidence is not proof that a process launched.

The activation-safety regressions cover both input receipt before commit and input receipt during a held append. For each Harness stage, the held-append schedule commits enabled configuration first, waits for append entry, receives the disabled replacement, then requires a durable reservation and known nonlaunch without a process effect. Both Harness Commands render GitHub map and ticket URLs for a Connection-bound GitHub source while using its admitted local Workspace; `application/automation.test.ts` covers both prompts.

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

The cutover removes generic `configuration-updated` and `authorization-started` acknowledgements, absent-path cancellation, arbitrary `launch-action` IDs, the negative host exclusion list, broad host state/configuration/credential inputs, duplicated launch string interpretation, submitted-path and result-name identity guesses, and state-bearing HTTP outcomes. The dedicated four public leaves remain the only schema authority; no compatibility aliases or alternate decoder owner preserve the removed meanings.

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

The cutover removes public registrations, registered-Project/raw-Snapshot Project overlap, `roadmap.projects`, the `roadmap` publication wrapper, and consumer joins used to recover source paths and URLs. It removes root and `/codecs` exports and their unchecked generic assertion decoders, separately maintained public declarations, compatibility aliases, and obsolete projection branches. Map `frontier` contains scoped `TicketRef` values, not duplicate Ticket objects. Consumers resolve them against that map's canonical tickets. Private source, Automation, and persisted owners no longer use public DTOs as their domain authority; the deleted Snapshot store is not recreated.

Strict own-data decoding starts at `unknown`, rejects undeclared fields and inherited discriminators, and applies resource and whole-state refinement. It checks unique canonical identities and memberships, parent scopes, actual Connection association, Integration/source agreement, current binding provenance, open/closed placement, display ordering, frontier consistency, and ticket-type evidence. Missing type evidence requires `labels: []`; nonempty unrecognized or conflicting labels use their corresponding variants. Incomplete ticket collections may retain larger source aggregate counts. Claimed and blocked remain independent facts even when display placement chooses blocked. Unknown blockers remain unknown.

A completed AFK Classification requires a queued or later Wayfinder Session. Every Session requires a completed AFK Classification. Queued Sessions have no admission; launching, running, finished, launch-failed, and outcome-unknown Sessions carry their actual automatic/override admission. Process result, Session report, and tracker facts need not agree. Acknowledged outcome-unknown remains unknown. Public variant validation cannot prove correspondence to a real durable history; private replay owns legal transitions. Schemas also cannot establish truthful absence, successful IO, atomic activation, actual Session chronology, readiness, or effect completion. Attempt, last successful read, retained successful time, and publication time retain different meanings.

### Compiler projects and dependency gates

Contracts compile in `packages/contracts/tsconfig.json` against ES2023 with `types: []`, without DOM or Node ambient types. Web source compiles separately in `apps/web/tsconfig.app.json` against ES2023/DOM and `vite/client`, without Node ambient types. The private server uses `apps/server/tsconfig.json` with ES2024, Node ambient types, and NodeNext resolution. Vite configuration has its own Node project. Separate compilation is necessary but does not replace resolved dependency enforcement.

`config/dependency-cruiser` supplies owner-specific resolvers and shared rules. The TypeScript parser includes pre-compilation dependencies, so type-only imports and reexports count. Resolution uses real package exports, explicit leaf subpaths, project aliases, and relative traversal. Contracts depend only on their internal browser-safe definitions and Zod; identity cannot import read/operation meaning, state cannot import operations/wire, and operations cannot import wire. Browser consumers cannot import server code or private contract subpaths. Generic UI cannot depend on applications, contracts, or docs. Docs can consume UI but not web, server, or contracts. Server cannot depend on web/UI/docs except the explicit real transport/store integration test. Additional rules prohibit cycles, unresolved imports, production imports of test fixtures, policy-to-adapter/composition imports, and unauthorized host capabilities.

Dependency-cruiser's configuration and resolver loaders require default exports. Biome's existing tool-configuration exception names those six configuration paths explicitly; application source still forbids default exports.

Source-boundary inspection also rejects browser transport capabilities outside the store, direct view imports of store internals, private persistence-factory access outside composition, and environment access outside approved owners. It follows ordinary static aliases and object destructuring without confusing lexical shadowing or type-only references with runtime capabilities. Reassignment, runtime-computed names, and arbitrary runtime object flow are outside this static proof. Astro frontmatter and scripts are extracted for docs dependency checks; static catalog prose is not a domain model.

Run the installed repository gates from the root:

```sh
pnpm check
pnpm architecture
pnpm typecheck
node scripts/check-contract-types.mjs
pnpm test
pnpm knip
pnpm --filter @roadmap/web build
```

`pnpm check` combines Biome and `pnpm architecture`. Architecture runs resolved repository graphs, browser/server positive export fixtures, intended-diagnostic negative import fixtures, source-boundary and browser-plugin tests, and actual-Vite build fixtures. Negative cases cover Node imports in public decoders, private backend imports, relative/alias bypasses, private package subpaths, type-only/reexport edges, and prohibited UI/docs and server reverse dependencies. An unrelated missing package is not accepted as proof of an intended architecture refusal.

`pnpm typecheck` runs project compilation, docs checking, and `scripts/check-contract-types.mjs`. That runner checks the ES-only contracts graph, separate browser/server consumer graphs, the exhaustive supported export inventory and positive decoder controls, and illegal branded/scoped/variant/result-family constructions. It requires the intended diagnostic at each invalid construction. Scoped types do not claim compile-time equality between arbitrary runtime parent identities; relational decoding supplies that check.

The web Vite configuration installs `roadmapArchitectureGraph`. The actual production build inspects parsed resolved modules and their static/dynamic edges before tree shaking, refusing Node builtins/browser externalization, server implementation, and credential/environment/process/launcher libraries. `scripts/check-browser-build-fixtures.mjs` uses that actual configuration and resolver, including unused forbidden imports; its accepted fixture must record the graph-plugin diagnostic. This complements type-only/import checks and emitted-output inspection, not runtime effect proof. Use `pnpm --filter @roadmap/web build`; the root `build` script recursively invokes itself and is not production-browser evidence.

Issue resolutions record exercised gates, consumer journeys, graph/output evidence, and responsibility counts. Passing schema and dependency checks do not establish successful IO, durable chronology, or effect completion.

### Historical public-read cutover evidence

The completed public-read cutover passed `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm knip`. These historical results do not establish verification of the later operation cutover. The application suites passed 1,256 server, 219 web, and 27 UI tests. The dependency gate checked five production graphs and two positive consumer graphs, 45 intended-diagnostic import refusals, 47 detector/options tests, and six actual-config build fixtures. Both compiler consumers exercised all 158 public exports, seven decoders, and 77 invalid constructions. Astro checked 41 files without errors, warnings, or hints.

The actual web package production build inspected 714 resolved modules before tree shaking. Separate emitted-output inspection checked 486 modules in the JavaScript chunk, matched its bytes to the actual `dist` file, and found no Node, private server, credential, or host implementation dependency. Local and GitHub application/HTTP/WebSocket/store smoke runs, source-URI probes, and actual browser journeys covered initial unreadiness, retained graph/prose/source links, pinned selection, recovery, readable incomplete content, known empty, never-observed resources, and durable absent-target evidence. Additional actual Local and GitHub public/wire runs covered duplicate map-scoped blocker IDs and unavailable repository replacement. Fixtures used temporary data and harmless adapters, with zero host or Automation process effects. These are consumer and boundary proofs, not claims about external Session completion.

The counting boundary matches the map's source baseline: handwritten TypeScript/JavaScript under server, web, and contracts source, excluding declarations, tests/specs, explicit test fixtures, styles, generated output, and dependencies. Nonblank physical lines and UTF-8 bytes use the original Git snapshot and complete current manifests. Every relocated production owner remains counted.

| Application production revision | Files | Nonblank lines | UTF-8 bytes |
| --- | ---: | ---: | ---: |
| Map baseline `7e70e897` | 85 | 13,616 | 489,864 |
| Before this cutover `dd3fac09` | 95 | 21,777 | 792,772 |
| Completed public-read cutover | 99 | 22,477 | 820,944 |

Build/gate implementation and Vite configuration outside those original source roots add 16 counted files, 1,333 nonblank lines, and 51,759 bytes. The combined current application/build responsibility is 115 files, 23,810 lines, and 872,703 bytes. Source tests and declared fixtures are separate: 66 files, 41,051 lines, and 1,519,392 bytes. Outside-source proof tests and fixture data are also separate: 89 files, 2,885 lines, and 85,991 bytes. Documentation is not production code.

Application production increased by four files, 700 lines, and 28,172 bytes in this cutover. The additional validation, correlated variants, scoped identity, private authorization/host/process translation, and permanent enforcement/proof implementations justify that increase. The removed competing models, unchecked codecs, repeated frontier objects, consumer joins, and compatibility exports are the semantic deletion inventory above. Formatting, moved files, and test changes are not claimed as code savings. Biome passed with 131 warnings and five informational diagnostics; Vite reported its over-500-kB chunk warning. No performance improvement or warning-free result is claimed.

### Operation cutover evidence

The operation cutover passed `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm knip`. The complete suites passed 1,447 server, 241 web, and 27 UI tests. Both compiler consumer graphs exercised all 177 public exports, seven decoders, and 122 invalid constructions. Astro checked 41 files without errors, warnings, or hints. The dependency gate verified five production graphs, two positive consumer graphs, 45 intended-diagnostic import refusals, 47 detector/options tests, and six actual-config build fixtures.

Disposable public application, HTTP, WebSocket, and actual store runs passed 65 operation scenarios and 10 authority schedules. They covered canonical Local/GitHub registration and repair, finite harmless host effects, selector variants, active-owner and partial refresh truth, phase-correct authorization, real precommit failure and postrename uncertainty, exact durable Automation admission, outgoing private-field refusal, both delayed predecessor settlement orders, current differing-epoch rebaselining, and obsolete/prebaseline requests. Lost post-effect replies remained unknown through successor state, with no application replay or inferred native completion. A separate missing-Workspace runtime proved new manual failure attempts at times 2000 and 3000 after startup failure at 1000, through HTTP and authoritative WebSocket/store state.

Actual browser journeys exercised normalized Local/GitHub imports, canonical repair, harmless launches, observed/identical/degraded/unavailable/auth-failed refresh feedback, selector cancellation and independent validation error, stopped-selector lifecycle rejection, waiting/granted/failed/denied/expired/cancelled authorization, delayed publication and response feedback, pane close/reopen, canonical grant navigation, confirmed and unconfirmed mutation feedback, and removal results that survive resource disappearance. Fixtures used temporary configuration and Automation storage, safe provider/vault substitutes, and recorded host invocations. No production native launch or credential use formed part of this proof.

The semantic deletion inventory is the operation table's clean cutover: generic configuration and authorization acknowledgements, state-bearing HTTP, arbitrary action-ID launch interpretation, broad host state/configuration inputs, the negative host exclusion contract, submitted-path/result-name identity guesses, and obsolete exported helpers. Page-level removal and permanently consumed authorization feedback replace stale or disappearing result ownership. No retry, reconnect replay, receipt system, or new launch-durability promise replaces these removed paths.

| Operation source responsibility | Files | Nonblank lines | UTF-8 bytes |
| --- | ---: | ---: | ---: |
| Map baseline production `7e70e897` | 85 | 13,616 | 489,864 |
| Before operation cutover production `cf9606f6` | 99 | 22,477 | 820,944 |
| Completed operation production | 100 | 23,936 | 876,921 |
| Map baseline source tests and fixtures | 41 | 8,396 | 303,730 |
| Before operation source tests and fixtures | 66 | 41,051 | 1,519,392 |
| Completed operation source tests and fixtures | 69 | 45,544 | 1,681,194 |
| Map baseline documentation | 3 | 294 | 52,248 |
| Before operation documentation | 3 | 509 | 117,529 |
| Completed operation documentation | 3 | 559 | 131,342 |

The source counting boundary and Git-snapshot method are unchanged. Operation production increased by one file, 1,459 nonblank lines, and 55,977 bytes. Strict correlated variants, canonical commit translation, finite host interpretation, scoped refresh truth, and surviving feedback owners account for the added responsibility. Build/gate owners outside those source roots remain 16 files, 1,333 lines, and 51,759 bytes. Outside-source proof tests and fixture data are separate at 134 files, 4,569 lines, and 140,243 bytes. Documentation remains three files. Disposable runtime scripts are not shipped source and were removed after proof. Formatting and test changes are not code savings. Biome passed with 141 warnings and five informational diagnostics. The actual web production build inspected 714 resolved modules before tree shaking and reported its over-500-kB chunk warning. No performance improvement or warning-free result is claimed.

This continuation completed the interrupted work without changing `roadmap.automation.json`. Its original unknown Session outcome remains unknown. Tracker resolution records this continuation's implementation and verification, not a fabricated terminal result for the stopped Session.

## Configuration and credentials

The root `.env.local` holds the public GitHub App identifiers. Device-flow credentials live in macOS Keychain. The schemas for `roadmap.config.json`, `ApplicationState`, and transport messages do not allow credentials.

## Partial data

Completeness belongs to each own-scope observation and each membership result. Public resources preserve raw `MapBody` content, missing sections, warnings, actual provenance and source time, and ticket `blockersComplete`. Unknown aggregate progress is `null`. An incomplete readable document stays current-readable; a failed read retains only real prior success; complete trustworthy membership can prove absence. None permits discarding known trace or treating retained display as current admission evidence.
