import { describe, expect, it } from 'vitest'
import { readConfig } from './config.ts'

function env(overrides: Partial<ImportMetaEnv>): ImportMetaEnv {
  return overrides as ImportMetaEnv
}

describe('readConfig', () => {
  it('reads the token and the user', () => {
    const result = readConfig(env({ VITE_GITHUB_TOKEN: ' t0ken ', VITE_GITHUB_USER: 'asmundwien' }))

    expect(result).toEqual({ ok: true, config: { token: 't0ken', user: 'asmundwien' } })
  })

  it('names what is missing rather than throwing', () => {
    const result = readConfig(env({}))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toEqual(['VITE_GITHUB_TOKEN', 'VITE_GITHUB_USER'])
    expect(result.message).toContain('.env.local')
  })

  it('treats a blank value as missing', () => {
    const result = readConfig(env({ VITE_GITHUB_TOKEN: '   ', VITE_GITHUB_USER: 'a' }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toEqual(['VITE_GITHUB_TOKEN'])
  })
})
