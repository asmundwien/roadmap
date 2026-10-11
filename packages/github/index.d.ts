/** Opaque semantic identity. Only SDK validation creates these values from unknown input. */
declare const identity: unique symbol

/** Stable GitHub repository database ID, independent of its current name. */
export type RepositoryId = string & { readonly [identity]: 'repository-id' }

/** Stable GitHub account database ID, independent of its current login. */
export type AccountId = string & { readonly [identity]: 'account-id' }

/** Stable GitHub issue database ID, independent of repository names and local numbers. */
export type IssueId = string & { readonly [identity]: 'issue-id' }

/** Positive safe integer identifying an issue within its repository, not globally. */
export type IssueNumber = number & { readonly [identity]: 'issue-number' }

/** Private access token. Branding prevents token mixups, not serialization or disclosure. */
export type AccessToken = string & { readonly [identity]: 'access-token' }

/** Private refresh token, distinct from an access token. */
export type RefreshToken = string & { readonly [identity]: 'refresh-token' }

/** Invalid caller input. The message and field never include the rejected value. */
export interface InvalidInput {
  /** Failure discriminator. */
  readonly kind: 'invalid-input'
  /** Safe field path identifying the invalid input. */
  readonly field: string
  /** Safe description of the required correction. */
  readonly message: string
}

/** Validation is synchronous and performs no provider requests. */
export type Validation<T> =
  | { readonly kind: 'valid'; readonly value: T }
  | { readonly kind: 'invalid'; readonly error: InvalidInput }

/** Expected provider failures. Raw response bodies and exceptions are never retained. */
export type GitHubFailure =
  | InvalidInput
  | {
      /** The provider rejected the supplied credential; this is not an account mismatch proof. */
      readonly kind: 'authentication'
      /** User authorization or refresh-token exchange requires renewed credentials. */
      readonly reason: 'rejected-token' | 'expired-refresh-token'
    }
  | {
      /** The provider limited this request. The SDK does not schedule another attempt. */
      readonly kind: 'rate-limited'
      /** Earliest provider-supplied retry time as Unix milliseconds, or null if unknown. */
      readonly retryAt: number | null
    }
  | {
      /** The requested resource was inaccessible; this does not establish deletion. */
      readonly kind: 'unavailable'
      /** Actual resource-access HTTP status, not account-wide authorization evidence. */
      readonly status: 403 | 404 | 410
    }
  | { readonly kind: 'network' }
  | {
      /** Other non-success HTTP response. */
      readonly kind: 'provider'
      /** Actual HTTP status. Raw provider messages are omitted. */
      readonly status: number
    }
  | { readonly kind: 'invalid-response' }

/** Expected failures and cancellation resolve as values; they do not reject the promise. */
export type Result<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'failure'; readonly error: GitHubFailure }
  | { readonly kind: 'cancelled' }

/** Per-operation cancellation. No request, page, or polling step begins after cancellation. */
export interface RequestOptions {
  /** Caller-owned signal; aborting does not undo a request already sent. */
  readonly signal?: AbortSignal
}

/** Explicit repository lookup. ID and name selectors cannot be confused. */
export type RepositorySelector =
  | { readonly kind: 'id'; readonly id: RepositoryId }
  | { readonly kind: 'name'; readonly owner: string; readonly name: string }

/** Current repository metadata. Renames leave the stable ID unchanged. */
export interface Repository {
  /** Stable provider database identity. */
  readonly id: RepositoryId
  /** Current owner login. */
  readonly owner: string
  /** Current repository name without the owner prefix. */
  readonly name: string
  /** GitHub browser destination, not a trusted request URL. */
  readonly url: string
}

/** Identified GitHub user account, not application registration or authorization policy. */
export interface Account {
  /** Stable account database identity. */
  readonly id: AccountId
  /** Current login, which may change. */
  readonly login: string
  /** GitHub browser destination. */
  readonly url: string
  /** Provider avatar destination. */
  readonly avatarUrl: string
}

/** Private expiring GitHub App user credentials. Neither token belongs in public state. */
export interface Credentials {
  /** Token may identify its account before storage; operational reads wait for storage success. */
  readonly accessToken: AccessToken
  /** Token exchanged explicitly through the configured app's credentials collection. */
  readonly refreshToken: RefreshToken
  /** Access-token expiry as Unix milliseconds. */
  readonly accessTokenExpiresAt: number
  /** Refresh-token expiry as Unix milliseconds. */
  readonly refreshTokenExpiresAt: number
}

/** Stable issue identity plus its repository address at the time of this response. */
export interface IssueReference {
  /** Stable provider issue identity; retain it across separate observations. */
  readonly id: IssueId
  /** Repository address observed for this issue, never a registered application identity. */
  readonly repository: Extract<RepositorySelector, { readonly kind: 'name' }>
  /** Provider-supplied or ID-selected repository identity; null when this response cannot prove it. */
  readonly repositoryId: RepositoryId | null
  /** Repository-local issue number. */
  readonly number: IssueNumber
}

/** Tracker state. Only a closed issue has a closing timestamp. */
export type IssueState =
  | { readonly kind: 'open'; readonly reason: 'reopened' | null }
  | {
      readonly kind: 'closed'
      readonly reason: 'completed' | 'not-planned' | 'duplicate' | null
      readonly closedAt: string
    }

/** Label metadata without application-specific interpretation. */
export interface Label {
  /** Literal provider label name. */
  readonly name: string
  /** Provider hexadecimal color without a leading hash. */
  readonly color: string
}

/** Summary supplied by GitHub, not inferred from fetched children. */
export type SubIssueSummary =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'known'
      readonly total: number
      readonly completed: number
      readonly percentCompleted: number
    }

/** Dependency counts supplied by GitHub, not inferred from a separately fetched collection. */
export type IssueDependencySummary =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'known'
      /** Provider blocked-by count, without application interpretation. */
      readonly blockedBy: number
      /** Provider total blocked-by count; retain separately rather than assuming equality. */
      readonly totalBlockedBy: number
      /** Provider blocking count. No inverse-relationship read is implied. */
      readonly blocking: number
      /** Provider total blocking count. */
      readonly totalBlocking: number
    }

/** Canonical immutable issue content for direct, repository-list, and relationship reads. */
export interface Issue {
  /** Stable identity and the repository-local address observed in this response. */
  readonly reference: IssueReference
  /** Provider issue title. */
  readonly title: string
  /** Raw Markdown, or null when GitHub supplies no body. */
  readonly body: string | null
  /** GitHub browser destination, never request authority. */
  readonly url: string
  /** Discriminated tracker state with its applicable closing evidence. */
  readonly state: IssueState
  /** Creation time in ISO 8601 format. */
  readonly createdAt: string
  /** Provider update time in ISO 8601 format, not application observation time. */
  readonly updatedAt: string
  /** Complete labels returned with the issue; no ticket-type interpretation. */
  readonly labels: readonly Label[]
  /** Complete assignees returned with the issue; no claim or execution policy. */
  readonly assignees: readonly Account[]
  /** Supplied counts, which may differ from a later relationship read. */
  readonly subIssues: SubIssueSummary
  /** Supplied dependency counts; known zero is distinct from unavailable evidence. */
  readonly dependencies: IssueDependencySummary
}

/** Explicit issue-list filters. Pagination is internal and always completes or fails. */
export interface IssueFilter {
  /** Required state selection; callers do not inherit GitHub's default open-only filter. */
  readonly state: 'open' | 'closed' | 'all'
  /** All supplied labels must match. An absent or empty array applies no label filter. */
  readonly labels?: readonly string[]
}

/** Current authenticated account lookup using the client's fixed token. */
export interface AccountResource {
  /** Fetch and identify the token's current user. Never accepts an expected identity as proof. */
  readonly get: (options?: RequestOptions) => Promise<Result<Account>>
}

/** Repository collection with explicit lookup and pure navigation. */
export interface Repositories {
  /** Fetch current metadata by name or stable ID; validate the requested identity. */
  readonly get: (
    selector: RepositorySelector,
    options?: RequestOptions,
  ) => Promise<Result<Repository>>
  /** Select a repository without I/O. The returned handle never mutates this collection. */
  readonly at: (selector: RepositorySelector) => RepositoryResource
}

/** Immutable repository handle. Selection proves neither existence nor access. */
export interface RepositoryResource {
  /** Repository-local issue collection; no fetch occurs when this property is read. */
  readonly issues: Issues
}

/** Repository-scoped issue collection. Pull requests are excluded from both reads. */
export interface Issues {
  /** Fetch one issue only. Sub-issues and dependencies require separate explicit reads. */
  readonly get: (number: IssueNumber, options?: RequestOptions) => Promise<Result<Issue>>
  /** Fetch every matching issue, following all pages. Failure returns no partial collection. */
  readonly list: (
    filter: IssueFilter,
    options?: RequestOptions,
  ) => Promise<Result<readonly Issue[]>>
  /** Select an issue without I/O. Its number is interpreted only within this repository. */
  readonly at: (number: IssueNumber) => IssueResource
}

/** Immutable issue handle used only to select explicit relationship collections. */
export interface IssueResource {
  /** Direct sub-issues only; no recursive graph traversal. */
  readonly subIssues: IssueRelationship
  /** Issues this issue is blocked by; not the inverse blocking relationship. */
  readonly blockedBy: IssueRelationship
}

/** Explicit REST relationship collection. Its members may belong to other repositories. */
export interface IssueRelationship {
  /** Fetch every accessible member and page; success is not a graph-wide or atomic snapshot proof. */
  readonly list: (options?: RequestOptions) => Promise<Result<readonly Issue[]>>
}

/** Immutable fixed-token read client. Returned data and resource handles are deeply readonly. */
export interface GitHubClient {
  /** Explicit account identification. Accessing the property performs no I/O. */
  readonly account: AccountResource
  /** Repository resource navigation. Accessing the property performs no I/O. */
  readonly repositories: Repositories
}

/** Public device-flow instructions. No private device code is exposed. */
export interface DeviceVerification {
  /** User-entered authorization code; may be shown only as explicit authorization instructions. */
  readonly userCode: string
  /** GitHub verification destination. */
  readonly verificationUrl: string
  /** Instruction expiry as Unix milliseconds. */
  readonly expiresAt: number
}

/** Device flow has terminal denial and expiry outcomes, not optional success fields. */
export type DeviceAuthorizationResult =
  | { readonly kind: 'success'; readonly account: Account; readonly credentials: Credentials }
  | { readonly kind: 'denied' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failure'; readonly error: GitHubFailure }

/** Device authorization inputs. The callback exposes instructions before polling completes. */
export interface DeviceAuthorizationOptions extends RequestOptions {
  /** Called once after valid instructions arrive, never after cancellation. Must not throw. */
  readonly onVerification: (verification: DeviceVerification) => void
}

/** Device-flow operations for one fixed GitHub App configuration. */
export interface DeviceAuthorizations {
  /** Perform one device flow, respecting slow-down and expiry, then identify the granted account. */
  readonly authorize: (options: DeviceAuthorizationOptions) => Promise<DeviceAuthorizationResult>
}

/** Explicit token exchange. It does not update clients, validate an expected account, or save. */
export interface CredentialExchanges {
  /** Exchange once, then identify and save replacements. Sent exchanges can invalidate old tokens. */
  readonly refresh: (token: RefreshToken, options?: RequestOptions) => Promise<Result<Credentials>>
}

/** Immutable GitHub App protocol handle, independent of authenticated read clients. */
export interface GitHubApp {
  /** Explicit device authorization. */
  readonly device: DeviceAuthorizations
  /** Explicit refresh-token exchange. */
  readonly credentials: CredentialExchanges
}

/** App configuration; no client secret or platform storage is part of this interface. */
export interface GitHubAppOptions {
  /** Public GitHub App client ID with device flow enabled and expiring user tokens required. */
  readonly clientId: string
}

/** Fixed-token client construction inputs. No token is exposed on the resulting client. */
export interface GitHubClientOptions {
  /** Caller-owned usable user access token. A new token requires a new client. */
  readonly accessToken: AccessToken
}

/** Pure validation for caller input and previously stored credentials. No coercion or I/O. */
export interface GitHubValues {
  /** Validate a positive decimal repository database ID string. */
  readonly repositoryId: (input: unknown) => Validation<RepositoryId>
  /** Validate a positive decimal account database ID string. */
  readonly accountId: (input: unknown) => Validation<AccountId>
  /** Validate a positive decimal issue database ID string. */
  readonly issueId: (input: unknown) => Validation<IssueId>
  /** Validate a positive safe integer repository-local issue number. */
  readonly issueNumber: (input: unknown) => Validation<IssueNumber>
  /** Validate a nonempty private access token without certifying provider acceptance or expiry. */
  readonly accessToken: (input: unknown) => Validation<AccessToken>
  /** Validate a nonempty private refresh token without certifying provider acceptance or expiry. */
  readonly refreshToken: (input: unknown) => Validation<RefreshToken>
  /** Validate a complete stored bundle, including finite positive Unix-millisecond expiries. */
  readonly credentials: (input: unknown) => Validation<Credentials>
}

/** Declaration-only SDK entry point. The package exposes types, not a runtime implementation. */
export declare const GitHub: {
  /** Pure validated-value constructors. */
  readonly values: GitHubValues
  /** Construct an immutable fixed-token resource client without fetching or identifying an account. */
  readonly connect: (options: GitHubClientOptions) => GitHubClient
  /** GitHub App protocol resources. Selecting configuration performs no provider request. */
  readonly apps: {
    /** Construct an immutable App handle. Invalid configuration fails its subsequent operation. */
    readonly at: (options: GitHubAppOptions) => GitHubApp
  }
}
