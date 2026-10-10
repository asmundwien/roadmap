import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectSource } from './source-boundaries.mjs'

test('refuses direct transport in views and browser helpers', () => {
  for (const source of [
    "fetch('/api/query')",
    "window.fetch('/api/query')",
    "new WebSocket('ws://localhost')",
    'new XMLHttpRequest()',
  ]) {
    assert.deepEqual(
      inspectSource('apps/web/src/views/map/page.tsx', source).map(({ rule }) => rule),
      ['web-views-through-store'],
    )
  }
  assert.deepEqual(
    inspectSource('apps/web/src/network.ts', "fetch('/api/query')").map(({ rule }) => rule),
    ['web-views-through-store'],
  )
})

test('permits transport in the store and intentional test fixtures', () => {
  assert.deepEqual(
    inspectSource(
      'apps/web/src/store/roadmap-store.ts',
      "new WebSocket('ws://localhost'); fetch('/api/query')",
    ),
    [],
  )
  assert.deepEqual(inspectSource('apps/web/src/views/map/page.test.ts', "fetch('/api/query')"), [])
})

test('refuses ambient transport aliases and member calls outside the store', () => {
  for (const source of [
    "const request = globalThis.fetch; request('/api/query')",
    "window.fetch.call(window, '/api/query')",
    "const Socket = window.WebSocket; new Socket('ws://localhost')",
    "const { fetch: request } = globalThis; request('/api/query')",
  ]) {
    assert.ok(
      inspectSource('apps/web/src/views/map/page.tsx', source).some(
        ({ rule }) => rule === 'web-views-through-store',
      ),
    )
  }
})

test('permits unrelated local functions and objects named fetch', () => {
  for (const source of [
    'function fetch() { return 1 }; fetch()',
    'const api = { fetch() { return 1 } }; api.fetch()',
    'function read(fetch) { return fetch() }',
    'const window = { fetch() { return 1 } }; window.fetch()',
  ]) {
    assert.deepEqual(inspectSource('apps/web/src/views/map/page.tsx', source), [])
  }
})

test('refuses storage namespace, dynamic and reexport factory access', () => {
  for (const source of [
    "import * as document from '../configuration/document.ts'; document.createConfigurationDocument('file')",
    "const document = await import('../configuration/document.ts'); document['createConfigurationDocument']('file')",
    "(await import('../configuration/document.ts')).createConfigurationDocument('file')",
    "export { createConfigurationDocument as create } from '../configuration/document.ts'",
    "export * as document from '../configuration/document.ts'",
    "export * from '../configuration/document.ts'",
    "import * as document from '../configuration/document.ts'; const { createConfigurationDocument: create } = document",
  ])
    assert.ok(
      inspectSource('apps/server/src/application/application.ts', source).some(
        ({ rule }) => rule === 'server-policy-not-to-adapters-or-composition',
      ),
    )
})

test('permits private storage interfaces and unrelated local factory names', () => {
  assert.deepEqual(
    inspectSource(
      'apps/server/src/application/application.ts',
      "import type * as document from '../configuration/document.ts'; type Document = document.ConfigurationDocument",
    ),
    [],
  )
  assert.deepEqual(
    inspectSource(
      'apps/server/src/application/application.ts',
      "import * as document from '../configuration/document.ts'; function read(document) { return document.createConfigurationDocument() }",
    ),
    [],
  )
})

test('refuses environment capability outside approved backend owners', () => {
  assert.deepEqual(
    inspectSource('apps/server/src/application/projection.ts', 'process.env.TOKEN').map(
      ({ rule }) => rule,
    ),
    ['host-capabilities-only-in-adapters'],
  )
  assert.deepEqual(
    inspectSource('packages/contracts/src/state.ts', "process['env'].TOKEN").map(
      ({ rule }) => rule,
    ),
    ['host-capabilities-only-in-adapters'],
  )
  assert.deepEqual(
    inspectSource('apps/server/src/application/projection.ts', 'globalThis.process.env.TOKEN').map(
      ({ rule }) => rule,
    ),
    ['host-capabilities-only-in-adapters'],
  )
  assert.deepEqual(inspectSource('apps/server/src/main.ts', 'process.env.PORT'), [])
  assert.deepEqual(inspectSource('apps/server/src/automation/launcher.ts', 'process.env.PATH'), [])
})

test('refuses static ambient environment aliases at the access boundary', async (context) => {
  const path = 'apps/server/src/application/projection.ts'
  for (const [name, source, line] of [
    ['process destructuring', 'const { env } = process', 1],
    ['renamed environment destructuring', 'const { env: settings } = process', 1],
    ['process alias', 'const runtime = process;\nruntime.env.TOKEN', 2],
    [
      'chained process aliases',
      'const runtime = process;\nconst host = runtime;\nhost.env.TOKEN',
      3,
    ],
    ['global alias', 'const root = globalThis;\nroot.process.env.TOKEN', 2],
    [
      'process alias through global alias',
      'const root = globalThis;\nconst runtime = root.process;\nruntime.env.TOKEN',
      3,
    ],
    [
      'process destructuring through global alias',
      'const root = globalThis;\nconst { process: runtime } = root;\nruntime.env.TOKEN',
      3,
    ],
    [
      'environment destructuring through process alias',
      'const runtime = process;\nconst { env: settings } = runtime',
      2,
    ],
    [
      'nested environment destructuring',
      'const root = globalThis;\nconst { process: { env: settings } } = root',
      2,
    ],
    ['literal environment key', "const runtime = process;\nconst { 'env': settings } = runtime", 2],
    ['wrapped process alias', 'const runtime = (process as typeof process);\nruntime.env.TOKEN', 2],
  ]) {
    await context.test(name, () => {
      assert.deepEqual(inspectSource(path, source), [
        { rule: 'host-capabilities-only-in-adapters', path, line },
      ])
      for (const owner of ['apps/server/src/main.ts', 'apps/server/src/automation/launcher.ts'])
        assert.deepEqual(inspectSource(owner, source), [])
    })
  }
})

test('refuses static ambient transport aliases at the access boundary', async (context) => {
  const path = 'apps/web/src/views/map/page.tsx'
  for (const [name, source, line] of [
    ['window alias', "const browser = window;\nbrowser.fetch('/api')", 2],
    ['globalThis alias', "const root = globalThis;\nroot.fetch('/api')", 2],
    ['self alias', "const worker = self;\nworker.fetch('/api')", 2],
    [
      'chained global aliases',
      "const root = globalThis;\nconst browser = root;\nbrowser.fetch('/api')",
      3,
    ],
    [
      'transport extraction through alias',
      "const browser = window;\nconst request = browser.fetch;\nrequest('/api')",
      2,
    ],
    [
      'transport destructuring through alias',
      "const browser = window;\nconst { fetch: request } = browser;\nrequest('/api')",
      2,
    ],
    [
      'shorthand transport destructuring',
      "const root = globalThis;\nconst { fetch } = root;\nfetch('/api')",
      2,
    ],
    ['literal transport key', "const worker = self;\nconst { 'fetch': request } = worker", 2],
    [
      'global member alias',
      "const root = globalThis;\nconst browser = root.window;\nbrowser.fetch('/api')",
      3,
    ],
    [
      'global destructuring alias',
      "const root = globalThis;\nconst { self: worker } = root;\nworker.fetch('/api')",
      3,
    ],
    [
      'nested transport destructuring',
      'const root = globalThis;\nconst { window: { fetch: request } } = root',
      2,
    ],
    [
      'WebSocket constructor alias',
      "const browser = window;\nnew browser.WebSocket('ws://localhost')",
      2,
    ],
    [
      'XMLHttpRequest destructuring',
      'const browser = window;\nconst { XMLHttpRequest: Request } = browser',
      2,
    ],
    [
      'EventSource constructor alias',
      "const worker = self;\nnew worker.EventSource('/api/events')",
      2,
    ],
    [
      'wrapped global alias',
      "const browser = (window as typeof window);\nbrowser.fetch('/api')",
      2,
    ],
  ]) {
    await context.test(name, () => {
      assert.deepEqual(inspectSource(path, source), [
        { rule: 'web-views-through-store', path, line },
      ])
      assert.deepEqual(inspectSource('apps/web/src/store/roadmap-store.ts', source), [])
    })
  }
})

test('permits lexical ambient names and type-only references through static aliases', () => {
  for (const source of [
    'const process = { env: {} }; const runtime = process; runtime.env.TOKEN',
    'const process = { env: {} }; const { env } = process',
    'function read(process) { const runtime = process; return runtime.env.TOKEN }',
    'function process() { return {} }; const runtime = process; runtime.env',
    'const globalThis = { process: { env: {} } }; const root = globalThis; root.process.env',
    'function read(globalThis) { const { process: { env } } = globalThis; return env }',
    'const runtime = process; function read(runtime) { return runtime.env }',
    'const window = { fetch() { return 1 } }; const browser = window; browser.fetch()',
    'const self = { fetch() { return 1 } }; const worker = self; const { fetch } = worker; fetch()',
    'function read(window) { const browser = window; return browser.fetch() }',
    'function window() { return {} }; const browser = window; browser.fetch()',
    'const globalThis = { window: { fetch() { return 1 } } }; const { window: { fetch } } = globalThis; fetch()',
    'const browser = window; function read(browser) { return browser.fetch() }',
    'function fetch() { return 1 }; const request = fetch; request()',
    'type Environment = typeof process.env; type Transport = typeof globalThis.fetch',
    'const runtime = process; type Environment = typeof runtime.env',
    'const root = globalThis; type Environment = typeof root.process.env',
    'const browser = window; type Transport = typeof browser.fetch',
    'type process = { env: string }; type window = { fetch: string }',
  ]) {
    assert.deepEqual(inspectSource('apps/server/src/application/projection.ts', source), [], source)
    assert.deepEqual(inspectSource('apps/web/src/views/map/page.tsx', source), [], source)
  }
})

test('refuses storage factories outside composition even through an imported alias', () => {
  assert.deepEqual(
    inspectSource(
      'apps/server/src/application/application.ts',
      "import { createConfigurationDocument as makeDocument } from '../configuration/document.ts'",
    ).map(({ rule }) => rule),
    ['server-policy-not-to-adapters-or-composition'],
  )
  assert.deepEqual(
    inspectSource(
      'apps/server/src/main.ts',
      "import { createConfigurationDocument } from './configuration/document.ts'",
    ),
    [],
  )
})

test('refuses raw facade execution and query access in views', async (context) => {
  const path = 'apps/web/src/views/settings/projects/details-section.tsx'
  for (const [name, source, line] of [
    [
      'selected execute function',
      "import { useRoadmap } from '@/store/roadmap-provider'\nconst execute = useRoadmap(read => read.execute)\nexecute(command)",
      2,
    ],
    [
      'selected query function',
      "import { useRoadmap } from '@/store/roadmap-provider'\nconst query = useRoadmap(read => read.query)\nquery({ type: 'select-workspace' })",
      2,
    ],
    [
      'facade import alias and selected object',
      "import { useRoadmap as select } from '@/store/roadmap-provider'\nconst actions = select(read => ({ run: read.execute }))\nactions.run(command)",
      2,
    ],
    [
      'literal property',
      "import { useRoadmap } from '@/store/roadmap-provider'\nconst execute = useRoadmap(read => read['execute'])",
      2,
    ],
    [
      'selector destructuring',
      "import { useRoadmap } from '@/store/roadmap-provider'\nconst execute = useRoadmap(({ execute: run }) => run)",
      2,
    ],
    [
      'selected root alias',
      "import { useRoadmap } from '@/store/roadmap-provider'\nconst read = useRoadmap(read => read)\nconst actions = read\nactions.execute(command)",
      4,
    ],
    [
      'selected root query destructuring',
      "import { useRoadmap } from '@/store/roadmap-provider'\nconst read = useRoadmap(read => read)\nconst { query: choose } = read\nchoose({ type: 'select-workspace' })",
      3,
    ],
    [
      'namespace facade import',
      "import * as facade from '@/store/roadmap-provider'\nconst execute = facade.useRoadmap(read => read.execute)",
      2,
    ],
    [
      'relative facade import',
      "import { useRoadmap } from '../../../store/roadmap-provider'\nconst query = useRoadmap(read => read.query)",
      2,
    ],
    [
      'typed facade callback',
      "import type { RoadmapViewState } from '@/store/roadmap-provider'\nfunction select(read: RoadmapViewState) { return read.execute }",
      2,
    ],
  ]) {
    await context.test(name, () => {
      assert.deepEqual(inspectSource(path, source), [
        { rule: 'web-views-through-workflows', path, line },
      ])
    })
  }
})

test('refuses view-owned versioned Command construction', async (context) => {
  const path = 'apps/web/src/views/settings/projects/details-section.tsx'
  for (const [name, source] of [
    [
      'Command annotation',
      "import type { Command } from '@roadmap/contracts/operations'\nconst command: Command = { type: 'rename-project', expectedConfigurationVersion: version, project, name }",
    ],
    [
      'renamed Command annotation',
      "import type { Command as Request } from '@roadmap/contracts/operations'\nconst command: Request = { type: 'rename-project', expectedConfigurationVersion: version, project, name }",
    ],
    [
      'Command variant satisfies',
      "import type { Command } from '@roadmap/contracts/operations'\nconst command = { type: 'rename-project', expectedConfigurationVersion: version, project, name } satisfies Extract<Command, { type: 'rename-project' }>",
    ],
    [
      'namespace Command annotation',
      "import type * as operations from '@roadmap/contracts/operations'\nconst command: operations.Command = { type: 'rename-project', expectedConfigurationVersion: version, project, name }",
    ],
    [
      'Command schema parsing',
      "import { commandSchema as request } from '@roadmap/contracts/operations'\nconst command = request.parse({ type: 'rename-project', expectedConfigurationVersion: version, project, name })",
    ],
    [
      'relative public Command import',
      "import type { Command } from '../../../../../../packages/contracts/src/operations.ts'\nconst command: Command = { type: 'rename-project', expectedConfigurationVersion: version, project, name }",
    ],
  ]) {
    await context.test(name, () => {
      assert.deepEqual(inspectSource(path, source), [
        { rule: 'web-views-through-workflows', path, line: 2 },
      ])
    })
  }
})

test('refuses view-owned ConfigurationVersion construction but permits reading accepted versions', () => {
  const path = 'apps/web/src/views/settings/projects/details-section.tsx'
  for (const source of [
    "import { configurationVersionSchema } from '@roadmap/contracts/identity'\nconst version = configurationVersionSchema.parse(1)",
    "import { configurationVersionSchema as revision } from '@roadmap/contracts/identity'\nconst version = revision.safeParse(input)",
    "import * as identity from '@roadmap/contracts/identity'\nconst version = identity.configurationVersionSchema.parse(input)",
  ]) {
    assert.deepEqual(inspectSource(path, source), [
      { rule: 'web-views-through-workflows', path, line: 2 },
    ])
  }
  for (const source of [
    "import { useRoadmap } from '@/store/roadmap-provider'; const version = useRoadmap(read => read.configurationVersion)",
    "import type { ConfigurationVersion } from '@roadmap/contracts/identity'; declare const acceptedVersion: ConfigurationVersion; export const revision = acceptedVersion",
    "import { configurationVersionSchema } from '@roadmap/contracts/identity'; function read(configurationVersionSchema) { return configurationVersionSchema.parse(1) }",
    'const configurationVersionSchema = { parse(value) { return value } }; configurationVersionSchema.parse(1)',
  ]) {
    assert.deepEqual(inspectSource(path, source), [], source)
  }
})

test('permits lexical workflow names and public operation-derived drafts', () => {
  const path = 'apps/web/src/views/shared/fixture.tsx'
  for (const source of [
    'const api = { execute() { return 1 }, query() { return 2 } }; api.execute(); api.query()',
    'function run(execute, query) { execute(); query() }',
    'function useRoadmap(selector) { return selector({ execute() { return 1 } }) }; useRoadmap(read => read.execute)()',
    "import { useRoadmap } from '@/store/roadmap-provider'; function run(useRoadmap) { return useRoadmap(read => read.execute) }",
    "import { useRoadmap } from '@/store/roadmap-provider'; useRoadmap(read => { const local = { execute() { return 1 } }; return local.execute() })",
    "import { useRoadmap } from '@/store/roadmap-provider'; useRoadmap(read => { function run(read) { return read.execute() }; return run(local) })",
    "import type { Command } from '@roadmap/contracts/operations'; function run() { type Command = { expectedConfigurationVersion: number }; const record: Command = { expectedConfigurationVersion: 1 }; return record }",
    "import { commandSchema } from '@roadmap/contracts/operations'; function run(commandSchema) { return commandSchema.parse({ expectedConfigurationVersion: 1 }) }",
    'type Command = { type: string; expectedConfigurationVersion: number }; const record: Command = { type: "note", expectedConfigurationVersion: 1 }',
    'const metadata = { expectedConfigurationVersion: 1 }; type execute = () => void; type query = () => void',
    "import type { Command, CommandResultFor } from '@roadmap/contracts/operations'; type Candidate = Extract<Command, { type: 'register-project' }>['candidate']; type Result = CommandResultFor<Extract<Command, { type: 'register-project' }>>; declare const candidate: Candidate; export const draft = { candidate }",
    "import type { RoadmapViewState } from '@/store/roadmap-provider'; type Execute = RoadmapViewState['execute']; type Query = RoadmapViewState['query']",
  ]) {
    assert.deepEqual(inspectSource(path, source), [], source)
  }
})

test('permits named workflow consumers and the store transport seam', () => {
  assert.deepEqual(
    inspectSource(
      'apps/web/src/views/shared/workflow-feedback.tsx',
      "import { useRoadmap } from '@/store/roadmap-provider'; import { workflowFeedback } from '@/workflows/workflows'; import { Alert } from '@roadmap/ui/alert'; import { createElement } from 'react'; const selected = useRoadmap(read => ({ workflows: read.workflows, feedback: workflowFeedback(read.workflowState, 'rename-project', { kind: 'project', project }) })); selected.workflows.renameProject({ project, name }); createElement(Alert, null, selected.feedback.message)",
    ),
    [],
  )
  const transport = 'transport.execute(command); transport.query({ type: "select-workspace" })'
  assert.deepEqual(inspectSource('apps/web/src/workflows/workflows.ts', transport), [])
  assert.deepEqual(inspectSource('apps/web/src/store/roadmap-store.ts', transport), [])
  assert.deepEqual(
    inspectSource(
      'apps/web/src/views/fixture.test.tsx',
      "import { useRoadmap } from '@/store/roadmap-provider'; const execute = useRoadmap(read => read.execute); execute(command)",
    ),
    [],
  )
})

test('refuses source transport in the workflow owner without banning its narrow seam', () => {
  const path = 'apps/web/src/workflows/workflows.ts'
  for (const source of [
    "fetch('/api/execute')",
    "const root = globalThis; root.fetch('/api/execute')",
    "new WebSocket('ws://localhost')",
  ]) {
    assert.ok(
      inspectSource(path, source).some(({ rule }) => rule === 'web-views-through-store'),
      source,
    )
  }
  assert.deepEqual(inspectSource(path, 'transport.execute(command); transport.query(query)'), [])
})
