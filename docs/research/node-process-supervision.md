# Research: supervising configurable agent processes on Node.js and macOS

Resolves [#60](https://github.com/asmundwien/roadmap/issues/60) for [Roadmap v7](https://github.com/asmundwien/roadmap/issues/53).

**Verdict:** Node 22 can directly launch one executable, observe its direct child while Roadmap lives, continuously drain bounded output, and stop a dedicated process group. It cannot guarantee arbitrary descendants remain in that group, cleanup after a crash, or that persisted PID/PGID still identifies the Run after restart. On restart, every durably active Run must become **interrupted / ownership uncertain**; Roadmap must never signal its persisted PID alone and must require acknowledgement before resuming that Project lane.

Investigated against Node.js **v22.23.2** docs/source and its libuv, Apple/Darwin XNU source, Apple macOS manuals, and POSIX.1-2024 Issue 8.

## Reliable guarantees

### Direct launch and live lifecycle

Use `spawn(executable, args, { cwd, env, shell: false })`. Node documents `shell: false` as the default and accepts argv separately, so no shell interprets metacharacters, expansion, redirection, or quoting ([API](https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processspawncommand-args-options), [source handoff](https://github.com/nodejs/node/blob/v22.23.2/lib/child_process.js#L599-L787)). A `spawn` event proves OS launch, not harness initialization; `error` reports launch failure. A bare executable may be PATH-resolved, so durable command identity must remain executable plus argv, never a reconstructed command string.

While the owner lives, `exit` supplies code or terminating signal; `close` follows process termination **and** stdio closure. Source emits exit, drains untouched stdio, and emits close after close accounting ([events](https://nodejs.org/docs/latest-v22.x/api/child_process.html#event-close), [implementation](https://github.com/nodejs/node/blob/v22.23.2/lib/internal/child_process.js#L269-L303), [accounting](https://github.com/nodejs/node/blob/v22.23.2/lib/internal/child_process.js#L1096-L1103)). Finalize output and release the Project lane on `close`, never on tracker mutation or merely `exit`.

This guarantee dies with the parent. `waitpid` obtains terminal status only for the caller's child ([POSIX](https://pubs.opengroup.org/onlinepubs/9799919799/functions/wait.html), [Apple](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html)). POSIX reparents survivors to an implementation-defined system process; Apple says PID 1. A restarted Node server cannot recover the old `ChildProcess` handle or exit status.

### Bounded output without deadlock

Node's default stdout/stderr pipes have finite platform-specific capacity; an undrained writer blocks ([warning](https://nodejs.org/docs/latest-v22.x/api/child_process.html#child-process)). Therefore a history cap must never pause readers. Drain stdout and stderr independently through EOF while retaining fixed-size tails/rings, byte totals, and truncation flags.

For stdin, stop when `write()` returns false, await `drain`, then `end`. Node warns that ignoring writable backpressure buffers until maximum memory and can abort; `highWaterMark` is a threshold, not a hard cap ([write](https://nodejs.org/docs/latest-v22.x/api/stream.html#writablewritechunk-encoding-callback), [buffering](https://nodejs.org/docs/latest-v22.x/api/stream.html#buffering)). Continuous consumption prevents Roadmap-caused pipe deadlock; only the explicit ring bounds retained history.

### Process group and stopping

On macOS `detached: true` makes the child leader of a new session and process group. Node's libuv requests `POSIX_SPAWN_SETSID`, falling back to fork/exec plus `setsid()` where needed ([Node](https://nodejs.org/docs/latest-v22.x/api/child_process.html#optionsdetached), [libuv macOS](https://github.com/nodejs/node/blob/v22.23.2/deps/uv/src/unix/process.c#L490-L523), [fallback](https://github.com/nodejs/node/blob/v22.23.2/deps/uv/src/unix/process.c#L300-L320)). POSIX says `setsid()` makes PGID equal PID ([spec](https://pubs.opengroup.org/onlinepubs/9799919799/functions/setsid.html)). `kill(-pid, signal)` targets that group ([POSIX](https://pubs.opengroup.org/onlinepubs/9799919799/functions/kill.html), [Apple](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html)). `child.kill()` targets only the direct PID ([libuv](https://github.com/nodejs/node/blob/v22.23.2/deps/uv/src/unix/process.c#L1096-L1108)); do not use it for group stop, and do not `unref()` the owned child.

Orderly stop is: mark stopping and retain lane; send SIGTERM to `-pid`; keep draining and wait a fixed grace interval for `close`; if needed send SIGKILL to `-pid`; await `close`; record terminal facts; release lane. SIGTERM is cooperative—installing a listener removes Node's default exit—and `subprocess.killed` means only “signal sent,” not terminated ([signals](https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events), [killed](https://nodejs.org/docs/latest-v22.x/api/child_process.html#subprocesskilled)). SIGKILL cannot be caught or ignored ([Apple sigaction](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/sigaction.2.html)). Signal-send success is not terminal proof; live `close` is.

**Unreliable boundary:** a descendant can call `setsid()`/`setpgid()` and escape. A process group is membership, not an immutable descendant tree. Stop covers the direct child and descendants that remain in the group, not arbitrary/adversarial harness containment. Group-signal success also does not prove every member exited.

### Shutdown and crash

Handle SIGINT/SIGTERM for orderly shutdown, but cleanup hooks are best effort. Node `exit` listeners can perform synchronous work only; `beforeExit` is absent for explicit termination and uncaught exceptions; SIGKILL is unconditional. Node says an uncaught exception leaves undefined state and permits only synchronous cleanup ([exit](https://nodejs.org/docs/latest-v22.x/api/process.html#event-exit), [exception warning](https://nodejs.org/docs/latest-v22.x/api/process.html#warning-using-uncaughtexception-correctly), [signals](https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events)). Power loss, SIGKILL, native crash, or abrupt failure may leave the detached group alive and durable state “running.” Correctness must model that interruption rather than assume cleanup.

## PID identity, reuse, and restart

A PID is recyclable, not durable identity. Darwin increments PIDs, wraps at `PID_MAX`, and finds an unused value; separately it increments `p_uniqueid` and PID version ([XNU allocator](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_fork.c#L918-L985)). XNU says unique ID is incremented on fork/spawn/vfork and stable across exec ([proc_ro.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_ro.h#L74-L83)); the kernel pairs PID with unique ID to avoid recycled-PID mistakes ([ktrace](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_ktrace.c#L309-L319)).

Darwin exposes `PROC_PIDUNIQIDENTIFIERINFO` with executable UUID, 64-bit unique ID, parent unique ID, and PID versions ([structure](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h#L42-L55), [fill](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c#L1506-L1515)); BSD info includes start time ([source](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c#L695-L706)). Node exposes neither a durable process handle nor these fields.

Even a native “check `(PID, unique ID)`, then `kill(PID)`” has a time-of-check/time-of-use race: the process may exit and PID recycle before the signal. `kill` accepts PID/PGID, not an identity token. Persisted PGID has the same reuse risk.

Consequences:

- `kill(pid, 0)` proves only that *a* process occupies that PID and is signalable. POSIX explicitly says a parent must use `waitpid`, not null-signal probing, for child termination; restart lost that relationship.
- argv, path, cwd, parent PID, start time, and even unique ID are useful diagnostics, not atomic authority for a later PID signal.
- no observed match proves only absence at that instant; an escaped descendant may remain and the old exit result is unrecoverable.

**Safe restart policy:** persist PID/PGID only as diagnostics. Convert active Runs to interrupted/ownership-uncertain; optionally show inspected candidates, but never automatically kill or resume from persisted IDs. Require acknowledgement before scheduling the lane. This directly avoids signaling an unrelated reused PID and falsely claiming all descendants are gone.

If authoritative cross-restart control becomes required, ownership must move to a persistent external per-run supervisor with a stable named control channel. That deeper mechanism is not warranted by today's local single-user scope.

## Narrowest process-owner interface

    interface ProcessOwner {
      start(spec: ProcessSpec): Promise<OwnedProcess>;
    }
    interface ProcessSpec {
      executable: string;
      args: readonly string[];
      cwd: string;
      env: Readonly<Record<string, string>>;
      stdin?: Uint8Array;
      outputLimitBytes: number;
    }
    interface OwnedProcess {
      readonly pid: number; // live diagnostic; PGID equals PID
      readonly completion: Promise<ProcessCompletion>;
      stop(graceMs: number): Promise<ProcessCompletion>;
    }
    interface ProcessCompletion {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdoutTail: Uint8Array;
      stderrTail: Uint8Array;
      stdoutBytes: number;
      stderrBytes: number;
      stdoutTruncated: boolean;
      stderrTruncated: boolean;
    }

Semantics: `start` always direct-spawns with `shell: false`, `detached: true`, piped output, and resolves on spawn/rejects on error. Output drains concurrently through EOF. `completion` settles once after direct-child termination plus stdio closure. `stop` is idempotent for the live object and performs group TERM → grace → KILL while draining. There is deliberately no `attach(pid)`, `isAlive(pid)`, or `kill(pid)`: each would imply unavailable cross-restart identity guarantees.

## Consequences for Roadmap v7

1. Lane release waits for direct-child `close`, including stop escalation.
2. Active state at startup becomes interrupted/uncertain and blocks continuation pending acknowledgement.
3. Stop promises best-effort group termination for cooperative harness trees, not arbitrary descendant containment.
4. History stores bounded stream tails, totals/truncation, spawn error or exit code/signal, and PID/PGID only as diagnostics.
5. Configuration remains typed executable + argv + cwd/env/stdin substitutions, never a shell string.
6. A server-local ProcessOwner suffices now; introduce a persistent external supervisor only for a future authoritative cross-restart requirement.
