# Roadmap settings migration

Temporary cutover context, not the package contract or current architecture documentation. Delete this file when the cutover, caller migration, and cleanup are complete. Keep the README domain agnostic. Update `docs/architecture.md` as behavior actually changes.

The smaller product contract is intentional. Live manual edits, revision protocols, historical migrations, and filesystem durability stages are not requirements to preserve.

## Define the document before replacing storage

[`ProjectConfiguration`](../../apps/server/src/projects/registry.ts) contains Connection identities, Project registrations, canonical Workspace intent, display names, Automation preferences, and executable Harness Commands. It is broader than the package's preferences contract.

- Define the complete browser-editable preferences document and its application-owned schema before adding a store. Display names and Automation enablement are candidate fields, not a finalized schema.
- Keep credentials, executables, environment configuration, runtime admission evidence, and public state outside that preferences document.
- Keep registration and authorization as application operations. A UI settings proposal does not establish a canonical Workspace, repository identity, Connection account, or permission to launch.
- Account for persisted registration intent and server-supplied commands separately. Adding preferences storage while leaving the old configuration owner unchanged is not a replacement of the broader persistence problem.
- Do not round-trip `ApplicationState` into a settings save. Public state contains observations and capabilities, not an editable persistence document.

This field allocation is a prerequisite for implementation. It must not enlarge the domain-agnostic package contract to accommodate Roadmap's current configuration shape.

## Existing save path

Views submit named intents through [`workflows.ts`](../../apps/web/src/workflows/workflows.ts). [`RoadmapApplication`](../../apps/server/src/application/application.ts) serializes mutations, checks policy and expected configuration version, and constructs a complete document.

`persistConfiguration` validates and saves that document, then synchronizes credentials, prepares registry admissions, activates observation, and publishes state. [`configuration/document.ts`](../../apps/server/src/configuration/document.ts) owns historical decoding, migration, watching, raw-byte conflict detection, serialized replacement, and confirmed or unconfirmed durability.

Keep named application operations where they protect server-owned facts. Whole-document replacement is appropriate for the defined preferences document, not automatically for every registration or authorization operation.

## Remove during cutover

- Configuration directory watching, debounce, fingerprints, and live manual-file publication.
- Raw-byte external-edit conflicts, own-write echo suppression, live-input receipt queues, and version rules used only for manual replacement.
- Read-only repair transitions driven by live invalid input. Manual repair happens while stopped and takes effect at startup.
- Implicit initialization during load. Initialization becomes an explicit absent-only action.
- Historical version decoders and import machinery after any actual data conversion is complete. Unsupported input must remain intact rather than silently reset.
- Public confirmed or unconfirmed durability stages and related filesystem synchronization gates. Keep ordinary failure reporting, stored-result uncertainty, and partial-write prevention.
- Configuration revisions on callers whose only reason for carrying one was the old settings protocol. Do not rename the same protocol into a new revision field.

Keep operation-specific admission checks, a save serialization lane, and shutdown handling for begun writes. WebSocket epoch and sequence authority are transport facts, not settings revisions.

Source observers still need their own source watching. Removing configuration watching does not remove Local source observation or provider authorization changes.

## Startup safety

Current startup substitutes `EMPTY_CONFIGURATION` after an invalid load and continues through credential cleanup before reaching read-only readiness. `cleanupOrphanCredentials` supplies that empty Connection set to [`credential-vault.ts`](../../apps/server/src/application/credential-vault.ts), which deletes indexed credentials absent from the set.

The review reproduced this behavior through public `RoadmapApplication` with the real vault logic and an injected in-memory Keychain adapter. Invalid startup deleted the injected saved Connection record. No real Keychain access occurred.

Reject missing, invalid, or unreadable settings before settings-dependent activation or cleanup. An invalid document does not prove that its Connections were removed. Preserve actionable file and field errors through bootstrap without accepting an empty substitute.

## Save and activation behavior

- Serialize complete preference proposals and use whole-document replacement in acceptance order. A single file writer does not prevent stale browser drafts from overwriting fields. There is no merge or stale-draft detection.
- [`SafeError`](../contracts/src/operations.ts) currently has one optional field, and application validation flattens document issues into a message. Complete settings saves need structured field and general errors through the public operation contract.
- Accept preferences only after ordinary save success. Keep accepted memory unchanged on failure, and report stored-result uncertainty when necessary.
- After an uncertain save, require restart before another save. Startup validates the stored document without replay or automatic repair.
- Report resource activation failure separately from a successful save. Credential synchronization or observer activation can fail after persistence. Do not claim the file stayed unchanged in that case.
- HTTP response loss remains unknown operation delivery. Removing filesystem durability stages does not prove that a browser received a save result.

## Relationship to process execution

The [process execution cutover](../process-execution/roadmap-migration.md) removes interruption acknowledgement and automatic Project disablement. Delete those preference writes and shutdown rewrites rather than recreating them in Settings.

Roadmap still owns automatic trigger enablement and final process admission. A saved preferences document does not prove source freshness, Workspace access, provider authorization, or process success.

## Verification and completion

Exercise the settings acceptance scenarios through its caller interface. Exercise integration scenarios through public `RoadmapApplication`.

- Start with absent input. Observe no implicit write and an explicit initialization requirement.
- Start with invalid or unreadable input. Observe no accepted substitute and no settings-dependent activation or credential deletion.
- Initialize absent input, then repeat initialization against valid and invalid existing documents. Observe no overwrite.
- Save a complete valid proposal, stop, and restart. Observe the saved accepted preferences.
- Submit invalid proposals and fail saves before replacement. Observe structured errors and unchanged accepted settings and stored input.
- Submit two complete proposals. Observe serialized replacement without hidden merge or stale-draft guarantees.
- Leave a save uncertain. Observe unchanged accepted memory, restart-required save admission, and validation of the actual file on restart.
- Change the file while stopped. Observe the edit at the next startup without live-file reconciliation.
- Fail dependent activation after save success, and begin shutdown during a save. Observe persistence truth independently of activation and lifetime.

Completion requires a defined preferences schema, migrated callers and operation errors, removed obsolete configuration protocols, updated behavior tests, and accurate architecture documentation. Remove this temporary file after those conditions hold.
