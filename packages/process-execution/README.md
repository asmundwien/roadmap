# Process execution

Product contract. This document specifies desired behavior, not a module implementation or server cutover.

Record explicit process attempts within caller-supplied execution scopes and report observed process outcomes without choosing business tasks or automation stages.

## Supported behavior

- The application owns authorization and automatic trigger enablement or disablement. It supplies each business target, execution scope, and prepared request. The module does not choose tasks or automation stages.
- Validate the application-supplied executable, argument array, and working directory before shell-free execution. Request validity does not establish authorization or business eligibility.
- The execution owner coordinates attempt recording, launch, observation, and outcome recording through one history writer. Callers request an attempt rather than perform those steps themselves.
- History is schema-validated. Each attempt has a stable ID, and related history changes save together with valid references. Repeating a request creates a new attempt, not a replacement of earlier evidence.
- Acquire the in-process scope before the first awaited save. Await an ordinary successful history save before launch. An occupied scope rejects a second request rather than queueing it. Other scopes may accept requests independently.
- Immediately before launch, the application must still authorize the prepared request and the execution owner must still accept launches. A request whose authorization changed during the save does not launch.
- Report attempt acceptance separately from process launch and completion. Observations and later save failures identify the attempt they concern.
- Record known nonlaunch, launch failure, observed exit code or signal, and unknown outcome separately. Exit zero does not establish business success.
- Bound captured output and report truncation to its private consumer. Raw output and arbitrary text extracted from it remain private by default. Schema validation does not make process-supplied text secret-free.

## Application responsibilities

- The application owns business eligibility, scope identity, command preparation, and interpretation of process output. Prompt construction and business result schemas do not belong to process execution.
- If the application needs standard input or environment overrides, it supplies those as prepared execution inputs. The execution owner delivers them without interpreting business content.
- The application receives captured output only through a private path. Any public projection is application-owned and must obey its credential and sensitive-data rules.
- A new automatic trigger is an application decision, not recovery of an unfinished attempt. Reading history alone does not authorize another execution.

## Failure behavior

- Invalid requests or history, unreadable history, and failed saves produce actionable errors without exposing secrets or document contents. A failed pre-launch save prevents launch.
- A failed outcome save leaves the persisted attempt unfinished and its persisted outcome unknown. A live observed exit remains an observed exit. Report the persistence failure separately, including failures after acceptance has returned.
- Release the live scope after known nonlaunch, launch failure, observed completion, or loss of observation. Outcome-save failure does not turn an exited process into an active process or require acknowledgement.
- Loss of observation reports an unknown outcome, not termination. Another explicit attempt may overlap an unobserved surviving process. Each later request must still pass admission and save its new attempt before launch.
- On restart, unfinished attempts have unknown or interrupted outcomes. They do not occupy new in-process scopes or replay automatically. Launched processes may outlive the application.
- A user may request another attempt without an acknowledgement ritual. Repetition is not known safe or exactly once. Host effects are not rolled back.

## Shutdown behavior

- Close launch admission before shutdown drains pending saves and launch acquisition. A pre-launch save that finishes after admission closes cannot lead to a launch.
- Join history writes and launch acquisition already begun, and report their failures. Shutdown does not promise to stop independent processes or wait for them to exit.
- End observation without inventing completion. Unfinished persisted attempts remain unknown unless an actual terminal observation was saved. Retired callbacks cannot publish new evidence or start more work.

## Out of scope

- Automatic retry, replay, or resumption; durable reservations; power-loss guarantees; full process supervision; distributed scheduling; business-stage selection; a new query engine.

## Acceptance scenarios

1. A valid request encounters a declined history save. The caller receives an actionable error and no process launches.
2. A valid request saves its attempt before launch and records an observed exit. While it occupies its scope, a second request in that scope does not launch.
3. The application restarts with an unfinished attempt. History reports an unknown or interrupted outcome, launches nothing automatically, and makes no claim that the old process stopped.
4. Two requests arrive in the same scope while the first pre-launch save waits. The second request is rejected, and a request in another scope may proceed.
5. Authorization is revoked or shutdown closes admission while a pre-launch save waits. The save completes, but no process launches. History does not claim a launch occurred.
6. A process exits, but saving its outcome fails. The caller observes the exit and a separate save failure. Persisted history remains unfinished, and the scope is released.
7. A user repeats a request after completion or an unknown outcome. The new request has a different attempt ID and leaves the earlier evidence unchanged.
8. A process emits oversized output. Capture is bounded, and truncation is reported to the private consumer. Sensitive text in otherwise valid structured output remains private by default.
9. Shutdown begins while an independent process runs. Owned writes and launch acquisition drain without a promise to terminate the process. A later callback cannot restart work or restore observation ownership.
