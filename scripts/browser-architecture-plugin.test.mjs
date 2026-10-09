import assert from 'node:assert/strict'
import { test } from 'node:test'
import { roadmapArchitectureGraph } from './browser-architecture-plugin.mjs'

function inspect(modules, buildError) {
  const plugin = roadmapArchitectureGraph('/repository')
  plugin.buildStart.call({})
  for (const module of modules)
    plugin.moduleParsed.call({}, { importedIds: [], dynamicallyImportedIds: [], ...module })
  plugin.buildEnd.call(
    {
      error(message) {
        throw new Error(message)
      },
      info() {},
    },
    buildError,
  )
}

test('rejects a tree-shaken static private module before output emission', () => {
  assert.throws(
    () =>
      inspect([
        {
          id: '/repository/apps/web/src/main.tsx',
          importedIds: ['/repository/apps/server/src/application/credential-vault.ts'],
        },
      ]),
    /ROADMAP_ARCHITECTURE_GRAPH.*credential-vault/,
  )
})

test('rejects dynamic Node modules and browser external shims', () => {
  for (const id of [
    'node:fs',
    'node:child_process',
    '__vite-browser-external:node:fs',
    '\0__vite-browser-external',
  ]) {
    assert.throws(
      () => inspect([{ id: '/repository/apps/web/src/main.tsx', dynamicallyImportedIds: [id] }]),
      /ROADMAP_ARCHITECTURE_GRAPH/,
    )
  }
})

test('rejects forbidden modules even without a recorded importer', () => {
  assert.throws(
    () => inspect([{ id: '/repository/apps/server/src/host/darwin.ts' }]),
    /ROADMAP_ARCHITECTURE_GRAPH/,
  )
})

test('diagnoses a forbidden parsed graph even if linking also fails', () => {
  assert.throws(
    () =>
      inspect(
        [
          {
            id: '/repository/apps/web/src/main.tsx',
            importedIds: ['/repository/apps/server/src/host/darwin.ts'],
          },
        ],
        new Error('A browser external shim has no named Node export.'),
      ),
    /ROADMAP_ARCHITECTURE_GRAPH/,
  )
})

test('does not replace an unrelated upstream build error', () => {
  assert.doesNotThrow(() =>
    inspect([{ id: '/repository/apps/web/src/main.tsx' }], new Error('An unrelated syntax error.')),
  )
})

test('accepts real browser contract and UI dependencies', () => {
  inspect([
    {
      id: '/repository/apps/web/src/main.tsx',
      importedIds: [
        '/repository/packages/contracts/src/wire.ts',
        '/repository/packages/ui/src/components/button/button.tsx',
      ],
    },
    {
      id: '/repository/packages/contracts/src/wire.ts',
      importedIds: ['/repository/node_modules/.pnpm/zod@4/node_modules/zod/index.js'],
    },
  ])
})

test('normalizes Windows paths, query strings and virtual prefixes', () => {
  assert.throws(
    () => inspect([{ id: '\0/repository/apps/server/src/host/darwin.ts?raw' }]),
    /ROADMAP_ARCHITECTURE_GRAPH/,
  )
  assert.throws(
    () => inspect([{ id: '\\repository\\apps\\server\\src\\host\\darwin.ts?raw' }]),
    /ROADMAP_ARCHITECTURE_GRAPH/,
  )
})
