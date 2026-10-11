# Roadmap GitHub migration

Temporary cutover plan. Delete after migration and update current architecture docs as implementation changes. The package is declaration-only; this document defines the intended cutover, not current application behavior.

## Ownership and package integration

GitHub owns device authorization, token exchange, and explicit REST reads with response validation and pagination. Roadmap owns private storage, account policy, registration, acquisition, observation, and Wayfinder interpretation.

- Add `@roadmap/github` as a server workspace dependency only when the runtime entry point exists. Use its public root export, not declaration-file paths. Browser views continue through `useRoadmap`, never GitHub imports.
- Replace [`github/connections.ts`](../../apps/server/src/github/connections.ts) and application device polling with package authorization operations. Keep one Roadmap authorization owner per account for credential loading, expected-account checks, and serialized refresh/reauthorization acceptance.
- Keep [`credential-vault.ts`](../../apps/server/src/application/credential-vault.ts) in Roadmap. Storage and registration failures remain separate. Invalid configuration must not trigger orphan credential deletion, as required by the [settings plan](../settings/roadmap-migration.md#startup-safety).
- Replace [`github/client.ts`](../../apps/server/src/github/client.ts), [`repository.ts`](../../apps/server/src/github/repository.ts), and [`map-query.ts`](../../apps/server/src/github/map-query.ts) with package repository, issue, child, and dependency reads. Remove GraphQL queries, aliases, partial-error decoding, conditional cache, and mutable-token callbacks.
- Simplify [`github/observer.ts`](../../apps/server/src/github/observer.ts) into the Roadmap acquisition adapter. Keep retention and absence in the resource catalog and interpretation in [`wayfinder/from-github.ts`](../../apps/server/src/wayfinder/from-github.ts). Do not move Connection workers, budget schedulers, or application credential policy into the package.
- Keep [`github/admission.ts`](../../apps/server/src/github/admission.ts) responsible for local Workspace proof, using package repository lookup. Migrate [`main.ts`](../../apps/server/src/main.ts) composition and remove provider-shaped method checks from admission.

## Canonical provider models

Use `Issue` for every direct read and issue-bearing collection. Share issue translation and validation across endpoints. Keep endpoint-specific HTTP, pagination, and requested-identity checks separate from that common model. Do not introduce endpoint-specific partial issue types or automatic enrichment to manufacture missing fields.

Keep GitHub provider models distinct from Roadmap map and ticket content, which adds Wayfinder interpretation. A Wayfinder map is an issue selected by the `wayfinder:map` label, not a second GitHub entity. A child-list response already supplies ticket content; do not immediately fetch each child again.

Preserve stable issue IDs and proven repository IDs before constructing application keys. Names describe observed addresses, not registered Project identity. An absent repository ID remains absent; a later name lookup is new evidence and cannot rewrite an earlier member's identity. Cross-repository blockers remain external or unresolved when the application cannot prove the registered target.

The package preserves cross-repository relationships. Initially, Roadmap map ticket membership supports same-repository children only. A foreign child must remain visible as unsupported evidence, make membership incomplete, and prevent execution based on a flattened parent-local ticket ID. Never silently drop it and certify complete membership. Cross-repository blockers remain supported. Supporting foreign tickets later requires repository-qualified application keys, not a new provider issue type.

## Summary and detail acquisition

### Map navigation

For each registered repository, fetch its metadata by stable ID and list all `wayfinder:map` issues with `state: 'all'`. Use those issue responses for map metadata and supplied progress counts. An overview such as "Map 3 has 4 issues" uses `subIssues.total` without fetching those children. Missing counts stay unknown rather than zero.

Map ordering and default selection depend on complete map-list evidence and relevant map metadata, not every map's ticket and blocker graph. Remove the current catalog dependency between map navigation and full execution readiness. Keep conservative behavior when map membership or ordering metadata is unavailable.

### Selected map detail

The UI displays one map's detail at a time. Opening its URL acquires its direct children and the children's blocked-by collections. Use each child's returned repository reference for relationship navigation, not the parent repository by assumption. Reuse returned issue content for ticket detail; a new direct issue read is deliberate revalidation, not mandatory enrichment.

Add explicit acquire/release behavior through the public `RoadmapApplication` interface and the existing store/workflow owners. Views must not fetch. The URL remains navigation authority; acquisition interest records resource demand, not a second selected-map state. Detail enters server-owned application state through the existing authoritative publication path. HTTP operation results do not become a competing read authority.

Track acquisition lifetime through route changes, disconnects, and application stop. Release viewer demand when it ends, stop subsequent detail reads when no consumer needs them, and prevent retired work from changing the current acquisition. Repeated acquisition of the same scope shares work. Keep this lifecycle in Roadmap, not in GitHub resource handles.

### Automation and retained evidence

Automation acquires detail independently of visible UI selection for the maps it actually needs. No visible map does not mean no detail demand. Share acquisition when viewer and Automation need the same map. Do not prefetch every graph to preserve incidental old polling behavior.

Without demand, previously fetched detail may remain retained with its actual last observation time, but receives no background synchronization. Not acquired, loading, failed, retained, and successfully empty detail are different facts. Omission caused by nonacquisition or release cannot prove a map or ticket absent.

Keep execution readiness separate from navigation. Classification and Session admission still require fresh, complete evidence for their target, explicit ticket membership, blocker facts, authorization, and Workspace proof. Summary counts or a selected URL never grant execution authority. Cross-map blocker targets can remain external graph references without loading their entire maps.

This policy intentionally reduces background ticket-level notifications for unacquired maps. Summary updates are not evidence of a particular ticket transition. Keep notifications attributable to actual observations rather than silently reacquiring every graph for the old Change feed.

## Evidence, cost, and authorization

Record actual attempt time, successful-read time, and read identity around each named package operation. A repository issue list can establish map membership and map content from one response; separate child and blocker reads cannot reuse an earlier GraphQL graph timestamp as if they were one atomic observation.

A failed child-list read cannot establish empty or absent ticket membership. A failed blocker read must leave its ticket incomplete or unavailable for execution without discarding independently readable prose. Preserve supplied dependency counts and treat discrepancies with fetched membership conservatively. Separate REST reads can disagree because provider data changes; collection pagination is not snapshot proof.

Use bounded read concurrency and separate summary/detail cadence in Roadmap. Drop the fixed 30-second graph expectation and Connection-wide manual refresh. Manual detail refresh targets the requested acquired map, not every graph sharing its Connection. Measure request count and latency for navigation-only, one selected map, and overlapping Automation demand before selecting polling intervals. Honor rate-limit retry times at the caller; no scheduler belongs in GitHub.

Start device authorization as an owned task outside the serialized command lane. Return a waiting receipt when instructions arrive or an early terminal result if they do not. Cancel and retry must remain callable while authorization waits. Enqueue only short state and registration transitions, and abort and join authorization tasks on shutdown.

For refresh, serialize exchange, replacement account identification, expected-account validation, private persistence, and operational client replacement. Identification uses the new token before saving; resource reads wait for storage success. A successful exchange invalidates both old tokens. Response loss, cancellation after dispatch, or failed persistence cannot roll back that provider effect or promise the old bundle usable. Do not automatically repeat a possibly consumed token exchange. Preserve the existing separation between credential storage and Connection registration.

## Completion

Exercise package acceptance through its public root interface with controlled HTTP responses. Exercise Roadmap through public `RoadmapApplication` and private test storage, not its internals. No live GitHub account or real Keychain writes are required.

Cover:

- Navigation and aggregate counts with no child or blocker requests.
- Opening one map without loading unrelated graphs; ticket detail reuses child content.
- Viewer acquire/release, route replacement, disconnect cleanup, shared Automation demand, and no late publication after retirement or stop.
- Map ordering without deep graph acquisition, while execution stays denied without fresh complete target evidence.
- Canonical issue decoding, foreign identities, repository renames/name reuse, and unsupported foreign child membership without false emptiness.
- Failed pagination, count discrepancies, scoped relationship failures, retained data, and nonacquisition without false absence.
- Expected-account checks, failed private persistence, cancelled authorization, nonblocking command delivery, refresh uncertainty, and serialized credential acceptance.
- Representative request counts and latency under the chosen summary/detail cadence.

Remove replaced provider code, duplicate decoders, business-named request types, and obsolete orchestration without compatibility wrappers. Update affected contract and behavior tests, `docs/architecture.md`, and `docs/research/github-api-primitives.md` when the cutover occurs. Document the actual acquisition and notification policy, not the removed all-graphs synchronization model.
