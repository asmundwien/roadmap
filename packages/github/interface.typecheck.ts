import type {
  AccessToken,
  AccountId,
  DeviceAuthorizationResult,
  GitHubClient,
  GitHubFailure,
  Issue,
  IssueFilter,
  IssueId,
  IssueNumber,
  IssueReference,
  IssueRelationship,
  IssueState,
  Issues,
  RefreshToken,
  RepositoryId,
  RepositorySelector,
  Result,
} from '@roadmap/github'

type Assert<T extends true> = T
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Rejects<A, B> = A extends B ? false : true

/** Compile-time consumer invariants. No runtime code or provider implementation. */
export type InterfaceChecks = [
  Assert<Rejects<AccountId, RepositoryId>>,
  Assert<Rejects<RepositoryId, AccountId>>,
  Assert<Rejects<RepositoryId, IssueNumber>>,
  Assert<Rejects<number, IssueNumber>>,
  Assert<Rejects<IssueId, IssueNumber>>,
  Assert<Rejects<RepositoryId, IssueId>>,
  Assert<Rejects<string, IssueId>>,
  Assert<Rejects<string, AccessToken>>,
  Assert<Rejects<RefreshToken, AccessToken>>,
  Assert<Rejects<AccessToken, RefreshToken>>,
  Assert<Rejects<{ kind: 'id'; id: AccountId }, RepositorySelector>>,
  Assert<Rejects<{ kind: 'name'; owner: string }, RepositorySelector>>,
  Assert<Rejects<IssueNumber, IssueReference>>,
  Assert<
    Rejects<
      { repository: { kind: 'name'; owner: string; name: string }; number: IssueNumber },
      IssueReference
    >
  >,
  Assert<Equal<IssueReference['repositoryId'], RepositoryId | null>>,
  Assert<Rejects<{ kind: 'open'; reason: 'completed' }, IssueState>>,
  Assert<Rejects<{ kind: 'closed'; reason: 'completed' }, IssueState>>,
  Assert<Rejects<{ state: 'pending' }, IssueFilter>>,
  Assert<Rejects<{ kind: 'success' }, Result<Issue>>>,
  Assert<Rejects<{ kind: 'failure' }, Result<Issue>>>,
  Assert<Equal<Extract<Result<Issue>, { kind: 'success' }>['value'], Issue>>,
  Assert<Equal<Extract<Result<Issue>, { kind: 'failure' }>['error'], GitHubFailure>>,
  Assert<Equal<Extract<IssueState, { kind: 'open' }>['reason'], 'reopened' | null>>,
  Assert<Equal<Extract<IssueState, { kind: 'closed' }>['closedAt'], string>>,
  Assert<
    Equal<Extract<DeviceAuthorizationResult, { kind: 'denied' }>, { readonly kind: 'denied' }>
  >,
  Assert<Equal<Awaited<ReturnType<Issues['get']>>, Result<Issue>>>,
  Assert<Equal<Awaited<ReturnType<Issues['list']>>, Result<readonly Issue[]>>>,
  Assert<Equal<Awaited<ReturnType<IssueRelationship['list']>>, Result<readonly Issue[]>>>,
  Assert<Equal<ReturnType<Issues['at']>['subIssues'], IssueRelationship>>,
  Assert<Equal<ReturnType<Issues['at']>['blockedBy'], IssueRelationship>>,
  Assert<Equal<ReturnType<GitHubClient['repositories']['at']>['issues'], Issues>>,
  Assert<
    Equal<Extract<Issue['dependencies'], { kind: 'unavailable' }>, { readonly kind: 'unavailable' }>
  >,
  Assert<Rejects<Issue['labels'], { push: (item: unknown) => unknown }>>,
  Assert<Rejects<Issue['assignees'], { push: (item: unknown) => unknown }>>,
]
