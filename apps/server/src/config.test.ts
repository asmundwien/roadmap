import { describe, expect, it } from 'vitest'
import { DEFAULT_PORT, readServerConfig } from './config.ts'

const FULL_ENV = {
  ROADMAP_GITHUB_TOKEN: 't0ken',
  ROADMAP_GITHUB_USER: 'asmundwien',
  ROADMAP_SMEE_URL: 'https://smee.io/abc',
  ROADMAP_WEBHOOK_SECRET: 's3cret',
  ROADMAP_SERVER_PORT: '9000',
}

describe('readServerConfig', () => {
  it('reads a full environment without warnings', () => {
    const result = readServerConfig(FULL_ENV)
    expect(result).toEqual({
      ok: true,
      config: {
        token: 't0ken',
        user: 'asmundwien',
        smeeUrl: 'https://smee.io/abc',
        webhookSecret: 's3cret',
        port: 9000,
      },
      warnings: [],
    })
  })

  it('refuses to start without the GitHub token and user', () => {
    const result = readServerConfig({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['ROADMAP_GITHUB_TOKEN', 'ROADMAP_GITHUB_USER'])
      expect(result.message).toContain('.env.local')
    }
  })

  it('degrades to poll-only with a warning when the webhook pieces are unset', () => {
    const result = readServerConfig({ ROADMAP_GITHUB_TOKEN: 't', ROADMAP_GITHUB_USER: 'u' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.smeeUrl).toBeNull()
      expect(result.config.webhookSecret).toBeNull()
      expect(result.warnings).toHaveLength(2)
    }
  })

  it('falls back to the default port on absent or nonsense values', () => {
    for (const port of [undefined, '', 'abc', '-1', '70000']) {
      const result = readServerConfig({
        ROADMAP_GITHUB_TOKEN: 't',
        ROADMAP_GITHUB_USER: 'u',
        ROADMAP_SERVER_PORT: port,
      })
      expect(result.ok && result.config.port).toBe(DEFAULT_PORT)
    }
  })
})
