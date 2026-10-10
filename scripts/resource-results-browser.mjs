import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const scenarioManifest = [
  'No accepted state: live socket with withheld readiness never mounts empty consumers',
  'Never-observed root: no readable content or invented source link',
  'Known-empty root: complete zero membership stays distinct in map, Settings and Overview',
  'Default selection: trusted closed order is readable; uncertain order promotes no sibling',
  'Readable incomplete map: raw custom Markdown, duplicate ticket trace, warnings and unknown progress',
  'Unknown blockers: visible uncertainty and independent blocked/claimed tracker facts',
  'Direct pinned map and ticket load/reload preserve opaque percent/slash/Unicode identities',
  'Markdown ticket/map/blocker/source navigation uses exact scoped destinations',
  'Map navigation, Modal close, Back and Forward preserve URL-owned selection',
  'Actual Local map-file unreadability retains graph/prose/ticket/source and safe cause',
  'Actual Local root unreadability agrees across map, Settings and Overview',
  'Local same-identity map/root recovery restores readable content',
  'Trustworthy ticket/map disappearance retains exact pins with no sibling substitution',
  'Never-known explicit map stays absent with no fabricated source capability',
  'GitHub selected aggregate remains 12 total/7 completed despite two fetched tickets',
  'GitHub map-read failure preserves successful Project freshness despite Connection degradation',
  'GitHub retained root/map/ticket keeps graph/prose/source destinations and recovers same IDs',
  'Durable Classification verdict/process/admission and Session report/process/admission stay independent',
  'Queued Session has no launch admission; acknowledged outcome remains unknown',
  'All simultaneous unknown interruptions link absent Project/map/ticket targets from real consumers',
  'Server-authored ineligible controls and explicit HTTP denials have no native/Automation effects',
  'Disposable services, browser, sockets, watchers and files join deterministic cleanup',
]

const { values } = parseArgs({
  options: {
    help: { type: 'boolean' },
    'serve-only': { type: 'boolean' },
    headed: { type: 'boolean' },
    'executable-path': { type: 'string' },
    screenshots: { type: 'string' },
  },
  strict: true,
})
if (values.help) {
  console.log(`Resource-results regression through the mounted App, provider, router, store and real application transport.

Setup:
  pnpm install
  pnpm exec playwright install chromium

Examples:
  node scripts/resource-results-browser.mjs
  node scripts/resource-results-browser.mjs --serve-only
  node scripts/resource-results-browser.mjs --screenshots /tmp/roadmap-resource-results-visual
  node scripts/resource-results-browser.mjs --headed --executable-path /path/to/chromium

Options:
  --serve-only       Print the fixture URL and control endpoint, then serve until SIGINT/SIGTERM.
  --headed           Show the isolated Chromium window.
  --executable-path  Select Chromium. CHROMIUM_EXECUTABLE_PATH is also supported.
  --screenshots      Save scenario PNGs to this directory during the complete regression run.
  --help             Show setup and invocation.

All sources, configuration and durable Automation history belong to a disposable fixture.
No production configuration, credentials, native host actions or Automation processes are used.
The default run prints a JSON scenario inventory and exits nonzero on an assertion failure.`)
} else {
  if (values['serve-only'] && values.screenshots)
    throw new Error(
      '--screenshots requires the complete run. Omit --serve-only to capture scenario PNGs.',
    )
  await main()
}

async function executable(chromium) {
  const explicit = values['executable-path'] ?? process.env.CHROMIUM_EXECUTABLE_PATH
  if (explicit) {
    await access(explicit)
    return explicit
  }
  const candidates = [chromium.executablePath()]
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'chrome', 'chrome.exe'])
      candidates.push(join(directory, name))
  }
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  throw new Error(
    'Install Chromium with pnpm exec playwright install chromium, or pass --executable-path /path/to/chromium.',
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
  let cache
  let vite
  let fixture
  let browser
  let toolingServer
  let page
  const failures = []
  const scenarios = []
  const screenshots = []
  const screenshotDirectory = values.screenshots ? resolve(values.screenshots) : null
  async function capture(label) {
    if (!screenshotDirectory || !page) return
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
    cache = await mkdtemp(join(tmpdir(), 'roadmap-resource-results-vite-'))
    const entry = join(root, 'scripts/fixtures/resource-results-browser.tsx')
    if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true })
    // Vite 8's CSS runtime imports /@vite/client, which connects even with ws:false.
    // Give that tooling client an isolated ephemeral listener, not the application's /ws
    // or Vite's shared middleware default port. hmr:false still disables source updates.
    toolingServer = createHttpServer((request, response) => response.writeHead(404).end())
    await new Promise((resolve, reject) => {
      toolingServer.once('error', reject)
      toolingServer.listen(0, '127.0.0.1', () => {
        toolingServer.off('error', reject)
        resolve()
      })
    })
    const toolingAddress = toolingServer.address()
    assert.ok(toolingAddress && typeof toolingAddress !== 'string')
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
          name: 'resource-results-fixture-dependencies',
          enforce: 'pre',
          async resolveId(source, importer, options) {
            if (
              !importer?.includes('/scripts/fixtures/resource-results-browser.tsx') ||
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
        ws: { server: toolingServer, host: '127.0.0.1', clientPort: toolingAddress.port },
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
    const { createResourceResultsServer } = await import('./fixtures/resource-results-server.ts')
    fixture = await createResourceResultsServer(vite.middlewares, entry)
    console.log(
      JSON.stringify({
        fixture: fixture.origin,
        control: `${fixture.origin}/__fixture/control?action=status`,
        paths: fixture.paths,
        scenarioManifest,
        toolingSocket: `ws://127.0.0.1:${toolingAddress.port}`,
        screenshotDirectory,
      }),
    )
    if (values['serve-only']) {
      await new Promise((resolve) => {
        process.once('SIGINT', resolve)
        process.once('SIGTERM', resolve)
      })
      return
    }
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
    page.on('pageerror', (error) => failures.push(error.message))
    const control = (action) => fixture.control(action)
    const snapshot = () => page.evaluate(() => window.resourceResultsFixture.snapshot())
    const read = async () => {
      const state = (await snapshot()).state
      return state?.phase === 'ready' ? state : (state?.retained ?? null)
    }
    async function until(label, predicate) {
      const deadline = Date.now() + 20_000
      while (!(await predicate())) {
        assert.deepEqual(failures, [], `Browser errors before ${label}`)
        if (Date.now() >= deadline)
          throw new Error(
            `Timed out waiting for ${label}. URL ${page.url()}. Client ${JSON.stringify(await page.evaluate(() => window.resourceResultsFixture?.snapshot() ?? null))}. DOM ${await page.locator('body').innerText()}`,
          )
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.deepEqual(failures, [], `Browser errors after ${label}`)
    }
    const text = async () => page.locator('body').innerText()
    const has = async (value) => (await text()).includes(value)
    async function navigate(path) {
      await page.evaluate(
        (destination) => window.resourceResultsFixture.navigate(destination),
        path,
      )
      await until(`navigation ${path}`, () => new URL(page.url()).pathname === path)
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
    }
    async function contains(...parts) {
      for (const part of parts) await until(`content ${part}`, () => has(part))
    }
    async function meaning(label, pattern) {
      await until(label, async () => pattern.test(await text()))
    }
    async function exactPath(path) {
      await until(`exact pinned URL ${path}`, () => new URL(page.url()).pathname === path)
    }
    const project = async (id) => (await read()).projects.find((item) => item.ref.projectId === id)
    const map = async (id, mapId) =>
      (await project(id)).maps.find((item) => item.ref.mapId === mapId)
    const observation = (resource) => {
      switch (resource.kind) {
        case 'current-readable':
          return resource.observation
        case 'retained-unavailable':
          return resource.lastSuccessful
        case 'proven-absent':
          return resource.trace.kind === 'last-successful-trace'
            ? resource.trace.lastSuccessful
            : null
        case 'never-observed':
          return null
        default:
          throw new Error(`Unknown public resource variant ${resource.kind}`)
      }
    }
    async function evidenceText(path, ...parts) {
      await navigate(path)
      await until('native ticket Modal', () => page.locator('dialog[open]').count())
      const modal = page.locator('dialog[open]')
      for (const part of parts)
        await until(`evidence ${part}`, async () => (await modal.innerText()).includes(part))
      return modal
    }
    async function fact(scope, term, expected) {
      const row = scope.locator('dl > div').filter({ has: page.getByText(term, { exact: true }) })
      await until(
        `labelled ${term}: ${expected}`,
        async () =>
          (await row.count()) === 1 && (await row.locator('dd').innerText()).includes(expected),
      )
    }
    async function sourceHref(name, expected, scope = page) {
      const link = scope.getByRole('link', { name, exact: true })
      await until(`source destination ${name}`, () => link.count())
      assert.equal(await link.getAttribute('href'), expected)
    }
    async function selectMarkdown(scope, name) {
      const selection = scope
        .getByRole('button', { name, exact: true })
        .or(scope.getByRole('link', { name, exact: true }))
      await selection.click()
    }
    async function sourceJourney(name, expected, scope = page) {
      await sourceHref(name, expected, scope)
      const previousPath = new URL(page.url()).pathname
      const linkBeforeClose = scope.getByRole('link', { name, exact: true })
      const behindModal =
        (await page.locator('dialog[open]').count()) > 0 &&
        !(await linkBeforeClose.evaluate((element) => element.closest('dialog[open]') !== null))
      if (behindModal) {
        await page
          .locator('dialog[open]')
          .getByRole('button', { name: 'Close', exact: true })
          .click()
        await until(
          'source link accessible outside Modal',
          async () => (await page.locator('dialog[open]').count()) === 0,
        )
      }
      await page.context().route(expected, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>Fixture source destination</title>',
        }),
      )
      try {
        const link = scope.getByRole('link', { name, exact: true })
        const newTab = (await link.getAttribute('target')) === '_blank'
        const popupPromise = page.context().waitForEvent('page')
        await link.click(newTab ? {} : { modifiers: ['Shift'] })
        const popup = await popupPromise
        try {
          await popup.waitForURL(expected)
          assert.equal(popup.url(), expected)
        } finally {
          await popup.close()
        }
      } finally {
        await page.context().unroute(expected)
        if (behindModal) await navigate(previousPath)
      }
    }
    const p = fixture.paths
    await page.goto(`${fixture.origin}${p.localSettings}`)
    await until('fixture entry', () => page.evaluate(() => Boolean(window.resourceResultsFixture)))
    await until(
      'live withheld socket',
      async () =>
        (await snapshot()).transport === 'live' && (await control('status')).upstreamSockets === 1,
    )
    assert.equal((await snapshot()).state, null)
    assert.equal(await page.locator('[data-roadmap-readiness="waiting"]').count(), 1)
    assert.equal(await page.locator('.react-flow').count(), 0)
    assert.equal(await page.getByText('Resource Local', { exact: true }).count(), 0)
    await capture('initial-waiting')
    await control('release-baseline')
    await until('accepted application baseline', async () => (await read()) !== null)
    // This is deliberately first after readiness. The baseline Settings owner drops this
    // durable link because its map/ticket never existed in the live resource catalog.
    await contains('Resource Local', 'unknown')
    const missingInterruption = page.locator(`a[href="${p.missingMapTicket}"]`)
    await until('Settings link to never-present durable target', () => missingInterruption.count())
    await missingInterruption.first().click()
    await exactPath(p.missingMapTicket)
    await contains('Never-present map interruption.', 'Outcome unknown', 'Required')
    await capture('durable-missing-map-settings-journey')
    scenarios.push(
      'Withheld initial readiness is not empty state; Settings links durable evidence without live map/ticket membership',
    )

    await navigate(p.empty)
    assert.equal((await project(fixture.ids.emptyProject)).mapsMembership.kind, 'current-complete')
    assert.equal((await project(fixture.ids.emptyProject)).maps.length, 0)
    await contains('Resource Empty')
    await meaning('known-empty map truth', /no current (?:open|wayfinder) map|known empty/i)
    assert.equal(await page.locator('.react-flow').count(), 0)
    await navigate(p.never)
    assert.notEqual((await project(fixture.ids.neverProject)).resource.kind, 'current-readable')
    assert.equal(observation((await project(fixture.ids.neverProject)).resource), null)
    await contains('Resource Never')
    await meaning(
      'never-observed map truth',
      /never (?:been read|observed)|no source content is known/i,
    )
    assert.equal(await page.getByRole('link', { name: 'Project source', exact: true }).count(), 0)
    assert.equal(await page.locator('.react-flow').count(), 0)
    for (const destination of [p.emptySettings, p.neverSettings, '/']) {
      await navigate(destination)
      await contains(
        destination === p.emptySettings
          ? 'Resource Empty'
          : destination === p.neverSettings
            ? 'Resource Never'
            : 'Known empty',
      )
      await meaning(
        `consumer truth ${destination}`,
        destination === p.emptySettings
          ? /no current (?:open|wayfinder) map|known empty/i
          : destination === p.neverSettings
            ? /never (?:been read|observed)|no source content is known/i
            : /known empty/i,
      )
    }
    await contains('Resource Empty', 'Resource Never', 'unknown')
    await meaning(
      'Overview never-read resource truth',
      /never (?:been read|observed)|no source content is known/i,
    )
    await contains((await project(fixture.ids.neverProject)).activeMap.cause)
    await navigate(p.closed)
    await contains('Closed default prose.')
    await exactPath(p.closed)
    assert.equal((await project(fixture.ids.closedProject)).activeMap.kind, 'known-empty')
    await navigate(p.local)
    assert.equal((await project(fixture.ids.localProject)).activeMap.kind, 'uncertain')
    assert.equal(
      await page.locator('.react-flow').count(),
      0,
      'An uncertain default cannot promote either known map',
    )
    await exactPath(p.local)
    await contains((await project(fixture.ids.localProject)).activeMap.cause)
    scenarios.push(
      'Known-empty and never-observed roots remain distinct in map, Settings and Overview',
    )

    const directTicketInput = p.localTicket.replaceAll(':', '%3A')
    await page.goto(`${fixture.origin}${directTicketInput}`)
    await until('direct opaque ticket load', () => has('Opaque primary ticket.'))
    await exactPath(directTicketInput)
    assert.equal((await project(fixture.ids.localProject)).ref.projectId, fixture.ids.localProject)
    assert.equal(
      (await map(fixture.ids.localProject, fixture.ids.localMap)).ref.mapId,
      fixture.ids.localMap,
    )
    assert.equal(await page.locator('dialog[open]').count(), 1)
    await page.reload()
    await contains('Opaque primary ticket.', 'Blocked', 'unknown-blocker')
    await until('independent claimed label', async () =>
      /claimed/i.test(await page.locator('dialog[open]').innerText()),
    )
    await exactPath(directTicketInput)
    const localMap = await map(fixture.ids.localProject, fixture.ids.localMap)
    assert.equal(localMap.resource.kind, 'current-readable')
    assert.equal(localMap.resource.observation.completeness.kind, 'incomplete')
    assert.equal(localMap.resource.observation.value.progress, null)
    assert.equal(localMap.ticketsMembership.kind, 'current-incomplete')
    assert.equal(
      localMap.resource.observation.value.warnings.includes(
        `Duplicate ticket id ${fixture.ids.localTicket}.`,
      ),
      true,
    )
    assert.equal(
      localMap.tickets.filter((item) => item.ref.ticketId === fixture.ids.localTicket).length,
      1,
    )
    const primaryContent = observation(
      localMap.tickets.find((item) => item.ref.ticketId === fixture.ids.localTicket).resource,
    ).value
    assert.equal(primaryContent.isBlocked, true)
    assert.equal(primaryContent.isClaimed, true)
    await contains(
      'Raw incomplete resource prose.',
      'Custom retained heading',
      'Unindexed prose survives.',
      `Duplicate ticket id ${fixture.ids.localTicket}.`,
      'Some blockers',
    )
    assert.equal(
      (
        await observation(
          (
            await map(fixture.ids.localProject, fixture.ids.localMap)
          ).tickets.find((item) => item.ref.ticketId === fixture.ids.localTicket).resource,
        )
      ).value.blockersComplete,
      false,
    )
    await capture('opaque-incomplete-ticket')
    scenarios.push(
      'Opaque encoded identities survive direct pinned load/reload; incomplete raw Markdown, duplicate trace, warnings, unknown blockers and blocked/claimed facts survive',
    )

    const modal = page.locator('dialog[open]')
    await sourceJourney('Public source reference', 'https://example.invalid/resource-source', modal)
    await selectMarkdown(modal, 'Return to resource map')
    await exactPath(p.localMap)
    await until(
      'closed native Modal',
      async () => (await page.locator('dialog[open]').count()) === 0,
    )
    assert.equal(await page.locator('dialog[open]').count(), 0)
    await selectMarkdown(page, 'Open opaque primary')
    await exactPath(p.localTicket)
    await selectMarkdown(page.locator('dialog[open]'), 'Open known blocker')
    await exactPath(p.localBlocker)
    await contains('Known blocker ticket.')
    await page.goBack()
    await exactPath(p.localTicket)
    await page.goForward()
    await exactPath(p.localBlocker)
    await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click()
    await exactPath(p.localMap)
    await page.goBack()
    await exactPath(p.localTicket)
    await page.goForward()
    await exactPath(p.localMap)
    await until(
      'closed native Modal',
      async () => (await page.locator('dialog[open]').count()) === 0,
    )
    assert.equal(await page.locator('dialog[open]').count(), 0)
    await navigate(p.localTicket)
    const blockerButton = page
      .locator('dialog[open]')
      .getByRole('button', { name: /Known blocker/ })
    await blockerButton.click()
    await exactPath(p.localBlocker)
    await navigate(p.localMap)
    await page
      .locator('.react-flow')
      .getByRole('button', { name: `Open ${fixture.ids.localTicket}: Opaque primary`, exact: true })
      .click()
    await exactPath(p.localTicket)
    await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click()
    await exactPath(p.localMap)
    const siblingLink = page.locator(`a[href="${p.localSibling}"]`).first()
    await siblingLink.click()
    await exactPath(p.localSibling)
    await contains('Sibling map prose.')
    await page.goBack()
    await exactPath(p.localMap)
    await page.goForward()
    await exactPath(p.localSibling)
    await page.goto(`${fixture.origin}${p.localMap}`)
    await contains('Raw incomplete resource prose.')
    await exactPath(p.localMap)
    await page.reload()
    await contains('Raw incomplete resource prose.')
    await exactPath(p.localMap)
    await capture('incomplete-map-graph-prose')
    scenarios.push(
      'Markdown map/ticket/blocker/source links, graph blocker controls, map navigation, Modal replacement close and Back/Forward preserve pinned identities',
    )

    await navigate(p.localTicket)
    const sourcePath = observation(
      (await map(fixture.ids.localProject, fixture.ids.localMap)).resource,
    ).value.source.path
    await control('local-map-unreadable')
    await until(
      'actual Local failed file read',
      async () =>
        (await map(fixture.ids.localProject, fixture.ids.localMap)).resource.kind ===
        'retained-unavailable',
    )
    await contains('Raw incomplete resource prose.', 'Opaque primary ticket.')
    await exactPath(p.localTicket)
    assert.equal(
      observation((await map(fixture.ids.localProject, fixture.ids.localMap)).resource).value.source
        .path,
      sourcePath,
    )
    const localFailure = (await map(fixture.ids.localProject, fixture.ids.localMap)).resource
      .unavailable
    assert.equal(localFailure.kind, 'source-failure')
    assert.equal(localFailure.provenance.integration, 'local')
    assert.equal(localFailure.provenance.path, sourcePath)
    assert.ok(localFailure.cause.length > 0)
    assert.equal(await page.locator('.react-flow').count(), 1)
    await contains(localFailure.cause)
    await capture('local-retained-map-ticket')
    await navigate(p.localSettings)
    await contains('Resource Local')
    await contains((await project(fixture.ids.localProject)).activeMap.cause)
    await meaning('Settings uncertain map source truth', /uncertain|incomplete|unavailable/i)
    await navigate('/')
    await contains('Resource Local')
    await contains((await project(fixture.ids.localProject)).activeMap.cause)
    await meaning('Overview uncertain map source truth', /uncertain|incomplete|unavailable/i)
    await control('local-map-recover')
    await navigate(p.localTicket)
    await until(
      'same Local map recovery',
      async () =>
        (await map(fixture.ids.localProject, fixture.ids.localMap)).resource.kind ===
        'current-readable',
    )
    await contains('Opaque primary ticket.')
    await control('local-root-unreadable')
    await until(
      'actual Local root failure',
      async () =>
        (await project(fixture.ids.localProject)).resource.kind === 'retained-unavailable',
    )
    await contains('Raw incomplete resource prose.', 'Opaque primary ticket.')
    assert.equal(await page.locator('.react-flow').count(), 1)
    const rootFailure = (await project(fixture.ids.localProject)).resource.unavailable
    assert.equal(rootFailure.provenance.integration, 'local')
    assert.equal(rootFailure.provenance.operation, 'inspect-root')
    assert.ok(rootFailure.cause.length > 0)
    await contains(rootFailure.cause)
    await exactPath(p.localTicket)
    await capture('local-retained-root-ticket')
    for (const destination of [p.localSettings, '/']) {
      await navigate(destination)
      await contains('Resource Local')
      await contains(rootFailure.cause)
      await meaning(
        'retained source truth in actual consumer',
        /last successful|last-good|retained/i,
      )
      assert.equal((await project(fixture.ids.localProject)).resource.kind, 'retained-unavailable')
      await capture(destination === '/' ? 'local-retained-overview' : 'local-retained-settings')
    }
    await control('local-root-recover')
    await navigate(p.localTicket)
    await until(
      'same Local root recovery',
      async () => (await project(fixture.ids.localProject)).resource.kind === 'current-readable',
    )
    await contains('Opaque primary ticket.')
    await capture('local-recovered-ticket')
    scenarios.push(
      'Real Local map-file and root unreadability retain graph/prose/ticket/source and agree across Settings/Overview; identical source identities recover',
    )

    await control('local-ticket-disappear')
    await until(
      'trustworthy ticket absence',
      async () =>
        (await map(fixture.ids.localProject, fixture.ids.localMap)).tickets.find(
          (item) => item.ref.ticketId === fixture.ids.localTicket,
        ).resource.kind === 'proven-absent',
    )
    await exactPath(p.localTicket)
    assert.equal(await page.locator('dialog[open]').count(), 1)
    await contains('Opaque primary ticket.')
    await contains('Report disagrees with process exit.')
    await control('local-ticket-recover')
    await until(
      'same ticket recovery',
      async () =>
        (await map(fixture.ids.localProject, fixture.ids.localMap)).tickets.find(
          (item) => item.ref.ticketId === fixture.ids.localTicket,
        ).resource.kind === 'current-readable',
    )
    await control('local-map-disappear')
    await until(
      'trustworthy map absence',
      async () =>
        (await map(fixture.ids.localProject, fixture.ids.localMap)).resource.kind ===
        'proven-absent',
    )
    await exactPath(p.localTicket)
    await contains('Raw incomplete resource prose.')
    await contains('Report disagrees with process exit.')
    assert.equal(await has('Sibling map prose.'), false)
    await control('local-map-recover-membership')
    await until(
      'same map membership recovery',
      async () =>
        (await map(fixture.ids.localProject, fixture.ids.localMap)).resource.kind ===
        'current-readable',
    )
    await contains('Opaque primary ticket.')
    await navigate(p.missingMap)
    await contains(fixture.ids.missingMap)
    await exactPath(p.missingMap)
    assert.equal(await page.locator('.react-flow').count(), 0)
    assert.equal(await has('Sibling map prose.'), false)
    await navigate(p.local)
    await until(
      'closed native Modal',
      async () => (await page.locator('dialog[open]').count()) === 0,
    )
    assert.equal(await page.locator('dialog[open]').count(), 0)
    scenarios.push(
      'Complete membership proves map/ticket disappearance without substitution; pinned URL and historical trace persist and same IDs recover; never-known explicit map stays absent',
    )

    await navigate(p.githubTicket)
    await contains('GitHub child prose.', 'Remote aggregate prose.', 'Some blockers')
    await sourceHref('Project source', 'https://github.com/fixture/resources')
    await sourceJourney('Project source', 'https://github.com/fixture/resources')
    await sourceHref('Map source', 'https://github.com/fixture/resources/issues/71')
    await sourceHref(
      'View item in source',
      'https://github.com/fixture/resources/issues/72',
      page.locator('dialog[open]'),
    )
    await sourceJourney(
      'View item in source',
      'https://github.com/fixture/resources/issues/72',
      page.locator('dialog[open]'),
    )
    await sourceHref('Remote Markdown ticket', 'https://github.com/fixture/resources/issues/72')
    const remote = await map(fixture.ids.githubProject, '71')
    assert.deepEqual(remote.resource.observation.value.progress, { total: 12, completed: 7 })
    assert.equal(remote.tickets.length, 2)
    await contains('7 closed tickets')
    await sourceJourney('Remote Markdown ticket', 'https://github.com/fixture/resources/issues/72')
    await sourceJourney(
      'Remote Markdown map',
      'https://github.com/fixture/resources/issues/71',
      page.locator('dialog[open]'),
    )
    assert.equal(remote.resource.observation.completeness.kind, 'complete')
    assert.equal(remote.ticketsMembership.kind, 'current-incomplete')
    assert.equal(remote.ticketsMembership.observation.completeness.reason, 'pagination')
    assert.equal(
      observation(remote.tickets.find((ticket) => ticket.ref.ticketId === '72').resource).value
        .blockersComplete,
      false,
    )
    await navigate('/')
    await contains('Resource GitHub')
    assert.equal((await project(fixture.ids.githubProject)).activeMap.kind, 'uncertain')
    assert.equal(
      await has('5 open'),
      false,
      'Observed aggregate does not establish a trustworthy current active map',
    )
    await control('github-unreadable')
    await navigate(p.githubTicket)
    await until(
      'retained GitHub map read',
      async () =>
        (await map(fixture.ids.githubProject, '71')).resource.kind === 'retained-unavailable',
    )
    assert.equal(
      (await project(fixture.ids.githubProject)).resource.kind,
      'current-readable',
      'Connection/map failure cannot turn a successful Project read into retained data',
    )
    await contains('Remote aggregate prose.', 'GitHub child prose.')
    assert.equal(await page.locator('.react-flow').count(), 1)
    assert.equal(
      (await map(fixture.ids.githubProject, '71')).resource.unavailable.provenance.stage,
      'map-read',
    )
    assert.ok((await map(fixture.ids.githubProject, '71')).resource.unavailable.cause.length > 0)
    await contains((await map(fixture.ids.githubProject, '71')).resource.unavailable.cause)
    await exactPath(p.githubTicket)
    await sourceHref('Project source', 'https://github.com/fixture/resources')
    await sourceHref('Map source', 'https://github.com/fixture/resources/issues/71')
    await sourceHref(
      'View item in source',
      'https://github.com/fixture/resources/issues/72',
      page.locator('dialog[open]'),
    )
    await capture('github-retained-map-ticket')
    for (const destination of [p.githubSettings, '/']) {
      await navigate(destination)
      await contains('Resource GitHub')
      await contains((await project(fixture.ids.githubProject)).activeMap.cause)
      await meaning('degraded source truth remains uncertain', /uncertain|degraded|unavailable/i)
      assert.equal((await project(fixture.ids.githubProject)).resource.kind, 'current-readable')
    }
    await navigate(p.githubTicket)
    await control('github-recover')
    await until(
      'same GitHub resource recovery',
      async () => (await map(fixture.ids.githubProject, '71')).resource.kind === 'current-readable',
    )
    await contains('GitHub child prose.')
    await control('github-root-unreadable')
    await until(
      'retained GitHub Project read',
      async () =>
        (await project(fixture.ids.githubProject)).resource.kind === 'retained-unavailable',
    )
    await contains('GitHub child prose.', 'Remote aggregate prose.')
    assert.equal(await page.locator('.react-flow').count(), 1)
    const remoteRootCause = (await project(fixture.ids.githubProject)).resource.unavailable.cause
    await contains(remoteRootCause)
    await exactPath(p.githubTicket)
    await sourceHref('Project source', 'https://github.com/fixture/resources')
    await sourceHref('Map source', 'https://github.com/fixture/resources/issues/71')
    await sourceHref(
      'View item in source',
      'https://github.com/fixture/resources/issues/72',
      page.locator('dialog[open]'),
    )
    await capture('github-retained-root-ticket')
    for (const destination of [p.githubSettings, '/']) {
      await navigate(destination)
      await contains('Resource GitHub')
      await contains(remoteRootCause)
      await meaning(
        'GitHub retained truth in actual consumer',
        /last successful|last-good|retained/i,
      )
      assert.equal((await project(fixture.ids.githubProject)).resource.kind, 'retained-unavailable')
      await capture(destination === '/' ? 'github-retained-overview' : 'github-retained-settings')
    }
    await navigate(p.githubTicket)
    await control('github-root-recover')
    await until(
      'same GitHub Project recovery',
      async () => (await project(fixture.ids.githubProject)).resource.kind === 'current-readable',
    )
    await contains('GitHub child prose.')
    await capture('github-recovered-ticket')
    scenarios.push(
      'Real GitHub observer/provider scopes retain equivalent graph/prose/ticket/source; Connection health never overrides successful Project freshness; upstream 12/7 aggregate exceeds two fetched tickets',
    )

    const queuedModal = await evidenceText(
      p.queuedTicket,
      'Classification',
      'AFK',
      'Exited 3',
      'Queued',
      'No launch admission',
    )
    const queuedClassification = queuedModal
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Classification', exact: true }) })
      .last()
    const queuedSession = queuedModal
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Wayfinder Session', exact: true }) })
      .last()
    await fact(queuedClassification, 'Admission', 'Automatic')
    await fact(queuedClassification, 'Verdict', 'AFK')
    await fact(queuedClassification, 'Process result', 'Exited 3')
    await fact(queuedSession, 'State', 'Queued')
    await fact(queuedSession, 'Admission', 'No launch admission')
    assert.equal(await queuedSession.getByText('Process result', { exact: true }).count(), 0)
    const finishedModal = await evidenceText(
      p.finishedTicket,
      'Classification',
      'AFK',
      'Exited 3',
      'Finished',
      'Exited 9',
      'Completed',
      'Report disagrees with process exit.',
    )
    const finishedSession = finishedModal
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Wayfinder Session', exact: true }) })
      .last()
    await fact(finishedSession, 'Admission', 'Override')
    await fact(finishedSession, 'Process result', 'Exited 9')
    await fact(finishedSession, 'Session report', 'Completed')
    const acknowledgedModal = await evidenceText(
      p.acknowledgedTicket,
      'Outcome unknown',
      'Acknowledged',
      'Acknowledged unknown remains unknown.',
    )
    const unknownSession = acknowledgedModal
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Wayfinder Session', exact: true }) })
      .last()
    await fact(unknownSession, 'State', 'Outcome unknown')
    await fact(unknownSession, 'Acknowledgement', 'Acknowledged')
    await fact(unknownSession, 'Admission', 'Override')
    await navigate(p.localSettings)
    const settingsEvidence = (target) =>
      page.getByRole('region', { name: 'Automation evidence', exact: true }).filter({
        has: page.locator(`a[href="${target}"]`),
      })
    const stageFact = async (scope, stage, term, value) => {
      const owner = scope.getByRole('region', { name: stage, exact: true })
      await until(`${stage} ${term}: ${value}`, () =>
        owner.getByText(`${term}: ${value}`, { exact: false }).count(),
      )
    }
    await stageFact(settingsEvidence(p.queuedTicket), 'Classification', 'Admission', 'Automatic')
    await stageFact(settingsEvidence(p.queuedTicket), 'Classification', 'Verdict', 'AFK')
    await stageFact(
      settingsEvidence(p.queuedTicket),
      'Classification',
      'Process result',
      'Exited 3',
    )
    await stageFact(settingsEvidence(p.queuedTicket), 'Wayfinder Session', 'State', 'Queued')
    await stageFact(
      settingsEvidence(p.queuedTicket),
      'Wayfinder Session',
      'Admission',
      'No launch admission',
    )
    await stageFact(
      settingsEvidence(p.finishedTicket),
      'Wayfinder Session',
      'Admission',
      'Override',
    )
    await stageFact(
      settingsEvidence(p.finishedTicket),
      'Wayfinder Session',
      'Process result',
      'Exited 9',
    )
    await stageFact(
      settingsEvidence(p.finishedTicket),
      'Wayfinder Session',
      'Session report',
      'Completed',
    )
    await stageFact(
      settingsEvidence(p.acknowledgedTicket),
      'Wayfinder Session',
      'State',
      'Outcome unknown',
    )
    await stageFact(
      settingsEvidence(p.acknowledgedTicket),
      'Wayfinder Session',
      'Acknowledgement',
      'Acknowledged',
    )
    await navigate('/connections')
    const recordedUnknown = page
      .getByRole('region', { name: 'Automation evidence', exact: true })
      .filter({
        has: page.locator(`a[href="${p.acknowledgedTicket}"]`),
      })
    await stageFact(recordedUnknown, 'Classification', 'Admission', 'Automatic')
    await stageFact(recordedUnknown, 'Classification', 'Verdict', 'AFK')
    await stageFact(recordedUnknown, 'Classification', 'Process result', 'Exited 3')
    await stageFact(recordedUnknown, 'Wayfinder Session', 'Admission', 'Override')
    await stageFact(recordedUnknown, 'Wayfinder Session', 'State', 'Outcome unknown')
    await stageFact(recordedUnknown, 'Wayfinder Session', 'Acknowledgement', 'Acknowledged')
    await evidenceText(
      p.missingMapTicket,
      'Outcome unknown',
      'Required',
      'Never-present map interruption.',
    )
    await evidenceText(
      p.missingTicket,
      'Outcome unknown',
      'Required',
      'Never-present ticket interruption.',
    )
    await evidenceText(
      p.missingProjectTicket,
      'Outcome unknown',
      'Required',
      'Never-present Project interruption.',
    )
    assert.equal(await page.getByRole('link', { name: 'Map source', exact: true }).count(), 0)
    await exactPath(p.missingProjectTicket)
    assert.equal(await page.getByRole('link', { name: 'Project source', exact: true }).count(), 0)
    await navigate(p.localSettings)
    for (const target of [p.missingMapTicket, p.missingTicket])
      assert.ok(
        await page.locator(`a[href="${target}"]`).count(),
        'All simultaneous interruption targets remain navigable',
      )
    await navigate('/')
    await until('Overview durable missing Project destination', () =>
      page.locator(`a[href="${p.missingProjectTicket}"]`).count(),
    )
    await page.locator(`a[href="${p.missingProjectTicket}"]`).first().click()
    await exactPath(p.missingProjectTicket)
    await contains('Never-present Project interruption.')
    await control('remove-local-project')
    await navigate(p.localSettings)
    await until('missing Project Settings evidence link', () =>
      page.locator(`a[href="${p.missingMapTicket}"]`).count(),
    )
    await page.locator(`a[href="${p.missingMapTicket}"]`).first().click()
    await exactPath(p.missingMapTicket)
    await contains('Never-present map interruption.', 'Outcome unknown')
    await capture('durable-missing-project-map')
    scenarios.push(
      'Replay-validated durable Classification/Session evidence separates admission, verdict, process, report and acknowledgement; queued/unknown and every missing Project/map/ticket target remain reachable from real consumers',
    )

    const before = await control('status')
    const deniedModal = await evidenceText(p.githubTicket, 'GitHub child prose.')
    const serverControl = (await read()).automation.overrides.find(
      (item) =>
        item.target.map.project.projectId === fixture.ids.githubProject &&
        item.target.ticketId === '72',
    )
    assert.ok(serverControl)
    for (const [stage, label] of [
      ['classification', 'Run Classification'],
      ['wayfinder', 'Start Wayfinder Session'],
    ]) {
      assert.equal(serverControl[stage].status, 'ineligible')
      const button = deniedModal.getByRole('button', { name: label, exact: true })
      assert.equal(await button.isDisabled(), true)
      assert.equal(await button.getAttribute('title'), serverControl[stage].reason)
      await button.evaluate((element) => element.click())
      const outcome = await page.evaluate(
        ({ target, stage }) => window.resourceResultsFixture.executeOverride(target, stage),
        { target: serverControl.target, stage },
      )
      assert.equal(
        outcome.ok,
        false,
        'Server rechecks ineligibility through real HTTP, independently of disabled UI',
      )
    }
    const after = await control('status')
    assert.equal(after.hostInvocations, before.hostInvocations)
    assert.equal(after.selectorInvocations, 0)
    assert.equal(after.classificationLaunches, 0)
    assert.equal(after.wayfinderLaunches, 0)
    assert.equal(after.automationEvents, before.automationEvents)
    assert.equal(after.hostInvocations, 0)
    const publicFacts = JSON.stringify((await snapshot()).state)
    assert.equal(publicFacts.includes('fixture-access-only'), false)
    assert.equal(publicFacts.includes('fixture-refresh-only'), false)
    assert.equal(
      after.commandRequests,
      before.commandRequests + 2,
      'Disabled controls send nothing; only explicit server-denial probes send HTTP',
    )
    assert.deepEqual(failures, [])
    scenarios.push(
      'Server-authored ineligible controls preserve exact reasons; disabled clicks and real public HTTP denial produce no host/selector/Automation/durable effects',
    )
    await capture('server-ineligible-controls')
    assert.deepEqual(failures, [])
    console.log(
      JSON.stringify({
        status: 'passed',
        scenarioManifest,
        scenarios,
        errors: failures,
        screenshots,
        effects: {
          host: after.hostInvocations,
          selectors: after.selectorInvocations,
          classification: after.classificationLaunches,
          wayfinder: after.wayfinderLaunches,
        },
      }),
    )
  } catch (error) {
    try {
      await capture('failure')
    } catch (captureError) {
      console.error(JSON.stringify({ status: 'screenshot-failed', error: String(captureError) }))
    }
    console.error(
      JSON.stringify({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        errors: failures,
        scenarioManifest,
        scenarios,
        screenshots,
        url: page?.url() ?? null,
      }),
    )
    throw error
  } finally {
    try {
      await browser?.close()
    } finally {
      try {
        await fixture?.close()
      } finally {
        try {
          await vite?.close()
        } finally {
          try {
            if (toolingServer?.listening) {
              toolingServer.closeAllConnections()
              await new Promise((resolve, reject) =>
                toolingServer.close((error) => (error ? reject(error) : resolve())),
              )
            }
          } finally {
            try {
              if (cache) await rm(cache, { recursive: true, force: true })
            } finally {
              hooks.deregister()
            }
          }
        }
      }
    }
    console.log(
      JSON.stringify({
        status: 'cleaned-up',
        services: ['browser', 'application-fixture', 'vite', 'tooling-socket', 'temporary-cache'],
      }),
    )
  }
}
