import type { GitHubConnectionIdentity, SupportedIntegration } from '@roadmap/contracts'

const GITHUB_API = 'https://api.github.com'
const GITHUB_LOGIN = 'https://github.com/login'
const REST_API_VERSION = '2022-11-28'

export interface CredentialBundle {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: number
  refreshTokenExpiresAt: number
}

export interface DeviceAuthorization {
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
  readonly integration: Extract<SupportedIntegration, { integration: 'github' }>
  beginDeviceAuthorization(): Promise<DeviceAuthorization>
  pollDeviceAuthorization(deviceCode: string): Promise<DeviceAuthorizationPoll>
  identify(accessToken: string): Promise<GitHubConnectionIdentity>
  refresh(refreshToken: string): Promise<CredentialBundle>
}

export interface GitHubConnectionPortOptions {
  clientId: string
  appSlug: string
  fetch?: typeof fetch
  now?: () => number
}

export function createGitHubConnectionPort(
  options: GitHubConnectionPortOptions,
): GitHubConnectionPort {
  const request = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const clientId = requiredIdentifier(options.clientId, 'GitHub App client id')
  const appSlug = requiredIdentifier(options.appSlug, 'GitHub App slug')

  async function oauth(body: URLSearchParams): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await request(`${GITHUB_LOGIN}/oauth/access_token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
    } catch {
      throw new GitHubConnectionError('network', 'GitHub could not be reached.')
    }
    if (!response.ok) {
      throw new GitHubConnectionError('network', 'GitHub authorization is temporarily unavailable.')
    }
    return jsonRecord(response)
  }

  async function api(path: string, accessToken: string): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await request(`${GITHUB_API}${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': REST_API_VERSION,
        },
      })
    } catch {
      throw new GitHubConnectionError('network', 'GitHub could not be reached.')
    }
    if (response.status === 401) {
      throw new GitHubConnectionError('unauthorized', 'GitHub authorization is no longer valid.')
    }
    if (!response.ok) {
      throw new GitHubConnectionError('network', 'GitHub could not complete the request.')
    }
    return jsonRecord(response)
  }

  return {
    integration: {
      integration: 'github',
      name: 'GitHub',
      connectionKind: 'device-authorization',
      newInstallationUrl: `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`,
      installationsUrl: 'https://github.com/settings/installations',
      authorizationsUrl: `https://github.com/settings/connections/applications/${encodeURIComponent(clientId)}`,
    },

    async beginDeviceAuthorization() {
      let response: Response
      try {
        response = await request(`${GITHUB_LOGIN}/device/code`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ client_id: clientId }),
        })
      } catch {
        throw new GitHubConnectionError('network', 'GitHub could not be reached.')
      }
      if (!response.ok) {
        throw new GitHubConnectionError(
          'network',
          'GitHub authorization is temporarily unavailable.',
        )
      }
      const value = await jsonRecord(response)
      const deviceCode = requiredString(value.device_code)
      const userCode = requiredString(value.user_code)
      const verificationUri = safeHttpsUrl(value.verification_uri)
      const expiresIn = positiveNumber(value.expires_in)
      const interval = positiveNumber(value.interval)
      if (!deviceCode || !userCode || !verificationUri || !expiresIn || !interval) {
        throw invalidResponse()
      }
      return {
        deviceCode,
        userCode,
        verificationUri,
        expiresAt: now() + expiresIn * 1_000,
        intervalMs: interval * 1_000,
      }
    },

    async pollDeviceAuthorization(deviceCode) {
      const value = await oauth(
        new URLSearchParams({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      )
      const error = optionalString(value.error)
      if (error === 'authorization_pending') return { status: 'pending' }
      if (error === 'slow_down') return { status: 'slow-down' }
      if (error === 'access_denied') return { status: 'denied' }
      if (error === 'expired_token') return { status: 'expired' }
      if (error) {
        throw new GitHubConnectionError(
          'invalid-response',
          'GitHub rejected the authorization request.',
        )
      }
      return { status: 'granted', credentials: decodeCredentials(value, now()) }
    },

    async identify(accessToken) {
      const value = await api('/user', accessToken)
      const id = value.id
      const login = requiredString(value.login)
      if ((typeof id !== 'number' && typeof id !== 'string') || !login) throw invalidResponse()
      return { id: String(id), login }
    },

    async refresh(refreshToken) {
      const value = await oauth(
        new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      )
      if (value.error === 'bad_refresh_token') {
        throw new GitHubConnectionError(
          'bad-refresh-token',
          'GitHub authorization must be renewed.',
        )
      }
      if (value.error === 'incorrect_client_credentials') {
        throw new GitHubConnectionError(
          'bad-refresh-token',
          'GitHub rejected the stored authorization. Reauthenticate this Connection.',
        )
      }
      if (value.error) {
        throw new GitHubConnectionError('network', 'GitHub could not refresh authorization.')
      }
      return decodeCredentials(value, now())
    },
  }
}

function decodeCredentials(value: Record<string, unknown>, now: number): CredentialBundle {
  const accessToken = requiredString(value.access_token)
  const refreshToken = requiredString(value.refresh_token)
  const expiresIn = positiveNumber(value.expires_in)
  const refreshTokenExpiresIn = positiveNumber(value.refresh_token_expires_in)
  if (!accessToken || !refreshToken || !expiresIn || !refreshTokenExpiresIn) throw invalidResponse()
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: now + expiresIn * 1_000,
    refreshTokenExpiresAt: now + refreshTokenExpiresIn * 1_000,
  }
}

async function jsonRecord(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json()
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    // Fall through to the same safe protocol error.
  }
  throw invalidResponse()
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function safeHttpsUrl(value: unknown): string | null {
  const raw = requiredString(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.toString() : null
  } catch {
    return null
  }
}

function requiredIdentifier(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${name} is required.`)
  return trimmed
}

function invalidResponse(): GitHubConnectionError {
  return new GitHubConnectionError('invalid-response', 'GitHub returned an invalid response.')
}
