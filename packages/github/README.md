# GitHub

`@roadmap/github` is a private, declaration-only workspace package for GitHub App authorization and explicit REST reads. It defines the provider contract for Roadmap's migration. It does not perform requests yet.

## Package entry point

The root export exposes [`index.d.ts`](index.d.ts) under the `types` condition. Consumers can use `import type` from `@roadmap/github`. There is no JavaScript entry point, runtime import, build output, or implemented `GitHub` value. The declared value describes the intended implementation interface; it is not a callable SDK today.

Run the consumer contract checks with:

```sh
pnpm --filter @roadmap/github typecheck
```

[`interface.typecheck.ts`](interface.typecheck.ts) imports the public package entry point and checks identity distinctions, result variants, readonly collections, and reuse of the canonical issue model. Root `pnpm typecheck` includes this check.

## Resource interface

The following consumer example typechecks against the declarations. It requires an implemented client before it can run.

```ts
import type { GitHubClient, IssueNumber, RepositorySelector } from '@roadmap/github'

async function readMapNavigation(github: GitHubClient, selector: RepositorySelector) {
  return github.repositories.at(selector).issues.list({
    state: 'all',
    labels: ['wayfinder:map'],
  })
}

async function readMapChildren(
  github: GitHubClient,
  selector: RepositorySelector,
  number: IssueNumber,
) {
  return github.repositories.at(selector).issues.at(number).subIssues.list()
}
```

`at` selects an immutable resource without I/O. `get` and `list` fetch fresh data. Handles contain no fetched content or setters. Reading an issue does not fetch children or dependencies. `GitHub.connect({ accessToken })` describes fixed-token client construction; `GitHub.apps.at({ clientId })` describes App protocol selection.

The implementation must capture selectors without retaining mutable caller-owned objects and freeze handles and returned data recursively. TypeScript `readonly` does not enforce runtime immutability.

## Shared models and identity

Every direct issue read, repository issue list, sub-issue list, and blocked-by list returns the same `Issue` type. Relationships contain ordinary issues, not smaller `SubIssue` or `BlockerIssue` variants. Endpoint-specific validation must translate into one canonical model without issuing automatic enrichment requests.

`Issue` contains its body, labels, assignees, tracker state, timestamps, and provider-supplied child and dependency summaries. Summaries distinguish unavailable evidence from known zero. They are not fetched relationship membership. A child-list response already supplies child content; opening a ticket does not require a second read just to obtain that content.

`IssueReference` contains a stable `IssueId`, the repository address observed in the response, its local `IssueNumber`, and a `RepositoryId` or explicit `null`. Preserve repository identity when the provider supplies it or a validated ID-selected read proves it. A name-only response cannot acquire a stable repository identity from an earlier name match. Do not fetch repository metadata implicitly to fill this field.

Separate responses may contain different observations of the same issue. Canonical model reuse does not imply object identity, caching, version agreement, or an atomic snapshot. Use the returned repository address to navigate foreign relationship members. Deduplicate by stable issue ID, not by repository-local number alone; reject conflicting identity evidence.

Brands distinguish account, repository, and issue IDs, issue numbers, and private tokens. `GitHub.values` describes synchronous validation of unknown input without coercion or provider access. Branding does not prove authorization or prevent secret disclosure.

## Operations

- Authorize through GitHub App device flow. Respect polling intervals, slow-down, denial, expiry, and cancellation. Return identified private credentials without saving or registering them.
- Exchange device-flow-origin refresh tokens for replacement credentials without modifying storage. The configured App must enable device flow and expiring user tokens. No client secret is required for this flow.
- Identify the account associated with the client's fixed access token.
- Get a repository by name or stable ID.
- List repository issues with explicit state and label filters, excluding pull requests.
- Get an issue without fetching its relationships.
- List direct sub-issues or blocked-by dependencies, including members in other repositories. No recursive traversal or inverse dependency read is implied.

The package owns REST requests, response validation, and pagination. The caller supplies a usable token and optional cancellation signal. There is no credential loading or automatic refresh.

## Results and completeness

Results distinguish `success`, `failure`, and `cancelled`. Device authorization also distinguishes `denied` and `expired`. Provider failures retain authentication, rate limiting, unavailable access, network, provider HTTP status, and invalid-response distinctions. Errors contain no raw provider bodies, exceptions, or credentials.

- Validate requested identities. Renames change names and URLs, not stable IDs.
- Follow every collection page. Return all validated accessible members or fail without a partial collection. A failed later page is not empty success.
- Pagination success proves completion of that accessible collection read, not graph-wide visibility or coherence with a separate issue read.
- Preserve supplied dependency counts independently. Roadmap can detect count discrepancies, but must not assume equality across separate reads or fabricate missing summaries from returned arrays.
- A generic 403/404 does not prove deletion or account-wide authorization loss. Classify rate limiting before generic unavailable access and include a provider-supplied retry time when available. Do not schedule retries.
- Send credentials only to supported GitHub endpoints. Validate pagination and redirect destinations before sending credentials; provider URLs are not request authority.
- Keep tokens and private device codes out of URLs, logs, and public results. Only explicit user authorization instructions may be public.
- Cancellation begins no further requests, pages, or polling steps and permits no late authorization success. It does not undo requests already sent.

## Authorization ownership

`device.authorize({ onVerification, signal })` reports public instructions before returning a terminal result. Roadmap must track this long-running task outside its serialized command lane so that cancel and retry remain available. The callback runs once after valid instructions arrive, never after cancellation, and must not throw.

`credentials.refresh(refreshToken, { signal })` exchanges tokens only. Roadmap serializes refresh and reauthorization, identifies the replacement token's account through `account.get()`, validates the expected stable account, and saves the complete replacement bundle before operational resource reads. Identification itself necessarily uses the replacement token before saving it. Construct a new fixed-token client rather than mutating an existing client.

A successful refresh invalidates the previous access and refresh tokens. A sent exchange followed by cancellation or response loss cannot promise that old credentials still work. Storage failure cannot roll back provider rotation. Do not automatically retry a possibly consumed refresh token or report the old bundle as usable without proof. Credential writes and application registration saves remain separate effects.

## Roadmap acquisition policy

Read map navigation and provider-supplied aggregates across registered repositories. Acquire children and blockers only for the selected map or maps that Automation actually needs. The UI displays one map's detail at a time; the GitHub package does not know which map is selected.

Roadmap owns acquisition interest, bounded concurrency, read cadence, observation times, retained evidence, absence interpretation, and public projection. It also owns registration, expected-account policy, and local Workspace proof. Views continue through `useRoadmap`; credentials and provider clients remain server-side.

The [migration plan](roadmap-migration.md) separates map selection from execution readiness and covers transport acquisition, retention, and Automation demand. GraphQL, implicit relationship fetching, caches, schedulers, credential registries, source history, global lifecycle, and provider mutations are outside this package contract.

## Implementation acceptance

- Device flow respects polling intervals and terminal outcomes. Cancellation stops subsequent work and cannot publish a late grant.
- Refresh returns replacement credentials without storage effects. Roadmap verifies account mismatch, failed storage, and response-loss or cancellation after a sent exchange.
- Repository lookup survives renames and rejects mismatched identities. Issue reads retain stable issue identity and any proven repository identity without hidden enrichment.
- Direct, repository-list, child-list, and blocker-list reads use the same issue decoder and model. Equal local numbers in different repositories remain distinct; pull requests never become issues.
- Issue reads make no relationship requests. Collections complete pagination or fail; later-page failure never certifies empty membership.
- Child and dependency summaries preserve supplied facts and unknown values. Collection success does not erase a separate count discrepancy.
- Authentication, ambiguous access, and rate limiting remain distinguishable. Provider redirects, pagination, failures, and cancellation expose no credentials.
