import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProofOptions } from './proof-options.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const cases = JSON.parse(
  await readFile(new URL('./fixtures/architecture/cases.json', import.meta.url), 'utf8'),
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
    'Usage: node scripts/check-architecture-fixtures.mjs [--case NAME]\nChecks every architecture refusal by default.\n\nExamples:\n  node scripts/check-architecture-fixtures.mjs\n  node scripts/check-architecture-fixtures.mjs --case contracts-node-fs',
  )
  process.exit(0)
}
const requested = options.case
if (requested !== null && !cases.some((fixture) => fixture.name === requested)) {
  console.error(
    `Unknown architecture fixture ${requested}. Run node scripts/check-architecture-fixtures.mjs --help.`,
  )
  process.exit(2)
}

for (const fixture of cases.filter((fixture) => requested === null || fixture.name === requested)) {
  const directory = await mkdtemp(join(root, '.architecture-fixtures-'))
  try {
    const owner = fixture.file.split('/').slice(0, 2).join('/')
    await mkdir(join(directory, owner), { recursive: true })
    await writeFile(
      join(directory, owner, 'package.json'),
      await readFile(join(root, owner, 'package.json')),
    )
    await symlink(
      join(root, owner, 'node_modules'),
      join(directory, owner, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    for (const [path, source] of Object.entries({
      [fixture.file]: fixture.source,
      ...fixture.companions,
    })) {
      await mkdir(dirname(join(directory, path)), { recursive: true })
      await writeFile(join(directory, path), source)
    }
    const entry = relative(root, join(directory, fixture.file)).split('\\').join('/')
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'depcruise',
        '--config',
        `config/dependency-cruiser/${fixture.leaf}.mjs`,
        '--output-type',
        'json',
        entry,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    )
    assert.ifError(result.error)
    assert.ok(
      result.stdout.trim().startsWith('{'),
      `${fixture.name}: checker did not return JSON\n${result.stderr}\n${result.stdout}`,
    )
    const graph = JSON.parse(result.stdout)
    const violations = graph.summary.violations.filter((violation) =>
      fixture.rule === 'no-circular'
        ? violation.rule.name === 'no-circular' &&
          violation.cycle?.some(({ name }) => name === entry)
        : violation.from === entry,
    )
    assert.ok(
      violations.some((violation) => violation.rule.name === fixture.rule),
      `${fixture.name}: expected ${fixture.rule} for ${entry}, received ${JSON.stringify(violations)}; graph=${JSON.stringify({ modules: graph.modules, summary: graph.summary })}`,
    )
    if (fixture.rule === 'no-circular') {
      assert.ok(
        violations.some(
          (violation) =>
            violation.type === 'cycle' &&
            violation.cycle.length >= 2 &&
            violation.cycle.every(({ dependencyTypes }) => dependencyTypes.includes('type-only')),
        ),
        `${fixture.name}: the reported cycle containing the entry must preserve every erased type edge`,
      )
    }
    // The selected checker's JSON reporter intentionally exits zero. The
    // structured named Error diagnosis, not that reporter status, is refusal.
    assert.equal(
      result.status,
      0,
      `${fixture.name}: JSON reporter failed unexpectedly; entry=${entry}; graph=${JSON.stringify({ modules: graph.modules, summary: graph.summary })}`,
    )
    assert.ok(
      violations.some(
        (violation) => violation.rule.name === fixture.rule && violation.rule.severity === 'error',
      ) && graph.summary.error > 0,
      `${fixture.name}: expected named Error-category refusal; graph=${JSON.stringify(graph.summary)}`,
    )
    if (fixture.exportPath) {
      assert.deepEqual(
        violations.map((violation) => [violation.rule.name, violation.to]),
        [['not-to-unresolvable', fixture.exportPath]],
        `${fixture.name}: must be the export-map refusal, not a missing dependency`,
      )
    } else {
      assert.ok(
        !violations.some((violation) => violation.rule.name === 'not-to-unresolvable'),
        `${fixture.name}: fixture target must resolve before architecture refusal`,
      )
    }
    console.log(
      JSON.stringify({ proof: 'architecture-refusal', case: fixture.name, rule: fixture.rule }),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
