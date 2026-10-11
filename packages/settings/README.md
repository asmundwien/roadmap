# Settings

Product contract. This document specifies desired behavior, not current server behavior, a module implementation, or a server cutover.

Settings provides validated application preferences through one application-owned document and schema.

## Supported behavior

- The application owns the preferences document, schema, and validation rules. Settings coordinates validation, persistence, and acceptance without exposing storage steps to callers.
- Load and validate the complete document at startup before accepting it. Reading input does not initialize or repair it.
- Missing input requires explicit initialization. Initialization creates schema-validated defaults only when input is absent. It must not replace an existing valid, invalid, or unreadable document.
- One application instance owns writes. Manual file editing happens while the application is stopped, never concurrently with UI saves. The next startup loads those edits.
- A UI save submits the complete preferences document for structured validation. Accepted settings change only after the ordinary save succeeds. The saved settings remain visible after restart.
- Serialize saves. Each successful proposal replaces the complete document in acceptance order. There is no merge or stale-draft detection. A later proposal can overwrite changes from an earlier save.
- Storage avoids partial document writes internally. Callers receive an ordinary save result, not filesystem synchronization stages.

## Application responsibilities

- The preferences document is not application runtime state or a round-trip copy of public state. The application defines which fields users may replace.
- A valid preferences document does not establish authorization, resource access, or permission to execute effects. The application owns those checks.
- Saved preference acceptance and activation of dependent resources are separate facts. A later activation failure does not undo a successful save or establish that stored input stayed unchanged.
- Startup without accepted settings cannot activate defaults or perform settings-dependent cleanup. The application may expose diagnostic status without accepting a substitute document.
- On shutdown, close new save admission and join writes already begun. Report the actual save result without inventing cancellation or rollback.

## Failure behavior

- Missing, invalid, or unreadable startup input produces an actionable error without fabricated defaults or accepted settings. Preserve existing input for stopped repair and restart.
- An invalid save proposal reports structured field errors and general errors. Accepted settings and stored input remain unchanged.
- A failed save reports the failure and leaves accepted in-memory settings unchanged. If the stored result is uncertain, report that uncertainty rather than claim success or an unchanged file.
- After an uncertain save, stop and restart to validate stored input before accepting another save. Restart loads a valid stored document or reports a startup error. It does not replay the failed proposal.
- Errors omit credentials and sensitive document contents. No automatic repair, retry, or replay replaces user action.

## Out of scope

- Executable configuration, environment merging, credential or secret storage.
- Concurrent writers, live file watching, revision counters, retention, or compare-and-swap protocols.
- Required schema versions or a migration system before an actual incompatible change.
- Public SDK interfaces, implementation dependencies, or power-loss durability guarantees.

## Acceptance scenarios

1. A valid document loads at startup. A valid complete UI proposal becomes accepted only after a successful save, and restart loads that saved document.
2. Invalid startup input remains intact and produces an actionable error without defaults. The user stops the application, repairs the file, and restarts to load it.
3. An invalid UI proposal returns validation errors. The previously accepted settings and stored document remain unchanged.
4. Two valid complete proposals arrive. Saves run serially, and the later accepted proposal replaces the earlier one without merging or detecting stale fields.
5. A save fails before replacement. Accepted settings and the stored document remain unchanged, and the caller receives a save error.
6. A save leaves the stored result uncertain. Accepted settings remain unchanged, and further saves require restart. Startup validates the actual stored input without replaying the failed proposal.
7. Explicit initialization creates valid defaults when input is absent. The same action refuses to overwrite any existing document, including invalid input.
8. Startup input is invalid. The application accepts no settings and performs no settings-dependent activation or cleanup.
9. A save succeeds, but activation of a dependent resource fails. The saved preferences remain accepted, and the application reports activation failure separately.
10. Shutdown begins while a save waits. No new save is admitted. The begun save drains and reports its actual result without a rollback claim.
