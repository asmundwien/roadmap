/**
 * Where the token and the searched account come from.
 *
 * Both are injected at dev time by Vite from `.env.local` — never read from `localStorage`, and
 * never shipped: a production build would carry the token inside the bundle. See
 * `docs/research/github-api-primitives.md` §4e.
 */
export interface GitHubConfig {
  /** A personal access token. Fine-grained with `Issues: read` is enough. */
  token: string
  /** The account whose repos are searched for `wayfinder:map` issues. */
  user: string
}

export type ConfigResult =
  | { ok: true; config: GitHubConfig }
  | { ok: false; missing: string[]; message: string }

/**
 * Reads config from the Vite env, reporting what is missing rather than throwing — the UI needs to
 * tell the user which line of `.env.local` to fill in.
 */
export function readConfig(env: ImportMetaEnv = import.meta.env): ConfigResult {
  const token = env.VITE_GITHUB_TOKEN?.trim() ?? ''
  const user = env.VITE_GITHUB_USER?.trim() ?? ''

  const missing: string[] = []
  if (token === '') missing.push('VITE_GITHUB_TOKEN')
  if (user === '') missing.push('VITE_GITHUB_USER')

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `Missing ${missing.join(' and ')} — copy .env.example to .env.local and fill it in.`,
    }
  }

  return { ok: true, config: { token, user } }
}
