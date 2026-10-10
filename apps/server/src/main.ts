import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createRoadmapApplication } from './application/application.ts'
import { createMacOsCredentialVault } from './application/credential-vault.ts'
import { createApplicationOperations } from './application/operations.ts'
import { createAutomationDatabaseDocument } from './automation/database.ts'
import { createAutomationLauncher } from './automation/launcher.ts'
import { readServerConfig } from './config.ts'
import { createConfigurationDocument } from './configuration/document.ts'
import { createGitHubProjectAdmission } from './github/admission.ts'
import { createGitHubClient } from './github/client.ts'
import { createGitHubConnectionPort } from './github/connections.ts'
import { createGitHubObserverPool } from './github/observer.ts'
import { createDarwinHostExecutor } from './host/darwin.ts'
import { createLocalProjectAdmission } from './local/admission.ts'
import { createLocalObserver } from './local/observer.ts'
import { createNotifier } from './notify.ts'
import { createRoadmapTransport } from './transport.ts'

async function main(): Promise<void> {
  loadRootEnv()

  const result = readServerConfig(process.env)
  if (!result.ok) {
    console.error(result.message)
    process.exitCode = 1
    return
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
  const operations = createApplicationOperations({ host: createDarwinHostExecutor() })
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

  const server = createServer((request, response) => {
    if (transport.handle(request, response)) return
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('not found')
  })

  const transport = createRoadmapTransport({
    server,
    application,
    allowedOrigin: config.allowedOrigin,
  })

  const unsubscribe = application.subscribe((state) => {
    const counts = application.diagnostics()
    console.info(
      `state ${state.stateSequence}: ${counts.projects ?? 'unknown'} registered projects, ` +
        `${counts.maps ?? 'unknown'} current maps, ${counts.unavailable ?? 'unknown'} unavailable projects, ` +
        `${counts.absent ?? 'unknown'} absent projects, ${transport.clientCount()} clients`,
    )
  })

  const listening = new AbortController()
  let shutdownTask: Promise<void> | undefined
  const shutdown = (): Promise<void> => {
    if (shutdownTask) return shutdownTask
    console.info('shutting down')
    // Close listener admission first. Transport drains replies before reaping newly idle sockets.
    // Join listener closure too; never force-close admitted effects or an active response.
    const serverClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) reject(error)
        else resolve()
      })
    })
    const transportClosed = transport.close()
    listening.abort()
    shutdownTask = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        serverClosed,
        Promise.resolve().then(() => application.stop()),
        transportClosed,
        Promise.resolve().then(unsubscribe),
      ])
      process.off('SIGINT', signalShutdown)
      process.off('SIGTERM', signalShutdown)
      if (results.some((result) => result.status === 'rejected')) {
        process.exitCode = 1
        console.error('Roadmap shutdown failed.')
        throw new Error('Roadmap shutdown failed.')
      }
    })
    return shutdownTask
  }
  const signalShutdown = (): void => {
    void shutdown().catch(() => undefined)
  }
  process.on('SIGINT', signalShutdown)
  process.on('SIGTERM', signalShutdown)

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        server.off('listening', onListening)
        server.off('close', onClosed)
        server.off('error', onError)
      }
      const onListening = (): void => {
        cleanup()
        resolve()
      }
      const onClosed = (): void => {
        cleanup()
        resolve()
      }
      const onError = (): void => {
        cleanup()
        reject(new Error('Listener startup failed.'))
      }
      server.once('listening', onListening)
      server.once('close', onClosed)
      server.once('error', onError)
      server.listen({ port: config.port, host: '127.0.0.1', signal: listening.signal })
    })
    if (!shutdownTask) await application.start()
    if (!shutdownTask) {
      console.info(
        `listening on http://127.0.0.1:${config.port} ` +
          '(operations: /api/query + /api/command, state: /ws, diagnostics: /health + /ready)',
      )
    }
  } catch {
    if (!shutdownTask) {
      process.exitCode = 1
      console.error('Roadmap startup failed.')
    }
    await shutdown().catch(() => undefined)
  }
  if (shutdownTask) await shutdownTask.catch(() => undefined)
}

/** `.env.local` lives at the repo root, shared with the web app; absent is fine (CI, tests). */
function loadRootEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)))
  } catch {
    // No .env.local. The environment itself may carry the configuration.
  }
}

await main().catch(() => {
  process.exitCode = 1
  console.error('Roadmap startup failed.')
})
