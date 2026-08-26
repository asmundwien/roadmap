import { describe, expect, it } from 'vitest'
import { DEFAULT_PORT, DEFAULT_WEB_ORIGIN, readServerConfig } from './config.ts'

const FULL_ENV = {
  ROADMAP_GITHUB_APP_CLIENT_ID: 'Iv1.public-client-id',
  ROADMAP_GITHUB_APP_SLUG: 'roadmap-reader',
  ROADMAP_SERVER_PORT: '9000',
}

describe('readServerConfig', () => {
  it('reads the public GitHub App identity without warnings', () => {
    const result = readServerConfig(FULL_ENV)
    expect(result).toEqual({
      ok: true,
      config: {
        githubApp: { clientId: 'Iv1.public-client-id', slug: 'roadmap-reader' },
        port: 9000,
        allowedOrigin: DEFAULT_WEB_ORIGIN,
      },
      warnings: [],
    })
  })

  it('starts Local-only when no GitHub App is configured', () => {
    const result = readServerConfig({})
    expect(result).toEqual({
      ok: true,
      config: { githubApp: null, port: DEFAULT_PORT, allowedOrigin: DEFAULT_WEB_ORIGIN },
      warnings: ['GitHub Connections are disabled until the public GitHub App is configured.'],
    })
  })

  it('rejects a half-configured GitHub App', () => {
    expect(readServerConfig({ ROADMAP_GITHUB_APP_CLIENT_ID: 'client' })).toMatchObject({
      ok: false,
      missing: ['ROADMAP_GITHUB_APP_SLUG'],
    })
    expect(readServerConfig({ ROADMAP_GITHUB_APP_SLUG: 'app' })).toMatchObject({
      ok: false,
      missing: ['ROADMAP_GITHUB_APP_CLIENT_ID'],
    })
  })

  it('falls back to the default port on absent or nonsense values', () => {
    for (const port of [undefined, '', 'abc', '-1', '70000']) {
      const result = readServerConfig({ ...FULL_ENV, ROADMAP_SERVER_PORT: port })
      expect(result.ok && result.config.port).toBe(DEFAULT_PORT)
    }
  })

  it('accepts one exact configured web origin and rejects paths or non-HTTP schemes', () => {
    const configured = readServerConfig({
      ...FULL_ENV,
      ROADMAP_WEB_ORIGIN: 'https://roadmap.example',
    })
    expect(configured.ok && configured.config.allowedOrigin).toBe('https://roadmap.example')

    for (const origin of ['http://localhost:5173/', 'file:///tmp/roadmap']) {
      const result = readServerConfig({ ...FULL_ENV, ROADMAP_WEB_ORIGIN: origin })
      expect(result.ok).toBe(false)
    }
  })
})
