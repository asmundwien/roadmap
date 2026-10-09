import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProofOptions } from './proof-options.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/build/cases.json', import.meta.url), 'utf8'),
)
let options
try {
  options = parseProofOptions(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exit(2)
}
if (options.help) {
  console.log(
    'Usage: node scripts/check-browser-build-fixtures.mjs [--case NAME]\nBuilds every fixture through the actual web Vite configuration and production resolver.\n\nExamples:\n  node scripts/check-browser-build-fixtures.mjs\n  node scripts/check-browser-build-fixtures.mjs --case unused-private-host',
  )
  process.exit(0)
}
if (options.case !== null && !fixtures.some(({ name }) => name === options.case)) {
  console.error(
    `Unknown browser build fixture ${options.case}. Run node scripts/check-browser-build-fixtures.mjs --help.`,
  )
  process.exit(2)
}
for (const fixture of fixtures.filter(
  ({ name }) => options.case === null || name === options.case,
)) {
  const directory = await mkdtemp(join(root, '.architecture-fixtures-'))
  try {
    const workspace = join(directory, 'apps/web')
    // JavaScript keeps unused value imports as runtime edges. A synthetic
    // TypeScript entry could elide them before Rolldown parses the graph.
    const entry = join(workspace, 'src/entry.js')
    await mkdir(dirname(entry), { recursive: true })
    await writeFile(
      join(workspace, 'package.json'),
      await readFile(join(root, 'apps/web/package.json')),
    )
    await symlink(
      join(root, 'apps/web/node_modules'),
      join(workspace, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    let source = fixture.source
    if (fixture.target) {
      const target = resolve(root, fixture.target)
      await access(target)
      source = source.replace('TARGET', JSON.stringify(target.replaceAll('\\', '/')))
    }
    await writeFile(entry, source)
    // Do not load production .env files or inherit credentials. The actual
    // Vite configuration and plugins still supply the production resolver.
    const environment = {
      PATH: process.env.PATH,
      HOME: directory,
      TMPDIR: directory,
      TEMP: directory,
      TMP: directory,
      NODE_ENV: 'production',
    }
    if (process.env.SystemRoot) environment.SystemRoot = process.env.SystemRoot
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts/run-browser-build-fixture.mjs'), entry, directory],
      {
        cwd: directory,
        env: environment,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    assert.ifError(result.error)
    const marker = 'ROADMAP_BUILD_FIXTURE_RESULT '
    const records = result.stdout.split('\n').filter((line) => line.startsWith(marker))
    assert.equal(
      records.length,
      1,
      `${fixture.name}: actual Vite build must report one framed result\n${result.stdout}\n${result.stderr}`,
    )
    const proof = JSON.parse(records[0].slice(marker.length))
    assert.equal(proof.config, 'apps/web/vite.config.ts')
    if (fixture.accepted) {
      assert.equal(
        result.status,
        0,
        `${fixture.name}: public production graph must build\n${JSON.stringify(proof)}\n${result.stderr}`,
      )
      assert.equal(proof.status, 'accepted')
      assert.ok(
        proof.messages.some((message) =>
          /ROADMAP_ARCHITECTURE_GRAPH: inspected [1-9]\d* resolved modules/.test(message),
        ),
        'Actual Vite graph plugin must run, not merely an unrelated successful build',
      )
    } else {
      assert.notEqual(
        result.status,
        0,
        `${fixture.name}: an unused forbidden import must fail before tree shaking`,
      )
      assert.equal(proof.status, 'rejected')
      assert.ok(
        proof.message.includes('ROADMAP_ARCHITECTURE_GRAPH'),
        `${fixture.name}: require the graph diagnosis, not an incidental build failure\n${JSON.stringify(proof)}\n${result.stderr}`,
      )
      assert.ok(
        !/Could not resolve|does not provide an export|is not exported by|Cannot find (?:package|module)/i.test(
          proof.message,
        ),
        `${fixture.name}: missing dependency/export is not architecture proof`,
      )
      if (fixture.target) {
        const target = resolve(root, fixture.target).replaceAll('\\', '/')
        assert.ok(
          proof.message
            .split('\n')
            .some((line) => line.trim() === target || line.trim().endsWith(': ' + target)),
          `${fixture.name}: forbidden target must be a parsed module, not only source text or an import edge`,
        )
      }
    }
    console.log(
      JSON.stringify({
        proof: 'actual-browser-build',
        case: fixture.name,
        accepted: fixture.accepted,
        config: proof.config,
      }),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
