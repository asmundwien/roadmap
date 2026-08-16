import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { readServerConfig } from './config.ts'
import { createGitHubClient } from './github/client.ts'
import { startRelay } from './relay.ts'
import { createSnapshotSocket } from './socket.ts'
import { createSnapshotStore } from './store.ts'
import { createWebhookHandler } from './webhook.ts'

/**
 * The demoted poll. Webhooks are the engine now; this is the net under them — it trues up
 * whatever smee silently dropped (docs/research/webhook-path.md §4). Down from 90s in v2.
 */
const RECONCILE_MS = 5 * 60_000

/** Budget valve, unchanged in spirit from the v2 store: polling is the only spend we can shrink. */
const THROTTLE_STEPS: { remainingBelow: number; multiplier: number }[] = [
  { remainingBelow: 300, multiplier: 8 },
  { remainingBelow: 1000, multiplier: 4 },
  { remainingBelow: 2000, multiplier: 2 },
]

async function main(): Promise<void> {
  loadRootEnv()

  const result = readServerConfig(process.env)
  if (!result.ok) {
    console.error(result.message)
    process.exit(1)
  }
  const { config, warnings } = result
  for (const warning of warnings) console.warn(warning)

  const client = createGitHubClient({ token: config.token })
  const store = createSnapshotStore(client, config.user)

  const handleWebhook = createWebhookHandler({
    secret: config.webhookSecret,
    knownMaps: () => store.knownMaps(),
    onInvalidation: (invalidation) => store.invalidate(invalidation),
  })

  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/webhook') {
      handleWebhook(request, response)
      return
    }
    if (request.method === 'GET' && (request.url === '/' || request.url === '/health')) {
      const snapshot = store.snapshot()
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          capturedAt: snapshot.capturedAt,
          projects: snapshot.projects.length,
          maps: store.knownMaps().length,
          unreachable: snapshot.unreachable.length,
          rateLimit: snapshot.rateLimit,
          clients: socket.clientCount(),
        }),
      )
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('not found')
  })

  const socket = createSnapshotSocket(server)
  store.onChange((snapshot) => {
    socket.broadcast(snapshot)
    console.info(
      `snapshot: ${snapshot.projects.length} projects, ` +
        `${snapshot.unreachable.length} unreachable → ${socket.clientCount()} clients`,
    )
  })

  await new Promise<void>((resolve) => server.listen(config.port, resolve))
  console.info(`listening on http://localhost:${config.port} (webhook: /webhook, socket: /ws)`)

  // Baseline before the relay starts: state exists before the first delivery can touch it, and
  // no triggers fire from this sweep — subscribers attach to the change feed later (#22).
  await store.reconcile('baseline')
  console.info(`baseline: ${store.knownMaps().length} maps`)

  const relay =
    config.smeeUrl === null
      ? null
      : await startRelay({
          source: config.smeeUrl,
          target: `http://localhost:${config.port}/webhook`,
          onReconnect: () => void store.reconcile('relay reconnect'),
        })
  if (relay) console.info(`relaying ${config.smeeUrl} → /webhook`)

  // The reconciler: a timeout chain rather than an interval, so a slow sweep never overlaps the
  // next, and each delay can stretch with the remaining budget.
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleReconcile(): void {
    reconcileTimer = setTimeout(async () => {
      await store.reconcile('interval')
      scheduleReconcile()
    }, nextReconcileDelay())
  }
  function nextReconcileDelay(): number {
    const remaining = store.snapshot().rateLimit?.remaining
    if (remaining === undefined) return RECONCILE_MS
    const step = THROTTLE_STEPS.find((candidate) => remaining < candidate.remainingBelow)
    return RECONCILE_MS * (step?.multiplier ?? 1)
  }
  scheduleReconcile()

  const shutdown = (): void => {
    console.info('shutting down')
    if (reconcileTimer !== null) clearTimeout(reconcileTimer)
    store.stop()
    socket.close()
    server.close()
    const stopped = relay ? relay.stop() : Promise.resolve()
    void stopped.finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/** `.env.local` lives at the repo root, shared with the web app; absent is fine (CI, tests). */
function loadRootEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)))
  } catch {
    // No .env.local — the environment itself must carry the config.
  }
}

await main()
