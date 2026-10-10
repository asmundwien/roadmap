import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { parseProofOptions } from './proof-options.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const allFixtures = JSON.parse(
  await readFile(new URL('./fixtures/types/cases.json', import.meta.url), 'utf8'),
)
let options
try {
  options = parseProofOptions(process.argv.slice(2), true)
} catch (error) {
  console.error(error.message)
  process.exit(2)
}
if (options.help) {
  console.log(
    'Usage: node scripts/check-contract-types.mjs [--case NAME] [--negative-only]\nChecks separate compilation graphs, all supported exports/decoders and every invalid construction by default.\n\nExamples:\n  node scripts/check-contract-types.mjs\n  node scripts/check-contract-types.mjs --negative-only --case session-queued-admission',
  )
  process.exit(0)
}
const requested = options.case
if (requested !== null && !allFixtures.some(({ name }) => name === requested)) {
  console.error(
    `Unknown type fixture ${requested}. Run node scripts/check-contract-types.mjs --help.`,
  )
  process.exit(2)
}
const fixtures = allFixtures.filter(({ name }) => requested === null || name === requested)
const negativeOnly = options.negativeOnly
const exportInventory = JSON.parse(
  await readFile(new URL('./fixtures/types/exports.json', import.meta.url), 'utf8'),
)
const format = (diagnostics) =>
  ts.formatDiagnostics(diagnostics, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: (path) => path,
    getNewLine: () => '\n',
  })
const normalize = (path) => resolve(path).replaceAll('\\', '/')
function config(path) {
  const filename = resolve(root, path)
  const result = ts.getParsedCommandLineOfConfigFile(
    filename,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(format([diagnostic]))
      },
    },
  )
  assert.ok(result, `Unable to parse ${path}`)
  assert.deepEqual(result.errors, [], format(result.errors))
  return result
}
function program(files, compilerOptions) {
  return ts.createProgram(files, {
    ...compilerOptions,
    incremental: false,
    composite: false,
    tsBuildInfoFile: undefined,
  })
}
function requireClean(compilation, label) {
  const diagnostics = ts.getPreEmitDiagnostics(compilation)
  assert.equal(diagnostics.length, 0, `${label}\n${format(diagnostics)}`)
}
function proveExports(compilation, positive) {
  const source = compilation.getSourceFile(positive)
  assert.ok(source)
  const checker = compilation.getTypeChecker()
  const modules = new Map()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    const name = statement.moduleSpecifier.text
    const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier)
    assert.ok(symbol, `Unresolved public leaf ${name}`)
    const imported = modules.get(name) ?? new Set()
    for (const element of statement.importClause?.namedBindings?.elements ?? [])
      imported.add(element.propertyName?.text ?? element.name.text)
    modules.set(name, imported)
    const leaf = name.slice('@roadmap/contracts/'.length)
    const actual = checker
      .getExportsOfModule(symbol)
      .map((symbol) => symbol.name)
      .sort()
    assert.deepEqual(
      actual,
      exportInventory[leaf].map(({ name }) => name).sort(),
      `Public export inventory drift for ${leaf}`,
    )
  }
  for (const [leaf, inventory] of Object.entries(exportInventory)) {
    assert.deepEqual(
      [...modules.get(`@roadmap/contracts/${leaf}`)].sort(),
      inventory.map(({ name }) => name).sort(),
      `Positive fixture omits a supported ${leaf} export`,
    )
  }
}

const contract = config('packages/contracts/tsconfig.json')
assert.deepEqual(contract.options.types, [], 'Contracts must have explicit no-ambient types')
assert.ok(
  contract.options.lib.every((lib) => !/dom|webworker|scripthost/i.test(lib)),
  'Contracts must compile against ES only',
)
if (!negativeOnly)
  requireClean(program(contract.fileNames, contract.options), 'Browser-safe contract graph')

for (const [consumer, tsconfig, owner] of [
  ['browser', 'apps/web/tsconfig.app.json', 'apps/web'],
  ['server', 'apps/server/tsconfig.json', 'apps/server'],
]) {
  const leaf = config(tsconfig)
  if (consumer === 'browser') {
    assert.ok(
      leaf.options.lib.some((lib) => /dom/i.test(lib)),
      'Web must use its ES/DOM graph',
    )
    assert.ok(!leaf.options.types?.includes('node'), 'Web must not select Node ambient types')
  } else assert.ok(leaf.options.types.includes('node'), 'Private server must select its Node graph')
  if (consumer === 'browser') {
    const clientFixture = await readFile(
      new URL('./fixtures/types/browser/client-owner.ts', import.meta.url),
      'utf8',
    )
    const clientDirectory = await mkdtemp(join(root, 'apps/web/.architecture-client-owner-'))
    try {
      const clientPath = join(clientDirectory, 'client-owner.ts')
      const marker = '// Invalid constructions.'
      assert.equal(clientFixture.split(marker).length, 2, 'Client proof needs one invalid boundary')
      if (!negativeOnly) {
        await writeFile(clientPath, clientFixture.split(marker)[0])
        requireClean(
          program([...leaf.fileNames, clientPath], leaf.options),
          'Browser client owner selected facade and lifecycle',
        )
      }
      await writeFile(clientPath, clientFixture)
      const clientProgram = program([...leaf.fileNames, clientPath], leaf.options)
      const source = clientProgram.getSourceFile(clientPath)
      assert.ok(source)
      const expected = [
        ['invalidMissingSelector', 2554, 'Expected 1 arguments'],
        ['invalidReadyLifecycle', 2322, 'mode'],
        ['invalidFailedLifecycle', 2322, 'cause'],
        ['invalidReadyCause', 2353, 'cause'],
        ['invalidNotReady', 2322, 'state'],
        ['invalidSynchronized', 2322, 'state'],
      ]
      const diagnostics = ts.getPreEmitDiagnostics(clientProgram)
      assert.equal(
        diagnostics.length,
        expected.length,
        `Browser client owner: expected exactly ${expected.length} diagnostics\n${format(diagnostics)}`,
      )
      for (const [name, code, detail] of expected) {
        const declaration = source.statements.find(
          (statement) =>
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(
              (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
            ),
        )
        assert.ok(declaration, `Missing client owner invalid construction ${name}`)
        const errors = diagnostics.filter(
          (diagnostic) =>
            diagnostic.file &&
            normalize(diagnostic.file.fileName) === normalize(clientPath) &&
            diagnostic.start >= declaration.getStart() &&
            diagnostic.start < declaration.getEnd(),
        )
        assert.equal(
          errors.length,
          1,
          `${name}: expected one intended diagnostic\n${format(errors)}`,
        )
        assert.equal(errors[0].code, code, `${name}: wrong diagnostic\n${format(errors)}`)
        assert.equal(errors[0].category, ts.DiagnosticCategory.Error)
        assert.ok(
          ts.flattenDiagnosticMessageText(errors[0].messageText, '\n').includes(detail),
          `${name}: diagnostic must name ${detail}\n${format(errors)}`,
        )
      }
      console.log(JSON.stringify({ proof: 'client-owner', consumer, cases: expected.length }))
    } finally {
      await rm(clientDirectory, { recursive: true, force: true })
    }
    const resourceFixture = await readFile(
      new URL('./fixtures/types/browser/resource-results.ts', import.meta.url),
      'utf8',
    )
    const resourceDirectory = await mkdtemp(join(root, 'apps/web/.architecture-resource-results-'))
    try {
      const resourcePath = join(resourceDirectory, 'resource-results.ts')
      const marker = '// Invalid constructions.'
      assert.equal(
        resourceFixture.split(marker).length,
        2,
        'Resource proof needs one invalid boundary',
      )
      if (!negativeOnly) {
        await writeFile(resourcePath, resourceFixture.split(marker)[0])
        requireClean(
          program([...leaf.fileNames, resourcePath], leaf.options),
          'Browser app-local resource result consumers',
        )
      }
      await writeFile(resourcePath, resourceFixture)
      const resourceProgram = program([...leaf.fileNames, resourcePath], leaf.options)
      const source = resourceProgram.getSourceFile(resourcePath)
      assert.ok(source)
      const expected = [
        ['invalidUnscopedSelection', 2322, 'mapId'],
        ['invalidMapKindSelection', 2739, 'mapId'],
        ['invalidTicketKindSelection', 2739, 'ticketId'],
        ['invalidKnownProjectPayload', 2322, 'missing'],
        ['invalidQueuedAdmission', 2322, 'admission'],
        ['invalidLinkDestination', 2322, 'href'],
        ['invalidFileDestination', 2322, 'path'],
      ]
      const diagnostics = ts.getPreEmitDiagnostics(resourceProgram)
      assert.equal(
        diagnostics.length,
        expected.length,
        `Browser resource results: expected exactly ${expected.length} diagnostics\n${format(diagnostics)}`,
      )
      for (const [name, code, detail] of expected) {
        const declaration = source.statements.find(
          (statement) =>
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(
              (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
            ),
        )
        assert.ok(declaration, `Missing resource result invalid construction ${name}`)
        const errors = diagnostics.filter(
          (diagnostic) =>
            diagnostic.file &&
            normalize(diagnostic.file.fileName) === normalize(resourcePath) &&
            diagnostic.start >= declaration.getStart() &&
            diagnostic.start < declaration.getEnd(),
        )
        assert.equal(
          errors.length,
          1,
          `${name}: expected one intended diagnostic\n${format(errors)}`,
        )
        assert.equal(errors[0].code, code, `${name}: wrong diagnostic\n${format(errors)}`)
        assert.equal(errors[0].category, ts.DiagnosticCategory.Error)
        assert.ok(
          ts.flattenDiagnosticMessageText(errors[0].messageText, '\n').includes(detail),
          `${name}: diagnostic must name ${detail}\n${format(errors)}`,
        )
      }
      console.log(JSON.stringify({ proof: 'resource-results', consumer, cases: expected.length }))
    } finally {
      await rm(resourceDirectory, { recursive: true, force: true })
    }
    const workflowFixture = await readFile(
      new URL('./fixtures/types/browser/workflows.ts', import.meta.url),
      'utf8',
    )
    const workflowDirectory = await mkdtemp(join(root, 'apps/web/.architecture-workflows-'))
    try {
      const workflowPath = join(workflowDirectory, 'workflows.ts')
      const marker = '// Invalid constructions.'
      assert.equal(
        workflowFixture.split(marker).length,
        2,
        'Workflow proof needs one invalid boundary',
      )
      const workflowOptions = { ...leaf.options, types: [] }
      const workflowFiles = [join(root, 'apps/web/src/vite-env.d.ts'), workflowPath]
      if (!negativeOnly) {
        await writeFile(workflowPath, workflowFixture.split(marker)[0])
        requireClean(
          program(workflowFiles, workflowOptions),
          'Browser named workflows and operation-specific settled results',
        )
      }
      await writeFile(workflowPath, workflowFixture)
      const workflowProgram = program(workflowFiles, workflowOptions)
      assert.ok(
        workflowProgram
          .getSourceFiles()
          .every((file) => !normalize(file.fileName).includes('/@types/node/')),
        'Workflow consumer proof must not load Node ambient declarations',
      )
      const source = workflowProgram.getSourceFile(workflowPath)
      assert.ok(source)
      const expected = [
        ['invalidRawProject', 2322, 'integration'],
        ['invalidProjectIdBrand', 2322, 'ProjectId'],
        ['invalidConnectionIdBrand', 2322, 'ConnectionId'],
        ['invalidAuthorizationIdBrand', 2322, 'AuthorizationOperationId'],
        ['invalidProjectAsConnection', 2322, 'ConnectionId'],
        ['invalidProjectScope', 2741, 'integration'],
        ['invalidOverrideScope', 2739, 'ticketId'],
        ['invalidMissingSelectorOwner', 2345, 'owner'],
        ['invalidSelectorOwnerKind', 2322, 'registration'],
        ['invalidRegistrationOwner', 2322, 'connectionId'],
        ['invalidProjectOwner', 2322, 'project'],
        ['invalidBeginVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidReauthorizeVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidRetryVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidCancelVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidRenameConnectionVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidRemoveConnectionVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidRegisterVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidRenameProjectVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidRepairVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidRemoveProjectVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidGlobalAutomationVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidProjectAutomationVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidOverrideVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidRefreshVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidLaunchVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidSelectorVersion', 2353, 'expectedConfigurationVersion'],
        ['invalidWrongResultFamily', 2739, 'configurationVersion'],
        ['invalidWrongOutcomeFamily', 2322, 'result'],
        ['invalidAcknowledgedRejectedOutcome', 2741, 'result'],
        ['invalidPendingResult', 2353, 'result'],
        ['invalidPendingError', 2353, 'error'],
        ['invalidPendingOutcome', 2353, 'outcome'],
        ['invalidPendingMissingVersion', 2322, 'configurationVersion'],
        ['invalidUnknownResult', 2353, 'result'],
        ['invalidUnknownOutcome', 2353, 'outcome'],
        ['invalidUnknownCanonicalSubject', 2353, 'canonicalSubject'],
        ['invalidAcknowledgedError', 2353, 'error'],
        ['invalidFolderPendingVersion', 2322, 'undefined'],
        ['invalidNotDispatchedVersion', 2322, 'undefined'],
        ['invalidFolderCommandResult', 2322, 'kind'],
        ['invalidFolderSelectedWithoutPath', 2322, 'path'],
        ['invalidFolderCancelledPath', 2353, 'path'],
        ['invalidRawAttemptId', 2322, 'WorkflowAttemptId'],
        ['invalidMutableAttempts', 4104, 'readonly'],
        ['invalidMutableAttempt', 2540, 'dismissed', 'body'],
        ['invalidExecuteFacade', 2339, 'execute'],
        ['invalidQueryFacade', 2339, 'query'],
        ['invalidAggregateFacade', 2339, 'command'],
        ['invalidWorkflowExecute', 2339, 'execute'],
        ['invalidWorkflowQuery', 2339, 'query'],
        ['invalidOperationSubject', 2739, 'integration, projectId'],
        ['invalidAuthorizationWaitingPayload', 2322, 'verificationUri'],
        ['invalidAuthorizationGrantedPayload', 2322, 'connection'],
        ['invalidAuthorizationCancelledError', 2353, 'error'],
        ['invalidAuthorizationFeedbackId', 2345, 'AuthorizationOperationId'],
      ]
      const diagnostics = ts.getPreEmitDiagnostics(workflowProgram)
      assert.equal(
        diagnostics.length,
        expected.length,
        `Browser workflows: expected exactly ${expected.length} diagnostics\n${format(diagnostics)}`,
      )
      for (const [name, code, detail, location] of expected) {
        const statement = source.statements.find(
          (statement) =>
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(
              (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
            ),
        )
        assert.ok(statement, `Missing workflow invalid construction ${name}`)
        const declaration = statement.declarationList.declarations.find(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
        )
        assert.ok(declaration, `Missing workflow invalid variable ${name}`)
        let diagnosticSpan = declaration
        if (location === 'body') {
          assert.ok(
            statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
            `${name}: mutation probe must be exported`,
          )
          assert.ok(
            declaration.initializer &&
              ts.isArrowFunction(declaration.initializer) &&
              ts.isBlock(declaration.initializer.body),
            `${name}: mutation probe must have an arrow function statement body`,
          )
          diagnosticSpan = declaration.initializer.body
        }
        const errors = diagnostics.filter(
          (diagnostic) =>
            diagnostic.file &&
            normalize(diagnostic.file.fileName) === normalize(workflowPath) &&
            diagnostic.start >= diagnosticSpan.getStart() &&
            diagnostic.start < diagnosticSpan.getEnd(),
        )
        assert.equal(
          errors.length,
          1,
          `${name}: expected one intended diagnostic\n${format(errors)}`,
        )
        assert.equal(errors[0].code, code, `${name}: wrong diagnostic\n${format(errors)}`)
        assert.equal(errors[0].category, ts.DiagnosticCategory.Error)
        assert.ok(
          ts.flattenDiagnosticMessageText(errors[0].messageText, '\n').includes(detail),
          `${name}: diagnostic must name ${detail}\n${format(errors)}`,
        )
      }
      console.log(JSON.stringify({ proof: 'workflows', consumer, cases: expected.length }))
    } finally {
      await rm(workflowDirectory, { recursive: true, force: true })
    }
  }
  const directory = await mkdtemp(join(root, '.architecture-fixtures-'))
  try {
    const workspace = join(directory, owner)
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(
      join(workspace, 'package.json'),
      await readFile(join(root, owner, 'package.json')),
    )
    await symlink(
      join(root, owner, 'node_modules'),
      join(workspace, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const positive = join(workspace, 'src/public.ts')
    await writeFile(
      positive,
      await readFile(new URL(`./fixtures/types/${consumer}/public.ts`, import.meta.url)),
    )
    const fixtureConfigPath = fileURLToPath(
      new URL(`./fixtures/types/${consumer}/tsconfig.json`, import.meta.url),
    )
    const fixtureConfig = JSON.parse(await readFile(fixtureConfigPath, 'utf8'))
    fixtureConfig.extends = resolve(dirname(fixtureConfigPath), fixtureConfig.extends)
    fixtureConfig.include = ['src/public.ts']
    const stagedConfig = join(workspace, 'tsconfig.json')
    await writeFile(stagedConfig, JSON.stringify(fixtureConfig))
    const fixtureProject = config(stagedConfig)
    if (!negativeOnly) {
      const positiveProgram = program(
        [...leaf.fileNames, ...fixtureProject.fileNames],
        fixtureProject.options,
      )
      requireClean(positiveProgram, `${consumer} public exports and decoders`)
      proveExports(positiveProgram, positive)
      const controls = await import(pathToFileURL(positive).href)
      for (const [name, result] of Object.entries(controls.decoderControls))
        assert.equal(result.ok, true, `${consumer} positive ${name} decoder`)
      console.log(
        JSON.stringify({
          proof: 'public-exports',
          consumer,
          exports: Object.values(exportInventory).reduce(
            (count, symbols) => count + symbols.length,
            0,
          ),
          decoders: Object.keys(controls.decoderControls).length,
        }),
      )
    }

    const negativeFiles = []
    await mkdir(join(workspace, 'src/negative'), { recursive: true })
    await writeFile(
      join(workspace, 'src/negative/inputs.ts'),
      await readFile(new URL('./fixtures/types/negative/inputs.ts', import.meta.url)),
    )
    for (const fixture of fixtures) {
      const path = join(workspace, `src/negative/${fixture.name}.ts`)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(
        path,
        await readFile(new URL(`./fixtures/types/negative/${fixture.name}.ts`, import.meta.url)),
      )
      negativeFiles.push(path)
    }
    const diagnostics = ts.getPreEmitDiagnostics(program(negativeFiles, fixtureProject.options))
    for (const diagnostic of diagnostics)
      assert.ok(
        diagnostic.file &&
          negativeFiles.some((path) => normalize(path) === normalize(diagnostic.file.fileName)),
        `Unrelated compiler failure\n${format([diagnostic])}`,
      )
    for (const [index, fixture] of fixtures.entries()) {
      const errors = diagnostics.filter(
        (diagnostic) =>
          diagnostic.file &&
          normalize(diagnostic.file.fileName) === normalize(negativeFiles[index]),
      )
      assert.equal(
        errors.length,
        1,
        `${consumer}/${fixture.name}: expected exactly one ${fixture.code} diagnostic\n${format(errors)}`,
      )
      assert.equal(
        errors[0].code,
        fixture.code,
        `${consumer}/${fixture.name}: wrong TypeScript diagnostic\n${format(errors)}`,
      )
      assert.equal(errors[0].category, ts.DiagnosticCategory.Error)
      assert.ok(
        ts.flattenDiagnosticMessageText(errors[0].messageText, '\n').includes(fixture.detail),
        `${consumer}/${fixture.name}: diagnostic must name ${fixture.detail}\n${format(errors)}`,
      )
      const declaration = errors[0].file.statements.find(
        (statement) =>
          ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(
            (declaration) =>
              ts.isIdentifier(declaration.name) && declaration.name.text === 'invalid',
          ),
      )
      assert.ok(
        declaration &&
          errors[0].start >= declaration.getStart() &&
          errors[0].start < declaration.getEnd(),
        `${consumer}/${fixture.name}: failure must occur at the intended invalid construction`,
      )
    }
    console.log(
      JSON.stringify({
        proof: 'invalid-constructions',
        consumer,
        cases: fixtures.length,
        codes: [...new Set(fixtures.map(({ code }) => code))],
      }),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
