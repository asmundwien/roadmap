import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAvailableTranspilers } from 'dependency-cruiser'
import { inspectSource } from './source-boundaries.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const roots = [
  ['contracts', 'packages/contracts/src'],
  ['server', 'apps/server/src'],
  ['web', 'apps/web/src'],
  ['ui', 'packages/ui/src'],
  ['docs', 'apps/docs/src'],
]
const compiler = getAvailableTranspilers().find(({ name }) => name === 'typescript')
assert.ok(
  compiler?.available && /^typescript@6[.]/.test(compiler.currentVersion),
  'Architecture requires the installed TypeScript 6 tsc parser',
)
function cruise(leaf, entries, positive = false) {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'depcruise',
      '--config',
      `config/dependency-cruiser/${leaf}.mjs`,
      '--output-type',
      'json',
      ...entries,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  assert.ifError(result.error)
  assert.ok(
    result.stdout.trim().startsWith('{'),
    `${leaf}: checker did not return JSON\n${result.stderr}\n${result.stdout}`,
  )
  const graph = JSON.parse(result.stdout)
  assert.equal(
    result.status,
    0,
    `${leaf} architecture violations\n${JSON.stringify(graph.summary.violations, null, 2)}\n${result.stderr}`,
  )
  assert.deepEqual(graph.summary.violations, [], `${leaf}: unexpected architecture warning`)
  if (positive) {
    for (const module of graph.modules) {
      if (!entries.includes(module.source)) continue
      const leaves = new Set(
        module.dependencies
          .map((dependency) => dependency.resolved)
          .filter((resolved) =>
            /packages\/contracts\/src\/(?:identity|state|operations|wire)[.]ts$/.test(resolved),
          ),
      )
      assert.equal(leaves.size, 4, `${leaf}: pnpm resolver must resolve all four public leaves`)
    }
  }
  console.log(`Architecture ${leaf}: ${graph.modules.length} fully resolved modules`)
}
async function sources(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sources(path)))
    else if (/\.(?:[cm]?[jt]sx?|astro)$/.test(entry.name)) files.push(path)
  }
  return files
}
function astroCode(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const scripts = [...text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1],
  )
  return [frontmatter, ...scripts].join('\n')
}
const directory = await mkdtemp(join(root, '.architecture-fixtures-'))
try {
  for (const [leaf, sourceRoot] of roots) {
    const files = await sources(join(root, sourceRoot))
    assert.ok(files.length, `${leaf}: source root cannot be silently omitted`)
    for (const path of files) {
      const ownerPath = relative(root, path).split('\\').join('/')
      const text = await readFile(path, 'utf8')
      const violations = inspectSource(ownerPath, path.endsWith('.astro') ? astroCode(text) : text)
      assert.deepEqual(
        violations,
        [],
        `${ownerPath}: architecture capabilities\n${JSON.stringify(violations)}`,
      )
    }
    const entries = [sourceRoot]
    if (leaf === 'docs') {
      // dependency-cruiser does not parse Astro templates. The owning project's
      // real resolver checks extracted frontmatter/script edges in a mirrored
      // source tree; imports keep their original relative and alias meanings.
      const owner = 'apps/docs'
      await cp(join(root, sourceRoot), join(directory, sourceRoot), { recursive: true })
      await writeFile(
        join(directory, owner, 'package.json'),
        await readFile(join(root, owner, 'package.json')),
      )
      await symlink(
        join(root, owner, 'node_modules'),
        join(directory, owner, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      for (const path of files.filter((path) => path.endsWith('.astro'))) {
        const copy = join(directory, relative(root, path)) + '.ts'
        await writeFile(copy, astroCode(await readFile(path, 'utf8')))
        entries.push(relative(root, copy).split('\\').join('/'))
      }
    }
    cruise(leaf, entries)
  }
  for (const [consumer, leaf, owner] of [
    ['browser', 'web', 'apps/web'],
    ['server', 'server', 'apps/server'],
  ]) {
    const workspace = join(directory, owner)
    const positive = join(workspace, 'src/public.test.ts')
    await mkdir(dirname(positive), { recursive: true })
    await writeFile(
      join(workspace, 'package.json'),
      await readFile(join(root, owner, 'package.json')),
    )
    await symlink(
      join(root, owner, 'node_modules'),
      join(workspace, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await writeFile(
      positive,
      await readFile(new URL(`./fixtures/types/${consumer}/public.ts`, import.meta.url)),
    )
    cruise(leaf, [relative(root, positive).split('\\').join('/')], true)
    if (consumer === 'browser') {
      const resources = join(workspace, 'src/resource-results.test.ts')
      await writeFile(
        resources,
        await readFile(new URL('./fixtures/architecture/resource-results.ts', import.meta.url)),
      )
      cruise(leaf, [relative(root, resources).split('\\').join('/')])
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
const fixtures = spawnSync(process.execPath, ['scripts/check-architecture-fixtures.mjs'], {
  cwd: root,
  stdio: 'inherit',
})
assert.ifError(fixtures.error)
assert.equal(fixtures.status, 0, 'Architecture negative fixtures must prove every intended refusal')
