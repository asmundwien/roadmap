# Research: watching local directories on macOS — fs.watch vs chokidar

Resolves [#34](https://github.com/asmundwien/roadmap/issues/34). Question: how should the server
watch ~1–5 registered project directories' `.wayfinder/` subtrees of markdown on macOS — Node's
built-in recursive `fs.watch`, chokidar, or something else?

**Verdict up front: built-in `fs.watch(dir, { recursive: true })`, zero dependencies — but only
because the adapter treats the watcher as a dumb dirty-signal.** On darwin, recursive `fs.watch`
is FSEvents-backed and reliably *fires* for every mutation shape we care about (verified live,
§2), but its event vocabulary is useless: everything arrives as `'rename'`, atomic-write swaps
emit duplicates, and pre-watch events can leak in. So: never interpret `eventType` or diff on
`filename` — any event just marks the directory dirty, a trailing-edge debounce (~250ms, capped)
coalesces bursts, and the refresh re-reads the `.wayfinder/` tree from disk. Deleted watched
roots emit no `error` and no `close` — the adapter must detect root disappearance itself and
re-attach by polling for the path. chokidar v4/v5 is the fallback if this ever outgrows macOS or
one directory-per-project; @parcel/watcher is overkill (native addon, 12 platform packages).

Live verification was done 2026-08-18 on this machine (macOS, Darwin 25.6.0, Node v26.0.0) with
the experiment in §2. Doc citations are to the Node docs source (`doc/api/fs.md` on `main`,
rendered at <https://nodejs.org/api/fs.html>), the Node issue tracker, the chokidar repo, and the
npm registry.

---

## 1. What Node itself promises on darwin

From the `fs.watch` docs and their Caveats section
(<https://nodejs.org/api/fs.html#caveats>):

- **Backends** ("Availability"): "On macOS, this uses `kqueue(2)` for files and `FSEvents` for
  directories." So watching a *directory* (our case) rides FSEvents; watching a single *file*
  rides kqueue on the inode.
- **Recursive**: `recursive: true` is supported on macOS and Windows (and Linux/AIX/IBMi since
  v19.1.0, <https://github.com/nodejs/node/pull/45098>) — no caveat flag needed for darwin.
- **Honesty about consistency**: "The `fs.watch` API is not 100% consistent across platforms,
  and is unavailable in some situations." The specific Windows caveats (EPERM on watched-dir
  delete, silence on rename) don't apply here.
- **Inodes caveat**: "On Linux and macOS systems, `fs.watch()` resolves the path to an inode and
  watches the inode. If the watched path is deleted and recreated, it is assigned a new inode.
  The watch will emit an event for the delete but will continue watching the *original* inode."
  §2 shows the FSEvents *directory* path behaves better than this in practice — but the docs
  license the worse behavior, so the adapter must not depend on recovery (§4).
- **`filename` may be null**: "even on supported platforms, `filename` is not always guaranteed
  to be provided … have some fallback logic if it is `null`."
- **Event vocabulary**: `eventType` is only `'rename' | 'change'`; "On most platforms, `'rename'`
  is emitted whenever a filename appears or disappears in the directory." (§2: on darwin
  recursive, it's `'rename'` for everything, including in-place content rewrites.)
- **`fs.watchFile`**: stat-polling, explicitly "slower and less reliable" per the Availability
  caveat — only worth it on network filesystems. Not our case.
- Newer conveniences: `throwIfNoEntry` (v24.16.0+/v26.1.0+,
  <https://github.com/nodejs/node/pull/61870>) and an `ignore` option exist on current `main`
  docs; neither is needed here and the `ignore` option is too new to lean on.

Known darwin issues in the tracker, all consistent with "fires reliably, reports coarsely":

- **Pre-watch event leak / startup race**: "On macOS, fsevents generated **before** the watcher
  was started may be emitted" — acknowledged in Node's own test-suite refactor
  (<https://github.com/nodejs/node/commit/4f82673139>), and the companion problem — you cannot
  know *when* the FSEvents stream has actually started — was filed as
  <https://github.com/nodejs/node/issues/52601> and closed 2026-06 as stale/not-planned, i.e.
  still real. Mitigation: always do a full initial read *after* creating the watcher, and treat
  early events as ordinary dirty signals (they just trigger a redundant re-read).
- **Single-file watching is genuinely broken for content changes**
  (<https://github.com/nodejs/node/issues/28882>, kqueue path): another reason to watch the
  directory, never individual markdown files.
- **Watcher-count limits** (EMFILE around a few thousand watchers,
  <https://github.com/nodejs/node/issues/43267>): irrelevant at our 1–5 recursive watchers —
  one FSEvents stream covers a whole subtree.

## 2. Live verification (Node v26.0.0, this Mac)

One recursive watcher on a temp root containing `.wayfinder/`, exercised with the ticket's exact
failure modes. Full event log reproduced from the run; timings in ms.

| Action | Events observed |
| --- | --- |
| (before `watch()` returned) | `rename wt`, `rename .wayfinder` — **pre-watch creation events leaked in** (§1's startup race, confirmed) |
| Plain new file `a.md` | 1× `rename .wayfinder/a.md` — an *add* is `'rename'` |
| In-place rewrite of `a.md` | 1× `rename .wayfinder/a.md` — a pure *content change* is **also `'rename'`**; `'change'` never appeared in the entire run |
| Atomic write (write `.a.md.tmp`, `rename(2)` over `a.md`) | `rename .a.md.tmp`, then `rename a.md` **twice** — the tmp file surfaces, and the target gets a duplicate event |
| Burst: 5 files written in one tick | 5 events, all delivered in the same millisecond — one per file, no loss |
| `rm -r .wayfinder` (watched subtree) | 6 per-file/dir `rename` events + `rename .wayfinder` — deletes fire per-entry |
| `rm -r` the **watched root itself** | 1× `rename wt`. **No `error`, no `close`** — the watcher object stays open and silent |
| Recreate root + write a file | `rename wt`, `rename .wayfinder`, `rename .wayfinder/c.md` — on this Node/macOS the FSEvents stream is path-based and **kept reporting after the root returned** |
| `watch()` on a missing path | throws `ENOENT` synchronously |

Readings:

- **Reliability: good.** Every mutation shape — add, in-place edit, atomic swap, burst, delete —
  produced at least one event. Nothing was missed.
- **Semantics: worthless.** `'rename'` vs `'change'` carries no signal on darwin-recursive
  (everything is `'rename'`), atomic swaps produce tmp-file noise plus duplicates, and pre-watch
  events leak. Any design that diffs on event type/filename is built on sand; a design that only
  says "this root is dirty" is immune to all of it.
- **Deleted root: silent, not fatal.** No error path exists to hook. Recovery-on-recreate *did*
  work here (FSEvents watches the path, not the inode), but the documented Inodes caveat (§1)
  promises the opposite, so treat observed recovery as a bonus, not a contract.

## 3. The candidates

| | built-in `fs.watch` recursive | chokidar | @parcel/watcher |
| --- | --- | --- | --- |
| Deps added | 0 | v4: 1 (`readdirp`), ~145KB unpacked; v5 (2025-11): ESM-only, Node ≥ 20.19, ~82KB + readdirp | native C++ addon, 4 deps + **12** per-platform prebuild packages (npm registry, v2.6.0) |
| macOS backend | FSEvents (directories) | plain `fs.watch`/`fs.watchFile` — **v4 dropped the `fsevents` optional dep entirely** (npm: v3.6.0 had `optionalDependencies: { fsevents }`, v4.0.3/v5.0.0 have none) | its own FSEvents binding |
| What it adds | — | normalized `add/change/unlink(Dir)` events, `atomic` tmp-file filtering (default on, 100ms), `awaitWriteFinish` stabilization, `ignored`, cross-platform recursion (README: <https://github.com/paulmillr/chokidar>) | snapshots + `getEventsSince`, watchman integration; used by VS Code, Nx, Nuxt (README: <https://github.com/parcel-bundler/watcher>) |
| Maintenance | Node core | active (v5.0.0 Nov 2025; ~30M dependent repos per npm) | active (v2.6.0, 2026-07) |

chokidar exists precisely to paper over the §2 semantics — its README's pitch is "events are
properly reported": macOS filenames, no duplicated events, `add/change/unlink` instead of raw
`rename`, atomic-write and chunked-write handling. All true, and all **unnecessary once the
consumer doesn't read per-file semantics at all**. Our adapter feeds a coalescing invalidation
that re-reads the `.wayfinder/` tree wholesale (same shape as the server's existing
snapshot-refetch habit) — so normalized event names buy nothing, and the one real gap chokidar
would *not* close (silent watched-root deletion needs supervision either way — chokidar reports
`unlinkDir` but likewise won't re-attach a vanished root by itself as a watched root) still needs
the same handling. @parcel/watcher's native prebuilds are the heaviest possible answer to the
lightest possible workload.

## 4. Recommendation for the local adapter

1. **Watcher**: one `fs.watch(projectDir + '/.wayfinder', { recursive: true })` per registered
   project (1–5 total). No dependency. Watch the directory, never individual files (kqueue file
   watching is the broken path, §1). Node ≥ 20 on darwin is all it needs; if a Linux/exotic-FS
   deployment ever appears, swapping in chokidar v4/v5 behind the same seam is the escape hatch.
2. **Event handling**: ignore `eventType` and `filename` entirely — every callback invocation
   (and any `filename: null`) means "this project is dirty". This single decision neutralizes
   rename/change ambiguity, atomic-swap tmp noise, duplicate events, and startup leaks at once.
3. **Debounce shape**: per-project trailing-edge debounce — reset a ~250ms timer on every event,
   fire when quiet; add a max-wait cap (~2s) so a long-running agent edit stream still yields
   intermediate refreshes. §2 showed a 5-file burst lands within 1ms and an atomic swap within
   1ms — 250ms coalesces both into one invalidation. On fire, emit one dirty-project token into
   the existing coalescing invalidation; the refresh re-reads the tree from disk (the disk is the
   source of truth, events are only the doorbell). This mirrors chokidar's own `atomic: 100ms`
   and `awaitWriteFinish.pollInterval: 100ms` defaults, with margin.
4. **Deleted/renamed root**: supervise, don't trust. Wrap each watcher: on `'error'`, on
   `ENOENT` at creation, and on a debounced event whose follow-up `stat` of the root fails,
   `close()` the watcher and enter a retry loop (poll `existsSync` every ~2s, bounded backoff);
   when the path returns, create a fresh watcher **then** immediately mark the project dirty
   (full re-read — never assume events covered the gap; §1 startup race). Observed FSEvents
   recovery-in-place (§2) makes this rarely needed on macOS, but the docs' Inodes caveat means
   the supervisor is the contract and the observed recovery is just luck we don't cash.
5. **Truncation honesty**: a project whose `.wayfinder/` root is currently missing surfaces as
   `unreachable` in the snapshot rather than silently vanishing — same partial-data habit as the
   GitHub side.
