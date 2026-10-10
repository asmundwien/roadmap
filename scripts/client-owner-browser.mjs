import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    help: { type: 'boolean' },
    'serve-only': { type: 'boolean' },
    'selectors-only': { type: 'boolean' },
    headed: { type: 'boolean' },
    'executable-path': { type: 'string' },
  },
  strict: true,
})
if (values.help) {
  console.log(`Mounted client-owner regression through real provider, App, router, application, HTTP and WebSocket.

Setup:
  pnpm install
  pnpm exec playwright install chromium

Examples:
  pnpm test:client-owner-browser
  pnpm test:client-owner-browser --selectors-only
  pnpm test:client-owner-browser --serve-only
  pnpm test:client-owner-browser --headed --executable-path /path/to/chromium

Options:
  --serve-only       Start disposable fixture services until SIGINT/SIGTERM. Prints the URL and control endpoint.
  --selectors-only  Run mounted selected-result regression before the complete lifetime schedules.
  --headed          Show the isolated browser window.
  --executable-path Use an installed Chromium executable. CHROMIUM_EXECUTABLE_PATH is also supported.
  --help            Show setup and invocation.

The default uses Playwright's installed Chromium, then searches PATH for chromium, chromium-browser,
google-chrome or chrome. No real configuration, credentials, host effects or Automation are used.`)
} else {
  await main()
}

async function discoverExecutable(chromium) {
  const explicit = values['executable-path'] ?? process.env.CHROMIUM_EXECUTABLE_PATH
  if (explicit) {
    await access(explicit)
    return explicit
  }
  const candidates = [chromium.executablePath()]
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    for (const name of [
      'chromium',
      'chromium-browser',
      'google-chrome',
      'chrome',
      'chrome.exe',
      'chromium.exe',
    ])
      candidates.push(join(directory, name))
  }
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  throw new Error(
    'No Chromium executable found. Run pnpm exec playwright install chromium, or pass --executable-path /path/to/chromium.',
  )
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const web = createRequire(new URL('../apps/web/package.json', import.meta.url))
  // Node strips TypeScript in the real server source. Fixture-only imports use the existing server workspace dependencies.
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
  const { createServer } = await import(pathToFileURL(web.resolve('vite')).href)
  const { default: react } = await import(pathToFileURL(web.resolve('@vitejs/plugin-react')).href)
  const cache = await mkdtemp(join(tmpdir(), 'roadmap-client-owner-vite-'))
  const vite = await createServer({
    configFile: false,
    root: join(root, 'apps/web'),
    cacheDir: cache,
    envDir: false,
    publicDir: false,
    appType: 'custom',
    plugins: [
      react(),
      {
        name: 'client-owner-fixture-dependencies',
        enforce: 'pre',
        async resolveId(source, importer, options) {
          if (
            !importer ||
            !importer.includes('/scripts/fixtures/client-owner-browser.tsx') ||
            source.startsWith('.') ||
            source.startsWith('/') ||
            source.startsWith('\\0')
          )
            return null
          return this.resolve(source, join(root, 'apps/web/src/main.tsx'), {
            ...options,
            skipSelf: true,
          })
        },
      },
    ],
    server: { middlewareMode: true, hmr: false, fs: { allow: [root, cache] } },
    optimizeDeps: {
      entries: [join(root, 'scripts/fixtures/client-owner-browser.tsx')],
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
  let fixture
  let browser
  const failures = []
  try {
    const { createClientOwnerServer } = await import('./fixtures/client-owner-server.ts')
    fixture = await createClientOwnerServer(
      vite.middlewares,
      join(root, 'scripts/fixtures/client-owner-browser.tsx'),
    )
    console.log(
      JSON.stringify({
        fixture: fixture.origin,
        control: `${fixture.origin}/__fixture/control?action=status`,
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
      executablePath: await discoverExecutable(chromium),
      headless: !values.headed,
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', (error) => failures.push(error.message))
    const results = []
    const control = async (action) => fixture.control(action)
    const snapshot = () => page.evaluate(() => window.clientOwnerFixture.snapshot())
    async function until(label, predicate) {
      const deadline = Date.now() + 15_000
      while (!(await predicate())) {
        assert.deepEqual(failures, [], `Browser errors before ${label}`)
        if (Date.now() >= deadline)
          throw new Error(
            `Timed out waiting for ${label}. Last client snapshot: ${JSON.stringify(await page.evaluate(() => window.clientOwnerFixture?.snapshot() ?? null))}`,
          )
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
    async function settle() {
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
    }
    async function stableSelection(before, label) {
      await settle()
      const after = await snapshot()
      assert.equal(
        after.observations.projectRenders,
        before.observations.projectRenders,
        `${label}: selected Projects must not render`,
      )
      assert.equal(
        after.observations.projectCommits,
        before.observations.projectCommits,
        `${label}: selected Projects must not commit`,
      )
      assert.equal(
        after.observations.projectIdentityChanges,
        before.observations.projectIdentityChanges,
        `${label}: selected Projects object must remain identical`,
      )
      assert.equal(
        after.observations.selectedResultIdentityChanges,
        before.observations.selectedResultIdentityChanges,
        `${label}: selected result object must remain identical`,
      )
      assert.deepEqual(
        after.derivedObservations,
        before.derivedObservations,
        `${label}: pure derived object selection must keep render and reference stability`,
      )
    }
    const mapPath = '/projects/local/fixture/maps/.wayfinder%2Fowner-map%2Fmap.md'
    const ticketPath = `${mapPath}/tickets/1`
    await page.goto(`${fixture.origin}${values['selectors-only'] ? '/components' : mapPath}`)
    await until('fixture API', () => page.evaluate(() => Boolean(window.clientOwnerFixture)))
    await until(
      'open socket without baseline',
      async () =>
        (await snapshot()).snapshot.transport === 'live' &&
        (await control('status')).upstreamSockets === 1,
    )
    assert.equal((await snapshot()).snapshot.state, null)
    assert.equal(await page.locator('[data-roadmap-readiness="waiting"]').count(), 1)
    assert.equal(await page.locator('.react-flow').count(), 0)
    assert.equal(await page.locator('[data-fixture-projects]').count(), 0)
    await control('malformed')
    await settle()
    assert.equal(
      (await snapshot()).snapshot.state,
      null,
      'Malformed initial state cannot fabricate resources or readiness',
    )
    await control('release-baseline')
    await until(
      'real accepted baseline and mounted consumers',
      async () =>
        (await snapshot()).snapshot.synchronization === 'synchronized' &&
        (values['selectors-only']
          ? (await page.locator('[data-fixture-projects]').count()) === 1
          : (await page.locator('.react-flow').count()) === 1),
    )
    await settle()
    const accepted = await snapshot()
    if (!values['selectors-only']) {
      assert.deepEqual(accepted.observedStatus.lifecycle, { phase: 'ready', mode: 'mutable' })
      assert.equal(accepted.observedStatus.synchronization, 'synchronized')
    }
    assert.equal(accepted.snapshot.state.phase, 'ready')
    const unavailable = accepted.snapshot.state.projects.find(
      (project) => project.ref.projectId === 'unavailable',
    )
    assert.ok(unavailable)
    assert.equal(unavailable.resource.kind, 'never-observed')
    assert.ok(
      unavailable.resource.current,
      'Real missing Local source must carry unavailable evidence',
    )
    assert.equal(unavailable.resource.current.kind, 'source-failure')
    assert.deepEqual(unavailable.resource.current.failure, {
      kind: 'filesystem',
      operation: 'inspect-root',
      code: 'ENOENT',
    })
    assert.equal(unavailable.maps.length, 0, 'Never-observed source cannot fabricate maps')
    assert.equal(unavailable.mapsMembership.kind, 'unavailable')
    assert.equal(
      unavailable.mapsMembership.lastComplete,
      null,
      'Unavailable membership has no invented known-empty successful observation',
    )
    assert.equal(unavailable.mapsMembership.unavailable.kind, 'source-failure')
    assert.deepEqual(unavailable.mapsMembership.unavailable.scope, {
      kind: 'project',
      project: { integration: 'local', projectId: 'unavailable' },
    })
    assert.deepEqual(unavailable.mapsMembership.unavailable.failure, {
      kind: 'filesystem',
      operation: 'inspect-root',
      code: 'ENOENT',
    })
    assert.equal(
      await page.locator('[data-roadmap-readiness="waiting"]').count(),
      0,
      'Source-unavailable accepted state is still application-ready',
    )
    results.push(
      'withheld and malformed initial baseline; actual source-unavailable accepted readiness',
    )

    // The request captures current admission, then a real external revision makes it stale before application dispatch.
    await control('withhold')
    await control('hold-next-request')
    await control('hold-next-response')
    const beforeCommand = await snapshot()
    void page.evaluate(() => {
      void window.clientOwnerFixture.renameProject()
    })
    await until(
      'held captured workflow request',
      async () =>
        (await control('status')).pendingRequests === 1 &&
        (await snapshot()).snapshot.workflows.attempts.some(
          (attempt) => attempt.kind === 'pending',
        ),
    )
    await control('equal-projects')
    await control('release-requests')
    await until(
      'held real correlated command outcome',
      async () =>
        (await control('status')).pendingResponses === 1 &&
        (await snapshot()).snapshot.workflows.attempts.some(
          (attempt) => attempt.kind === 'pending',
        ),
    )
    await stableSelection(beforeCommand, 'command-only publication')
    await control('release-responses')
    await until(
      'settled real workflow',
      async () =>
        !(await snapshot()).snapshot.workflows.attempts.some(
          (attempt) => attempt.kind === 'pending',
        ),
    )
    await stableSelection(beforeCommand, 'command-only completion')
    const commandConflict = (await snapshot()).outcomes.at(-1)
    assert.equal(commandConflict.kind, 'rejected')
    assert.equal(commandConflict.operation, 'rename-project')
    assert.deepEqual(commandConflict.subject, {
      kind: 'project',
      project: { integration: 'local', projectId: 'fixture' },
    })
    assert.equal(commandConflict.error.code, 'conflict')
    assert.equal(commandConflict.outcome.ok, false)
    assert.equal(
      commandConflict.configurationVersion,
      beforeCommand.snapshot.state.configurationVersion,
    )
    assert.equal(commandConflict.destination ?? null, null)
    results.push(
      'selected Projects render and identity stability during command-only begin/completion',
    )
    if (values['selectors-only']) {
      console.log(JSON.stringify({ status: 'passed', schedules: results }))
      return
    }

    await control('release-baseline')
    await until(
      'external revision becomes accepted',
      async () =>
        (await snapshot()).snapshot.state.configurationVersion >
        beforeCommand.snapshot.state.configurationVersion,
    )
    const beforeEqual = await snapshot()
    await control('equal-projects')
    await until(
      'independently decoded equal Projects replacement',
      async () =>
        (await snapshot()).snapshot.state.configurationVersion >
        beforeEqual.snapshot.state.configurationVersion,
    )
    await stableSelection(beforeEqual, 'equal independently decoded Projects')
    const beforeMutation = await snapshot()
    await control('mutate-projects')
    await until('changed selected Project', () =>
      page
        .locator('[data-fixture-projects]')
        .textContent()
        .then((text) => text.includes('Changed selected Project')),
    )
    assert.ok(
      (await snapshot()).observations.projectIdentityChanges >
        beforeMutation.observations.projectIdentityChanges,
    )
    await until('changed primitive in derived selection', () =>
      page
        .locator('[data-fixture-derived]')
        .textContent()
        .then((text) => text.includes('Changed selected Project')),
    )
    assert.ok(
      (await snapshot()).derivedObservations.identities >
        beforeMutation.derivedObservations.identities,
    )
    results.push(
      'equal independently decoded full replacement; pure derived object identity stability; selected fact and derived primitive mutation change content',
    )

    await page.locator('[data-fixture-draft]').fill('Keep this view-local draft')
    await page.evaluate((path) => window.clientOwnerFixture.navigate(path), ticketPath)
    await until(
      'open actual URL-selected ticket Modal',
      async () =>
        (await page.locator('dialog[open]').count()) === 1 &&
        (await snapshot()).pathname === ticketPath,
    )
    await settle()
    await page.evaluate(() => window.clientOwnerFixture.pinIdentity('Predecessor'))
    async function assertRetained(label) {
      await settle()
      const identity = await page.evaluate(() => window.clientOwnerFixture.identity())
      assert.deepEqual(
        identity,
        {
          graph: true,
          modal: true,
          mapProse: true,
          ticketProse: true,
          draft: true,
          draftValue: 'Keep this view-local draft',
          pathname: ticketPath,
        },
        `${label}: mounted DOM identities and URL selection`,
      )
      assert.equal((await snapshot()).snapshot.synchronization, 'retained')
      assert.equal(await page.locator('[data-roadmap-readiness="retained"]').count(), 1)
    }
    await control('withhold')
    await control('disconnect')
    await until(
      'disconnected retained state',
      async () => (await snapshot()).snapshot.transport === 'disconnected',
    )
    await assertRetained('disconnect')
    await until(
      'live retained socket with withheld baseline',
      async () =>
        (await snapshot()).snapshot.transport === 'live' &&
        (await control('status')).upstreamSockets === 1,
    )
    await assertRetained('live socket without baseline')
    await control('release-baseline')
    await until(
      'reestablished predecessor baseline',
      async () => (await snapshot()).snapshot.synchronization === 'synchronized',
    )

    // A predecessor host command really completes before transport settlement. The fixture holds its original correlated HTTP bytes.
    await control('hold-next-response')
    void page.evaluate(() => {
      void window.clientOwnerFixture.launchProject()
    })
    await until(
      'predecessor outcome held',
      async () => (await control('status')).pendingResponses === 1,
    )
    const predecessor = await snapshot()
    const beforeSuccessorConnections = (await control('status')).socketConnections
    await control('successor')
    await until(
      'live successor socket without baseline',
      async () =>
        (await control('status')).socketConnections > beforeSuccessorConnections &&
        (await snapshot()).snapshot.transport === 'live' &&
        (await control('status')).upstreamSockets === 1,
    )
    await assertRetained('live successor before baseline')
    await control('release-baseline')
    await until('successor content release', () =>
      page
        .locator('dialog[open]')
        .textContent()
        .then((text) => text.includes('Successor ticket prose.')),
    )
    const successor = await snapshot()
    assert.deepEqual(successor.observedStatus.lifecycle, { phase: 'ready', mode: 'mutable' })
    assert.equal(successor.observedStatus.synchronization, 'synchronized')
    assert.notEqual(successor.snapshot.state.serverEpoch, predecessor.snapshot.state.serverEpoch)
    assert.equal(successor.pathname, ticketPath)
    assert.equal(
      await page.locator('[data-fixture-draft]').inputValue(),
      'Keep this view-local draft',
    )
    const resumedIdentity = await page.evaluate(() => window.clientOwnerFixture.identity())
    assert.equal(resumedIdentity.graph, true)
    assert.equal(resumedIdentity.modal, true)
    assert.equal(resumedIdentity.draft, true)
    await control('release-responses')
    await until(
      'obsolete predecessor outcome settlement',
      async () =>
        !(await snapshot()).snapshot.workflows.attempts.some(
          (attempt) => attempt.kind === 'pending',
        ),
    )
    assert.equal(
      (await snapshot()).snapshot.state.serverEpoch,
      successor.snapshot.state.serverEpoch,
    )
    assert.equal((await snapshot()).snapshot.synchronization, 'synchronized')
    assert.equal((await snapshot()).outcomes.at(-1).kind, 'acknowledged')
    assert.equal(
      (await snapshot()).outcomes.at(-1).outcome.serverEpoch,
      predecessor.snapshot.state.serverEpoch,
    )
    results.push(
      'retained disconnect and live withheld baseline with pinned graph/Modal/prose/draft DOM identity; successor release; predecessor HTTP after successor WebSocket without rollback',
    )

    // The second settlement order releases the predecessor reply while the successor baseline is still withheld.
    await control('hold-next-response')
    void page.evaluate(() => {
      void window.clientOwnerFixture.launchProject()
    })
    await until(
      'second predecessor outcome held',
      async () => (await control('status')).pendingResponses === 1,
    )
    const beforeSecondSuccessorConnections = (await control('status')).socketConnections
    await control('successor')
    await until(
      'second live successor without baseline',
      async () =>
        (await control('status')).socketConnections > beforeSecondSuccessorConnections &&
        (await snapshot()).snapshot.transport === 'live' &&
        (await snapshot()).snapshot.synchronization === 'retained',
    )
    const withheldEpoch = (await snapshot()).snapshot.state.serverEpoch
    await control('release-responses')
    await until(
      'predecessor outcome before successor baseline',
      async () =>
        !(await snapshot()).snapshot.workflows.attempts.some(
          (attempt) => attempt.kind === 'pending',
        ),
    )
    assert.equal((await snapshot()).snapshot.state.serverEpoch, withheldEpoch)
    assert.equal((await snapshot()).snapshot.synchronization, 'retained')
    assert.equal((await snapshot()).outcomes.at(-1).kind, 'acknowledged')
    assert.equal((await snapshot()).outcomes.at(-1).outcome.serverEpoch, withheldEpoch)
    await control('release-baseline')
    await until(
      'second valid successor baseline',
      async () =>
        (await snapshot()).snapshot.synchronization === 'synchronized' &&
        (await snapshot()).snapshot.state.serverEpoch !== withheldEpoch,
    )
    results.push('predecessor HTTP before successor WebSocket cannot establish synchronization')

    // HTTP reaches a real differing epoch while B's established socket remains active.
    await settle()
    await page.evaluate(() => {
      window.clientOwnerFixture.pinIdentity('Successor')
      window.clientOwnerFixture.pinReadState()
    })
    const current = await snapshot()
    const beforeHttpSuccessor = await control('status')
    const httpSuccessor = await control('http-successor')
    assert.equal(httpSuccessor.socketConnections, beforeHttpSuccessor.socketConnections)
    assert.equal(httpSuccessor.activeSockets, 1)
    assert.equal(httpSuccessor.upstreamSockets, 1)
    assert.notEqual(httpSuccessor.state.serverEpoch, current.snapshot.state.serverEpoch)
    assert.equal((await snapshot()).snapshot.synchronization, 'synchronized')
    assert.equal(await page.evaluate(() => window.clientOwnerFixture.readStateIdentity()), true)
    await page.evaluate(() => window.clientOwnerFixture.renameProject())
    const conflict = await snapshot()
    assert.equal(conflict.outcomes.at(-1).kind, 'rejected')
    assert.equal(conflict.outcomes.at(-1).operation, 'rename-project')
    assert.deepEqual(conflict.outcomes.at(-1).subject, {
      kind: 'project',
      project: { integration: 'local', projectId: 'fixture' },
    })
    assert.equal(conflict.outcomes.at(-1).error.code, 'conflict')
    assert.equal(conflict.outcomes.at(-1).outcome.serverEpoch, httpSuccessor.state.serverEpoch)
    assert.equal(conflict.outcomes.at(-1).destination ?? null, null)
    await until(
      'successor HTTP retires established B socket and opens fresh withheld C socket',
      async () => {
        const status = await control('status')
        const view = await snapshot()
        return (
          status.socketConnections > beforeHttpSuccessor.socketConnections &&
          status.activeSockets === 1 &&
          status.upstreamSockets === 1 &&
          view.snapshot.transport === 'live' &&
          view.snapshot.synchronization === 'retained'
        )
      },
    )
    await assertRetained('valid differing-epoch successor HTTP before socket baseline')
    const afterHttpSuccessor = await control('status')
    assert.equal(afterHttpSuccessor.socketConnections, beforeHttpSuccessor.socketConnections + 1)
    assert.equal(afterHttpSuccessor.commandRequests, beforeHttpSuccessor.commandRequests + 1)
    assert.equal(await page.evaluate(() => window.clientOwnerFixture.readStateIdentity()), true)
    assert.deepEqual((await snapshot()).snapshot.state, current.snapshot.state)
    await control('release-baseline')
    await until('actual C socket baseline establishes successor HTTP epoch', async () => {
      const view = await snapshot()
      return (
        view.snapshot.synchronization === 'synchronized' &&
        view.snapshot.state.serverEpoch === httpSuccessor.state.serverEpoch
      )
    })
    await settle()
    assert.equal((await snapshot()).pathname, ticketPath)
    await until('actual C mounted ticket prose', async () =>
      (await page.locator('dialog[open]').textContent()).includes('HTTP successor ticket prose.'),
    )
    assert.equal(await page.getByText('HTTP successor map prose.', { exact: true }).count(), 1)
    assert.equal(
      await page.locator('[data-fixture-draft]').inputValue(),
      'Keep this view-local draft',
    )
    const httpResumedIdentity = await page.evaluate(() => window.clientOwnerFixture.identity())
    assert.equal(httpResumedIdentity.graph, true)
    assert.equal(httpResumedIdentity.modal, true)
    assert.equal(httpResumedIdentity.draft, true)
    const beforeCurrentUpdate = await snapshot()
    await control('equal-projects')
    await until(
      'continued real C socket updates',
      async () =>
        (await snapshot()).snapshot.state.configurationVersion >
        beforeCurrentUpdate.snapshot.state.configurationVersion,
    )
    assert.equal((await snapshot()).snapshot.state.serverEpoch, httpSuccessor.state.serverEpoch)
    assert.equal((await snapshot()).snapshot.synchronization, 'synchronized')
    const beforeLoss = await control('status')
    await control('drop-next-response')
    await page.evaluate(() => window.clientOwnerFixture.launchProject())
    assert.equal((await snapshot()).outcomes.at(-1).kind, 'completion-unknown')
    const unknown = await snapshot()
    assert.equal(
      unknown.snapshot.workflows.attempts.some((attempt) => attempt.kind === 'pending'),
      false,
    )
    assert.equal(unknown.outcomes.at(-1).error.code, 'transport-failed')
    const unknownCompletion = unknown.outcomes.at(-1)
    const unknownError = unknownCompletion.error
    await page.evaluate(() => window.clientOwnerFixture.pinUnknown())
    async function assertCurrentUnknown(label, sameIdentity = true) {
      const view = await snapshot()
      const attempt = view.snapshot.workflows.attempts.find(
        (attempt) => attempt.id === unknownCompletion.id,
      )
      assert.ok(attempt, label)
      assert.equal(attempt.kind, 'completion-unknown', label)
      assert.equal(attempt.error.code, 'transport-failed', label)
      assert.deepEqual(attempt.error, unknownError, label)
      assert.equal(attempt.operation, 'launch-project-operation', label)
      assert.deepEqual(attempt.subject, unknownCompletion.subject, label)
      assert.equal(
        view.launchFeedback.unknown.some((attempt) => attempt.id === unknownCompletion.id),
        true,
        label,
      )
      assert.equal(attempt.destination ?? null, null, label)
      assert.deepEqual(
        await page.evaluate(() => window.clientOwnerFixture.unknownIdentity()),
        { completion: sameIdentity, completionFrozen: true, error: true, errorFrozen: true },
        label,
      )
    }
    await assertCurrentUnknown('unknown completion remains immutable and attached to its attempt')
    await page.evaluate(() => window.clientOwnerFixture.refreshUnavailable())
    const independentRefresh = (await snapshot()).outcomes.at(-1)
    assert.equal(independentRefresh.kind, 'acknowledged')
    assert.equal(independentRefresh.operation, 'refresh-project')
    assert.equal(independentRefresh.result.attempt.kind, 'failed')
    await assertCurrentUnknown('unrelated acknowledged refresh cannot clear native uncertainty')
    await control('hold-next-request')
    void page.evaluate(() => {
      void window.clientOwnerFixture.renameProject()
    })
    await until(
      'unrelated captured rename request',
      async () => (await control('status')).pendingRequests === 1,
    )
    await control('equal-projects')
    await control('release-requests')
    await until(
      'unrelated stale rename rejection',
      async () =>
        !(await snapshot()).snapshot.workflows.attempts.some(
          (attempt) => attempt.kind === 'pending',
        ),
    )
    const unrelatedRejection = (await snapshot()).outcomes.at(-1)
    assert.equal(unrelatedRejection.kind, 'rejected')
    assert.equal(unrelatedRejection.error.code, 'conflict')
    await assertCurrentUnknown('another workflow error cannot clear native uncertainty')
    await page.evaluate(() => window.clientOwnerFixture.dismissUnknown())
    const dismissed = (await snapshot()).snapshot.workflows.attempts.find(
      (attempt) => attempt.id === unknownCompletion.id,
    )
    assert.equal(dismissed.dismissed, true)
    assert.equal((await snapshot()).launchFeedback.message, null)
    assert.equal((await snapshot()).launchFeedback.error, null)
    await assertCurrentUnknown(
      'dismissal hides feedback without settling native uncertainty',
      false,
    )
    assert.equal(
      (await control('status')).commandRequests,
      beforeLoss.commandRequests + 3,
      'Each explicit workflow dispatches once, without replaying the unknown native operation',
    )
    assert.equal(
      (await control('status')).hostInvocations,
      beforeLoss.hostInvocations + 1,
      'Unknown completion has exactly one observed harmless host invocation',
    )
    const commandCount = (await control('status')).commandRequests
    const connectionsBeforeUnknownReconnect = (await control('status')).socketConnections
    await control('disconnect')
    await until(
      'reconnect after unknown completion',
      async () =>
        (await control('status')).socketConnections > connectionsBeforeUnknownReconnect &&
        (await snapshot()).snapshot.synchronization === 'synchronized',
    )
    await assertCurrentUnknown('unknown attempt survives reconnect', false)
    const beforeUnknownUpdate = await snapshot()
    await control('equal-projects')
    await until(
      'real current state after unknown completion',
      async () =>
        (await snapshot()).snapshot.state.configurationVersion >
        beforeUnknownUpdate.snapshot.state.configurationVersion,
    )
    await assertCurrentUnknown('unknown attempt survives state publication', false)
    assert.equal(
      (await control('status')).commandRequests,
      commandCount,
      'Reconnect must never replay a command',
    )
    assert.equal(
      (await control('status')).hostInvocations,
      beforeLoss.hostInvocations + 1,
      'Reconnect cannot repeat the unknown host invocation',
    )
    for (const order of ['predecessor-first', 'successor-first']) {
      const established = await snapshot()
      const networkBefore = await control('status')
      await page.evaluate(() => {
        window.clientOwnerFixture.pinIdentity('HTTP successor')
        window.clientOwnerFixture.pinReadState()
      })
      await control('hold-next-response')
      void page.evaluate(() => {
        void window.clientOwnerFixture.launchProject()
      })
      await until(
        `${order} current-authority predecessor reply held`,
        async () => (await control('status')).pendingResponses === 1,
      )
      const actualSuccessor = await control('http-successor')
      await control('hold-next-response')
      void page.evaluate(() => {
        void window.clientOwnerFixture.renameProject()
      })
      await until(
        `${order} independent successor reply held`,
        async () =>
          (await control('status')).pendingResponses === 2 &&
          (await snapshot()).snapshot.workflows.attempts.filter(
            (attempt) => attempt.kind === 'pending',
          ).length === 2,
      )
      assert.equal((await snapshot()).snapshot.synchronization, 'synchronized')
      await control(
        order === 'predecessor-first' ? 'release-first-response' : 'release-last-response',
      )
      await until(
        `${order} first independent settlement`,
        async () =>
          (await snapshot()).snapshot.workflows.attempts.filter(
            (attempt) => attempt.kind === 'pending',
          ).length === 1,
      )
      if (order === 'predecessor-first') {
        assert.equal((await snapshot()).snapshot.synchronization, 'synchronized')
        assert.equal((await control('status')).socketConnections, networkBefore.socketConnections)
        assert.equal((await snapshot()).outcomes.at(-1).kind, 'acknowledged')
        assert.equal(
          (await snapshot()).outcomes.at(-1).outcome.serverEpoch,
          established.snapshot.state.serverEpoch,
        )
      } else {
        assert.equal((await snapshot()).outcomes.at(-1).kind, 'rejected')
        assert.equal(
          (await snapshot()).outcomes.at(-1).outcome.serverEpoch,
          actualSuccessor.state.serverEpoch,
        )
      }
      await control('release-responses')
      await until(`${order} settled with one fresh withheld successor socket`, async () => {
        const view = await snapshot()
        const network = await control('status')
        return (
          !view.snapshot.workflows.attempts.some((attempt) => attempt.kind === 'pending') &&
          network.socketConnections === networkBefore.socketConnections + 1 &&
          network.activeSockets === 1 &&
          network.upstreamSockets === 1 &&
          view.snapshot.transport === 'live' &&
          view.snapshot.synchronization === 'retained'
        )
      })
      assert.equal(await page.evaluate(() => window.clientOwnerFixture.readStateIdentity()), true)
      assert.deepEqual((await snapshot()).snapshot.state, established.snapshot.state)
      await assertRetained(
        `${order} established authority retains DOM and draft until real baseline`,
      )
      const settled = (await snapshot()).outcomes.slice(-2)
      const native = settled.find((attempt) => attempt.operation === 'launch-project-operation')
      const mutation = settled.find((attempt) => attempt.operation === 'rename-project')
      assert.equal(native.kind, 'acknowledged')
      assert.equal(native.outcome.serverEpoch, established.snapshot.state.serverEpoch)
      assert.equal(mutation.kind, 'rejected')
      assert.equal(mutation.error.code, 'conflict')
      assert.equal(mutation.outcome.serverEpoch, actualSuccessor.state.serverEpoch)
      assert.equal(mutation.destination ?? null, null)
      await assertCurrentUnknown(
        `${order} independent outcomes cannot settle old native uncertainty`,
        false,
      )
      await control('release-baseline')
      await until(
        `${order} real successor baseline`,
        async () =>
          (await snapshot()).snapshot.synchronization === 'synchronized' &&
          (await snapshot()).snapshot.state.serverEpoch === actualSuccessor.state.serverEpoch,
      )
      await assertCurrentUnknown(
        `${order} fresh baseline cannot settle old native uncertainty`,
        false,
      )
      const beforePublication = await snapshot()
      await control('equal-projects')
      await until(
        `${order} continued successor publication`,
        async () =>
          (await snapshot()).snapshot.state.configurationVersion >
          beforePublication.snapshot.state.configurationVersion,
      )
      assert.equal((await snapshot()).snapshot.state.serverEpoch, actualSuccessor.state.serverEpoch)
      assert.equal((await control('status')).commandRequests, networkBefore.commandRequests + 2)
    }
    results.push(
      'actual differing-epoch HTTP conflict requests fresh socket without HTTP read adoption; current-authority predecessor/successor settlements in both orders; retained DOM/URL/draft until real baseline and continued successor updates; per-attempt native uncertainty survives unrelated workflow settlement, dismissal, reconnect and state without replay',
    )

    for (const route of ['/components', '/unknown-client-owner-path']) {
      await page.evaluate((path) => window.clientOwnerFixture.navigate(path), route)
      await until(`navigation to ${route}`, async () => (await snapshot()).pathname === route)
      await page.evaluate(() => window.clientOwnerFixture.readers(false))
      await settle()
      assert.equal(await page.locator('[data-fixture-projects]').count(), 0)
      const before = await control('status')
      assert.equal(before.activeSockets, 1)
      await control('equal-projects')
      await until(
        'observation without data readers',
        async () =>
          (await snapshot()).snapshot.state.configurationVersion >
          before.state.configurationVersion,
      )
      assert.equal((await control('status')).socketConnections, before.socketConnections)
      assert.equal((await snapshot()).snapshot.transport, 'live')
      if (route === '/unknown-client-owner-path')
        assert.equal(await page.getByRole('heading', { name: 'Page not found' }).count(), 1)
    }
    results.push(
      'provider observation through /components and unknown route without fixture/data readers',
    )

    const beforeChurn = await control('status')
    for (let index = 0; index < 4; index += 1) {
      await page.evaluate(() => window.clientOwnerFixture.readers(true))
      await settle()
      await page.evaluate(() => window.clientOwnerFixture.readers(false))
      await settle()
    }
    assert.equal(
      (await control('status')).socketConnections,
      beforeChurn.socketConnections,
      'Subscriber churn must not acquire observation',
    )
    await page.evaluate(() => window.clientOwnerFixture.owners(3))
    await settle()
    assert.equal((await control('status')).activeSockets, 1)
    await page.evaluate(() => window.clientOwnerFixture.owners(1))
    await settle()
    assert.equal((await control('status')).activeSockets, 1)
    for (let index = 0; index < 3; index += 1) {
      await page.evaluate(() => window.clientOwnerFixture.dispose())
      await until(
        'provider disposal closes sockets',
        async () =>
          (await control('status')).activeSockets === 0 &&
          (await control('status')).upstreamSockets === 0,
      )
      assert.equal((await snapshot()).snapshot.transport, 'disconnected')
      await assertCurrentUnknown('provider disposal retains dismissed attempt uncertainty', false)
      const disposedCount = (await control('status')).socketConnections
      await new Promise((resolve) => setTimeout(resolve, 650))
      assert.equal((await control('status')).socketConnections, disposedCount)
      await page.evaluate(() => window.clientOwnerFixture.mount())
      await until(
        'StrictMode provider reacquisition',
        async () =>
          (await control('status')).activeSockets === 1 &&
          (await snapshot()).snapshot.synchronization === 'synchronized',
      )
      await assertCurrentUnknown(
        'StrictMode reacquisition retains dismissed attempt uncertainty',
        false,
      )
    }
    await control('withhold')
    await control('disconnect')
    await until(
      'pending reconnect before disposal',
      async () => (await snapshot()).snapshot.transport === 'disconnected',
    )
    await page.evaluate(() => window.clientOwnerFixture.dispose())
    await until(
      'last owner released',
      async () =>
        (await control('status')).activeSockets === 0 &&
        (await control('status')).upstreamSockets === 0,
    )
    const disposedCount = (await control('status')).socketConnections
    await new Promise((resolve) => setTimeout(resolve, 650))
    assert.equal(
      (await control('status')).socketConnections,
      disposedCount,
      'Owner disposal clears pending reconnect',
    )
    assert.equal((await snapshot()).snapshot.transport, 'disconnected')
    assert.equal((await snapshot()).snapshot.synchronization, 'retained')
    assert.equal(
      (await control('status')).selectorInvocations,
      0,
      'Mounts, navigation and reconnect cannot invoke folder selection',
    )
    assert.equal(
      (await control('status')).hostInvocations,
      5,
      'Every explicit native attempt invokes its harmless effect once',
    )
    results.push(
      'subscriber churn; concurrent owners; repeated StrictMode setup/cleanup; disposal closes sockets and cancels pending reconnect',
    )
    assert.deepEqual(failures, [])
    console.log(
      JSON.stringify({
        status: 'passed',
        schedules: results,
        effects: {
          harmlessHostInvocations: (await control('status')).hostInvocations,
          folderSelectors: 0,
        },
      }),
    )
  } finally {
    try {
      await browser?.close()
    } finally {
      try {
        await fixture?.close()
      } finally {
        try {
          await vite.close()
        } finally {
          await rm(cache, { recursive: true, force: true })
          hooks.deregister()
        }
      }
    }
  }
}
