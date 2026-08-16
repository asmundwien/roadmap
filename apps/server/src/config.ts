/**
 * Where the server's configuration comes from: the root `.env.local`, loaded into `process.env`
 * by `main.ts` before this runs. Every name is `ROADMAP_`-prefixed, never `VITE_` — the PAT and
 * the webhook secrets are the server's alone, and an unprefixed name is what keeps Vite from
 * ever exposing them to the browser.
 */

/** The default port for the HTTP + WebSocket server; `ROADMAP_SERVER_PORT` overrides. */
export const DEFAULT_PORT = 8790

export interface ServerConfig {
  /** A personal access token. Fine-grained with `Issues: read` is enough. */
  token: string
  /** The account whose repos are searched for `wayfinder:map` issues. */
  user: string
  /** The smee.io channel the App delivers to; null runs the server poll-only. */
  smeeUrl: string | null
  /** The App's webhook secret; null skips signature verification entirely. */
  webhookSecret: string | null
  port: number
}

export type ConfigResult =
  | { ok: true; config: ServerConfig; warnings: string[] }
  | { ok: false; missing: string[]; message: string }

/**
 * Reads config from the environment, reporting what is missing rather than throwing. The token
 * and user are required — without them there is nothing to serve. The webhook pieces degrade:
 * no smee URL means the reconciler is the only funnel, no secret means unverified deliveries —
 * each is a warning, not a refusal, so the server always starts once reads work.
 */
export function readServerConfig(env: Record<string, string | undefined>): ConfigResult {
  const token = env.ROADMAP_GITHUB_TOKEN?.trim() ?? ''
  const user = env.ROADMAP_GITHUB_USER?.trim() ?? ''
  const smeeUrl = env.ROADMAP_SMEE_URL?.trim() || null
  const webhookSecret = env.ROADMAP_WEBHOOK_SECRET?.trim() || null
  const port = readPort(env.ROADMAP_SERVER_PORT)

  const missing: string[] = []
  if (token === '') missing.push('ROADMAP_GITHUB_TOKEN')
  if (user === '') missing.push('ROADMAP_GITHUB_USER')
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `Missing ${missing.join(' and ')} — copy .env.example to .env.local and fill it in.`,
    }
  }

  const warnings: string[] = []
  if (smeeUrl === null) {
    warnings.push('ROADMAP_SMEE_URL is unset — no webhook funnel; the reconciler is on its own.')
  }
  if (webhookSecret === null) {
    warnings.push('ROADMAP_WEBHOOK_SECRET is unset — deliveries will not be verified.')
  }

  return { ok: true, config: { token, user, smeeUrl, webhookSecret, port }, warnings }
}

function readPort(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT
}
