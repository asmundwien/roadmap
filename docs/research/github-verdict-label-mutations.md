# GitHub Verdict label mutations

Roadmap should use the REST label endpoints, pinned to its existing `2022-11-28` API version, for
both repository-label reconciliation and authoritative issue-label replacement. The GitHub App
needs the repository **Issues: read and write** permission. GitHub also accepts Pull requests write,
but Roadmap does not need that broader alternative.

This settles [GitHub Verdict labels — mutation APIs and App
permissions](https://github.com/asmundwien/roadmap/issues/71).

## Ensure the repository labels

For each fixed name — `roadmap:afk`, `roadmap:hitl`, and `roadmap:unable` — reconcile the canonical
name, color, and description through:

```http
GET   /repos/{owner}/{repo}/labels/{name}
POST  /repos/{owner}/{repo}/labels
PATCH /repos/{owner}/{repo}/labels/{name}
```

`GET` distinguishes an existing label from `404`; `POST` creates from a required name and
six-character hex color; `PATCH` updates the label identified by its current name. Creation is not
an idempotent create-if-absent operation. A duplicate-name probe against GitHub.com on 2026-08-25
returned `422 Validation Failed` with
`{resource: "Label", field: "name", code: "already_exists"}`, matching GitHub's documented
validation-error shape. Therefore two reconcilers can both observe `404`; the loser must re-read on
`already_exists`, then accept the canonical label or correct it with `PATCH`.

Re-read after creation or update rather than treating the write response as a durable lock. Neither
label endpoint documents a mutation precondition or version. GitHub states that conditional
requests for unsafe methods are unsupported unless an endpoint explicitly says otherwise, and
these endpoints do not.

Official references:

- [Create a repository label](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#create-a-label)
- [Get a repository label](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#get-a-label)
- [Update a repository label](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#update-a-label)
- [REST validation errors and `already_exists`](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#validation-failed)
- [Conditional requests are normally GET-only](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)

## Replace one issue's Verdict

Use the dedicated replacement operation:

```http
GET /repos/{owner}/{repo}/issues/{issue_number}/labels?per_page=100&page={page}
PUT /repos/{owner}/{repo}/issues/{issue_number}/labels

{"labels":["every preserved non-Verdict label","roadmap:hitl"]}
```

GitHub explicitly defines `PUT` as removing the previous labels and setting the supplied names;
`[]` clears every label. Read and paginate the complete current set, remove all three Verdict
names, add the one desired Verdict, preserve every other name, and send that full set. Skip the
write when the current set is already correct. Repeating the same full-set request is
state-idempotent when no other actor writes labels.

A live, subsequently cleaned-up GitHub.com probe exposed an important behavior omitted by the
endpoint reference: on 2026-08-25, a `PUT` containing one existing name and one absent name returned
`200`, created the absent repository label with color `ededed` and a null description, and assigned
it to the issue. Roadmap must not rely on that implicit creation because it loses the canonical
color and description. Ensure all three repository labels before replacement.

This is still a blind read-compute-write sequence. A label added by another actor after Roadmap's
read can be erased by Roadmap's `PUT`; a later writer can immediately supersede a successful
response. There is no `If-Match`/expected-version guard. The Integration must inspect the returned
set (and reconciliation must observe again later), report success only for the state it actually
saw, and treat persistent contention as a write conflict rather than claiming durable ownership.

Delta operations do not solve the invariant. REST add/remove and GraphQL
`addLabelsToLabelable`/`removeLabelsFromLabelable` preserve unrelated labels, but replacing one
Verdict takes multiple writes and exposes zero- or multiple-Verdict intermediate states and partial
failure. A full-set write is the smallest authoritative operation; periodic reconciliation handles
the unavoidable race.

Official references:

- [List labels for an issue](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#list-labels-for-an-issue)
- [Set labels for an issue](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#set-labels-for-an-issue)
- [GraphQL `addLabelsToLabelable`](https://docs.github.com/en/graphql/reference/issues#mutation-addlabelstolabelable)
- [GraphQL `removeLabelsFromLabelable`](https://docs.github.com/en/graphql/reference/issues#mutation-removelabelsfromlabelable)

## Why REST, not GraphQL

GraphQL exposes `createLabel`, `updateLabel`, and `updateIssue`; `UpdateIssueInput.labelIds` and its
newer `labels` input are the full-set surface. It also exposes the delta mutations above. GraphQL
requires repository, issue, and label node IDs, does not document replacement edge cases or a
mutation precondition, and provides no per-mutation permission table. GitHub directs App authors
to test GraphQL permissions.

REST accepts the names Roadmap already stores, documents the full replacement semantics and HTTP
status surface, and publishes the exact App permission matrix. GraphQL offers no stronger
concurrency guarantee here. Use REST for this write seam rather than adding ID lookups and a second
permission/error convention.

Official references:

- [GraphQL `createLabel`](https://docs.github.com/en/graphql/reference/issues#mutation-createlabel)
- [GraphQL `updateLabel`](https://docs.github.com/en/graphql/reference/issues#mutation-updatelabel)
- [GraphQL `updateIssue`](https://docs.github.com/en/graphql/reference/issues#mutation-updateissue)
- [Choosing permissions for GraphQL and REST](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

## Tokens and least privilege

The REST permission matrix accepts both GitHub App user access tokens (UAT) and installation access
tokens (IAT) for these reads and writes. **Issues: write** is sufficient for repository-label
create/update and issue-label replacement; its read level covers the prerequisite reads. Pull
requests write is an accepted alternative because pull requests share issue labels, but Roadmap
should not request it for issue-only work.

A UAT can act only where both the App and authorizing user have access, and only with the
intersection of their permissions. A user who cannot write the repository cannot lend that power
to Roadmap. An IAT is attributed to the App, is bounded by the installation's selected repositories
and App permissions, and expires after one hour. Either token type still requires that the App be
installed with access to the target repository. Roadmap's existing device-flow UAT therefore needs
no new token kind, only the App's Issues permission upgraded to read and write and approved by each
installation owner.

Official references:

- [GitHub App permission matrix](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-issues)
- [User access-token permission intersection](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#about-user-access-tokens)
- [Installation access-token boundaries](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation#generating-an-installation-access-token)

## Failure and rate-limit contract

Do not collapse GitHub failures into one write error. Preserve enough structured detail for the
application to distinguish:

- `401` expired/revoked/bad credentials;
- `403 Resource not accessible by integration` from insufficient App permission, plus the
  `X-Accepted-GitHub-Permissions` header;
- `404`, which can mean missing repository/issue/label **or** intentionally concealed private
  resource access, and `410` for a gone issue;
- `422` validation/conflict/spam, including `message` and every `errors[]` `resource`, `field`, and
  `code` such as `already_exists`;
- `403` or `429` rate limiting, preserving `Retry-After` and all `X-RateLimit-*` values; and
- transport failures, timeouts, and `5xx`, preserving `X-GitHub-Request-Id` when present.

Follow `301` redirects rather than classifying them as failures. Retry a label-create conflict only
after re-reading. Retry rate limits only after GitHub's advertised delay/reset; retry uncertain
transport or server failures by reconciling current state first, because the write may have taken
effect before the response was lost.

Authenticated REST calls use the user or installation primary bucket. User access tokens normally
share 5,000 requests/hour per user; installation tokens start at 5,000/hour and can scale. Most
REST mutations cost five secondary-limit points. GitHub recommends serial mutations and at least a
one-second pause between many mutative requests. The normal no-op reconciliation path should read
once and write nothing.

Official references:

- [Documented label endpoint status codes](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#set-labels-for-an-issue)
- [Authentication, authorization, `404`, and validation troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)
- [REST primary and secondary rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [REST mutation pacing and retry guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#pause-between-mutative-requests)

## Sharpened follow-up

The APIs expose no conditional label write. The later Integration protocol must decide whether a
post-write mismatch caused by concurrent human or bot edits is retried to eventual convergence or
pauses Automation after a bounded conflict, while never erasing unrelated labels without surfacing
that race.
