import { describe, expect, it } from 'vitest'
import type { CredentialBundle } from '../github/connections.ts'
import { createMacOsCredentialVault, type KeychainPort } from './credential-vault.ts'

const CREDENTIALS: CredentialBundle = {
  accessToken: 'access-one',
  refreshToken: 'refresh-one',
  accessTokenExpiresAt: 100,
  refreshTokenExpiresAt: 200,
}

function memoryKeychain() {
  const records = new Map<string, string>()
  const key = (service: string, account: string) => `${service}:${account}`
  const port: KeychainPort = {
    async read(service, account) {
      return records.get(key(service, account)) ?? null
    },
    async write(service, account, value) {
      records.set(key(service, account), value)
    },
    async delete(service, account) {
      records.delete(key(service, account))
    },
  }
  return { port, records }
}

describe('macOS credential vault', () => {
  it('rotates the complete bundle in one Keychain value and cleans indexed orphans', async () => {
    const keychain = memoryKeychain()
    const vault = createMacOsCredentialVault({ keychain: keychain.port, service: 'test' })
    await vault.write('kept', CREDENTIALS)
    await vault.write('orphan', { ...CREDENTIALS, accessToken: 'access-two' })

    expect(keychain.records.get('test:kept')).toBe(JSON.stringify(CREDENTIALS))
    await vault.cleanupOrphans(new Set(['kept']))

    expect(await vault.read('kept')).toEqual(CREDENTIALS)
    expect(await vault.read('orphan')).toBeNull()
    expect([...keychain.records.values()].join(' ')).not.toContain('access-two')
  })

  it('rejects a partial credential record', async () => {
    const keychain = memoryKeychain()
    keychain.records.set('test:broken', JSON.stringify({ accessToken: 'only-half' }))
    const vault = createMacOsCredentialVault({ keychain: keychain.port, service: 'test' })

    await expect(vault.read('broken')).rejects.toThrow(
      'Roadmap found an invalid credential bundle in macOS Keychain.',
    )
  })
})
