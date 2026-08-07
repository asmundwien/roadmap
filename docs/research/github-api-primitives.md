# Research: reading wayfinder primitives from the browser

Resolves [#2](https://github.com/asmundwien/roadmap/issues/2). Question: can a browser-only Vite/React SPA with a personal access token power a live read-only visualization of wayfinder maps, polling ~30s — with no backend?

**Verdict up front: yes, no backend needed.** CORS is wide open on both REST and GraphQL, a single GraphQL query fetches an entire map (sub-issues + all blocked-by edges) — verified live at a cost of 2 rate-limit points, and one aliased query fetched all three current maps at cost 5. Details and citations below.

All live verification was done 2026-08-07 against `asmundwien/gainstage` (issue #1 = map with 15 sub-issues #2–#16) and `api.github.com`, authenticated as `asmundwien` (classic token, `repo` scope). REST calls were made with `X-GitHub-Api-Version: 2022-11-28`; every response echoed `X-Github-Api-Version-Selected: 2022-11-28` — no preview/experimental headers were needed for sub-issues or dependencies.

---

## 1. Discovery — finding all `wayfinder:map` issues across the user's repos

**Both REST search and GraphQL search work, from the browser, including private repos.**

- REST: `GET /search/issues?q=label:"wayfinder:map" user:asmundwien is:issue`
  Docs: <https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests>. The `is:issue` (or `is:pull-request`) qualifier is required to avoid HTTP 422 under the advanced-search rollout, per that page.
- GraphQL: `search(type: ISSUE, query: "label:\"wayfinder:map\" user:asmundwien is:issue", first: 50) { issueCount nodes { ... on Issue { number state title repository { nameWithOwner isPrivate } } } }`

Query-syntax notes (docs: <https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests>):

- Quote the label because of the colon: `label:"wayfinder:map"` — the docs prescribe quotations around labels with non-word characters ("Use quotations around multi-word search terms… `label:"in progress"`"). Verified live that the quoted form matches.
- `user:asmundwien` scopes to all repos owned by the user ("To search issues and pull requests in all repositories owned by a certain user or organization, you can use the `user` or `org` qualifier").
- **Open and closed are both returned when no `state:` qualifier is given.** The docs don't state the default explicitly, so verified empirically: `user:asmundwien is:issue` → 52 results = `state:open` (28) + `state:closed` (24).

**Live verification:** both the REST and the GraphQL form returned exactly the expected maps — `asmundwien/roadmap#1`, `asmundwien/gainstage#1` (both private, `isPrivate: true` in the GraphQL result), plus `asmundwien/starmap#1`. GraphQL reported `rateLimit.cost: 1`.

Search results only contain resources the token can access ("you will only see results for repositories you have access to" — search docs above), so private-repo discovery works exactly when the token grants repo access (see §4b).

## 2. Sub-issues — reading a map's children

**One request per map suffices, in either API, for maps up to 100 children.**

### REST

`GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues` — docs: <https://docs.github.com/en/rest/issues/sub-issues#list-sub-issues>.

- **Response shape:** "Array of `Issue`" — full issue objects. Verified live against `gainstage#1`: each element carries `number`, `title`, `state`, `labels` (with name/color/description), `assignees`, `body`, plus two fields that matter a lot for this SPA:
  - `sub_issues_summary` — `{total, completed, percent_completed}` (progress for free), and
  - `issue_dependencies_summary` — `{blocked_by, total_blocked_by, blocking, total_blocking}` — **counts only, not which issues**; the actual edges need §3.
  - `parent_issue_url` points back at the map.
- **Pagination:** `per_page` (default 30, max 100) and `page` (docs above). A 15-child map fits in one page with `per_page=100`.
- **Headers:** `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. Verified: returns 200 with full data; no extra opt-in headers.

### GraphQL

`Issue.subIssues` connection plus `Issue.subIssuesSummary { total completed percentCompleted }` — schema reference: <https://docs.github.com/en/graphql/reference/objects#issue>. Verified live via introspection and the query in §3; `subIssues(first: 50)` returned all 15 children with `totalCount`, `pageInfo`, and per-node `state`, `stateReason`, `labels`, `assignees`. Max page size is 100 nodes per connection, per GraphQL resource limits (<https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api>).

## 3. Blocked-by edges — the whole map WITHOUT one request per ticket

**KEY RESULT: yes — GraphQL fetches every edge of a map in a single request.**

### REST (per-issue only)

`GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by` — docs: <https://docs.github.com/en/rest/issues/issue-dependencies#list-dependencies-an-issue-is-blocked-by>. Returns "Array of `Issue`" (full issue objects; verified live: `gainstage#6` → `[issue #2]`), paginated `per_page`/`page` (max 100). But it is inherently one request per issue — ~15 requests per map per poll. Workable within REST limits, yet strictly worse than GraphQL.

### GraphQL (whole map in one request)

The live schema (verified by introspection on 2026-08-07) has dependency fields on `Issue`: `blockedBy`, `blocking`, and `issueDependenciesSummary` — alongside `subIssues`, `subIssuesSummary`, and `parent`. Reference: <https://docs.github.com/en/graphql/reference/objects#issue>. (These fields are schema-recent; anything reading the schema should tolerate their absence on GitHub Enterprise Server.)

This exact query was live-tested against `asmundwien/gainstage`:

```graphql
query WayfinderMap($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      number
      title
      state
      url
      subIssuesSummary { total completed percentCompleted }
      subIssues(first: 50) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          title
          state
          stateReason
          url
          labels(first: 10) { nodes { name color } }
          assignees(first: 5) { nodes { login avatarUrl } }
          issueDependenciesSummary { blockedBy totalBlockedBy }
          blockedBy(first: 20) {
            totalCount
            nodes { number state repository { nameWithOwner } }
          }
        }
      }
    }
  }
  rateLimit { cost remaining limit resetAt }
}
```

**What it returned** (with `owner: "asmundwien", repo: "gainstage", number: 1`): all 15 sub-issues and the complete edge set in one response — #6←#2, #7←#2, #8←#2, #9←#2, #10←#2, #11←{#8,#3}, #12←{#11,#6,#4}, #13←{#11,#5}, #14←{#10,#9,#8,#7,#6}, #15←{#2,#14,#13,#12,#11}, #16←{#15} — including the ticket's known specimen edge #6 → blocked by #2. `rateLimit.cost: 2`.

**It batches across maps, too.** An aliased query with three `repository(...) { issue(number: 1) { ...MapFields } }` blocks fetched all three current maps (15 + 6 + 23 = 44 sub-issues with all their edges) in **one HTTP request at `rateLimit.cost: 5`** — verified live. `blockedBy` nodes carry `repository { nameWithOwner }`, so cross-repo edges are representable and detectable.

## 4. Browser reality

### (a) CORS — clean, everywhere that matters

GitHub's docs: "The REST API supports cross-origin resource sharing (CORS) for AJAX requests from any origin." — <https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests>.

Verified live with `curl -i` on 2026-08-07:

- REST (`/repos/.../sub_issues`, `/repos/.../dependencies/blocked_by`, `/search/issues`): all responses carry `Access-Control-Allow-Origin: *`.
- GraphQL (`POST https://api.github.com/graphql`): response carries `Access-Control-Allow-Origin: *`; the preflight (`OPTIONS` with `Origin: http://localhost:5173`) returns 204 with `access-control-allow-origin: *`, `access-control-allow-methods: GET, POST, PATCH, PUT, DELETE`, `access-control-allow-headers` including `Authorization`, `Content-Type`, `If-None-Match`, `X-GitHub-Api-Version`, and `access-control-max-age: 86400`.
- `Access-Control-Expose-Headers` includes `ETag`, `Link`, and all `X-RateLimit-*` headers, so browser JS can read pagination and budget state.

### (b) Tokens: fine-grained vs classic

- **Fine-grained PAT (recommended):** works for both REST and GraphQL ("You can authenticate to the GraphQL API using a personal access token… For example, select the 'issues:read' permission to read all of the issues in the repositories your token has access to." — <https://docs.github.com/en/graphql/guides/forming-calls-with-graphql#authenticating-with-graphql>). Required repository permissions, per <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>: **"Issues" read** covers `GET .../sub_issues` and `GET .../dependencies/blocked_by` (both listed there under Issues, read); "Metadata" read is included automatically. Grant it access to the wayfinder repos (or all owned repos so newly created maps appear without editing the token). Search only surfaces repos the token can access, so discovery works exactly over the granted set.
- **Classic PAT:** the whole ticket needs just the **`repo`** scope (private repo read implies issue read; verified — all live tests here ran on a classic token with `repo`). Broader blast radius than fine-grained; use only if fine-grained proves awkward.

### (c) Rate limits — three separate pools, all comfortable

- **REST core:** "your personal rate limit of 5,000 requests per hour" — <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>. Verified: `x-ratelimit-limit: 5000`, `x-ratelimit-resource: core`.
- **Search:** its own pool — 30 requests/minute authenticated (<https://docs.github.com/en/rest/search/search#rate-limit>). Verified live: `x-ratelimit-limit: 30`, `x-ratelimit-resource: search`.
- **GraphQL:** its own point pool — "5,000 points per hour" for PAT users, minimum 1 point/query, cost ≈ (connection requests ÷ 100, rounded), plus a secondary limit of "no more than 2,000 points per minute" — <https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api>. Verified: `x-ratelimit-resource: graphql`, and the map query costs 2 points.

**Budget at ~30s polling, 5 projects** (one aliased GraphQL query for all maps): measured cost was 5 points for 3 maps (~1.7/map), so budget ~10 points/poll for headroom × 120 polls/hr = **~1,200 GraphQL points/hr of 5,000 (24%)**, and ~10 points per 30s is nowhere near the 2,000/min secondary limit. Discovery via REST search every 5 min = 12 search calls/hr against a 30/min pool — negligible. REST core stays untouched except for optional extras.

### (d) Conditional requests (ETag/304)

- REST endpoints return ETags — verified on `/sub_issues` and `/dependencies/blocked_by`. Docs: "Making a conditional request does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized with an `Authorization` header." — <https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate>. **Verified live:** two consecutive `If-None-Match` requests to `/sub_issues` returned `HTTP 304` with `x-ratelimit-used` frozen at 91 across both — free polling on the REST side.
- **GraphQL has no equivalent:** the `POST /graphql` response carries no `ETag` header (verified live), and the conditional-request mechanism is documented only for REST. Every GraphQL poll pays its point cost. The `rateLimit { cost remaining resetAt }` field (free to include) is the self-monitoring substitute.
- Caveat: `/search/issues` responses showed **no ETag** either (verified live), so discovery polls can't be made conditional — another reason to poll discovery slowly.

### (e) Token-in-browser posture (local-only SPA)

Practical, for a dev-machine-only tool:

- Inject at dev time via Vite env: put `VITE_GITHUB_TOKEN` in `.env.local` (gitignored by Vite's scaffold; verify), read `import.meta.env.VITE_GITHUB_TOKEN`. The token lives in dev-server memory and the served JS on localhost only. Do not ship a production build anywhere.
- Avoid `localStorage`: it persists indefinitely and is readable by any XSS'd or compromised dependency in the page. Env-injection keeps persistence in a file already treated as secret. (If a paste-your-token UI is ever preferred, keep it in memory/`sessionStorage`.)
- Bound the blast radius regardless of storage: use a **fine-grained, read-only (Issues: read) PAT scoped to only the wayfinder repos, with an expiry**. Then even leakage costs read access to a few repos' issues, not the account.

## 5. Verdict and recommended fetch strategy

**"No backend" is viable.** Nothing forces a proxy: CORS is `*` on REST, GraphQL, and preflights; auth is a header the browser can send; discovery, children, and — decisively — all blocked-by edges batch into single GraphQL requests; budgets are at ~24% of one pool with two other pools idle.

Recommended strategy:

1. **Discovery (slow loop, every ~5 min and on manual refresh):** `GET /search/issues?q=label:"wayfinder:map" user:asmundwien is:issue&per_page=100` → list of `(owner, repo, number, state, title)` for all maps, open and closed, across all accessible repos. 12 calls/hr against the separate 30/min search pool.
2. **Map data (fast loop, every 30s):** one aliased GraphQL query — the `WayfinderMap` fragment from §3 repeated per discovered map under aliases — returning every map's issue, `subIssuesSummary`, up to 100 sub-issues each with `state`, `stateReason`, `labels`, `assignees`, and `blockedBy` edges (with `repository { nameWithOwner }` for cross-repo edges), plus `rateLimit { cost remaining resetAt }` to self-throttle. ~2 points per map, ~1,200 points/hr for 5 maps.
3. **Degradation valve (only if maps multiply):** if `rateLimit.remaining` trends low, stretch the poll interval; below ~30 maps per poll this never triggers. An alternative REST fallback (per-map `/sub_issues` + per-issue `/dependencies/blocked_by` with stored ETags) gets 304s for free when idle, at the price of ~16 requests/map when data changes — keep GraphQL as primary.
4. **Version pinning:** send `X-GitHub-Api-Version: 2022-11-28` on all REST calls (verified selected); no special headers on GraphQL.
