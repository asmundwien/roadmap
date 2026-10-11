# Roadmap process execution migration

Temporary cutover context, not the package contract or current architecture documentation. Delete this file when the cutover, caller migration, and cleanup are complete. Keep the README domain agnostic. Update `docs/architecture.md` as behavior actually changes.

The smaller product contract is intentional. Existing Roadmap behavior is evidence of work to remove or relocate, not a compatibility requirement.

## Existing owners

- [`automation/engine.ts`](../../apps/server/src/automation/engine.ts) combines task selection, Classification and Wayfinder sequencing, history writes, process observation, recovery, and interruption policy. `beginClassification` and `beginDispatch` save stage reservations and recheck admission before invoking the launcher.
- [`automation/launcher.ts`](../../apps/server/src/automation/launcher.ts) performs shell-free detached spawning, prompt delivery, environment construction, and bounded capture. Classification has owned termination. Wayfinder Sessions do not.
- [`automation/database.ts`](../../apps/server/src/automation/database.ts) validates opportunities and events, rejects repeated targets, and projects an AFK Verdict into a queued Session. It exposes confirmed or unconfirmed durability.
- [`application.ts`](../../apps/server/src/application/application.ts) composes the engine, publishes evidence, disables interrupted Projects, and persists acknowledgement before re-enablement. Shutdown also writes interrupted-Project disablement.

## Replacement ownership

- Process execution owns attempt identity, live scope occupancy, pre-launch history save, launch observation, bounded private output, outcome save, and observation cleanup. Replacing only the launcher leaves the orchestration complexity in the engine.
- Roadmap owns target selection, any retained Classification-to-Session policy, prompt preparation, authorization, current source evidence, Workspace admission, and trigger enablement.
- The current global Classification scope and per-Project Wayfinder scope are Roadmap policy, not package defaults. Supply those scopes only if that policy remains intentional.
- Preserve final admission after the awaited save. A changed Connection, Workspace, command, enablement, or application lifetime must not launch an obsolete prepared request. Do not move catalog or configuration-version knowledge into process execution.
- If Classification or Session reports remain, their schemas and interpretation stay application-owned. Generic process history must not manufacture a queued Session from an AFK Verdict.

## Remove during cutover

- Persisted reservation ownership as an execution lock, including `reservationId` exceptions and scans of historical running records. Replace execution exclusion with live scopes.
- Recovery-driven launch of old queued work. Loading unfinished history reports uncertainty rather than resuming it.
- Unknown-outcome acknowledgement events, interruption gates, automatic Project disablement, and shutdown disablement writes. Process uncertainty remains history, not a preference mutation.
- Once-only target restrictions. A repeat request creates another attempt and does not overwrite a completed or unknown attempt.
- Public filesystem durability stages and power-loss-specific launch gates. Keep ordinary save failures and the no-launch-before-save rule.
- Classification-specific termination and the two launcher lifetime contracts when replacing them with the package's independent-process contract. Keep finite acquisition, write, and observation cleanup.
- Obsolete event schemas, decoders, exports, and tests after their callers move. Do not keep the old engine behind a compatibility wrapper.

Removing these execution mechanisms does not decide which business policies remain. Retained policies must be explicit application behavior, not accidental requirements inherited from event replay.

## Callers and public contracts

- [`contracts/state.ts`](../contracts/src/state.ts) structurally couples Session evidence to completed AFK Classification and carries interruption acknowledgement. Generic attempts cannot satisfy that shape without an intentional application projection.
- [`contracts/operations.ts`](../contracts/src/operations.ts) returns target, stage, and admission without an attempt ID. Repeated attempts need attributable acceptance, observations, and save failures.
- [`resources/results.ts`](../../apps/web/src/resources/results.ts) uses the first evidence record for a ticket and describes both stage controls as once-only. Choose attempt history or an explicit latest-attempt projection. Earlier unknown attempts must not disappear.
- [`workflows.ts`](../../apps/web/src/workflows/workflows.ts) has global Classification and per-Project Wayfinder pending conflicts. Align these with application-supplied scopes. Its acknowledged delivery result is not the interruption acknowledgement ritual.
- [`ticket-modal.tsx`](../../apps/web/src/views/map/ticket-modal.tsx) exposes stage controls and evidence. Migrate those with the chosen application policy.
- [`Project Automation settings`](../../apps/web/src/views/settings/projects/[projectId]/automation-section.tsx) and portfolio presentation expose review-required interruption state, forced-off toggles, and acknowledgement-and-enable. Remove the ritual and queued-resumption promise, not honest unknown history.
- Fixed native actions and notification processes are separate existing capabilities. This cutover does not require recording every host subprocess as an Automation attempt.

## Output privacy

Classification and Session result schemas accept arbitrary reason strings. Those strings currently enter history and browser evidence. The launcher inherits `process.env`, so a valid result can contain sensitive text.

Keep raw output and arbitrary extracted text private. If Roadmap retains public result fields, construct a safe application projection. Shape validation and length bounds do not prove secrecy. Do not add universal redaction as a substitute for a narrower public contract.

## Verification and completion

Exercise the package acceptance scenarios through its caller interface. Exercise integration scenarios through public `RoadmapApplication`, not private engine state.

- Hold the pre-launch save and revoke admission or begin shutdown. Observe no spawn afterward.
- Contend in one scope during the held save and run an independent scope. Observe rejection without a queue and without a global process lock.
- Run a harmless real process. Observe launch and exit separately from business output, and attribute both to one attempt ID.
- Fail the outcome save. Observe a live process result, persisted uncertainty, and scope release without an acknowledgement requirement.
- Repeat a completed or unknown target. Observe distinct attempt IDs and preserved earlier evidence.
- Restart with unfinished history. Observe unknown outcomes and no recovery launch. Verify retained automatic policy cannot reinterpret that history as permission to replay.
- Emit oversized or sensitive structured output. Observe bounded private capture without arbitrary public reason text.

Completion requires migrated server and browser callers, removed obsolete recovery and acknowledgement machinery, updated behavior tests, and accurate architecture documentation. Remove this temporary file after those conditions hold.
