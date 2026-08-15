# Research: the webhook path — App, payloads, relay

Resolves [#17](https://github.com/asmundwien/roadmap/issues/17). Question: everything the server's
webhook funnel needs — a personal GitHub App as the subscription, payload → invalidation mapping,
a relay to localhost with nothing hosted, and delivery semantics honest enough to size the
reconciling poll.

**Verdict up front.** A webhook-only GitHub App with **Issues: Read + Metadata: Read**, subscribed
to `issues`, `sub_issues`, `issue_dependencies`, `label`, `repository`, installed account-wide,
needs exactly **one credential: the webhook secret** — no private key, no client secret. The relay
must be **smee.io + smee-client**: `gh webhook forward` only does repo/org hooks, not App webhooks.
Invalidation is mostly coarse — only `sub_issues` names the parent; `issues` and
`issue_dependencies` payloads carry no parent pointer, so "refetch the repo's maps" is the rule,
not the fallback. The reconciler is load-bearing: GitHub never auto-retries, deliveries can arrive
out of order, and smee.io silently drops payloads (while telling GitHub "200 OK") whenever the
laptop's client is disconnected. Details and citations below.

All claims are from primary sources — docs.github.com, the GitHub changelog, GitHub's own OpenAPI
description (`github/rest-api-description`, which generates the webhook docs), and the source code
of `probot/smee.io`, `probot/smee-client`, and `cli/gh-webhook` — gathered 2026-08-15.

---

## 1. The App — registration, permissions, subscriptions, credentials

**A personal account can own a GitHub App.** "You can register a GitHub App … under your personal
account" — Settings → Developer settings → GitHub Apps → New GitHub App (form at
<https://github.com/settings/apps/new>). The webhook is part of the registration form: an "Active"
checkbox, the webhook URL, and an optional (but "highly recommended") webhook secret.
Docs: <https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app>.

**Permissions — Issues: Read + Metadata: Read covers all five events.** Per the events reference
(<https://docs.github.com/en/webhooks/webhook-events-and-payloads>), each event states its gate:

- `issues` — "at least read-level access for the 'Issues' repository permission".
- `sub_issues` — Issues: Read.
- `issue_dependencies` — Issues: Read.
- `label` — Metadata: Read (mandatory for every App anyway).
- `repository` — Metadata: Read.

**`issue_dependencies` is real and GA.** Changelog 2025-08-21: "Issue dependencies are fully
supported in the API and webhooks"; max 50 linked issues per relationship type —
<https://github.blog/changelog/2025-08-21-dependencies-on-issues/>.

**Event subscriptions to tick** (actions per the same events reference):

- `issues` — actions: `assigned`, `closed`, `deleted`, `demilestoned`, `edited`, `field_added`,
  `field_removed`, `labeled`, `locked`, `milestoned`, `opened`, `pinned`, `reopened`,
  `transferred`, `typed`, `unassigned`, `unlabeled`, `unlocked`, `unpinned`, `untyped`.
- `sub_issues` — `parent_issue_added`, `parent_issue_removed`, `sub_issue_added`,
  `sub_issue_removed`.
- `issue_dependencies` — `blocked_by_added`, `blocked_by_removed`, `blocking_added`,
  `blocking_removed`.
- `label` — `created`, `edited`, `deleted`; `edited` fires on rename and carries
  `changes.name.from` (verified in the payload schema:
  <https://raw.githubusercontent.com/octokit/webhooks/main/payload-schemas/api.github.com/label/edited.schema.json>),
  so a rename of `wayfinder:map` is detectable with the old name.
- `repository` — `archived`, `created`, `deleted`, `edited`, `privatized`, `publicized`,
  `renamed`, `transferred`, `unarchived`; worth having for map identity/reachability (rename,
  delete, transfer, archive).

**One webhook, one URL, App-wide.** A GitHub App has a single app-level webhook config that fires
for all repos it is installed on; there is no per-installation URL, and the webhook can be turned
off entirely if unused —
<https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps>.
(The 20-webhook cap people cite applies to repository/organization hooks, not the App webhook.)

**Install account-wide.** Settings → Developer settings → GitHub Apps → Edit → Install App → choose
the account → "All repositories" —
<https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app>. Honest nuance:
current docs no longer spell out "current and future repositories" verbatim; mechanically the
installation stores `repository_selection: "all"` (OpenAPI `installation.repository_selection`),
new-repo coverage is signalled by an `installation_repositories` delivery with action `added`
(<https://docs.github.com/en/webhooks/webhook-events-and-payloads#installation_repositories>), and
the closest doc sentence is "If the GitHub App creates any repositories later, the app will
automatically be granted access to those repositories as well"
(<https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps>).
Do a one-off empirical check when wiring up: create a repo, watch for the delivery.

**Minimum credential set: the webhook secret, nothing else.**

- Private key — not needed. It exists solely "to make requests to the GitHub API as the
  application itself", generated on demand after registration —
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps>.
  Reads stay on the existing PAT, so no key is ever generated.
- Client secret — not needed. Only required for exchanging OAuth codes for user access tokens —
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app>.
- Webhook secret — the one to set. Signature arrives as `X-Hub-Signature-256: sha256=<hmac-hex>`
  over the payload body; the header is absent if no secret is configured (`X-Hub-Signature` SHA-1
  exists "only for legacy purposes") —
  <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>.
- Consequence flagged now, expanded in §4: the redelivery **API** for App webhooks requires an App
  JWT — i.e. a private key. A webhook-secret-only App can redeliver via the settings UI but not
  via API. The reconciler makes that acceptable.

## 2. Payloads → invalidation

Schemas verified against GitHub's OpenAPI description
(<https://raw.githubusercontent.com/github/rest-api-description/main/descriptions-next/api.github.com/api.github.com.json>,
webhook keys `issues-*`, `sub-issues-*`, `issue-dependencies-*`) — octokit/webhooks does not yet
ship schemas for `sub_issues`/`issue_dependencies`, so the OpenAPI file is the source of truth.

**The central fact: only `sub_issues` names the parent.** The `issue` object in `issues`-event
payloads includes `sub_issues_summary` (`{total, completed, percent_completed}`) and
`issue_dependencies_summary`, but **no `parent` object and no `parent_issue_url`** (the REST
`issue` component has `parent_issue_url`; the `issues`-webhook inline issue schema does not). So a
delivery for a ticket cannot identify its map from the payload alone.

Per event:

- **`issues`** — payload: `action`, `issue` (full object: `number`, `state`, `state_reason`,
  `labels`, `body`, summaries…), `repository` (with `full_name`), `sender`; plus `label` on
  `labeled`/`unlabeled`, `changes.title.from`/`changes.body.from` on `edited`,
  `changes.new_issue`/`changes.new_repository` on `transferred` (fires in the old repo, names the
  destination). Invalidation: if `issue.labels` contains `wayfinder:map`, the touched map is
  `repository.full_name#issue.number` — precise. Otherwise the issue is (maybe) a ticket of some
  map in that repo → **coarse: refetch all known maps in `repository.full_name`**.
- **`sub_issues`** — `sub_issue_added`/`sub_issue_removed` carry `parent_issue` +
  `parent_issue_id` (required) with top-level `repository` = the parent's repo, plus `sub_issue` +
  `sub_issue_repo`; `parent_issue_added`/`parent_issue_removed` mirror it (`sub_issue` required,
  `parent_issue_repo` for the other side). Both sides are full issue objects. Invalidation:
  **precise when the parent is the map** — `repository.full_name#parent_issue.number`. Sub-issues
  nest up to eight levels (<https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues>)
  and can cross repos/orgs (<https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/>),
  but wayfinder maps are one level deep, so treating the parent as the map is correct for our own
  data; if the parent isn't a known map, fall back to coarse.
- **`issue_dependencies`** — `blocked_by_*` carry `blocked_issue` (+ top-level `repository` as its
  repo) and `blocking_issue` + `blocking_issue_repo`; `blocking_*` mirror with
  `blocked_issue_repo`. Note the `*_issue` fields are technically not in the schema's `required`
  list. Dependencies connect tickets, never the map, and no parent pointer exists → **always
  coarse: refetch the repo's maps** (both repos, for a cross-repo edge).
- **`label`** — `edited` with `changes.name.from == "wayfinder:map"` or `deleted` with
  `label.name == "wayfinder:map"` → the repo's maps just changed identity → refetch discovery for
  that repo. `created` and unrelated labels: noise.
- **`repository`** — `renamed` (payload `repository.full_name` is already the new name;
  `changes.repository.name.from` holds the old —
  <https://raw.githubusercontent.com/octokit/webhooks/main/payload-schemas/api.github.com/repository/renamed.schema.json>),
  `deleted`, `transferred`, `archived`, `privatized` → remap or drop that repo's maps.
  `publicized`/`unarchived`/`edited`: at most cosmetic.

**Live discovery works.** A brand-new repo's first `wayfinder:map` issue produces `issues.opened`
and `issues.labeled` deliveries (both, when the label is applied at creation); the `labeled`
payload includes the `label` object with `name`, so matching `wayfinder:map` and registering
`repository.full_name#issue.number` as a new map needs nothing else —
<https://docs.github.com/en/webhooks/webhook-events-and-payloads#issues>. New repos under an
"all repositories" installation deliver from birth (§1).

**Signal vs noise** (for the ledger/graph):

- Signal: `issues` `opened`/`edited`/`closed`/`reopened`/`deleted`/`transferred`/`labeled`/
  `unlabeled`/`assigned`/`unassigned` (claimed-state derives from assignment) and `typed`/`untyped`
  (wayfinder ticket types); all `sub_issues` and `issue_dependencies` actions; `label`
  `edited`/`deleted` when the wayfinder label is involved; `repository`
  `renamed`/`deleted`/`transferred`/`archived`/`privatized`.
- Noise, drop on arrival: `issues` `pinned`/`unpinned`, `locked`/`unlocked`,
  `milestoned`/`demilestoned`, `field_added`/`field_removed`; `label.created`; `repository`
  `publicized`/`unarchived`/`edited`.

Since deliveries are only invalidation signals, misclassifying noise as signal costs one GraphQL
refetch (~2 points, §github-api-primitives) — err on the side of signal.

## 3. The relay — smee.io wins by default

**`gh webhook forward` cannot forward App webhooks — disqualified.** "Webhook forwarding in the
GitHub CLI only works with repository and organization webhooks. If you want to test other types of
webhooks locally, you'll need to do this manually" —
<https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/using-the-github-cli-to-forward-webhooks-for-testing>.
The source confirms: it POSTs `repos/{repo}/hooks` or `orgs/{org}/hooks` (a special `"name":"cli"`
hook whose creation response includes a `ws_url` it then dials) and has no App path —
<https://github.com/cli/gh-webhook/blob/main/webhook/forward.go>,
`webhook/create_webhook.go`. For the record, it is otherwise the better relay: it forwards the raw
`Body []byte` and all headers verbatim, so `X-Hub-Signature-256` verifies against true raw bytes,
and `--secret` installs the secret in the created hook. But it is per-repo (one forwarder per
repo, "only one person can use webhook forwarding at a time for each repository"), docs-labelled
"only designed for use during testing and development", and it retries a dropped websocket only 3
times before exiting. Since the whole point of the App is one account-wide subscription, this path
is out.

**smee.io + probot/smee-client is the remaining option — and GitHub's own docs demonstrate it**
(<https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/testing-webhooks>).
There is no other first-party relay; the testing docs offer exactly these two paths.

- Mechanics: create a channel (visit <https://smee.io> or `HEAD https://smee.io/new` → `Location`
  header; channel id = 12 random bytes base64url —
  <https://github.com/probot/smee.io/blob/main/lib/server.js>), paste the channel URL as the App's
  webhook URL, run `smee --url https://smee.io/<channel> --port <port> --path /webhook` locally.
  The client subscribes over Server-Sent Events and re-POSTs each payload to localhost —
  <https://github.com/probot/smee-client>.
- Headers survive: the server relays `{...req.headers, body, query, timestamp}` — all original
  headers including `x-hub-signature-256`, `x-github-event`, `x-github-delivery` — and the client
  forwards them all except `host` (deleted) and `content-length`/`content-type` (recomputed) —
  smee.io `lib/server.js`, smee-client `index.ts` (`#onmessage`).
- **HMAC caveat — raw bytes are NOT preserved.** smee.io's fastify parses the JSON body, the SSE
  frame is `JSON.stringify`'d, and the client re-serializes: `const body =
  JSON.stringify(data.body)` before POSTing — smee-client `index.ts`. The forwarded
  `X-Hub-Signature-256` was computed by GitHub over the original bytes, so local verification
  succeeds only when the parse→stringify round-trip is byte-identical (compact JSON, key order,
  unicode escaping, numbers ≤ 2^53). Verification must therefore be **best-effort**: verify, log
  mismatches, but design so a forged delivery is harmless anyway — it can only trigger a
  rate-limited refetch through the already-authenticated GraphQL client, never data ingestion.
  That is exactly what "deliveries are invalidation signals" buys.
- **Offline = silent loss.** "Webhook payloads are never stored on the server, or in any database;
  the Smee.io server is simply a pass-through" delivering only to "actively connected clients" —
  <https://github.com/probot/smee.io> README. Worse: the server returns 200 to GitHub
  unconditionally (`reply.status(200).send()` in `lib/server.js`), so GitHub's delivery log shows
  **success** even when no client was listening — missed deliveries are invisible to redelivery
  tooling. The reconciler is the only net.
- Security posture: "channels are not authenticated, so if someone has your channel ID they can
  see the payloads being sent"; "intended for use in development, not for production" — smee.io
  README. 96-bit channel ids are unguessable in practice, but treat payload contents as
  potentially public (they're issue metadata from repos the App covers) and treat inbound POSTs as
  forgeable (hence best-effort HMAC + harmless-by-design invalidation). Self-hosting exists if
  this ever rankles: `docker run -p 3000:3000 ghcr.io/probot/smee.io` — smee.io README.

## 4. Delivery semantics — why the reconciler is load-bearing

- **Ordering: none.** "GitHub may deliver webhooks in a different order than the order in which
  the events took place" —
  <https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks>.
  Fine here: invalidation is idempotent and the refetched snapshot is the truth.
- **Dedup key exists:** `X-GitHub-Delivery` is unique per event and stable across redeliveries —
  <https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks>.
- **No automatic retries.** "GitHub does not automatically redeliver failed deliveries" —
  <https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries>. A
  failed/timed-out delivery just sits in the log.
- **Redelivery:** manual via App settings → Advanced → Recent deliveries
  (<https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks>),
  or via REST — `GET /app/hook/deliveries` + `POST /app/hook/deliveries/{id}/attempts` — but both
  endpoints state "You must use a JWT to access this endpoint"
  (<https://docs.github.com/en/rest/apps/webhooks>), i.e. they need the App private key our
  webhook-secret-only App deliberately doesn't have. Retention is short anyway: "All deliveries
  from the past 3 days will be listed" (redelivering-webhooks page). So API redelivery is not part
  of the design; the reconciler covers it.
- **10-second rule:** "Your server should respond with a 2XX response within 10 seconds of
  receiving a webhook delivery" — best-practices page. The local server should ACK immediately and
  refetch asynchronously (also: "webhook deliveries can take a few minutes to be delivered" —
  troubleshooting page — so sub-second UI latency is the common case, not a guarantee).
- **Offline laptop:** GitHub → smee.io succeeds (200 regardless), smee.io → nobody. Nothing is
  buffered, nothing is marked failed, nothing is retried. "If your server goes down, you should
  redeliver missed webhooks once your server is back up" (best-practices) — which we can't do via
  API (no JWT) and mostly can't even see (smee reports success). **Conclusion confirmed: a
  reconciling poll on the existing GraphQL map query, plus a full sweep on server start and on
  smee reconnect, is required and sufficient** — every gap (missed, dropped, out-of-order, forged,
  unverifiable) converges to "the poll refetches the truth".

## 5. Recommended funnel

1. **Register** the App at <https://github.com/settings/apps/new>: permissions Issues: Read +
   Metadata: Read; subscribe `issues`, `sub_issues`, `issue_dependencies`, `label`, `repository`;
   webhook URL = smee channel; set a webhook secret; generate no private key, no client secret.
2. **Install** on `asmundwien`, All repositories — new repos deliver from birth
   (`installation_repositories` confirms coverage changes).
3. **Relay**: `smee-client` as a child process of the local server, POSTing to it on localhost.
   On SSE reconnect, trigger a reconcile.
4. **Invalidate**: map issue named in payload (`issues` on a `wayfinder:map`-labelled issue;
   `sub_issues` whose parent is a known map) → refetch that map. Anything else issue-shaped in a
   repo with known maps → refetch that repo's maps. `issues.labeled` with `wayfinder:map` on an
   unknown issue → new map, register + fetch. `label`/`repository` signal actions → rerun
   discovery for that repo. Dedup on `X-GitHub-Delivery`; ACK within 10s, work async.
5. **Verify** `X-Hub-Signature-256` best-effort (smee re-serialization can break it); a delivery
   that fails verification may still trigger a rate-limited refetch — refetching is always safe.
6. **Reconcile**: keep the existing poll at a stretched interval (webhooks make it a safety net,
   not the engine), plus baseline sweep on start and on relay reconnect. That closes every gap in
   §4 with zero dependence on GitHub-side redelivery.
