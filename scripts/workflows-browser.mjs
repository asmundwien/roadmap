import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const scenarioManifest = [
  'Settings configuration write permits independent other-Project refresh before reply',
  'Open settings/import/authorization panes capture current version and current readiness/policy',
  'External revision after capture is rejected without replay and keeps the draft',
  'Shared configuration scope blocks cross-Project writes in both start orders',
  'Independent configuration/resource/native scopes settle in both orders',
  'Selected/cancelled/failed folder interactions preserve local drafts',
  'Normalized registration and repair use actual committed canonical destinations',
  'Non-admission and application rejection remain distinct from post-effect ambiguity',
  'Lost/unreadable/wrong-operation/wrong-correlation/wrong-subject replies never navigate as committed',
  'Unknown attempts survive unrelated success/error, snapshot, reconnect, dismissal and pane close/reopen',
  'Older attempt settlement never replaces the latest created attempt feedback',
  'State-free predecessor/successor outcomes preserve read authority in both settlement orders',
  'Established current-authority differing epoch requests fresh baseline without replay; pre-baseline authority does not',
  'Local/GitHub/degraded/authorization refresh acknowledgements remain operation-specific',
  'Authorization waiting/cancelled/denied/retry/granted feedback follows real accepted phases',
  'Finite native launches contain no executable or path authority and no durable completion claim',
  'Durable Automation admission/verdict/process/report/acknowledged-unknown remain independent',
  'Every named workflow is exercised through the public owner and actual App consumers',
  'Disposable browsers/sockets/application/watchers/files clean up on success or assertion failure',
]
const { values } = parseArgs({
  options: {
    help: { type: 'boolean' },
    'serve-only': { type: 'boolean' },
    'essential-only': { type: 'boolean' },
    headed: { type: 'boolean' },
    'executable-path': { type: 'string' },
    screenshots: { type: 'string' },
  },
  strict: true,
})
if (values.help) {
  console.log(`Workflow regression through the mounted App/provider/router/store and public RoadmapApplication HTTP/WebSocket.

Setup:
  pnpm install
  pnpm exec playwright install chromium

Examples:
  pnpm test:workflows-browser
  pnpm test:workflows-browser --essential-only
  node scripts/workflows-browser.mjs --serve-only
  pnpm test:workflows-browser --screenshots /tmp/roadmap-workflow-screenshots
  pnpm test:workflows-browser --headed --executable-path /path/to/chromium

Options:
  --essential-only   Run the first behavioral concurrency regression, then clean up.
  --serve-only       Print the isolated URL/control endpoint; serve until SIGINT/SIGTERM.
  --headed           Show Chromium.
  --executable-path  Select installed Chromium. CHROMIUM_EXECUTABLE_PATH also works.
  --screenshots      Save scenario PNGs and assertion-failure evidence in this directory.
  --help             Show setup and invocations.

Node must support registerHooks and native TypeScript stripping. The fixture uses installed workspace
Vite/React/ws dependencies and Playwright. No credentials, real configuration, native programs or
Automation processes are used. All configuration, Local files and durable history are temporary.
JSON output reports the full manifest, exercised scenarios and cleanup. Assertions exit nonzero.`)
} else {
  if (values['serve-only'] && (values.screenshots || values['essential-only']))
    throw new Error('--serve-only cannot combine with --screenshots or --essential-only.')
  await main()
}
async function executable(chromium) {
  const explicit = values['executable-path'] ?? process.env.CHROMIUM_EXECUTABLE_PATH
  if (explicit) {
    await access(explicit)
    return explicit
  }
  const candidates = [chromium.executablePath()]
  for (const directory of (process.env.PATH ?? '').split(delimiter))
    for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'chrome', 'chrome.exe'])
      candidates.push(join(directory, name))
  for (const path of candidates) {
    try {
      await access(path)
      return path
    } catch {}
  }
  throw new Error(
    'Install Chromium with pnpm exec playwright install chromium or use --executable-path /path/to/chromium.',
  )
}
async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const web = createRequire(new URL('../apps/web/package.json', import.meta.url))
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        if (
          error.code !== 'ERR_MODULE_NOT_FOUND' ||
          !(specifier === 'ws' || specifier.startsWith('@roadmap/contracts/'))
        )
          throw error
        return nextResolve(specifier, {
          ...context,
          parentURL: pathToFileURL(join(root, 'apps/server/src/main.ts')).href,
        })
      }
    },
  })
  let vite, fixture, browser, page, cache, tooling
  const errors = [],
    scenarios = [],
    screenshots = []
  let failure
  let failed = false
  const cleanupErrors = []
  let success
  let stopSignal
  let resolveStop
  const stopped = values['serve-only']
    ? new Promise((resolve) => {
        resolveStop = resolve
      })
    : null
  function stopServing(signal) {
    if (stopSignal) return
    stopSignal = signal
    resolveStop()
  }
  const interrupt = () => stopServing('SIGINT')
  const terminate = () => stopServing('SIGTERM')
  if (values['serve-only']) {
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
  }
  const screenshotDirectory = values.screenshots ? resolve(values.screenshots) : null
  async function capture(label) {
    if (!page || !screenshotDirectory) return
    const path = join(
      screenshotDirectory,
      `${String(screenshots.length + 1).padStart(2, '0')}-${label}.png`,
    )
    await page.screenshot({ path, fullPage: true, timeout: 15_000 })
    screenshots.push({ label, path, url: page.url() })
  }
  try {
    const { createServer } = await import(pathToFileURL(web.resolve('vite')).href)
    const { default: react } = await import(pathToFileURL(web.resolve('@vitejs/plugin-react')).href)
    cache = await mkdtemp(join(tmpdir(), 'roadmap-workflows-vite-'))
    if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true })
    const entry = join(root, 'scripts/fixtures/workflows-browser.tsx')
    tooling = createHttpServer((_request, response) => response.writeHead(404).end())
    await new Promise((resolve, reject) => {
      tooling.once('error', reject)
      tooling.listen(0, '127.0.0.1', resolve)
    })
    const address = tooling.address()
    assert.ok(address && typeof address !== 'string')
    vite = await createServer({
      configFile: false,
      root: join(root, 'apps/web'),
      cacheDir: cache,
      envDir: false,
      publicDir: false,
      appType: 'custom',
      plugins: [
        react(),
        {
          name: 'workflows-fixture-dependencies',
          enforce: 'pre',
          async resolveId(source, importer, options) {
            if (
              !importer?.includes('/scripts/fixtures/workflows-browser.tsx') ||
              source.startsWith('.') ||
              source.startsWith('/') ||
              source.startsWith('\0')
            )
              return null
            return this.resolve(source, join(root, 'apps/web/src/main.tsx'), {
              ...options,
              skipSelf: true,
            })
          },
        },
      ],
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server: tooling, host: '127.0.0.1', clientPort: address.port },
        fs: { allow: [root, cache] },
      },
      optimizeDeps: {
        entries: [entry],
        include: [
          'react',
          'react-dom/client',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
          'use-sync-external-store/with-selector',
        ],
      },
      resolve: {
        dedupe: ['react', 'react-dom'],
        alias: [{ find: /^@\//, replacement: `${join(root, 'apps/web/src')}/` }],
      },
    })
    const { createWorkflowsServer } = await import('./fixtures/workflows-server.ts')
    fixture = await createWorkflowsServer(vite.middlewares, entry)
    console.log(
      JSON.stringify({
        fixture: fixture.origin,
        control: `${fixture.origin}/__fixture/control?action=status`,
        paths: fixture.paths,
        scenarioManifest,
        screenshotDirectory,
      }),
    )
    if (values['serve-only']) {
      await stopped
      success = { status: 'stopped', mode: 'serve-only', signal: stopSignal }
    } else {
      let chromium
      try {
        ;({ chromium } = await import('playwright'))
      } catch {
        throw new Error(
          'Missing Playwright. Run pnpm install, then pnpm exec playwright install chromium.',
        )
      }
      browser = await chromium.launch({
        executablePath: await executable(chromium),
        headless: !values.headed,
      })
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.on('pageerror', (error) => errors.push(error.message))
      const control = (action, argument = '') => fixture.control(action, argument)
      const snapshot = () => page.evaluate(() => window.workflowsFixture.snapshot())
      const text = () => page.locator('body').innerText()
      async function until(label, predicate) {
        const deadline = Date.now() + 20_000
        while (!(await predicate())) {
          assert.deepEqual(errors, [], `Browser errors before ${label}`)
          if (Date.now() >= deadline)
            throw new Error(
              `Timed out waiting for ${label}. URL ${page.url()}. DOM ${await text()}`,
            )
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        assert.deepEqual(errors, [], `Browser errors after ${label}`)
      }
      async function navigate(path) {
        await page.evaluate((destination) => window.workflowsFixture.navigate(destination), path)
        await until(`navigation ${path}`, () => new URL(page.url()).pathname === path)
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
      }
      async function scenario(name, run) {
        await run()
        await capture(name.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase())
        scenarios.push(name)
      }
      await page.goto(`${fixture.origin}${fixture.paths.alpha}`)
      await until('actual Settings pane', () =>
        page.getByRole('button', { name: 'Save name', exact: true }).count(),
      )
      await until(
        'ready baseline',
        async () => (await snapshot()).synchronization === 'synchronized',
      )
      await scenario(scenarioManifest[0], async () => {
        await page.getByLabel('Display name', { exact: true }).fill('Alpha independent write')
        const initialRequestCount = (await control('status')).requests.length
        await control('reply', 'hold')
        await page.getByRole('button', { name: 'Save name', exact: true }).click()
        await until(
          'real committed rename reply held in relay',
          async () => (await control('status')).pendingResponses.length === 1,
        )
        const before = await control('status')
        const write = before.requests.at(-1)
        const heldReply = before.pendingResponses[0]
        assert.equal(write.id, heldReply)
        assert.equal(write.endpoint, '/api/command')
        assert.equal(write.envelope.type, 'command')
        assert.equal(write.envelope.command.type, 'rename-project')
        assert.deepEqual(write.envelope.command.project, {
          integration: 'local',
          projectId: fixture.ids.alpha,
        })
        assert.equal(write.forwarded, true)
        assert.equal(write.outcome.outcome.ok, true)
        const renameAttempt = (await snapshot()).workflows.attempts.findLast(
          (value) => value.operation === 'rename-project',
        )
        assert.equal(renameAttempt.kind, 'pending')
        await navigate(fixture.paths.beta)
        const refresh = page.getByRole('button', { name: 'Refresh now', exact: true })
        await until('other-Project refresh control', () => refresh.count())
        assert.equal(
          await refresh.isEnabled(),
          true,
          'An open Settings configuration attempt must not disable independent other-Project refresh while its actual reply is delayed.',
        )
        await refresh.click()
        await until(
          'independent real refresh dispatch',
          async () => (await control('status')).requests.length > before.requests.length,
        )
        await until('real refresh acknowledgement before held write settlement', async () =>
          (await snapshot()).workflows.attempts.some(
            (value) =>
              value.operation === 'refresh-project' &&
              value.kind === 'acknowledged' &&
              value.result.project.projectId === fixture.ids.beta,
          ),
        )
        const concurrent = await control('status')
        assert.equal(
          concurrent.requests.length,
          before.requests.length + 1,
          'The Refresh click must issue exactly one independent HTTP request.',
        )
        const refreshRequest = concurrent.requests.at(-1)
        assert.equal(refreshRequest.endpoint, '/api/command')
        assert.equal(refreshRequest.envelope.type, 'command')
        assert.equal(refreshRequest.envelope.command.type, 'refresh-project')
        assert.deepEqual(refreshRequest.envelope.command.project, {
          integration: 'local',
          projectId: fixture.ids.beta,
        })
        assert.equal(refreshRequest.forwarded, true)
        assert.equal(refreshRequest.outcome.outcome.ok, true)
        assert.equal(refreshRequest.outcome.outcome.result.attempt.kind, 'observed')
        assert.deepEqual(
          concurrent.pendingResponses,
          [heldReply],
          'The first real rename reply must remain held while refresh completes.',
        )
        assert.equal(
          (await snapshot()).workflows.attempts.find((value) => value.id === renameAttempt.id).kind,
          'pending',
        )
        assert.deepEqual(
          concurrent.requests
            .slice(initialRequestCount)
            .map((value) => value.envelope.command.type),
          ['rename-project', 'refresh-project'],
          'Only one configuration write and one independent refresh may dispatch. Neither may replay.',
        )
        await control('release-reply', String(heldReply))
        await until(
          'held Settings write settlement',
          async () =>
            (await snapshot()).workflows.attempts.find((value) => value.id === renameAttempt.id)
              .kind === 'acknowledged',
        )
        const completed = await control('status')
        assert.deepEqual(completed.pendingResponses, [])
        assert.equal(
          completed.requests.length,
          concurrent.requests.length,
          'Settling the held write must not replay either request.',
        )
      })
      if (values['essential-only']) {
        success = {
          status: 'passed',
          mode: 'essential-only',
          scenarios,
          scenarioManifest,
          screenshots,
          limits: 'Only the first mounted behavioral regression was exercised.',
        }
      } else {
        await completeSchedules({
          page,
          fixture,
          control,
          snapshot,
          text,
          until,
          navigate,
          scenario,
          scenarios,
        })
        assert.deepEqual(errors, [])
        const expected = scenarioManifest.slice(0, -1)
        assert.deepEqual(
          [...scenarios].sort(),
          [...expected].sort(),
          'Every acceptance schedule must execute before a full proof passes.',
        )
        success = {
          status: 'passed',
          scenarios,
          scenarioManifest,
          screenshots,
          final: await control('status'),
          limits:
            'Harmless providers own external credentials/native/process effects. One explicit pre-baseline authority schedule uses the public raw store.execute seam; all workflow schedules use named owner and actual App consumers. Fixture-native WebSocket and relay counters record generations, fetch-start correlation, actual validated withheld publications, explicit close requests and physical closes. HTTP successors stop predecessor source ownership but retain its real accepted transport until native retirement or explicit fixture disconnect; no terminal lifecycle state is fabricated. Explicit application stop closes its real backend transport. Directory durability confirmation is withheld through a fixture ConfigurationDocument port only after a real successful filesystem write.',
        }
      }
    }
  } catch (error) {
    try {
      await capture('failure')
    } catch (captureError) {
      console.error(JSON.stringify({ status: 'screenshot-failed', error: String(captureError) }))
    }
    const transportEvidence = fixture ? await fixture.control('status').catch(() => null) : null
    const nativeEvidence = page
      ? await page
          .evaluate(() => ({
            sockets: window.workflowsFixture?.sockets(),
            requestStarts: window.workflowsFixture?.requestStarts(),
          }))
          .catch(() => null)
      : null
    console.error(
      JSON.stringify({
        status: 'failed',
        error: String(error),
        errors,
        scenarios,
        scenarioManifest,
        screenshots,
        url: page?.url() ?? null,
        transportEvidence: transportEvidence && {
          held: transportEvidence.held,
          socketConnections: transportEvidence.socketConnections,
          activeSockets: transportEvidence.activeSockets,
          upstreamSockets: transportEvidence.upstreamSockets,
          generations: transportEvidence.socketGenerations,
          transitions: transportEvidence.socketTransitions,
          backends: transportEvidence.backends,
        },
        nativeEvidence,
      }),
    )
    failure = error
    failed = true
  } finally {
    async function clean(action) {
      try {
        await action()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    await clean(async () => {
      await browser?.close()
    })
    await clean(async () => {
      await fixture?.close()
    })
    await clean(async () => {
      await vite?.close()
    })
    await clean(async () => {
      if (tooling?.listening) {
        tooling.closeAllConnections()
        await new Promise((resolve, reject) =>
          tooling.close((error) => (error ? reject(error) : resolve())),
        )
      }
    })
    await clean(async () => {
      if (cache) await rm(cache, { recursive: true, force: true })
    })
    await clean(() => hooks.deregister())
    await clean(async () => {
      if (cache) await assert.rejects(access(cache))
      if (fixture) {
        const state = await fixture.control('status').catch(() => null)
        assert.equal(
          state,
          null,
          'Closed fixture cannot retain application or filesystem authority.',
        )
      }
    })
    console.log(
      JSON.stringify({
        status: cleanupErrors.length ? 'cleanup-failed' : 'cleaned-up',
        errors: cleanupErrors.map(String),
        services: [
          'browser',
          'application',
          'HTTP/WebSocket-relay',
          'observers',
          'configuration',
          'Automation-database',
          'Local-files',
          'vite',
          'tooling-socket',
          'temporary-cache',
        ],
      }),
    )
    if (!cleanupErrors.length) {
      scenarios.push(scenarioManifest.at(-1))
      console.log(
        JSON.stringify({
          status: 'cleanup-proof',
          scenario: scenarioManifest.at(-1),
          exercised: scenarios,
        }),
      )
    }
    if (values['serve-only']) {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      failed ? [failure, ...cleanupErrors] : cleanupErrors,
      failed ? 'Workflow assertion and cleanup failed.' : 'Workflow runner cleanup failed.',
    )
  }
  if (failed) throw failure
  if (success) console.log(JSON.stringify(success))
}

async function completeSchedules({
  page,
  fixture,
  control,
  snapshot,
  text,
  until,
  navigate,
  scenario,
}) {
  const project = (id) => ({ integration: 'local', projectId: id })
  const alpha = project(fixture.ids.alpha),
    beta = project(fixture.ids.beta)
  const subject = (value) => ({ kind: 'project', project: value })
  const registration = { kind: 'registration', integration: 'local', connectionId: 'local' }
  const methods = [
    'beginAuthorization',
    'reauthorizeConnection',
    'retryAuthorization',
    'cancelAuthorization',
    'renameConnection',
    'removeConnection',
    'registerProject',
    'renameProject',
    'repairWorkspace',
    'removeProject',
    'setAutomationEnabled',
    'setProjectAutomationEnabled',
    'startOverride',
    'refreshProject',
    'launchProject',
    'selectWorkspace',
    'dismiss',
  ]
  assert.deepEqual(
    await page.evaluate(() => window.workflowsFixture.methods()),
    methods,
    'The public owner must provide the complete named workflow contract.',
  )
  const exercised = new Set()
  async function start(name, argument) {
    exercised.add(name)
    return page.evaluate((input) => window.workflowsFixture.start(input), { name, argument })
  }
  const settlement = (handle) =>
    page.evaluate((handle) => window.workflowsFixture.settlement(handle), handle)
  async function settled(handle, kind = 'acknowledged') {
    await until(
      'typed workflow settlement',
      async () => (await settlement(handle))?.kind !== 'pending',
    )
    const result = await settlement(handle)
    assert.equal(
      result.kind,
      'settled',
      'Named methods must settle an attempt, not throw generic transport policy to the consumer.',
    )
    assert.equal(result.value.kind, kind)
    assert.equal(typeof result.value.id, 'string')
    return result.value
  }
  const attempts = async () => (await snapshot()).workflows.attempts
  const feedback = (operation, scoped, owner) =>
    page.evaluate(
      ({ operation, scoped, owner }) => window.workflowsFixture.feedback(operation, scoped, owner),
      { operation, scoped, owner },
    )
  async function ready() {
    await until('synchronized ready application', async () => {
      const value = await snapshot()
      return value.synchronization === 'synchronized' && value.lifecycle?.phase === 'ready'
    })
  }
  async function version(version) {
    await until(
      'latest accepted configuration version',
      async () => (await snapshot()).state?.configurationVersion === version,
    )
  }
  const count = async () => (await control('status')).requests.length
  async function dispatched(previous) {
    await until('actual HTTP dispatch', async () => (await count()) > previous)
  }
  const rename = (target, name) => start('renameProject', { project: target, name })

  await scenario(scenarioManifest[1], async () => {
    await navigate(fixture.paths.alpha)
    await page.getByLabel('Display name', { exact: true }).fill('Draft survives current revision')
    const changed = await control('advance-revision')
    await version(changed.state.configurationVersion)
    const before = await count()
    await page.getByRole('button', { name: 'Save name', exact: true }).click()
    await dispatched(before)
    const record = (await control('status')).requests.at(-1)
    assert.equal(
      record.envelope.command.expectedConfigurationVersion,
      changed.state.configurationVersion,
    )
    await until('Settings write acknowledgement', async () =>
      (await attempts()).some(
        (value) =>
          value.operation === 'rename-project' &&
          value.kind === 'acknowledged' &&
          value.result.configurationVersion > changed.state.configurationVersion,
      ),
    )
    await navigate(fixture.paths.connections)
    await page
      .getByRole('button', { name: /add.*github|add.*connection/i })
      .first()
      .click()
    await page.getByLabel('Connection name', { exact: true }).fill('Open authorization draft')
    const advanced = await control('advance-revision')
    await version(advanced.state.configurationVersion)
    const authCount = await count()
    await page.getByRole('button', { name: 'Start authorization', exact: true }).click()
    await dispatched(authCount)
    assert.equal(
      (await control('status')).requests.at(-1).envelope.command.expectedConfigurationVersion,
      advanced.state.configurationVersion,
    )
    await until('accepted waiting phase in actual authorization pane', async () =>
      /FIXTURE|waiting/i.test(await page.locator('dialog[open]').innerText()),
    )
    const authChange = await control('advance-revision')
    await version(authChange.state.configurationVersion)
    const cancelCount = await count()
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: /Cancel authorization/i })
      .click()
    await dispatched(cancelCount)
    assert.equal(
      (await control('status')).requests.at(-1).envelope.command.expectedConfigurationVersion,
      authChange.state.configurationVersion,
    )
    await until('cancelled phase in actual open authorization pane', async () =>
      /cancelled/i.test(await page.locator('dialog[open]').innerText()),
    )
    await control('withhold')
    await control('disconnect')
    await until(
      'open authorization pane retained policy',
      async () =>
        (await snapshot()).synchronization === 'retained' &&
        (await snapshot()).transport === 'live',
    )
    const retryControl = page.locator('dialog[open]').getByRole('button', { name: /Retry/i })
    assert.equal(await retryControl.isEnabled(), false)
    await control('release-baseline')
    await ready()
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click()
    await navigate(fixture.paths.import)
    await page.getByLabel('Display name', { exact: true }).fill('Preserved import draft')
    const selectedImport = await control('selector-selected')
    await page.getByRole('button', { name: /Choose.*folder/ }).click()
    await until(
      'open import valid draft before retained policy',
      async () => (await page.locator('fieldset output').innerText()) === selectedImport.alias,
    )
    const importDraft = await page.getByLabel('Display name', { exact: true }).elementHandle()
    assert.ok(
      importDraft,
      'The real import pane must remain mounted across backend stop and restart.',
    )
    const beforeStop = await snapshot()
    const stopped = await control('stop-application')
    assert.equal(
      stopped.state.phase,
      'stopped',
      'Only the actual public Application stop establishes terminal server lifecycle.',
    )
    // The real transport closes rather than publishing terminal lifecycle. Its close retains the accepted browser read.
    await until('open import retained readiness after real upstream close', async () => {
      const value = await snapshot()
      return value.synchronization === 'retained' && value.transport !== 'live'
    })
    assert.deepEqual(
      (await snapshot()).state,
      beforeStop.state,
      'Transport closure must retain the actual accepted read without manufacturing a terminal snapshot or version.',
    )
    assert.equal(await importDraft.evaluate((input) => input.isConnected), true)
    assert.equal(await page.locator('fieldset output').innerText(), stopped.alias)
    assert.equal(
      await page.getByRole('button', { name: 'Validate and save', exact: true }).isEnabled(),
      false,
    )
    const prior = await count()
    const denied = await settled(
      await start('registerProject', {
        candidate: {
          integration: 'local',
          connectionId: 'local',
          workspace: { path: (await control('status')).alias },
        },
      }),
      'not-dispatched',
    )
    assert.equal(await count(), prior)
    assert.equal('configurationVersion' in denied, false)
    assert.equal('outcome' in denied, false, 'A readiness refusal has no delivered server outcome.')
    assert.equal(
      await page.getByLabel('Display name', { exact: true }).inputValue(),
      'Preserved import draft',
    )
    const restarted = await control('restart-application')
    await ready()
    await until(
      'actual restarted backend read authority',
      async () => (await snapshot()).state.serverEpoch === restarted.state.serverEpoch,
    )
    assert.notEqual(restarted.state.serverEpoch, beforeStop.state.serverEpoch)
    assert.equal(
      (await snapshot()).state.configurationVersion,
      restarted.state.configurationVersion,
    )
    assert.equal(await importDraft.evaluate((input) => input.isConnected), true)
    assert.equal(
      await page.getByLabel('Display name', { exact: true }).inputValue(),
      'Preserved import draft',
    )
    assert.equal(await page.locator('fieldset output').innerText(), restarted.alias)
    assert.equal(
      await page.getByRole('button', { name: 'Validate and save', exact: true }).isEnabled(),
      true,
    )
  })

  await scenario(scenarioManifest[2], async () => {
    await navigate(fixture.paths.beta)
    await page.getByLabel('Display name', { exact: true }).fill('Keep stale draft')
    await control('request', 'hold')
    const before = await count()
    await page.getByRole('button', { name: 'Save name', exact: true }).click()
    await dispatched(before)
    const captured = (await control('status')).requests.at(-1).envelope.command
      .expectedConfigurationVersion
    const external = await control('advance-revision')
    assert.ok(external.state.configurationVersion > captured)
    await control('release-dispatch')
    await until('truthful external stale rejection', async () =>
      (await attempts()).some(
        (value) =>
          value.operation === 'rename-project' &&
          value.kind === 'rejected' &&
          value.error.code === 'conflict',
      ),
    )
    assert.equal(await count(), before + 1, 'Stale writes must not silently rebase or replay.')
    assert.equal(
      await page.getByLabel('Display name', { exact: true }).inputValue(),
      'Keep stale draft',
    )
    const stale = (await attempts()).findLast((value) => value.operation === 'rename-project')
    assert.ok((await text()).includes(stale.message))
  })

  await scenario(scenarioManifest[3], async () => {
    for (const [first, second] of [
      [alpha, beta],
      [beta, alpha],
    ]) {
      await ready()
      await control('reply', 'hold')
      const before = await count()
      const one = await rename(first, `First ${first.projectId}`)
      await until(
        'first shared-revision reply held',
        async () => (await control('status')).pendingResponses.length === 1,
      )
      const two = await rename(second, `Second ${second.projectId}`)
      const blocked = await settled(two, 'not-dispatched')
      assert.equal(blocked.error.code, 'conflict')
      assert.equal(await count(), before + 1)
      await control('release-reply')
      await settled(one)
      assert.equal(
        (await settlement(two)).value.kind,
        'not-dispatched',
        'Settling another scope cannot queue the rejected write.',
      )
      const fresh = await rename(second, `Fresh ${second.projectId}`)
      await settled(fresh)
    }
  })

  await scenario(scenarioManifest[4], async () => {
    for (const reverse of [false, true]) {
      await control('reply', 'hold')
      const config = await rename(alpha, `Independent ${reverse}`)
      await until(
        'held config reply',
        async () => (await control('status')).pendingResponses.length === 1,
      )
      const firstId = (await control('status')).pendingResponses[0]
      await control('reply', 'hold')
      const refresh = await start('refreshProject', { project: beta })
      await until(
        'independent replies overlap',
        async () => (await control('status')).pendingResponses.length === 2,
      )
      const secondId = (await control('status')).pendingResponses[1]
      assert.equal((await settlement(config)).kind, 'pending')
      assert.equal((await settlement(refresh)).kind, 'pending')
      const firstHandle = reverse ? refresh : config
      const secondHandle = reverse ? config : refresh
      await control('release-reply', String(reverse ? secondId : firstId))
      await settled(firstHandle)
      assert.equal((await settlement(secondHandle)).kind, 'pending')
      await control('release-reply', String(reverse ? firstId : secondId))
      await settled(secondHandle)
      await control('reply', 'hold')
      const selectorHandle = await start('selectWorkspace', { owner: registration })
      await until(
        'actual selector reply held',
        async () => (await control('status')).pendingResponses.length === 1,
      )
      const selectorBefore = await count()
      await settled(await start('selectWorkspace', { owner: subject(beta) }), 'not-dispatched')
      assert.equal(await count(), selectorBefore)
      const noHostMutex = await start('launchProject', {
        project: beta,
        operation: 'open-workspace',
      })
      await settled(noHostMutex)
      await control('release-reply')
      await settled(selectorHandle)
      await control('hold-host')
      const launch = await start('launchProject', { project: alpha, operation: 'open-workspace' })
      await until(
        'harmless native effect barrier',
        async () => (await control('status')).hostBlocked,
      )
      const localBlock = await settled(
        await start('refreshProject', { project: alpha }),
        'not-dispatched',
      )
      assert.equal(localBlock.error.code, 'conflict')
      const independent = await start('refreshProject', { project: beta })
      await settled(independent)
      assert.equal((await settlement(launch)).kind, 'pending')
      await control('release-host')
      await settled(launch)
    }
  })

  await scenario(scenarioManifest[5], async () => {
    await navigate(fixture.paths.import)
    await control('selector-selected')
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click()
    const path = (await control('status')).alias
    await until(
      'selected import draft',
      async () => (await page.locator('fieldset output').innerText()) === path,
    )
    await control('selector-cancelled')
    await page.getByRole('button', { name: 'Choose another folder', exact: true }).click()
    await until('explicit cancelled interaction', async () => /cancelled/i.test(await text()))
    assert.equal(await page.locator('fieldset output').innerText(), path)
    await control('selector-error')
    await page.getByRole('button', { name: 'Choose another folder', exact: true }).click()
    await until('actual selection application failure', async () =>
      (await attempts()).some(
        (value) => value.operation === 'select-workspace' && value.kind === 'rejected',
      ),
    )
    assert.equal(await page.locator('fieldset output').innerText(), path)
    const selected = await settled(
      await start('selectWorkspace', { owner: registration }),
      'rejected',
    )
    assert.equal(selected.error.code, 'selection-failed')
    await control('selector-selected')
    await control('reply', 'hold')
    await page.getByRole('button', { name: 'Choose another folder', exact: true }).click()
    await until(
      'selector delayed past consumer lifetime',
      async () => (await control('status')).pendingResponses.length === 1,
    )
    await navigate(fixture.paths.beta)
    await control('release-reply')
    await navigate(fixture.paths.import)
    assert.equal(
      await page.locator('fieldset output').innerText(),
      'No folder selected',
      'A late selector reply must not populate a replacement pane draft.',
    )
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click()
    await until(
      'new pane deliberate selected draft',
      async () => (await page.locator('fieldset output').innerText()) === path,
    )
  })

  let registered
  await scenario(scenarioManifest[6], async () => {
    await page.getByLabel('Display name', { exact: true }).fill('Canonical registration')
    const changed = await control('advance-revision')
    await version(changed.state.configurationVersion)
    const before = await count()
    await page.getByRole('button', { name: 'Validate and save', exact: true }).click()
    await dispatched(before)
    const submitted = (await control('status')).requests.at(-1).envelope.command
    assert.equal(submitted.expectedConfigurationVersion, changed.state.configurationVersion)
    assert.equal(submitted.candidate.workspace.path, changed.alias)
    await until('committed canonical registration attempt', async () =>
      (await attempts()).some(
        (value) => value.operation === 'register-project' && value.kind === 'acknowledged',
      ),
    )
    registered = (await attempts()).findLast(
      (value) => value.operation === 'register-project' && value.kind === 'acknowledged',
    )
    assert.equal(registered.result.workspacePath, changed.newWorkspace)
    assert.notEqual(registered.result.workspacePath, submitted.candidate.workspace.path)
    const canonical = `/projects/local/${encodeURIComponent(registered.result.project.projectId).replaceAll('%3A', ':')}/settings`
    assert.equal(registered.destination, canonical)
    const link = page.getByRole('link', { name: 'Open Project settings', exact: true })
    if (new URL(page.url()).pathname !== canonical) {
      await until('canonical registration resource link', () => link.count())
      assert.equal(await link.getAttribute('href'), canonical)
      await link.click()
    }
    await until(
      'canonical registration browser destination',
      () => new URL(page.url()).pathname === canonical,
    )
    assert.notEqual(changed.alias, changed.repairAlias)
    await control('move-workspace')
    await settled(await start('refreshProject', { project: alpha }))
    await until('retained Local source after actual Workspace move', async () => {
      const retained = (await snapshot()).state?.projects.find(
        (project) =>
          project.ref.integration === alpha.integration &&
          project.ref.projectId === alpha.projectId,
      )
      return retained?.resource.kind === 'retained-unavailable'
    })
    const nativeBefore = await control('status')
    const reproofLocation = page.url()
    // Source refresh retains native admission. A named launch reproves the missing root before any host effect.
    const reproof = await settled(
      await start('launchProject', { project: alpha, operation: 'open-workspace' }),
      'rejected',
    )
    assert.equal(reproof.error.code, 'admission-failed')
    assert.equal(reproof.error.field, 'workspace.path')
    assert.deepEqual(reproof.subject, subject(alpha))
    assert.equal(page.url(), reproofLocation, 'Rejected Workspace reproof must not navigate.')
    assert.equal((await control('status')).hostInvocations, nativeBefore.hostInvocations)
    await until('actual server and browser native Workspace actions revoked', async () => {
      const server = (await control('status')).state
      const browser = (await snapshot()).state
      return [server, browser].every((state) => {
        const retained = state?.projects.find(
          (project) =>
            project.ref.integration === alpha.integration &&
            project.ref.projectId === alpha.projectId,
        )
        return retained && !retained.actions.some((action) => action.kind === 'server-launch')
      })
    })
    await navigate(fixture.paths.alpha)
    await until('actual repair control', () =>
      page.getByRole('button', { name: 'Validate and repair', exact: true }).count(),
    )
    await control('selector-selected', changed.repairAlias)
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click()
    await until(
      'repair alias selected',
      async () => (await page.locator('fieldset output').innerText()) === changed.repairAlias,
    )
    await page.getByRole('button', { name: 'Validate and repair', exact: true }).click()
    await until('canonical repair acknowledged', async () =>
      (await attempts()).some(
        (value) => value.operation === 'repair-project-workspace' && value.kind === 'acknowledged',
      ),
    )
    const repair = (await attempts()).findLast(
      (value) => value.operation === 'repair-project-workspace' && value.kind === 'acknowledged',
    )
    const repairSubmitted = (await control('status')).requests.findLast(
      (request) => request.envelope.command.type === 'repair-project-workspace',
    ).envelope.command
    assert.deepEqual(repairSubmitted.project, alpha)
    assert.equal(repairSubmitted.workspace.path, changed.repairAlias)
    assert.deepEqual(repair.result.project, alpha)
    assert.deepEqual(repair.canonicalSubject, subject(alpha))
    assert.equal(repair.result.workspacePath, join(changed.root, 'alpha-moved'))
    assert.notEqual(repair.result.workspacePath, repairSubmitted.workspace.path)
    await until(
      'server and browser admit repaired canonical Workspace for the same Project',
      async () => {
        const server = (await control('status')).state
        const browser = (await snapshot()).state
        return [server, browser].every((state) => {
          const repaired = state?.projects.find(
            (project) =>
              project.ref.integration === alpha.integration &&
              project.ref.projectId === alpha.projectId,
          )
          return (
            repaired?.source.integration === 'local' &&
            repaired.source.path === repair.result.workspacePath &&
            repaired.actions.some(
              (action) => action.kind === 'server-launch' && action.operation === 'open-workspace',
            )
          )
        })
      },
    )
    assert.equal(repair.destination, fixture.paths.alpha)
    assert.equal(new URL(page.url()).pathname, fixture.paths.alpha)
    await until('canonical repair feedback in actual Settings', async () =>
      (await text()).includes(repair.result.workspacePath),
    )
    const repairLink = page.getByRole('link', { name: 'Open Project settings', exact: true })
    assert.equal(await repairLink.getAttribute('href'), repair.destination)
    await repairLink.click()
    await until(
      'actual canonical repair resource link destination',
      () => new URL(page.url()).pathname === repair.destination,
    )
    await navigate(fixture.paths.githubImport)
    await control('selector-selected', changed.githubAlias)
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click()
    await until(
      'GitHub import canonical candidate draft',
      async () => (await page.locator('fieldset output').innerText()) === changed.githubAlias,
    )
    await page.getByRole('button', { name: 'Validate and save', exact: true }).click()
    await until(
      'actual GitHub registration owner outcome',
      async () =>
        (await attempts()).findLast((value) => value.operation === 'register-project')?.kind ===
          'acknowledged' &&
        (await attempts()).findLast((value) => value.operation === 'register-project').result
          .project.integration === 'github',
    )
    const remoteRegistration = (await attempts()).findLast(
      (value) => value.operation === 'register-project',
    )
    assert.equal(remoteRegistration.result.workspacePath, changed.githubWorkspace)
    assert.equal(remoteRegistration.result.connectionId, fixture.ids.connection)
    assert.equal(remoteRegistration.canonicalSubject.project.integration, 'github')
    assert.equal(
      await page
        .getByRole('link', { name: 'Open Project settings', exact: true })
        .getAttribute('href'),
      remoteRegistration.destination,
    )
    assert.ok((await text()).includes(changed.githubWorkspace))
  })

  await scenario(scenarioManifest[7], async () => {
    const initial = await control('status')
    await control('request', 'not-admitted')
    const denial = await settled(
      await start('launchProject', { project: alpha, operation: 'open-workspace' }),
      'not-admitted',
    )
    assert.equal(denial.rejection.type, 'request-rejected')
    assert.equal(denial.rejection.reason, 'media-type')
    assert.equal((await control('status')).hostInvocations, initial.hostInvocations)
    const reject = await settled(
      await start('registerProject', {
        candidate: {
          integration: 'local',
          connectionId: 'local',
          workspace: { path: join(initial.root, 'not-present') },
        },
      }),
      'rejected',
    )
    assert.equal(reject.error.code, 'admission-failed')
    assert.ok(Object.keys(reject.fields).length > 0)
    assert.equal(reject.destination ?? null, null)
    for (const [integration, path, field] of [
      ['local', fixture.paths.import, 'folder'],
      ['github', fixture.paths.githubImport, 'workspace'],
    ]) {
      await navigate(path)
      const nameDraft = `Retained ${integration} registration draft`
      await page.getByLabel('Display name', { exact: true }).fill(nameDraft)
      const pathDraft = await page.locator('fieldset output').innerText()
      const emptyCount = await count()
      const previousAttempt = (await attempts()).findLast(
        (value) => value.operation === 'register-project',
      )
      await page.getByRole('button', { name: 'Validate and save', exact: true }).click()
      await until('central empty draft field error for a new attempt', async () => {
        const latest = (await attempts()).findLast(
          (value) => value.operation === 'register-project',
        )
        return latest?.id !== previousAttempt?.id && latest?.kind === 'not-dispatched'
      })
      const empty = (await attempts()).findLast((value) => value.operation === 'register-project')
      const fieldError = empty.fields.folder ?? empty.fields.workspace
      assert.equal(empty.operation, 'register-project')
      assert.equal(empty.subject.integration, integration)
      assert.equal(empty.error.code, 'validation')
      assert.equal(empty.error.field, field)
      assert.equal(typeof fieldError, 'string')
      assert.ok(fieldError.trim().length > 0)
      assert.equal(fieldError, empty.error.message)
      assert.equal(empty.fields[field], fieldError)
      assert.equal(await count(), emptyCount)
      await until(
        'actual registration field feedback attaches to the retained folder draft',
        async () =>
          (await page.locator('fieldset').getByText(fieldError, { exact: true }).count()) === 1,
      )
      assert.equal(await page.locator('fieldset output').innerText(), pathDraft)
      assert.equal(await page.getByLabel('Display name', { exact: true }).inputValue(), nameDraft)
      assert.equal(new URL(page.url()).pathname, path)
    }
    await navigate(fixture.paths.beta)
    const emptyNameCount = await count()
    const previousNameAttempt = (await attempts()).findLast(
      (value) => value.operation === 'rename-project',
    )
    await page.getByLabel('Display name', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Save name', exact: true }).click()
    await until('central empty name field error for a new attempt', async () => {
      const latest = (await attempts()).findLast((value) => value.operation === 'rename-project')
      return latest?.id !== previousNameAttempt?.id && latest?.kind === 'not-dispatched'
    })
    const emptyName = (await attempts()).findLast((value) => value.operation === 'rename-project')
    assert.equal(emptyName.operation, 'rename-project')
    assert.equal(emptyName.error.code, 'validation')
    assert.equal(emptyName.error.field, 'name')
    assert.equal(typeof emptyName.fields.name, 'string')
    assert.ok(emptyName.fields.name.trim().length > 0)
    assert.equal(emptyName.fields.name, emptyName.error.message)
    assert.equal(await count(), emptyNameCount)
    assert.ok((await text()).includes(emptyName.fields.name))
    assert.equal(await page.getByLabel('Display name', { exact: true }).inputValue(), '')
    await control('unconfirmed-commit')
    const uncertain = await settled(await rename(beta, 'Real commit unconfirmed durability'))
    assert.equal(uncertain.result.commit, 'committed-unconfirmed')
    assert.equal(uncertain.destination, null)
    assert.ok(/unconfirmed/i.test(uncertain.message))
    const onDisk = (await control('status')).state.projects.find(
      (value) => value.ref.projectId === beta.projectId,
    )
    assert.equal(onDisk.name, 'Real commit unconfirmed durability')
  })

  const unknownIds = []
  await scenario(scenarioManifest[8], async () => {
    for (const mode of [
      'lost',
      'unreadable',
      'wrong-operation',
      'wrong-correlation',
      'wrong-subject',
    ]) {
      const before = await control('status')
      await control('reply', mode)
      const unknown = await settled(
        await start('launchProject', { project: alpha, operation: 'open-workspace' }),
        'completion-unknown',
      )
      unknownIds.push(unknown.id)
      assert.equal('result' in unknown, false)
      assert.equal(unknown.destination ?? null, null)
      assert.equal((await control('status')).hostInvocations, before.hostInvocations + 1)
      assert.equal(
        (await control('status')).requests.length,
        before.requests.length + 1,
        'Unknown effects must never replay automatically.',
      )
    }
    await navigate(fixture.paths.import)
    const baselineURL = new URL(page.url()).pathname
    const status = await control('status')
    for (const [index, mode] of [
      'lost',
      'unreadable',
      'wrong-correlation',
      'wrong-operation',
      'wrong-subject',
    ].entries()) {
      await control('selector-selected', status.ambiguityWorkspaces[index])
      await page.getByRole('button', { name: /Choose.*folder/, exact: false }).click()
      await until(
        'fresh actual unknown registration draft',
        async () =>
          (await page.locator('fieldset output').innerText()) === status.ambiguityWorkspaces[index],
      )
      await control('reply', mode)
      const previous = await count()
      const previousAttempt = (await attempts()).findLast(
        (value) => value.operation === 'register-project',
      )
      await page.getByRole('button', { name: 'Validate and save', exact: true }).click()
      await dispatched(previous)
      await until('actual import unknown result for a new attempt', async () => {
        const latest = (await attempts()).findLast(
          (value) => value.operation === 'register-project',
        )
        return latest?.id !== previousAttempt?.id && latest?.kind === 'completion-unknown'
      })
      const attempt = (await attempts()).findLast((value) => value.operation === 'register-project')
      assert.equal(attempt.destination ?? null, null)
      assert.equal(
        (await control('status')).requests.at(-1).outcome.outcome.ok,
        true,
        'The operation really committed before its unusable reply.',
      )
      assert.equal(new URL(page.url()).pathname, baselineURL)
      assert.equal(
        await page.getByRole('link', { name: 'Open Project settings', exact: true }).count(),
        0,
      )
      unknownIds.push(attempt.id)
    }
  })

  await scenario(scenarioManifest[9], async () => {
    const check = async () => {
      const current = await attempts()
      for (const id of unknownIds)
        assert.equal(current.find((value) => value.id === id)?.kind, 'completion-unknown')
      const scoped = await feedback('launch-project-operation', subject(alpha))
      const registrations = await feedback('register-project', registration)
      for (const id of unknownIds)
        assert.ok([...scoped.unknown, ...registrations.unknown].some((value) => value.id === id))
    }
    await settled(await start('refreshProject', { project: beta }))
    await check()
    await settled(
      await start('registerProject', {
        candidate: {
          integration: 'local',
          connectionId: 'local',
          workspace: { path: '/fixture-missing' },
        },
      }),
      'rejected',
    )
    const revision = await control('advance-revision')
    await version(revision.state.configurationVersion)
    await check()
    await control('withhold')
    await control('disconnect')
    await until(
      'socket reopen with retained facts',
      async () =>
        (await snapshot()).transport === 'live' &&
        (await snapshot()).synchronization === 'retained',
    )
    await check()
    await control('release-baseline')
    await ready()
    await check()
    const nativeIds = unknownIds.slice(0, 5)
    const registrationIds = unknownIds.slice(5)
    const nativeSurface = page
      .locator(`a[href="${fixture.paths.alpha}"]`)
      .filter({ hasText: 'Project settings' })
      .locator('xpath=../..')
    const nativeNotices = nativeSurface.getByRole('button', { name: 'Dismiss notice', exact: true })
    const importNotices = page.getByRole('button', { name: 'Dismiss notice', exact: true })
    await navigate(fixture.paths.connections)
    await until(
      'canonical alpha native consumer mounted with all unknown notices',
      async () =>
        (await nativeSurface.count()) === 1 && (await nativeNotices.count()) === nativeIds.length,
    )
    await navigate(fixture.paths.import)
    await until(
      'registration consumer mounted with its own unknown notices',
      async () => (await importNotices.count()) === registrationIds.length,
    )
    await navigate(fixture.paths.connections)
    await until(
      'native consumer remounted without erasing unknown notices',
      async () => (await nativeNotices.count()) === nativeIds.length,
    )
    await check()
    exercised.add('dismiss')
    await nativeNotices.first().click()
    await until(
      'actual native dismissal hides exactly one notice',
      async () => (await nativeNotices.count()) === nativeIds.length - 1,
    )
    await check()
    const afterClick = await attempts()
    assert.equal(
      nativeIds.filter((id) => afterClick.find((value) => value.id === id).dismissed).length,
      1,
    )
    await navigate(fixture.paths.import)
    await until(
      'registration notices remain visible after unrelated native dismissal',
      async () => (await importNotices.count()) === registrationIds.length,
    )
    await importNotices.first().click()
    await until(
      'actual registration dismissal hides exactly one notice',
      async () => (await importNotices.count()) === registrationIds.length - 1,
    )
    await check()
    await page.evaluate((ids) => {
      for (const attemptId of ids) window.workflowsFixture.dismiss(attemptId)
    }, unknownIds)
    await check()
    const dismissed = await attempts()
    assert.ok(unknownIds.every((id) => dismissed.find((value) => value.id === id).dismissed))
    await navigate(fixture.paths.connections)
    await until(
      'dismissed native consumer remounted',
      async () => (await nativeSurface.count()) === 1 && (await nativeNotices.count()) === 0,
    )
    await navigate(fixture.paths.import)
    await until(
      'dismissed registration consumer remounted',
      async () =>
        (await page.getByRole('button', { name: 'Validate and save', exact: true }).count()) ===
          1 && (await importNotices.count()) === 0,
    )
    await check()
    await navigate(fixture.paths.connections)
    await until(
      'canonical native consumer mounted before explicit fresh launch',
      async () => (await nativeSurface.count()) === 1 && (await nativeNotices.count()) === 0,
    )
    const explicit = await settled(
      await start('launchProject', { project: alpha, operation: 'open-workspace' }),
    )
    assert.equal(explicit.result.status, 'invoked')
    await check()
    await until(
      'fresh launch acknowledgement renders in canonical native consumer',
      async () => (await nativeSurface.getByText(explicit.message, { exact: true }).count()) === 1,
    )
    assert.equal(await nativeNotices.count(), 0)
    assert.equal(
      (await feedback('launch-project-operation', subject(alpha))).current.id,
      explicit.id,
    )
  })

  await scenario(scenarioManifest[10], async () => {
    for (const oldSettlesFirst of [false, true]) {
      await control('reply', 'hold')
      const old = await rename(beta, 'Old pending attempt')
      await until(
        'old attempt response held',
        async () => (await control('status')).pendingResponses.length === 1,
      )
      if (oldSettlesFirst) {
        await control('release-reply')
        await settled(old)
      }
      const newerHandle = await rename(beta, 'New current attempt')
      const newer = await settled(newerHandle, oldSettlesFirst ? 'acknowledged' : 'not-dispatched')
      await navigate(fixture.paths.connections)
      await navigate(fixture.paths.beta)
      assert.equal((await feedback('rename-project', subject(beta))).current.id, newer.id)
      if (!oldSettlesFirst) {
        await control('release-reply')
        await settled(old)
      }
      assert.equal((await feedback('rename-project', subject(beta))).current.id, newer.id)
    }
  })

  await epochSchedules({
    page,
    start,
    settled,
    settlement,
    control,
    snapshot,
    attempts,
    until,
    ready,
    version,
    rename,
    alpha,
    beta,
    scenario,
  })

  await scenario(scenarioManifest[13], async () => {
    const local = await settled(await start('refreshProject', { project: beta }))
    assert.equal(local.result.attempt.provenance.integration, 'local')
    assert.equal(local.result.attempt.kind, 'observed')
    const github = { integration: 'github', projectId: fixture.ids.github }
    await control('github-recover')
    const remote = await settled(await start('refreshProject', { project: github }))
    assert.equal(remote.result.attempt.provenance.integration, 'github')
    await control('github-degraded')
    const degraded = await settled(await start('refreshProject', { project: github }))
    assert.ok(['degraded', 'failed'].includes(degraded.result.attempt.kind))
    assert.ok(/incomplete|failed|unreachable/i.test(degraded.message))
    await control('github-authorization')
    const authorization = await settled(await start('refreshProject', { project: github }))
    assert.ok(['degraded', 'failed'].includes(authorization.result.attempt.kind))
    assert.ok(/authorization|access/i.test(authorization.result.attempt.cause))
    await control('github-recover')
    const noNativeActions = (state) => {
      const remoteProject = state.projects.find(
        (value) => value.ref.integration === 'github' && value.ref.projectId === github.projectId,
      )
      assert.ok(remoteProject, 'Original canonical GitHub Project remains present.')
      assert.equal(
        remoteProject.actions.some((action) => action.kind === 'server-launch'),
        false,
      )
    }
    await until('recovered original GitHub Project capabilities reach browser', async () => {
      const server = (await control('status')).state
      const browser = (await snapshot()).state
      return [server, browser].every((state) => {
        const original = state?.projects.find(
          (value) => value.ref.integration === 'github' && value.ref.projectId === github.projectId,
        )
        return original && !original.actions.some((action) => action.kind === 'server-launch')
      })
    })
    noNativeActions((await control('status')).state)
    noNativeActions((await snapshot()).state)
    await navigate(fixture.paths.connections)
    const githubSurface = page
      .locator(`a[href="${fixture.paths.github}"]`)
      .filter({ hasText: 'Project settings' })
      .locator('xpath=../..')
    await until(
      'original GitHub Project Connections consumer mounted',
      async () => (await githubSurface.count()) === 1,
    )
    for (const name of ['Open in VS Code', 'Open Terminal', 'View source folder'])
      assert.equal(
        await githubSurface.getByRole('button', { name, exact: true }).count(),
        0,
        'Unadmitted original GitHub Workspace has no fabricated native capability.',
      )
  })

  await scenario(scenarioManifest[14], async () => {
    const authorizationFeedback = (operationId) =>
      page.evaluate((id) => window.workflowsFixture.authorizationFeedback(id), operationId)
    async function acceptedAuthorization(operationId, status, outcome) {
      await until(`accepted authorization ${outcome ?? status}`, async () => {
        const browser = await snapshot()
        const server = (await control('status')).state
        return (
          browser.synchronization === 'synchronized' &&
          browser.lifecycle?.phase === 'ready' &&
          [server, browser.state].every((state) =>
            state?.authorizationOperations.some(
              (value) =>
                value.id === operationId &&
                value.status === status &&
                (status !== 'terminal' || value.outcome === outcome),
            ),
          ) &&
          (await authorizationFeedback(operationId))?.consumed === true
        )
      })
      const value = (await snapshot()).state.authorizationOperations.find(
        (value) => value.id === operationId,
      )
      assert.equal(value.status, status)
      if (status === 'terminal') assert.equal(value.outcome, outcome)
      return value
    }
    function assertPhase(attempt, operation, phase, operationId) {
      assert.equal(attempt.operation, operation)
      assert.equal(attempt.outcome.ok, true)
      assert.equal(attempt.outcome.operation, operation)
      assert.equal(attempt.result.type, operation)
      assert.equal(attempt.result.phase, phase)
      if (operationId !== undefined) assert.equal(attempt.result.operationId, operationId)
      assert.deepEqual(attempt.outcome.result, attempt.result)
      if (operation === 'retry-github-authorization' || operation === 'cancel-github-authorization')
        assert.deepEqual(attempt.subject, {
          kind: 'authorization',
          operationId: attempt.result.operationId,
        })
    }
    async function assertWaiting(attempt, operation, operationId) {
      assertPhase(attempt, operation, 'waiting', operationId)
      const waiting = await acceptedAuthorization(attempt.result.operationId, 'waiting')
      assert.equal(waiting.verificationUri, attempt.result.verificationUri)
      assert.equal(waiting.userCode, attempt.result.userCode)
      assert.equal(waiting.expiresAt, attempt.result.expiresAt)
      return waiting
    }

    // Reset the provider failure used by the preceding refresh schedule through its real control.
    await control('github-recover')
    const recovery = await settled(
      await start('refreshProject', {
        project: { integration: 'github', projectId: fixture.ids.github },
      }),
    )
    assert.equal(recovery.result.attempt.kind, 'observed')
    await until('accepted recovered GitHub source observation', async () => {
      const browser = await snapshot()
      return (
        browser.synchronization === 'synchronized' &&
        browser.lifecycle?.phase === 'ready' &&
        [(await control('status')).state, browser.state].every((state) =>
          state?.projects.some(
            (value) =>
              value.ref.integration === 'github' &&
              value.ref.projectId === fixture.ids.github &&
              value.resource.kind === 'current-readable' &&
              value.resource.observation.observedAt === recovery.result.attempt.observedAt,
          ),
        )
      )
    })
    await control('authorization-existing-account')
    await control('authorization-pending')
    const repairAuthorization = await settled(
      await start('reauthorizeConnection', { connectionId: fixture.ids.connection }),
    )
    await assertWaiting(repairAuthorization, 'reauthorize-github-connection')
    assert.deepEqual(repairAuthorization.subject, {
      kind: 'connection',
      connectionId: fixture.ids.connection,
    })
    await control('authorization-granted')
    const repairGrant = await acceptedAuthorization(
      repairAuthorization.result.operationId,
      'granted',
    )
    assert.deepEqual(repairGrant.connection, {
      kind: 'current',
      id: fixture.ids.connection,
      accountId: '9001',
    })
    const repairReceipt = await settled(
      await start('cancelAuthorization', { operationId: repairAuthorization.result.operationId }),
    )
    assertPhase(
      repairReceipt,
      'cancel-github-authorization',
      'granted',
      repairAuthorization.result.operationId,
    )
    assert.deepEqual(repairReceipt.result.connection, {
      connectionId: fixture.ids.connection,
      accountId: '9001',
    })
    await version(repairReceipt.result.configurationVersion)
    await control('authorization-new-account')
    await control('authorization-pending')
    const begin = await settled(await start('beginAuthorization', { name: 'Phase schedule grant' }))
    await assertWaiting(begin, 'begin-github-authorization')
    const operationId = begin.result.operationId
    await navigate(fixture.paths.connections)
    await page
      .getByRole('button', { name: 'GitHub authorization · Waiting for GitHub', exact: false })
      .click()
    const pane = page.locator('dialog[open]')
    await until('actual open pane accepted waiting phase', async () =>
      /Waiting for GitHub/.test(await pane.innerText()),
    )
    assert.ok((await pane.innerText()).includes(begin.result.userCode))

    const cancelled = await settled(await start('cancelAuthorization', { operationId }))
    assertPhase(cancelled, 'cancel-github-authorization', 'cancelled', operationId)
    await acceptedAuthorization(operationId, 'terminal', 'cancelled')
    await until('actual open pane accepted cancellation', async () =>
      /Authorization cancelled/.test(await pane.innerText()),
    )
    assert.equal(await pane.getByRole('button', { name: 'Copy code', exact: true }).count(), 0)

    const restarted = await settled(await start('retryAuthorization', { operationId }))
    await assertWaiting(restarted, 'retry-github-authorization', operationId)
    await until('actual open pane accepted retry waiting phase', async () =>
      /Waiting for GitHub/.test(await pane.innerText()),
    )
    assert.equal(await pane.getByRole('button', { name: 'Copy code', exact: true }).count(), 1)
    await control('authorization-denied')
    const denied = await acceptedAuthorization(operationId, 'terminal', 'denied')
    const deniedReceipt = await settled(await start('cancelAuthorization', { operationId }))
    assertPhase(deniedReceipt, 'cancel-github-authorization', 'denied', operationId)
    assert.equal(deniedReceipt.result.error.code, 'authorization-failed')
    assert.equal(deniedReceipt.result.error.message, denied.cause)
    await until('actual open pane accepted provider denial', async () =>
      /Authorization denied/.test(await pane.innerText()),
    )
    assert.equal(await pane.getByRole('button', { name: 'Copy code', exact: true }).count(), 0)

    await control('authorization-pending')
    const grantRetry = await settled(await start('retryAuthorization', { operationId }))
    await assertWaiting(grantRetry, 'retry-github-authorization', operationId)
    await until('actual open pane accepted grant retry waiting phase', async () =>
      /Waiting for GitHub/.test(await pane.innerText()),
    )
    assert.equal(await pane.getByRole('button', { name: 'Copy code', exact: true }).count(), 1)
    await control('authorization-granted')
    const granted = await acceptedAuthorization(operationId, 'granted')
    assert.equal(granted.connection.kind, 'current')
    assert.notEqual(granted.connection.id, fixture.ids.connection)
    assert.equal(granted.connection.accountId, '9002')
    const currentConnection = (await snapshot()).state.connections.find(
      (value) => value.id === granted.connection.id,
    )
    assert.equal(currentConnection.integration, 'github')
    assert.equal(currentConnection.githubIdentity.id, granted.connection.accountId)
    await until(
      'actual pane canonical current Connection grant link',
      async () =>
        (await pane.getByRole('link', { name: 'View granted Connection', exact: true }).count()) ===
        1,
    )
    assert.ok(
      (await pane.innerText()).includes(
        `Connection ${granted.connection.id}, account ${granted.connection.accountId}.`,
      ),
    )
    assert.equal(await pane.getByRole('button', { name: 'Copy code', exact: true }).count(), 0)
    const destination = `${fixture.paths.connections}/${encodeURIComponent(granted.connection.id)}`
    assert.equal(
      await pane
        .getByRole('link', { name: 'View granted Connection', exact: true })
        .getAttribute('href'),
      destination,
    )
    await pane.getByRole('link', { name: 'View granted Connection', exact: true }).click()
    await until(
      'actual granted Connection consumer navigation',
      () => new URL(page.url()).pathname === destination,
    )
    await until(
      'actual granted Connection details show current account',
      async () => (await page.getByLabel('Connection name', { exact: true }).count()) === 1,
    )
    assert.equal(
      await page.getByLabel('Connection name', { exact: true }).inputValue(),
      currentConnection.name,
    )
    assert.ok((await text()).includes(`@${currentConnection.githubIdentity.login}`))
    assert.equal(await page.getByRole('button', { name: 'Copy code', exact: true }).count(), 0)
    await navigate(fixture.paths.connections)
    assert.equal(await page.locator('dialog[open]').count(), 0)
    assert.equal((await authorizationFeedback(operationId)).consumed, true)
    assert.equal((await authorizationFeedback(operationId)).result.phase, 'waiting')
    assert.equal(
      (await feedback('retry-github-authorization', { kind: 'authorization', operationId }))
        .message,
      null,
      'Accepted grant consumes the earlier waiting retry instead of reactivating it.',
    )

    await control('authorization-existing-account')
    await control('authorization-pending')
    const fresh = await settled(
      await start('beginAuthorization', { name: 'New named authorization' }),
    )
    await assertWaiting(fresh, 'begin-github-authorization')
    assert.notEqual(fresh.result.operationId, operationId)
    const freshCancel = await settled(
      await start('cancelAuthorization', { operationId: fresh.result.operationId }),
    )
    assertPhase(freshCancel, 'cancel-github-authorization', 'cancelled', fresh.result.operationId)
    await acceptedAuthorization(fresh.result.operationId, 'terminal', 'cancelled')
    assert.equal((await authorizationFeedback(operationId)).result.phase, 'waiting')
    assert.equal((await authorizationFeedback(operationId)).consumed, true)
    const grantedReceipt = await settled(await start('cancelAuthorization', { operationId }))
    assertPhase(grantedReceipt, 'cancel-github-authorization', 'granted', operationId)
    assert.deepEqual(grantedReceipt.result.connection, {
      connectionId: granted.connection.id,
      accountId: granted.connection.accountId,
    })
    await version(grantedReceipt.result.configurationVersion)

    const expiring = await settled(
      await start('reauthorizeConnection', { connectionId: fixture.ids.connection }),
    )
    await assertWaiting(expiring, 'reauthorize-github-connection')
    assert.deepEqual(expiring.subject, { kind: 'connection', connectionId: fixture.ids.connection })
    await control('authorization-expired')
    await acceptedAuthorization(expiring.result.operationId, 'terminal', 'expired')
    const expiredReceipt = await settled(
      await start('cancelAuthorization', { operationId: expiring.result.operationId }),
    )
    assertPhase(
      expiredReceipt,
      'cancel-github-authorization',
      'expired',
      expiring.result.operationId,
    )
    await control('authorization-failed')
    const failed = await settled(
      await start('retryAuthorization', { operationId: expiring.result.operationId }),
    )
    assertPhase(failed, 'retry-github-authorization', 'failed', expiring.result.operationId)
    assert.equal(failed.result.error.code, 'authorization-failed')
    const failedRead = await acceptedAuthorization(
      expiring.result.operationId,
      'terminal',
      'failed',
    )
    assert.equal(failed.result.error.message, failedRead.cause)
    await control('authorization-recover')
    await control('authorization-pending')
    const recovered = await settled(
      await start('retryAuthorization', { operationId: expiring.result.operationId }),
    )
    await assertWaiting(recovered, 'retry-github-authorization', expiring.result.operationId)
    const recoveredCancel = await settled(
      await start('cancelAuthorization', { operationId: expiring.result.operationId }),
    )
    assertPhase(
      recoveredCancel,
      'cancel-github-authorization',
      'cancelled',
      expiring.result.operationId,
    )
    await acceptedAuthorization(expiring.result.operationId, 'terminal', 'cancelled')
  })

  await scenario(scenarioManifest[15], async () => {
    for (const operation of ['open-workspace', 'open-terminal', 'reveal-source']) {
      const before = await count()
      const launch = await settled(await start('launchProject', { project: beta, operation }))
      assert.equal(launch.result.operation, operation)
      assert.equal(launch.result.status, 'invoked')
      assert.equal(launch.destination, null)
      assert.ok(!/session completed|process exited|report received/i.test(launch.message))
      const wire = (await control('status')).requests[before].envelope.command
      assert.deepEqual(Object.keys(wire).sort(), [
        'expectedConfigurationVersion',
        'operation',
        'project',
        'type',
      ])
    }
  })

  await scenario(scenarioManifest[16], async () => {
    const original = (await control('status')).automation.events.filter(
      (value) => value.opportunityId === 'fixture-history',
    )
    await settled(await start('setAutomationEnabled', { enabled: true }))
    await settled(await start('setProjectAutomationEnabled', { project: beta, enabled: false }))
    const state = (await snapshot()).state
    const controlValue = state.automation.overrides.find(
      (value) =>
        value.target.map.project.projectId === beta.projectId &&
        value.classification.status === 'eligible',
    )
    assert.ok(controlValue, 'Fixture has a real eligible Automation classification target.')
    await settled(
      await start('startOverride', { target: controlValue.target, stage: 'classification' }),
    )
    await until(
      'durable harmless Classification process result',
      async () =>
        (await control('status')).classificationLaunches > 0 &&
        (await snapshot()).state.automation.overrides.some(
          (value) =>
            value.target.map.project.projectId === beta.projectId &&
            value.wayfinder.status === 'eligible',
        ),
    )
    const target = (await snapshot()).state.automation.overrides.find(
      (value) =>
        value.target.map.project.projectId === beta.projectId &&
        value.wayfinder.status === 'eligible',
    ).target
    await settled(await start('startOverride', { target, stage: 'wayfinder' }))
    await until('durable harmless Wayfinder report', async () =>
      (await control('status')).automation.events.some(
        (value) => value.type === 'wayfinder-finished' && value.report?.status === 'received',
      ),
    )
    const events = (await control('status')).automation.events
    assert.deepEqual(
      events.filter((value) => value.opportunityId === 'fixture-history'),
      original,
    )
    assert.ok(
      events.some(
        (value) =>
          value.type === 'classification-completed' &&
          value.processResult.code === 0 &&
          value.verdict.value === 'afk',
      ),
    )
    assert.ok(
      events.some(
        (value) =>
          value.type === 'wayfinder-finished' &&
          value.processResult.code === 9 &&
          value.report.status === 'received',
      ),
    )
    await navigate(fixture.paths.ticket)
    await until('actual durable evidence consumer', async () =>
      /Fixture durable unknown|unknown/i.test(await text()),
    )
    assert.ok((await text()).includes('Acknowledged'))
  })

  await scenario(scenarioManifest[17], async () => {
    await settled(
      await start('renameConnection', {
        connectionId: fixture.ids.connection,
        name: 'Renamed fixture GitHub',
      }),
    )
    await settled(
      await start('repairWorkspace', {
        project: alpha,
        path: join((await control('status')).root, 'alpha-moved'),
      }),
    )
    await settled(
      await start('registerProject', {
        candidate: {
          integration: 'local',
          connectionId: 'local',
          workspace: { path: '/fixture-missing-final' },
        },
      }),
      'rejected',
    )
    await settled(await start('removeProject', { project: registered.result.project }))
    await settled(
      await start('removeProject', {
        project: { integration: 'github', projectId: fixture.ids.github },
      }),
    )
    const remoteRegistered = (await attempts()).findLast(
      (value) =>
        value.operation === 'register-project' &&
        value.kind === 'acknowledged' &&
        value.result.project.integration === 'github',
    )
    assert.ok(remoteRegistered)
    await settled(await start('removeProject', { project: remoteRegistered.result.project }))
    await settled(await start('removeConnection', { connectionId: fixture.ids.connection }))
    for (const method of methods)
      assert.ok(
        exercised.has(method),
        `Named workflow ${method} must be exercised, not represented by a manifest-only entry.`,
      )
    await navigate(fixture.paths.beta)
    await control('invalid-configuration')
    await until(
      'current invalid policy in open Settings',
      async () => !(await snapshot()).state.configuration.valid,
    )
    assert.equal(
      await page.getByRole('button', { name: 'Save name', exact: true }).isEnabled(),
      false,
    )
    const before = await count()
    const invalid = await settled(
      await rename(beta, 'Must not dispatch invalid current policy'),
      'not-dispatched',
    )
    assert.equal(invalid.error.code, 'configuration-invalid')
    assert.equal(await count(), before)
    await control('selector-cancelled')
    const query = await settled(await start('selectWorkspace', { owner: subject(beta) }))
    assert.equal(
      query.result.kind,
      'cancelled',
      'Invalid configuration must not invent a selector restriction absent from actual admission.',
    )
    assert.equal('configurationVersion' in query, false)
  })
}

async function epochSchedules({
  page,
  start,
  settled,
  settlement,
  control,
  snapshot,
  attempts,
  until,
  ready,
  version,
  rename,
  alpha,
  beta,
  scenario,
}) {
  await scenario(scenarioManifest[11], async () => {
    for (const reverse of [false, true]) {
      await ready()
      await control('reply', 'hold')
      const old = await start('launchProject', { project: beta, operation: 'open-workspace' })
      await until(
        'state-free predecessor reply held',
        async () => (await control('status')).pendingResponses.length === 1,
      )
      const oldRecord = (await control('status')).requests.at(-1)
      assert.equal('state' in oldRecord.outcome.outcome, false)
      const successor = await control('successor')
      await control('release-baseline')
      await ready()
      await until(
        'successor accepted epoch',
        async () => (await snapshot()).state.serverEpoch === successor.state.serverEpoch,
      )
      await control('reply', 'hold')
      const current = await start('refreshProject', { project: alpha })
      await until(
        'successor and predecessor replies held',
        async () => (await control('status')).pendingResponses.length === 2,
      )
      const ids = (await control('status')).pendingResponses
      const connections = (await control('status')).socketConnections
      const firstHandle = reverse ? current : old
      const secondHandle = reverse ? old : current
      await control('release-reply', String(reverse ? ids[1] : ids[0]))
      const firstResult = await settled(firstHandle)
      assert.equal((await settlement(secondHandle)).kind, 'pending')
      await control('release-reply', String(reverse ? ids[0] : ids[1]))
      const secondResult = await settled(secondHandle)
      const previous = reverse ? secondResult : firstResult
      const next = reverse ? firstResult : secondResult
      assert.equal(previous.outcome.serverEpoch, oldRecord.outcome.outcome.serverEpoch)
      assert.equal(next.outcome.serverEpoch, successor.state.serverEpoch)
      assert.equal((await snapshot()).state.serverEpoch, successor.state.serverEpoch)
      assert.equal(
        (await control('status')).socketConnections,
        connections,
        'Obsolete predecessor outcome cannot establish authority or request synchronization.',
      )
      const advancement = await control('advance-revision')
      await version(advancement.state.configurationVersion)
      assert.equal((await snapshot()).state.serverEpoch, successor.state.serverEpoch)
      const unknown = (await attempts()).filter((value) => value.kind === 'completion-unknown')
      assert.ok(
        unknown.length > 0,
        'Unrelated state-free outcomes must not clear preceding unknowns.',
      )
    }
  })
  await scenario(scenarioManifest[12], async () => {
    const nativeSockets = () => page.evaluate(() => window.workflowsFixture.sockets())
    const requestStarts = () => page.evaluate(() => window.workflowsFixture.requestStarts())
    async function freshWithheldSocket(previous, nativePrevious, epoch) {
      await until('new native generation with actual withheld baseline', async () => {
        const status = await control('status')
        const native = await nativeSockets()
        const relay = status.socketGenerations.at(-1)
        const socket = native.at(-1)
        const retiredNative = native.find(
          (value) => value.generation === nativePrevious.at(-1).generation,
        )
        const retiredRelay = status.socketGenerations.find(
          (value) => value.generation === previous.socketConnections,
        )
        return (
          status.socketConnections === previous.socketConnections + 1 &&
          status.activeSockets === 1 &&
          status.upstreamSockets === 1 &&
          relay.upstreamOpened &&
          relay.receivedMessages > 0 &&
          relay.forwardedMessages === 0 &&
          relay.latestPublication.serverEpoch === epoch &&
          relay.browserClosed === null &&
          relay.upstreamClosed === null &&
          retiredRelay.browserClosed !== null &&
          retiredRelay.upstreamClosed !== null &&
          native.length === nativePrevious.length + 1 &&
          socket.opened &&
          socket.messages === 0 &&
          socket.closeRequests === 0 &&
          socket.closed === null &&
          retiredNative.closed !== null &&
          (await snapshot()).transport === 'live' &&
          (await snapshot()).synchronization === 'retained'
        )
      })
      assert.equal((await control('status')).held, true)
    }
    function socketLifecycle(record) {
      return {
        generation: record.generation,
        serverEpoch: record.serverEpoch,
        upstreamOpened: record.upstreamOpened,
        browserClosed: record.browserClosed,
        upstreamClosed: record.upstreamClosed,
      }
    }
    async function unchangedSocket(previous, nativePrevious) {
      const current = await control('status')
      assert.equal(current.socketConnections, previous.socketConnections)
      assert.equal(current.activeSockets, 1)
      assert.equal(current.upstreamSockets, 1)
      assert.deepEqual(current.socketTransitions, previous.socketTransitions)
      assert.deepEqual(
        current.socketGenerations.map(socketLifecycle),
        previous.socketGenerations.map(socketLifecycle),
      )
      assert.deepEqual(await nativeSockets(), nativePrevious)
      return current
    }
    function requestSocket(request, starts) {
      const captured = starts.find(
        (value) => value.correlationId === request.envelope.correlationId,
      )
      assert.ok(captured, 'The actual fetch start must identify its native socket generation.')
      return captured.socket
    }

    await ready()
    await until('only the established current native and upstream streams remain', async () => {
      const status = await control('status')
      const socket = (await nativeSockets()).at(-1)
      return (
        status.activeSockets === 1 &&
        status.upstreamSockets === 1 &&
        socket.opened &&
        socket.messages > 0 &&
        socket.closed === null
      )
    })
    await control('withhold')
    await control('request', 'hold')
    await control('reply', 'hold')
    const handle = await start('launchProject', { project: beta, operation: 'open-workspace' })
    await until(
      'established-authority request capture',
      async () => (await control('status')).pendingDispatches === 1,
    )
    const before = await control('status')
    const nativeBefore = await nativeSockets()
    const currentRequest = before.requests.at(-1)
    const establishedRequestSocket = requestSocket(currentRequest, await requestStarts())
    assert.equal(establishedRequestSocket.generation, nativeBefore.at(-1).generation)
    assert.equal(establishedRequestSocket.opened, true)
    assert.ok(establishedRequestSocket.messages > 0)
    assert.equal(establishedRequestSocket.closeRequests, 0)
    assert.equal(establishedRequestSocket.closed, null)
    assert.ok(nativeBefore.at(-1).messages > 0)
    const next = await control('http-successor')
    await unchangedSocket(before, nativeBefore)
    assert.equal(next.backends.at(-2).lifecycle, 'stopped')
    assert.equal(next.backends.at(-2).upstreamSockets, 1)
    assert.equal(next.backends.at(-1).upstreamSockets, 0)
    await control('release-dispatch')
    await until('actual differing-epoch outcome held without transport closure', async () =>
      (await control('status')).pendingResponses.includes(currentRequest.id),
    )
    const heldCurrent = await unchangedSocket(before, nativeBefore)
    assert.equal((await settlement(handle)).kind, 'pending')
    assert.equal(heldCurrent.requests.at(-1).outcome.outcome.serverEpoch, next.state.serverEpoch)
    assert.equal('state' in heldCurrent.requests.at(-1).outcome.outcome, false)
    assert.equal((await snapshot()).synchronization, 'synchronized')
    await control('release-reply', String(currentRequest.id))
    const outcome = await settled(handle, 'rejected')
    assert.equal(outcome.outcome.serverEpoch, next.state.serverEpoch)
    assert.equal(outcome.error.code, 'conflict')
    await freshWithheldSocket(before, nativeBefore, next.state.serverEpoch)
    const afterCurrent = await control('status')
    const nativeAfterCurrent = await nativeSockets()
    assert.equal(nativeAfterCurrent.at(-2).closeRequests, nativeBefore.at(-1).closeRequests + 1)
    assert.ok(nativeAfterCurrent.at(-2).closed)
    assert.deepEqual(
      afterCurrent.socketTransitions
        .slice(before.socketTransitions.length)
        .filter((value) => value.kind === 'close-requested'),
      [],
      'Only the current HTTP outcome may retire this native generation. The relay did not close it.',
    )
    assert.ok(afterCurrent.socketGenerations.at(-2).browserClosed)
    assert.ok(afterCurrent.socketGenerations.at(-2).upstreamClosed)
    assert.notEqual(
      (await snapshot()).state.serverEpoch,
      next.state.serverEpoch,
      'HTTP metadata must not replace retained socket read facts.',
    )
    assert.equal((await snapshot()).synchronization, 'retained')
    await control('release-baseline')
    await ready()
    assert.equal((await snapshot()).state.serverEpoch, next.state.serverEpoch)
    assert.ok((await nativeSockets()).at(-1).messages > 0)
    assert.equal((await control('status')).requests.length, before.requests.length)

    const connected = await control('status')
    const nativeConnected = await nativeSockets()
    await control('withhold')
    await control('disconnect')
    await freshWithheldSocket(connected, nativeConnected, next.state.serverEpoch)
    const preBaselineSocket = await control('status')
    const nativePreBaseline = await nativeSockets()
    assert.deepEqual(
      preBaselineSocket.socketTransitions
        .slice(connected.socketTransitions.length)
        .filter((value) => value.kind === 'close-requested')
        .map((value) => value.cause),
      ['fixture-disconnect'],
      'The intentional disconnect, not HTTP, creates the pre-baseline generation.',
    )
    assert.equal(nativePreBaseline.at(-2).closeRequests, nativeConnected.at(-1).closeRequests)
    const calls = preBaselineSocket.requests.length
    const denied = await settled(
      await rename(beta, 'No pre-baseline request authority'),
      'not-dispatched',
    )
    assert.equal('outcome' in denied, false)
    assert.equal((await control('status')).requests.length, calls)
    await unchangedSocket(preBaselineSocket, nativePreBaseline)
    await control('request', 'hold')
    await control('reply', 'hold')
    const retained = (await snapshot()).state
    const protocol = await page.evaluate(
      ({ project, version }) =>
        window.workflowsFixture.startProtocolCommand({
          type: 'launch-project-operation',
          project,
          operation: 'open-workspace',
          expectedConfigurationVersion: version,
        }),
      { project: beta, version: retained.configurationVersion },
    )
    await until(
      'actual protocol request before socket authority',
      async () => (await control('status')).pendingDispatches === 1,
    )
    const preBaseline = await unchangedSocket(preBaselineSocket, nativePreBaseline)
    const protocolRequest = preBaseline.requests.at(-1)
    assert.deepEqual(requestSocket(protocolRequest, await requestStarts()), {
      generation: nativePreBaseline.at(-1).generation,
      opened: true,
      messages: 0,
      closeRequests: 0,
      closed: null,
    })
    const later = await control('http-successor')
    await unchangedSocket(preBaseline, nativePreBaseline)
    assert.equal(later.backends.at(-2).lifecycle, 'stopped')
    assert.equal(later.backends.at(-2).upstreamSockets, 1)
    assert.equal(later.backends.at(-1).upstreamSockets, 0)
    await control('release-dispatch')
    await until('real no-authority successor outcome held', async () =>
      (await control('status')).pendingResponses.includes(protocolRequest.id),
    )
    const heldProtocol = await unchangedSocket(preBaseline, nativePreBaseline)
    assert.equal((await settlement(protocol)).kind, 'pending')
    assert.equal(heldProtocol.requests.at(-1).outcome.outcome.serverEpoch, later.state.serverEpoch)
    assert.equal('state' in heldProtocol.requests.at(-1).outcome.outcome, false)
    await control('release-reply', String(protocolRequest.id))
    await until(
      'state-free protocol settlement',
      async () => (await settlement(protocol)).kind !== 'pending',
    )
    const protocolReply = await settlement(protocol)
    assert.equal(protocolReply.kind, 'settled')
    assert.equal(protocolReply.value.serverEpoch, later.state.serverEpoch)
    assert.equal(protocolReply.value.ok, false)
    assert.equal(protocolReply.value.error.code, 'conflict')
    const afterProtocol = await unchangedSocket(preBaseline, nativePreBaseline)
    assert.deepEqual((await snapshot()).state, retained)
    assert.equal((await snapshot()).synchronization, 'retained')
    assert.equal(afterProtocol.requests.length, preBaseline.requests.length)
    assert.equal(afterProtocol.hostInvocations, preBaseline.hostInvocations)
    await control('release-baseline')
    await ready()
    assert.equal((await snapshot()).state.serverEpoch, next.state.serverEpoch)
    assert.equal((await nativeSockets()).at(-1).generation, nativePreBaseline.at(-1).generation)
    assert.ok((await nativeSockets()).at(-1).messages > 0)
    assert.equal((await nativeSockets()).at(-1).closeRequests, 0)

    const beforeFinal = await control('status')
    const nativeBeforeFinal = await nativeSockets()
    await control('withhold')
    await control('disconnect')
    await freshWithheldSocket(beforeFinal, nativeBeforeFinal, later.state.serverEpoch)
    assert.deepEqual(
      (await control('status')).socketTransitions
        .slice(beforeFinal.socketTransitions.length)
        .filter((value) => value.kind === 'close-requested')
        .map((value) => value.cause),
      ['fixture-disconnect'],
    )
    await control('release-baseline')
    await ready()
    assert.equal((await snapshot()).state.serverEpoch, later.state.serverEpoch)
    const advancement = await control('advance-revision')
    await version(advancement.state.configurationVersion)
    assert.equal((await snapshot()).state.serverEpoch, later.state.serverEpoch)
    assert.equal((await control('status')).requests.length, preBaseline.requests.length)
  })
}
