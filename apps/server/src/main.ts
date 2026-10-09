import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createRoadmapApplication } from './application/application.ts'
import { createMacOsCredentialVault } from './application/credential-vault.ts'
import { createApplicationOperations } from './application/operations.ts'
import { createAutomationDatabaseDocument } from './automation/database.ts'
import { createAutomationLauncher } from './automation/engine.ts'
import { readServerConfig } from './config.ts'
import { createConfigurationDocument } from './configuration/document.ts'
import { createGitHubProjectAdmission } from './github/admission.ts'
import { createGitHubClient } from './github/client.ts'
import { createGitHubConnectionPort } from './github/connections.ts'
import { createGitHubObserverPool } from './github/observer.ts'
import { createLocalProjectAdmission } from './local/admission.ts'
import { createLocalObserver } from './local/observer.ts'
import { createNotifier } from './notify.ts'
import { createRoadmapTransport, type RoadmapTransport } from './transport.ts'

async function main(): Promise<void> {
  loadRootEnv()

  const result = readServerConfig(process.env)
  if (!result.ok) {
    console.error(result.message)
    process.exit(1)
  }
  const { config, warnings } = result
  for (const warning of warnings) console.warn(warning)

  const github = config.githubApp
    ? createGitHubConnectionPort({
        clientId: config.githubApp.clientId,
        appSlug: config.githubApp.slug,
      })
    : undefined
  const credentialVault = github ? createMacOsCredentialVault() : undefined
  const githubObservers = createGitHubObserverPool()
  const operations = createApplicationOperations()
  const admissions = {
    local: createLocalProjectAdmission(),
    ...(github ? { github: createGitHubProjectAdmission() } : {}),
  }

  const application = createRoadmapApplication({
    configuration: createConfigurationDocument(
      fileURLToPath(new URL('../../../roadmap.config.json', import.meta.url)),
    ),
    automation: {
      database: createAutomationDatabaseDocument(
        fileURLToPath(new URL('../../../roadmap.automation.json', import.meta.url)),
      ),
      launcher: createAutomationLauncher(),
    },
    ...(github && credentialVault
      ? {
          github,
          credentialVault,
        }
      : {}),
    admissions,
    operations,
    providerRead: (accessToken) => createGitHubClient({ token: accessToken }),
    observers: {
      local: (input) => createLocalObserver(input),
      github: (input) => githubObservers.create(input),
      reconcileGitHubTopology: (inputs) => githubObservers.reconcileTopology(inputs),
      stop: () => githubObservers.stop(),
    },
    onChangeEvents: createNotifier(),
  })

  let transport: RoadmapTransport | null = null
  const server = createServer((request, response) => {
    if (transport?.handle(request, response)) return
    if (request.method === 'GET' && (request.url === '/' || request.url === '/health')) {
      const state = application.current()
      const diagnostics = githubObservers.diagnostics()
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          capturedAt: state.roadmap.capturedAt,
          projects: state.projects.length,
          maps: state.projects.reduce(
            (count, project) => count + project.openMaps.length + project.closedMaps.length,
            0,
          ),
          unavailable: state.projects.filter(
            (project) => project.availability.status === 'unavailable',
          ).length,
          rateLimit: diagnostics.rateLimit,
          githubConnections: state.connections.filter(
            (connection) => connection.integration === 'github',
          ).length,
          clients: transport?.clientCount() ?? 0,
        }),
      )
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('not found')
  })

  transport = createRoadmapTransport({
    server,
    application,
    allowedOrigin: config.allowedOrigin,
  })

  application.subscribe((state) => {
    const snapshot = state.roadmap
    console.info(
      `state ${state.stateSequence}: ${snapshot.projects.length} projects, ` +
        `${snapshot.unreachable.length} unreachable → ${transport?.clientCount() ?? 0} clients`,
    )
  })

  await new Promise<void>((resolve) => server.listen(config.port, '127.0.0.1', resolve))
  await application.start()
  console.info(
    `listening on http://127.0.0.1:${config.port} ` +
      `(operations: /api/query + /api/command, state: /ws)`,
  )

  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.info('shutting down')
    transport?.close()
    server.close()
    void application.stop().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/** `.env.local` lives at the repo root, shared with the web app; absent is fine (CI, tests). */
function loadRootEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)))
  } catch {
    // No .env.local. The environment itself may carry the configuration.
  }
}

await main()
