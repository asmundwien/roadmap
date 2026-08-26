/** Server-only process configuration loaded from the root `.env.local`. */

export const DEFAULT_PORT = 8790
export const DEFAULT_WEB_ORIGIN = 'http://localhost:5173'

export interface ServerConfig {
  githubApp: { clientId: string; slug: string } | null
  port: number
  allowedOrigin: string
}

export type ConfigResult =
  | { ok: true; config: ServerConfig; warnings: string[] }
  | { ok: false; missing: string[]; message: string }

export function readServerConfig(env: Record<string, string | undefined>): ConfigResult {
  const clientId = env.ROADMAP_GITHUB_APP_CLIENT_ID?.trim() ?? ''
  const slug = env.ROADMAP_GITHUB_APP_SLUG?.trim() ?? ''
  const port = readPort(env.ROADMAP_SERVER_PORT)
  const allowedOrigin = readOrigin(env.ROADMAP_WEB_ORIGIN)

  if (allowedOrigin === null) {
    return {
      ok: false,
      missing: [],
      message: 'ROADMAP_WEB_ORIGIN must be one exact http or https origin without a path.',
    }
  }
  if ((clientId === '') !== (slug === '')) {
    const missing = clientId === '' ? ['ROADMAP_GITHUB_APP_CLIENT_ID'] : ['ROADMAP_GITHUB_APP_SLUG']
    return {
      ok: false,
      missing,
      message: `Missing ${missing[0]}; both GitHub App settings are required together.`,
    }
  }

  return {
    ok: true,
    config: {
      githubApp: clientId && slug ? { clientId, slug } : null,
      port,
      allowedOrigin,
    },
    warnings:
      clientId && slug
        ? []
        : ['GitHub Connections are disabled until the public GitHub App is configured.'],
  }
}

function readPort(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT
}

function readOrigin(raw: string | undefined): string | null {
  const value = raw?.trim() || DEFAULT_WEB_ORIGIN
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
      ? value
      : null
  } catch {
    return null
  }
}
