import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CredentialBundle } from '../github/connections.ts'

const execFileAsync = promisify(execFile)
const DEFAULT_SERVICE = 'dev.roadmap.github-connection'
const INDEX_ACCOUNT = '__roadmap_connection_index__'

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

export interface KeychainPort {
  read(service: string, account: string): Promise<string | null>
  write(service: string, account: string, value: string): Promise<void>
  delete(service: string, account: string): Promise<void>
}

export function createMacOsCredentialVault(
  options: { keychain?: KeychainPort; service?: string } = {},
): CredentialVault {
  const keychain = options.keychain ?? createSecurityKeychain()
  const service = options.service ?? DEFAULT_SERVICE
  let lane: Promise<void> = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = lane.then(operation, operation)
    lane = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function readIndex(): Promise<Set<string>> {
    const raw = await keychain.read(service, INDEX_ACCOUNT)
    if (raw === null) return new Set()
    try {
      const value: unknown = JSON.parse(raw)
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new Error('invalid index')
      }
      return new Set(value)
    } catch {
      throw new CredentialVaultError(
        'invalid',
        'Roadmap could not read its Keychain credential index.',
      )
    }
  }

  async function writeIndex(index: ReadonlySet<string>): Promise<void> {
    await keychain.write(service, INDEX_ACCOUNT, JSON.stringify([...index].sort()))
  }

  return {
    read(connectionId) {
      return serialize(async () => {
        const raw = await keychain.read(service, connectionId)
        if (raw === null) return null
        return decodeBundle(raw)
      })
    },

    write(connectionId, credentials) {
      return serialize(async () => {
        const index = await readIndex()
        if (!index.has(connectionId)) {
          index.add(connectionId)
          await writeIndex(index)
        }
        await keychain.write(service, connectionId, JSON.stringify(credentials))
      })
    },

    delete(connectionId) {
      return serialize(async () => {
        await keychain.delete(service, connectionId)
        const index = await readIndex()
        if (index.delete(connectionId)) await writeIndex(index)
      })
    },

    cleanupOrphans(connectionIds) {
      return serialize(async () => {
        const index = await readIndex()
        let changed = false
        for (const connectionId of index) {
          if (connectionIds.has(connectionId)) continue
          await keychain.delete(service, connectionId)
          index.delete(connectionId)
          changed = true
        }
        if (changed) await writeIndex(index)
      })
    },
  }
}

export function createSecurityKeychain(): KeychainPort {
  return {
    async read(service, account) {
      try {
        const { stdout } = await execFileAsync('/usr/bin/security', [
          'find-generic-password',
          '-a',
          account,
          '-s',
          service,
          '-w',
        ])
        return stdout.replace(/\n$/, '')
      } catch (error) {
        if (isMissingKeychainItem(error)) return null
        throw new CredentialVaultError(
          'unavailable',
          'Roadmap could not read credentials from macOS Keychain.',
        )
      }
    },

    async write(service, account, value) {
      try {
        await execFileAsync('/usr/bin/security', [
          'add-generic-password',
          '-U',
          '-a',
          account,
          '-s',
          service,
          '-w',
          value,
        ])
      } catch {
        throw new CredentialVaultError(
          'unavailable',
          'Roadmap could not save credentials in macOS Keychain.',
        )
      }
    },

    async delete(service, account) {
      try {
        await execFileAsync('/usr/bin/security', [
          'delete-generic-password',
          '-a',
          account,
          '-s',
          service,
        ])
      } catch (error) {
        if (!isMissingKeychainItem(error)) {
          throw new CredentialVaultError(
            'unavailable',
            'Roadmap could not remove credentials from macOS Keychain.',
          )
        }
      }
    },
  }
}

function decodeBundle(raw: string): CredentialBundle {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    const record = value as Record<string, unknown>
    if (
      typeof record.accessToken !== 'string' ||
      record.accessToken === '' ||
      typeof record.refreshToken !== 'string' ||
      record.refreshToken === '' ||
      !validExpiry(record.accessTokenExpiresAt) ||
      !validExpiry(record.refreshTokenExpiresAt)
    ) {
      throw new Error()
    }
    return {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      accessTokenExpiresAt: record.accessTokenExpiresAt,
      refreshTokenExpiresAt: record.refreshTokenExpiresAt,
    }
  } catch {
    throw new CredentialVaultError(
      'invalid',
      'Roadmap found an invalid credential bundle in macOS Keychain.',
    )
  }
}

function validExpiry(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isMissingKeychainItem(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { code?: unknown; stderr?: unknown }
  return (
    record.code === 44 ||
    (typeof record.stderr === 'string' && record.stderr.includes('could not be found'))
  )
}
