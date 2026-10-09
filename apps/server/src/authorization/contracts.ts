export type AuthorizationFact =
  | { id: string; status: 'starting'; connectionId?: string }
  | {
      id: string
      status: 'waiting'
      connectionId?: string
      verificationUri: string
      userCode: string
      expiresAt: number
    }
  | { id: string; status: 'granted'; connectionId: string; accountId: string }
  | {
      id: string
      status: 'denied' | 'expired' | 'cancelled' | 'failed'
      connectionId?: string
      cause: string
    }

export interface GitHubConnectionIdentity {
  id: string
  login: string
}
interface GitHubIntegrationDescriptor {
  integration: 'github'
  name: string
  connectionKind: 'device-authorization'
  newInstallationUrl: string
  installationsUrl: string
  authorizationsUrl: string
}

export interface CredentialBundle {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: number
  refreshTokenExpiresAt: number
}

interface DeviceAuthorization {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalMs: number
}

export type DeviceAuthorizationPoll =
  | { status: 'pending' }
  | { status: 'slow-down' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'granted'; credentials: CredentialBundle }

export type GitHubConnectionErrorKind =
  | 'network'
  | 'unauthorized'
  | 'bad-refresh-token'
  | 'invalid-response'

export class GitHubConnectionError extends Error {
  readonly kind: GitHubConnectionErrorKind

  constructor(kind: GitHubConnectionErrorKind, message: string) {
    super(message)
    this.name = 'GitHubConnectionError'
    this.kind = kind
  }
}

/** Internal GitHub seam used by RoadmapApplication and scripted in its tests. */
export interface GitHubConnectionPort {
  readonly integration: GitHubIntegrationDescriptor
  beginDeviceAuthorization(): Promise<DeviceAuthorization>
  pollDeviceAuthorization(deviceCode: string): Promise<DeviceAuthorizationPoll>
  identify(accessToken: string): Promise<GitHubConnectionIdentity>
  refresh(refreshToken: string): Promise<CredentialBundle>
}

export interface CredentialVault {
  read(connectionId: string): Promise<CredentialBundle | null>
  /** Replaces the complete access/refresh pair as one Keychain password value. */
  write(connectionId: string, credentials: CredentialBundle): Promise<void>
  delete(connectionId: string): Promise<void>
  /** Removes only app-owned records whose Connection no longer exists. */
  cleanupOrphans(connectionIds: ReadonlySet<string>): Promise<void>
}

export class CredentialVaultError extends Error {
  readonly kind: 'invalid' | 'unavailable'

  constructor(kind: 'invalid' | 'unavailable', message: string) {
    super(message)
    this.name = 'CredentialVaultError'
    this.kind = kind
  }
}
