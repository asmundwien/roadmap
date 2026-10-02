# Roadmap project page isolation

> Historical audit, 2026-10-02. The canonical replacement map page supersedes the production descriptions below. See [the current architecture](../architecture.md#web-application). This audit retains the original isolation findings and disposable experiment evidence; its deletion plan is not the cutover plan. Maps, canonical Project/map/ticket routes, and the server/domain/store remain in place.

## Finding and scope

The Project/map implementation can be removed without breaking the remaining page implementations. It is not fully isolated today. Its CSS loads on every route and has unscoped selectors; remaining settings still consume legacy global colors; Overview and settings build links into the page. A clean removal requires navigation cleanup, not a redesign of the application.

This finding concerns the page, not the roadmap domain model. Overview and Project registration still consume map and ticket facts. Their data must remain available after the visual map, docked Panel, and ticket-detail navigation disappear.

A disposable deletion experiment built successfully and rendered all six remaining page types with live Local state. Disabling the page-exclusive styles produced no computed-style or layout changes in the measured routes. No production code, configuration, or credentials changed. The verification section records the experiment and its limits.

## Evidence method

Sources are the current workspace files. Reference searches covered `apps/web`, `apps/docs`, `apps/server`, `packages/contracts`, `packages/ui`, manifests, and architecture documentation. LSP references confirmed the consumers of `MapPage`, `projectHash`, `selectionHash`, `DestinationMark`, `activeMapOf`, `automationEvidenceFor`, and `resolveProseLink`. Source reads supply the line ranges below because LSP excerpts can retain older line positions.

## Import boundary

### Entry point and outward dependencies

`App` is the only production module outside `views/map` found to import a module from that directory. It imports `MapPage` and renders it only for `route.screen === 'project'`. The other page imports and render branches are separate. See [App.tsx, lines 1-27](../../apps/web/src/App.tsx#L1-L27).

The main outward edges are:

| Module | Dependencies outside its own page implementation | Evidence |
| --- | --- | --- |
| `map/page.tsx` | `ProjectKey` from contracts, `Route`, `useRoadmap`, `shared/views.css`; composes `project-screen` | [page.tsx, lines 1-19](../../apps/web/src/views/map/page.tsx#L1-L19) |
| `map/project-screen.tsx` | Contracts; UI `Badge`, `Icon`, `Mark`; React; router map/selection types and helpers; shared `IntegrationBadge` | [project-screen.tsx, lines 1-20](../../apps/web/src/views/map/project-screen.tsx#L1-L20) |
| `map/map-child.tsx` | Contracts; React; router `ResolvedSelection`; shared `DestinationMark` and `stripInlineMarkdown` | [map-child.tsx, lines 1-9](../../apps/web/src/views/map/map-child.tsx#L1-L9) |
| `map/ledger.tsx` | Contracts, including `ticketTypeOf`; React; shared `DestinationMark` and ticket-state metadata | [ledger.tsx, lines 1-20](../../apps/web/src/views/map/ledger.tsx#L1-L20) |
| `map/ticket-node.tsx` | Contracts; UI `Mark`; shared `TicketMark` and ticket-state metadata | [ticket-node.tsx, lines 1-5](../../apps/web/src/views/map/ticket-node.tsx#L1-L5) |
| `map/panel.tsx` | Contracts and automation command types; React; router `ResolvedSelection`; shared markdown flattening and ticket presentation; UI `Badge` and `Icon` | [panel.tsx, lines 1-40](../../apps/web/src/views/map/panel.tsx#L1-L40) |
| `map/prose.tsx` | React; `react-markdown`; `remark-gfm`; router `ResolvedSelection` | [prose.tsx, lines 1-6](../../apps/web/src/views/map/prose.tsx#L1-L6) |
| `map/geometry.ts`, `map/sequence.ts` | Contracts; shared markdown flattening; sequence also uses router `ResolvedSelection` | [geometry.ts, lines 1-2](../../apps/web/src/views/map/geometry.ts#L1-L2), [sequence.ts, lines 1-7](../../apps/web/src/views/map/sequence.ts#L1-L7) |
| `map/link-targets.ts` | Contracts and router `ResolvedSelection` | [link-targets.ts, lines 1-7](../../apps/web/src/views/map/link-targets.ts#L1-L7) |
| `map/active-map.ts`, `map/automation-presentation.ts` | Contracts; automation presentation also uses UI `Variant` | [active-map.ts, lines 1-9](../../apps/web/src/views/map/active-map.ts#L1-L9), [automation-presentation.ts, lines 1-24](../../apps/web/src/views/map/automation-presentation.ts#L1-L24) |

These are consumers of shared modules, not evidence that those shared modules belong to the map page.

Within the page, `project-screen` composes `MapChild` and `Panel`, uses `activeMapOf`, automation presentation, and traversal order. `MapChild` uses geometry and `MapLedger`; the ledger uses geometry, traversal/scope planning, automation presentation, and `TicketNode`. `Panel` uses automation presentation, prose link resolution, and `Prose`. See [project-screen.tsx, lines 15-20](../../apps/web/src/views/map/project-screen.tsx#L15-L20), [map-child.tsx, lines 4-9](../../apps/web/src/views/map/map-child.tsx#L4-L9), [ledger.tsx, lines 12-20](../../apps/web/src/views/map/ledger.tsx#L12-L20), and [panel.tsx, lines 24-28](../../apps/web/src/views/map/panel.tsx#L24-L28).

No reverse imports from remaining views into geometry, ledger, sequence, Panel, prose, link targets, active-map selection, or automation presentation were found. Their tests and `test-fixtures.ts` are inside `views/map`. In particular, the Overview computes its active map directly from `project.openMaps[0]`; it does not reuse `map/active-map.ts`. See [project-presentation.ts, lines 84-112](../../apps/web/src/views/overview/project-presentation.ts#L84-L112) and [project-screen.tsx, lines 370-374](../../apps/web/src/views/map/project-screen.tsx#L370-L374).

### Shared files with different removal decisions

- `shared/destination-mark.tsx` is outside the map directory but is a page-exclusive runtime dependency. LSP found only its recursive self-render, `MapChild`, `MapLedger`, and its own test. The component imports `destination-mark.css`. These three shared-directory files are deletion candidates with the page: `destination-mark.tsx`, `destination-mark.css`, and `destination-mark.test.ts`. See [destination-mark.tsx, lines 1-29](../../apps/web/src/views/shared/destination-mark.tsx#L1-L29), [map-child.tsx, lines 51-57](../../apps/web/src/views/map/map-child.tsx#L51-L57), and [ledger.tsx, lines 269-278](../../apps/web/src/views/map/ledger.tsx#L269-L278).
- `shared/ticket-mark.tsx` and `shared/ticket-presentation.ts` must remain. The catalog imports `TicketMark`, which imports both state and type metadata. The catalog displays all ticket states and types without rendering the map page. See [mark.tsx, lines 1-18 and 49-56](../../apps/web/src/views/catalog/mark.tsx#L1-L18), [mark.tsx, lines 49-56](../../apps/web/src/views/catalog/mark.tsx#L49-L56), and [ticket-mark.tsx, lines 1-25](../../apps/web/src/views/shared/ticket-mark.tsx#L1-L25).
- `shared/gist.ts` and its behavior remain. Overview flattens the active map's Markdown destination with `stripInlineMarkdown`; removing the Panel's Markdown renderer does not remove this plain-text projection. See [project-presentation.ts, lines 8 and 88-93](../../apps/web/src/views/overview/project-presentation.ts#L88-L93) and [gist.ts, lines 1-12](../../apps/web/src/views/shared/gist.ts#L1-L12).
- `shared/integration-badge.tsx` remains. Overview, Connection sections, and Project details import it independently. See [project-list.tsx, lines 8-10](../../apps/web/src/views/overview/project-list.tsx#L8-L10), [connection-sections.tsx, lines 16-20](../../apps/web/src/views/settings/connections/connection-sections.tsx#L16-L20), and [details-section.tsx, lines 10-19](../../apps/web/src/views/settings/projects/%5BprojectId%5D/details-section.tsx#L10-L19).
- The provider, store, router's remaining screens, shell, settings helpers, and workspace UI package remain. They have independent consumers described below. `shared/` is not a deletion unit.

The map modules import `map.css`; `map/page.tsx` is the only source import of `shared/views.css`. The selector investigation and browser measurements below establish the current removal boundary. Import exclusivity alone would not establish it.

## CSS boundary

The claim that global styles are no longer shared is false. There are two separate issues.

### Page styles load globally but have no observed retained consumers

`App` statically imports `MapPage`. The map component graph imports plain `map.css`, not a CSS Module. The browser loaded it on Overview before any project-page visit. Rendering a route conditionally does not conditionally import its styles. See [App.tsx, lines 1-18](../../apps/web/src/App.tsx#L1-L18), [ledger.tsx, line 18](../../apps/web/src/views/map/ledger.tsx#L18), [panel.tsx, line 21](../../apps/web/src/views/map/panel.tsx#L21), and [map-child.tsx, line 8](../../apps/web/src/views/map/map-child.tsx#L8).

Many selectors lack a page ancestor, including `.caption`, `.row-title`, `.type-chip`, `.edge`, `.fold`, `.panel`, `.cartouche`, and `.prose`. They are potential collisions with future content, not current dependencies of the other pages. Source searches found no retained consumers, and browser measurements found no matching-style or layout dependency in the exercised routes. See [map.css, lines 43-102](../../apps/web/src/views/map/map.css#L43-L102), [lines 227-256](../../apps/web/src/views/map/map.css#L227-L256), [lines 484-498](../../apps/web/src/views/map/map.css#L484-L498), [lines 572-579](../../apps/web/src/views/map/map.css#L572-L579), and [lines 946-1066](../../apps/web/src/views/map/map.css#L946-L1066).

The following styles can leave with the page:

- All of `views/map/map.css`.
- All of `views/shared/views.css`. Its only importer is the map page; its banner, Project header, legend, empty-state, and small-label consumers belong to the map. See [views.css, lines 1-42](../../apps/web/src/views/shared/views.css#L1-L42), [project-screen.tsx, lines 34-47](../../apps/web/src/views/map/project-screen.tsx#L34-L47), and [map-child.tsx, lines 51-60](../../apps/web/src/views/map/map-child.tsx#L51-L60).
- All of `views/shared/destination-mark.css`, with its renderer and test. See [destination-mark.css, lines 1-20](../../apps/web/src/views/shared/destination-mark.css#L1-L20).
- The `.shell`, `.shell h1`, and raw `.muted` rules in `index.css`, whose current consumers belong to the map. Other pages use the UI `Page` component. See [index.css, lines 63-77](../../apps/web/src/index.css#L63-L77) and [overview/page.tsx, lines 1-15](../../apps/web/src/views/overview/page.tsx#L1-L15).

### The application still needs shared global styles

`main.tsx` loads both `@roadmap/ui/index.css` and web `index.css`. The UI entry supplies tokens, not a document reset. Web `index.css` sets root typography, color scheme, universal box sizing, body margin, minimum height, foreground, and background. Every retained route inherits those rules. See [main.tsx, lines 5-6](../../apps/web/src/main.tsx#L5-L6), [index.css, lines 8-60](../../apps/web/src/index.css#L8-L60), and [UI styles/index.css, lines 8-18](../../packages/ui/src/styles/index.css#L8-L18).

Keep these legacy variables until their remaining consumers migrate:

| Variables | Retained consumer | Evidence |
| --- | --- | --- |
| `--bg`, `--fg` | Document background/text, settings overlays and inputs | [index.css, lines 56-60](../../apps/web/src/index.css#L56-L60), [settings-flow.css, lines 65-104](../../apps/web/src/views/shared/settings-flow.css#L65-L104), [lines 141-151](../../apps/web/src/views/shared/settings-flow.css#L141-L151) |
| `--muted`, `--edge`, `--wash` | Settings facts, device authorization, controls, borders and surfaces | [settings-flow.css, lines 2-56](../../apps/web/src/views/shared/settings-flow.css#L2-L56), [lines 85-104](../../apps/web/src/views/shared/settings-flow.css#L85-L104) |
| `--state-blocked` | Settings errors and danger text | [settings-flow.css, lines 59-62](../../apps/web/src/views/shared/settings-flow.css#L59-L62), [lines 166-183](../../apps/web/src/views/shared/settings-flow.css#L166-L183) |
| `--goal`, including its dark override | Connection authorization-operation border, despite the map-related name | [connections.css, lines 56-79](../../apps/web/src/views/settings/connections/connections.css#L56-L79), [index.css, lines 26 and 48](../../apps/web/src/index.css#L26-L48) |

After map removal, `--state-frontier`, `--state-claimed`, `--type-research`, `--type-prototype`, `--type-grilling`, `--type-task`, and `--trunk` have no remaining consumers. The `--signal-*` and `--state-closed` aliases already have no consumers in the searched web/UI/docs sources. Those aliases do not justify deleting the retained globals above. See [index.css, lines 14-33](../../apps/web/src/index.css#L14-L33) and [map.css, lines 72-102](../../apps/web/src/views/map/map.css#L72-L102).

The catalog's `TicketMark` already maps domain states/types to UI variants. Its colors come from UI semantic tokens rather than the root map aliases. Keep that shared component. See [ticket-presentation.ts, lines 9-23](../../apps/web/src/views/shared/ticket-presentation.ts#L9-L23), [ticket-mark.tsx, lines 1-26](../../apps/web/src/views/shared/ticket-mark.tsx#L1-L26), and [mark.module.css, lines 11-73](../../packages/ui/src/components/mark/mark.module.css#L11-L73).

Docs imports the UI tokens independently and has its own document baseline. It does not inherit web `index.css` or map styles. See [docs.astro, lines 2-7](../../apps/docs/src/layouts/docs.astro#L2-L7) and [document.module.css, lines 1-29](../../apps/docs/src/layouts/document.module.css#L1-L29).

## Hash navigation boundary

The router owns both the remaining application routes and the page-specific route. `screen: 'projects'` means Overview; `screen: 'project-registration'` means settings; only singular `screen: 'project'` means the map page. Removing project/map navigation must not remove Project registration. See [router.ts, lines 17-29](../../apps/web/src/router.ts#L17-L29) and [App.tsx, lines 18-26](../../apps/web/src/App.tsx#L18-L26).

The current map URLs are `#/projects/<integration>/<project-id>` and their `/maps/<map-id>` descendants. A pinned map can add `/map`, `/ticket/<id>`, `/fog/<index>`, `/scope/<index>`, or `/scope-all`. The parser and builders agree on this grammar. The architecture document's `#/owner/repo/<map>` example is already stale. See [router.ts, lines 94-129](../../apps/web/src/router.ts#L94-L129), [router.ts, lines 140-183](../../apps/web/src/router.ts#L140-L183), and [architecture.md, lines 21-23](../architecture.md#L21-L23).

### Consumers that survive the page deletion

| Builder | Remaining consumers | Required change |
| --- | --- | --- |
| `projectHash` | Overview's Project attention action and active/resting/waiting Project names | Retarget to the retained `projectRegistrationHash`, or deliberately remove the links. Preserve the rows and their domain summaries. [project-list.tsx, lines 114-120](../../apps/web/src/views/overview/project-list.tsx#L114-L120), [lines 127-140](../../apps/web/src/views/overview/project-list.tsx#L127-L140), [lines 158-167](../../apps/web/src/views/overview/project-list.tsx#L158-L167), [lines 178-191](../../apps/web/src/views/overview/project-list.tsx#L178-L191) |
| `projectHash` | Connections' `Go to roadmap` button | Remove this page-specific button while preserving Project settings, source links, and server-launch actions. Project settings is already a separate link in the same Connection row. [connection-sections.tsx, lines 141-145](../../apps/web/src/views/settings/connections/connection-sections.tsx#L141-L145), [lines 180-223](../../apps/web/src/views/settings/connections/connection-sections.tsx#L180-L223) |
| `selectionHash` | Project settings' `Review affected ticket` link for an interrupted Session | Remove or replace the map-only review destination. Do not remove the interruption warning or acknowledgement-and-enable command. The current link appears only when its target resolves in live maps. [automation-section.tsx, lines 24-34](../../apps/web/src/views/settings/projects/%5BprojectId%5D/automation-section.tsx#L24-L34), [lines 85-104](../../apps/web/src/views/settings/projects/%5BprojectId%5D/automation-section.tsx#L85-L104) |

A source-link replacement for the review link is not universally available: `Ticket.url` and `Ticket.sourcePath` are optional, and Local relative-link resolution is specific to the removed Panel. A removal must not silently label a Project settings URL as ticket inspection. See [contracts/index.ts, lines 54-77](../../packages/contracts/src/index.ts#L54-L77) and [link-targets.ts, lines 13-36](../../apps/web/src/views/map/link-targets.ts#L13-L36).

The remaining consumers of `mapHash`, `resolveSelection`, `encodeSelection`, `replaceHash`, `PanelSelection`, and `ResolvedSelection` are page modules and router tests. `projectHash` also feeds `mapHash`; `selectionHash` feeds map selection as well as the settings link above. See [router.ts, lines 156-232](../../apps/web/src/router.ts#L156-L232), [project-screen.tsx, lines 81-126](../../apps/web/src/views/map/project-screen.tsx#L81-L126), and [router.test.ts, lines 3-15](../../apps/web/src/router.test.ts#L3-L15).

A minimal router cut removes the `'project'` route variant, the bare and pinned map parse branches, `parseSelection`, the two selection types, `projectHash`, `mapHash`, `selectionHash`, `resolveSelection`, `encodeSelection`, and the now-unreferenced `replaceHash`. The router's `WayfinderMap` and `stripInlineMarkdown` imports then become unnecessary. Keep `ProjectKey`, `parseProjectKey`, URI encoding/decoding, Overview/catalog/settings hash builders and parsers, `parseHash`, and `useRoute`. Project registration still needs `parseProjectKey`. See [router.ts, lines 1-3](../../apps/web/src/router.ts#L1-L3), [lines 51-93](../../apps/web/src/router.ts#L51-L93), [lines 131-138](../../apps/web/src/router.ts#L131-L138), and [lines 239-255](../../apps/web/src/router.ts#L239-L255).

Unsupported hashes already fall back to Overview. After the map parse branches disappear, old map bookmarks can use that existing fallback without a replacement route or compatibility alias. Dropping only the `App` render branch would instead leave a recognized route with no page. See [router.ts, lines 85-107](../../apps/web/src/router.ts#L85-L107) and [App.tsx, lines 15-26](../../apps/web/src/App.tsx#L15-L26).

The shell does not link to the map page. Its navigation is Overview, Connections, Components, and the standalone UI docs. See [site-header.tsx, lines 1-20](../../apps/web/src/views/shell/site-header.tsx#L1-L20).

### Server-generated navigation

There is a navigation dependency without a web-source import. `projectActions` emits `{ id: 'open-roadmap', kind: 'roadmap', href: '#/projects/...' }` into registered Project state. The web Connection view currently ignores that action kind and builds its own Roadmap link; it renders only the source external link and selected server-launch actions from `project.actions`. See [application.ts, lines 1303-1319](../../apps/server/src/application/application.ts#L1303-L1319) and [connection-sections.tsx, lines 187-223](../../apps/web/src/views/settings/connections/connection-sections.tsx#L187-L223).

The backend can continue running after web-page removal without an import change, but that action URL would be stale. A clean navigation cut also removes the emitted `open-roadmap` action and its local URL variable. If no Roadmap action remains, remove the obsolete `'roadmap'` action discriminator from its type and runtime codec together. Keep `ProjectAction`, its other kinds, and `RegisteredProject.actions`. This is a small page-navigation contract change, not removal of domain maps or server functionality. See [contracts/index.ts, lines 239-253](../../packages/contracts/src/index.ts#L239-L253) and [contracts/codecs.ts, lines 325-342](../../packages/contracts/src/codecs.ts#L325-L342).

## Data that must remain

`MapPage` is a store consumer. It merges a committed registration with a source Project's `sourcePath` and passes maps, transport state, and automation state/commands down to the page. The page does not own a separate store or server. See [map/page.tsx, lines 10-54](../../apps/web/src/views/map/page.tsx#L10-L54).

`RoadmapProvider` creates one store at the application root. `useRoadmap` exposes registered Projects, source roadmap Projects, Connections, configuration, automation, capture time, supported integrations, authorization operations, command state, queries, and commands. It subscribes to the store and starts it. The store decodes full `ApplicationState` envelopes. See [main.tsx, lines 1-17](../../apps/web/src/main.tsx#L1-L17), [roadmap-provider.tsx, lines 16-76](../../apps/web/src/store/roadmap-provider.tsx#L16-L76), and [roadmap-store.ts, lines 1-40 and 116-123](../../apps/web/src/store/roadmap-store.ts#L1-L40), [roadmap-store.ts, lines 116-123](../../apps/web/src/store/roadmap-store.ts#L116-L123).

The remaining views consume this state independently:

- Overview reads registered Projects, Connections, configuration, capture time, and transport liveness. Its projection uses open/closed maps, destination Markdown, completion counts, fog, frontier ticket titles, and map timestamps. Those facts determine active/resting/waiting grouping and the summary rows. See [overview/page.tsx, lines 1-15](../../apps/web/src/views/overview/page.tsx#L1-L15) and [project-presentation.ts, lines 62-112](../../apps/web/src/views/overview/project-presentation.ts#L62-L112).
- Project registration reads registered Projects, Connections, capture time, and configuration. It displays whether maps exist. Details calls `mapState`, which counts open and closed maps. Automation reads shared evidence and enablement, performs acknowledgement/enable commands, and currently resolves the affected ticket for the review link. See [projects/page.tsx, lines 16-18 and 65-84](../../apps/web/src/views/settings/projects/%5BprojectId%5D/page.tsx#L65-L84), [details-section.tsx, lines 84-89](../../apps/web/src/views/settings/projects/%5BprojectId%5D/details-section.tsx#L84-L89), [settings-shared.tsx, lines 71-76](../../apps/web/src/views/shared/settings-shared.tsx#L71-L76), and [automation-section.tsx, lines 17-51](../../apps/web/src/views/settings/projects/%5BprojectId%5D/automation-section.tsx#L17-L51).
- Connection settings reads Connections, registered Projects, supported integrations, authorization operations, configuration, and shared command state. It groups Projects by Connection and uses automation evidence in each row. Connection detail selects a Connection and composes independent Details and Manage sections. See [connections/page.tsx, lines 16-34 and 76-81](../../apps/web/src/views/settings/connections/page.tsx#L16-L34), [connections/page.tsx, lines 76-81](../../apps/web/src/views/settings/connections/page.tsx#L76-L81), [connection-sections.tsx, lines 94-139](../../apps/web/src/views/settings/connections/connection-sections.tsx#L94-L139), and [connection-detail/page.tsx, lines 14-57](../../apps/web/src/views/settings/connections/%5BconnectionId%5D/page.tsx#L14-L57).
- Project import reads Connection/integration/configuration state and sends a `register-project` command with the shared configuration version. Its successful destination is already Project registration, not the map page. See [import/page.tsx, lines 24-54](../../apps/web/src/views/settings/connections/%5BconnectionId%5D/import/page.tsx#L24-L54), [lines 69-98](../../apps/web/src/views/settings/connections/%5BconnectionId%5D/import/page.tsx#L69-L98), and [lines 138-144](../../apps/web/src/views/settings/connections/%5BconnectionId%5D/import/page.tsx#L138-L144).
- The web catalog uses `TicketState` and `TicketType` plus the shared `TicketMark`; it does not use map selection or application state. See [catalog/page.tsx, lines 1-17](../../apps/web/src/views/catalog/page.tsx#L1-L17) and [catalog/mark.tsx, lines 1-18](../../apps/web/src/views/catalog/mark.tsx#L1-L18).

The `roadmapProjects` view-state projection has only the map page as a production view consumer, so it becomes a dead accessor after removal. `capturedAt` remains in use by Overview and loading/not-found states and is still derived from `state.roadmap.capturedAt`. No production view consumer of the already-exposed `unreachable` projection was found; that is existing unused exposure, not a reason to delete the server's Snapshot. See [map/page.tsx, lines 10-21](../../apps/web/src/views/map/page.tsx#L10-L21), [roadmap-provider.tsx, lines 53-69](../../apps/web/src/store/roadmap-provider.tsx#L53-L69), [overview/page.tsx, lines 7-13](../../apps/web/src/views/overview/page.tsx#L7-L13), and [connection-detail/page.tsx, lines 15-25](../../apps/web/src/views/settings/connections/%5BconnectionId%5D/page.tsx#L15-L25).

`WayfinderMap`, `Ticket`, `Project`, `RegisteredProject`, `Snapshot`, and `ApplicationState.roadmap` are retained contracts. `RegisteredProject` itself contains open/closed maps; the server application and snapshot store use those contracts without importing web code. See [contracts/index.ts, lines 121-182](../../packages/contracts/src/index.ts#L121-L182), [lines 246-253](../../packages/contracts/src/index.ts#L246-L253), [lines 382-395](../../packages/contracts/src/index.ts#L382-L395), [application.ts, lines 1-28](../../apps/server/src/application/application.ts#L1-L28), and [server/store.ts, lines 1-27](../../apps/server/src/store.ts#L1-L27).

Removing the page also removes its UI for ticket bodies, evidence details, and manual automation overrides. The Panel sends `start-automation-override` through the same shared command interface. That does not make server automation, global/Project automation settings, or their contract types page-exclusive. See [panel.tsx, lines 277-293](../../apps/web/src/views/map/panel.tsx#L277-L293) and [Project automation-section.tsx, lines 17-51](../../apps/web/src/views/settings/projects/%5BprojectId%5D/automation-section.tsx#L17-L51).

## Package and workspace boundary

`react-markdown` and `remark-gfm` are page-exclusive direct dependencies within `apps/web`. Their only web source imports are in `map/prose.tsx`, which renders the Panel's Markdown. Removing the page makes both removable from the web manifest and web lockfile importer. See [web/package.json, lines 13-20](../../apps/web/package.json#L13-L20), [prose.tsx, lines 1-15 and 78-83](../../apps/web/src/views/map/prose.tsx#L1-L15), [prose.tsx, lines 78-83](../../apps/web/src/views/map/prose.tsx#L78-L83), and [pnpm-lock.yaml, lines 86-108](../../pnpm-lock.yaml#L86-L108).

They are not exclusive across the workspace. The docs app declares both packages and imports them in its own Markdown renderer for token guides. Keep the docs declarations and the lockfile package entries/transitive dependencies still required by that importer. See [docs/package.json, lines 13-21](../../apps/docs/package.json#L13-L21), [docs/markdown.tsx, lines 1-19](../../apps/docs/src/examples/markdown.tsx#L1-L19), and [pnpm-lock.yaml, lines 18-43](../../pnpm-lock.yaml#L18-L43).

The other direct web dependencies are not map-only packages:

- `@roadmap/contracts` remains required by the state store, settings, Overview, and ticket catalog.
- `@roadmap/ui` remains required by every remaining screen and the shell.
- React and React DOM remain the application runtime. See [main.tsx, lines 1-17](../../apps/web/src/main.tsx#L1-L17), [roadmap-provider.tsx, lines 1-11](../../apps/web/src/store/roadmap-provider.tsx#L1-L11), [catalog/mark.tsx, lines 1-3](../../apps/web/src/views/catalog/mark.tsx#L1-L3), and [site-header.tsx, lines 1-4](../../apps/web/src/views/shell/site-header.tsx#L1-L4).
- `classnames` has no current `apps/web/src` consumers, including the map page, in the source search. Its web declaration is already unused, so classify it separately from dependencies made obsolete by page removal. The docs app and UI package still use/declare it. See [web/package.json, lines 13-20](../../apps/web/package.json#L13-L20), [docs/markdown.tsx, lines 1-6](../../apps/docs/src/examples/markdown.tsx#L1-L6), and [ui/package.json, lines 33-35](../../packages/ui/package.json#L33-L35).

No web map imports were found in the docs app, server, contracts package, or UI package. Their manifests do not depend on `@roadmap/web`. The docs app depends on public UI exports and has its own Markdown renderer. The server depends on contracts, `ajv`, and `ws`; contracts exposes its own types/codecs. See [docs/package.json, lines 13-21](../../apps/docs/package.json#L13-L21), [server/package.json, lines 17-20](../../apps/server/package.json#L17-L20), [contracts/package.json, lines 6-12](../../packages/contracts/package.json#L6-L12), and [ui/package.json, lines 7-35](../../packages/ui/package.json#L7-L35).

Root orchestration still includes the web app and must remain: the web workspace is being retained, not removed. The documented ownership boundary also keeps docs independent of web source/domain/application providers. See [root tsconfig.json, lines 1-9](../../tsconfig.json#L1-L9) and [architecture.md, lines 5-11 and 33-35](../architecture.md#L5-L11), [architecture.md, lines 33-35](../architecture.md#L33-L35).

## Verification

### Disposable deletion experiment

The experiment copied the workspace to a temporary directory without the real environment, configuration, Automation database, or Git metadata. A synthetic Local Project contained one open map and one ticket. The real server entry point, Local adapter, WebSocket transport, browser store, provider, and web app ran against that data. Automation remained disabled and GitHub credentials were absent.

Only the temporary copy changed:

1. Removed `views/map/` in full.
2. Removed `shared/destination-mark.tsx`, its CSS and test, and `shared/views.css`.
3. Removed the `MapPage` import and render branch from `App`.
4. Removed `react-markdown` and `remark-gfm` from the web manifest.
5. Kept existing router branches and incoming links deliberately, to expose navigation consequences.

The remaining web source passed its TypeScript build and Vite production build. From the temporary `apps/web` directory, the command was:

```sh
node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build
```

Vite transformed 103 modules and emitted the remaining app bundle. The experiment reused installed dependencies; it did not verify a fresh dependency installation or change the lockfile.

In a fresh browser tab, these routes rendered after deletion, with no browser errors and no map or exclusive support styles loaded:

| Page | Hash |
| --- | --- |
| Overview | `#/` |
| Connections | `#/settings/connections` |
| Connection detail | `#/settings/connections/local` |
| Project import | `#/settings/connections/local/import` |
| Project registration | `#/settings/projects/local/isolation` |
| Catalog | `#/components` |

Overview still displayed the Local Project's destination, ticket count and priority. The import page still rejected an empty Workspace with `Choose a readable Workspace folder.` Header navigation remained operational. Clicking the Overview Project link reached `#/projects/local/isolation`, but rendered only the persistent header and no page heading. This demonstrates the required router/link cleanup; the experiment was not a complete product removal.

### CSS measurements

Before deletion, the browser disabled `map.css`, `shared/views.css`, and `shared/destination-mark.css` together. Across the six routes above, in both light and dark mode at a 1440 by 1000 viewport, every measured descendant's computed CSS properties and bounding rectangle matched before and after. These 12 comparisons found no current dependence on the removed styles.

Removing only the custom-property declarations from web `index.css` in the catalog's CSSOM changed body background from `rgb(251, 251, 250)` to transparent and text from `rgb(28, 27, 26)` to black. UI ticket-mark colors stayed unchanged. The legacy document colors are still active dependencies; they are not safe page-removal candidates.

The deletion experiment briefly produced aborted Vite hot-reload requests in an already-open tab as files disappeared. Verification used a fresh tab after deletion, which had no browser errors. Screenshots confirmed the populated Overview, retained catalog, and header-only broken Project destination.

### Repository checks and limits

The unchanged production application passed `pnpm check`, `pnpm typecheck`, and `pnpm test`. Biome checked 273 files. TypeScript and Astro reported no errors; Astro checked 40 files. The tests passed 397 cases across 55 files. These are baseline repository checks, not a full post-removal test run. Dependency setup emitted missing `esbuild` bin-link warnings before check/typecheck, but both commands exited successfully.

The browser evidence covers desktop default states and one populated Local Project. It does not prove every mobile layout, GitHub authorization state, interrupted Session state, server command, or UI-docs interaction. Those retained dependencies follow from source evidence where the runtime scenario was not exercised. The standalone docs app was not runtime-smoked in this experiment.

## Proposed minimal deletion boundary

This is a proposed cut, not an applied change.

1. Delete `apps/web/src/views/map/` as a unit, including its page modules, CSS, tests, and test fixtures. Delete the exclusive `shared/destination-mark.tsx`, `destination-mark.css`, `destination-mark.test.ts`, and `shared/views.css`. Keep all shared files with remaining consumers listed above. Remove only the page-exclusive root rules/aliases identified in the CSS section; keep the document baseline and retained settings variables.
2. Remove `MapPage`'s import/render branch and map-specific header comment from `App`; retain all other pages and the persistent `SiteHeader`.
3. Remove only the map-specific router members listed above. Keep the existing Overview fallback and all settings/catalog routes. Retarget Overview links to Project registration, remove the Connections map button, and remove or replace the interrupted-ticket map destination without deleting acknowledgement/enablement behavior.
4. Remove `react-markdown` and `remark-gfm` from `apps/web/package.json` and its lockfile importer. Keep their docs dependencies. Remove the now-unreferenced `roadmapProjects` member from `RoadmapViewState` and `useRoadmap`'s return object, but retain the provider/store and their full authoritative state, including `roadmap.capturedAt`. Do not delete shared contracts, the UI package, the data store, or the web workspace.
5. Remove the stale server `open-roadmap` action and the obsolete action-kind discriminator from the type and codec together. Keep source and launch actions. This is the only backend/contracts change identified for a clean navigation cut.
6. Remove page-only router tests/fixtures while preserving the settings/catalog/Overview routing contract. Update existing tests that depend on the retired links, including [Connections page tests, lines 220-235](../../apps/web/src/views/settings/connections/page.test.ts#L220-L235) and [Project settings tests, lines 245-272](../../apps/web/src/views/settings/projects/%5BprojectId%5D/page.test.ts#L245-L272). Do not delete the store or Overview presentation tests. See [router.test.ts, lines 19-57](../../apps/web/src/router.test.ts#L19-L57), [lines 58-166](../../apps/web/src/router.test.ts#L58-L166), and [lines 218-279](../../apps/web/src/router.test.ts#L218-L279).
7. Update the architecture's map-route/Panel description and its interrupted-session ticket-link statement to match the retained application. See [architecture.md, lines 21-25](../architecture.md#L21-L25) and [lines 55-59](../architecture.md#L55-L59). The underlying server integration/automation ownership remains unchanged.

The import graph and runtime experiment support this cut without a prerequisite extraction or new abstraction. Navigation cleanup is required. Removing map data instead of the page would break the retained Overview projection and Project map-status reporting and would change the server's read model, which is outside this deletion boundary.

## Implications for standardizing the page

Keep the shared UI token layer and document baseline. Scope the Project page's own selectors with CSS Modules or an explicit page ancestor, including its SVG, prose, animation and state rules. Move the map-only support styles and DestinationMark into the page's ownership boundary rather than treating `shared/` as proof of shared use.

Migrate the remaining settings consumers before removing legacy globals. In particular, `--state-blocked` and `--goal` still style non-map UI. Separate that migration from the Project page's visual redesign so a regression has one responsible change.

Treat map/ticket data and route-link builders as explicit shared contracts. Other pages need domain summaries and intentional navigation, but should not need map rendering, geometry, Panel components, or their CSS. The current source already meets that rendering dependency direction; it does not yet enforce CSS locality or remove the shared legacy presentation layer.

