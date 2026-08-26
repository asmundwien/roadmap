import { describe, expect, it, vi } from 'vitest'
import { createGitHubConnectionPort, type GitHubConnectionError } from './connections.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GitHub Connection port', () => {
  it('implements device authorization, identity, and refresh', async () => {
    const responses = [
      json({
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
      json({ error: 'authorization_pending' }),
      json({
        access_token: 'access-one',
        refresh_token: 'refresh-one',
        expires_in: 28_800,
        refresh_token_expires_in: 15_552_000,
      }),
      json({ id: 42, login: 'octocat' }),
      json({
        access_token: 'access-two',
        refresh_token: 'refresh-two',
        expires_in: 28_800,
        refresh_token_expires_in: 15_552_000,
      }),
    ]
    const requests: Parameters<typeof fetch>[] = []
    const request = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      requests.push(args)
      return responses.shift() ?? json({}, 500)
    }
    const port = createGitHubConnectionPort({
      clientId: 'Iv1.public-client-id',
      appSlug: 'roadmap-reader',
      fetch: request,
      now: () => 1_000,
    })

    const device = await port.beginDeviceAuthorization()
    expect(device).toEqual({
      deviceCode: 'device-secret',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 901_000,
      intervalMs: 5_000,
    })
    expect(await port.pollDeviceAuthorization(device.deviceCode)).toEqual({ status: 'pending' })
    await expect(port.pollDeviceAuthorization(device.deviceCode)).resolves.toMatchObject({
      status: 'granted',
      credentials: { accessToken: 'access-one', refreshToken: 'refresh-one' },
    })
    await expect(port.identify('access-one')).resolves.toEqual({ id: '42', login: 'octocat' })
    await expect(port.refresh('refresh-one')).resolves.toMatchObject({
      accessToken: 'access-two',
      refreshToken: 'refresh-two',
    })
    expect(port.integration).toMatchObject({
      newInstallationUrl: 'https://github.com/apps/roadmap-reader/installations/new',
    })
    expect(String(requests[0]?.[1]?.body)).toBe('client_id=Iv1.public-client-id')
  })

  it('classifies revocation and bad refresh without exposing GitHub response bodies', async () => {
    const revoked = createGitHubConnectionPort({
      clientId: 'client',
      appSlug: 'app',
      fetch: vi.fn(async () => json({ private_detail: 'must not cross the seam' }, 401)),
    })
    await expect(revoked.identify('revoked')).rejects.toEqual(
      expect.objectContaining<Partial<GitHubConnectionError>>({
        kind: 'unauthorized',
        message: 'GitHub authorization is no longer valid.',
      }),
    )

    const badRefresh = createGitHubConnectionPort({
      clientId: 'client',
      appSlug: 'app',
      fetch: vi.fn(async () => json({ error: 'bad_refresh_token', error_description: 'private' })),
    })
    await expect(badRefresh.refresh('expired')).rejects.toEqual(
      expect.objectContaining<Partial<GitHubConnectionError>>({
        kind: 'bad-refresh-token',
        message: 'GitHub authorization must be renewed.',
      }),
    )
  })

  it('requires reauthentication when GitHub rejects stored refresh credentials', async () => {
    const rejected = createGitHubConnectionPort({
      clientId: 'client',
      appSlug: 'app',
      fetch: vi.fn(async () =>
        json({ error: 'incorrect_client_credentials', error_description: 'private' }),
      ),
    })

    await expect(rejected.refresh('rejected')).rejects.toEqual(
      expect.objectContaining<Partial<GitHubConnectionError>>({
        kind: 'bad-refresh-token',
        message: 'GitHub rejected the stored authorization. Reauthenticate this Connection.',
      }),
    )
  })
})
