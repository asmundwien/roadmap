# GitHub API primitives

Roadmap reads only explicitly registered GitHub repositories. A GitHub Connection uses the public
GitHub App device flow, stores its credential bundle in macOS Keychain, and sees repositories from
that App's selected installations. The browser receives neither credentials nor GitHub API
responses.

The authorization and event-delivery decision lives in [Choose GitHub authorization and event
delivery](https://github.com/asmundwien/roadmap/issues/41). The Connection lifecycle lives in
[GitHub Connections: device authorization and Keychain
lifecycle](https://github.com/asmundwien/roadmap/issues/49).

## Repository access

Project admission inspects the selected local Git worktree and derives its repository from the
`origin` remote. Connection-bound provider access proves the App account and stable repository ID;
Workspace inspection separately proves the worktree belongs to that repository. Admission shares
one authorized provider access result across those checks. The SourceObserver receives refined
source access and does not repeat admission preflight. The browser neither lists nor selects
repositories. Later Workspace failure or canonical path collision denies host actions without
discarding independently valid remote source access.

Roadmap does not search an account for Wayfinder maps. Each committed Project registration names
one stable repository ID. Reconciliation fetches that repository by ID, then reads its
`wayfinder:map` issues:

```http
GET /repositories/{repository_id}
GET /repos/{owner}/{repo}/issues?state=all&labels=wayfinder%3Amap&per_page=100&page={page}
```

Repository renames therefore update display data and source links without changing the Project
route key.

Official references:

- [List repositories accessible to the user access
token](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-user-access-token)
- [Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)
- [List repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues)

## Reading one map

One GraphQL request fetches a map, its child tickets, and every visible blocked-by edge. Roadmap
aliases up to ten registered map issues into one request. GitHub caps a connection page at 100
nodes, so the response records truncation instead of pretending a partial graph is complete.

```graphql
fragment MapFields on Issue {
  number
  title
  url
  state
  updatedAt
  closedAt
  body
  subIssuesSummary { total completed percentCompleted }
  subIssues(first: 100) {
    totalCount
    pageInfo { hasNextPage }
    nodes {
      number
      title
      url
      state
      stateReason
      createdAt
      closedAt
      body
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login avatarUrl url } }
      blockedBy(first: 50) {
        totalCount
        nodes { number title url state repository { nameWithOwner } }
      }
    }
  }
}
```

GitHub also exposes the same relationships through REST:

- [List sub-issues](https://docs.github.com/en/rest/issues/sub-issues#list-sub-issues)
- [List dependencies an issue is blocked
by](https://docs.github.com/en/rest/issues/issue-dependencies#list-dependencies-an-issue-is-blocked-by)
- [GraphQL Issue object](https://docs.github.com/en/graphql/reference/objects#issue)

## Polling and rate limits

Each GitHub Connection has its own API client, conditional REST cache, and rate budget. Per-source
SourceObservers share a Connection worker in `github/observer.ts`. The pool polls active admitted
sources every 30 seconds, doubles the interval below 2,000 remaining GraphQL points, quadruples it
below 1,000, and multiplies it by eight below 300. Operational failures also back off, up to five
minutes. Manual refresh of an active Project reconciles the active sources sharing its Connection,
not every Connection. A pending source refresh reads only that source.

The client resolves the current server-owned token before every provider request. It retains its
conditional cache while that token is unchanged. Rotation creates a separate cache, and a response
still in flight under the previous token cannot overwrite the current cache. Failed token resolution
starts no provider request. These failures retain credential-stage provenance even when their cause
is a network or malformed response. Classified failures retain their safe meanings; raw exceptions
and credentials do not enter source evidence.

REST conditional requests replay the cached body on `304 Not Modified`. GraphQL responses include
`rateLimit { cost remaining limit resetAt }`, which drives Connection pacing. Map requests batch up
to ten aliases; response refinement preserves successful aliases while recording failed aliases
and incomplete membership separately. Failure retains prior content and its successful-read time,
not a fresh empty graph.

The committed source topology controls cross-repository blocker resolution. Current repository
names resolve to opaque registered Project keys; a repository rename changes presentation and
source links without changing identity. Pending candidates do not alter active topology. An
unchanged source owner survives unrelated configuration changes.

The coordinator's separate 30-second recovery supervises only committed GitHub sources whose
operational source-access failure left them without verified observer input. Authorization-required,
rejected-credential, and account-mismatch failures do not enter that operational retry. After
admission, the SourceObserver pool owns polling and failure recovery.

GitHub polls and Local filesystem observations enter the same notification Change feed as committed
scoped evidence. Failed reads and incomplete membership retain comparison history. Source changes
establish a quiet baseline only for the affected Project; they do not fabricate Wayfinder activity.
Automation consumes committed observations directly, not notification events.

Official references:

- [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [GraphQL rate limits and node
limits](https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api)
- [REST API conditional request best
practice](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate)

## Security boundary

`ROADMAP_GITHUB_APP_CLIENT_ID` and `ROADMAP_GITHUB_APP_SLUG` are public App identifiers. Access and
refresh tokens, expiry timestamps, and authorization details stay in a server-owned Keychain
bundle. They are not representable in `roadmap.config.json`, `ApplicationState`, transport
envelopes, health output, browser storage, URLs, or logs.

Roadmap no longer supports personal access tokens, account-wide discovery, webhook delivery, or a
Smee relay. Polling is the only GitHub observation mechanism.
