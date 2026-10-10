import { fileURLToPath } from 'node:url'

// Fixture consumers retain the same physical owner path inside an isolated tree.
const prefix = '^(?:[.]architecture-fixtures-[A-Za-z0-9]{6}/|)'
const server = `${prefix}apps/server/src/`
const contracts = `${prefix}packages/contracts/src/`
const web = `${prefix}apps/web/src/`
const ui = `${prefix}packages/ui/src/`
const docs = `${prefix}apps/docs/src/`
const tests =
  '(?:[.]test[.][cm]?[jt]sx?$|(?:^|/)(?:source-test-fixtures|public-test-fixtures|test-fixtures)[.]ts$)'
const translators = `${server}(?:application/(?:application|projection|operations)[.]ts|transport[.]ts)$`
const policy = `${server}(?:projects/|observation/|resources/|authorization/|automation/(?:engine|model)[.]ts$|change-feed[.]ts$|application/(?:application|projection|operations)[.]ts$)`

// These are cohesive concrete adapters, not every file in a directory.
// Parser and provider helpers are part of their respective source adapter.
const adapterGroups = [
  `${server}(?:github/(?:admission|client|connections|map-query|observer|repository)[.]ts|wayfinder/from-github[.]ts)$`,
  `${server}(?:local/(?:admission|observer|workspace)[.]ts|wayfinder/from-local[.]ts)$`,
  `${server}application/credential-vault[.]ts$`,
  `${server}host/darwin[.]ts$`,
  `${server}automation/launcher[.]ts$`,
  `${server}notify[.]ts$`,
  `${server}(?:configuration/migration[.]ts|local-projects[.]ts)$`,
]
const concreteAdapters = adapterGroups.join('|')
// Persisted schema/replay owners also perform storage. Their narrow private
// contracts and refinements are consumed by policy; factories stay in main.
const hostOwners = `${server}(?:main[.]ts|transport[.]ts|configuration/(?:document|migration)[.]ts|automation/(?:database|launcher)[.]ts|application/credential-vault[.]ts|host/darwin[.]ts|local/(?:observer|workspace)[.]ts|github/admission[.]ts|wayfinder/from-local[.]ts|notify[.]ts|local-projects[.]ts)$`
const purePathOwners = `${server}(?:projects/registry|observation/coordinator)[.]ts$`
const zod = ['(?:^|/)node_modules/zod/', '(?:^|/)node_modules/[.]pnpm/zod@[^/]+/node_modules/zod/']
const hostLibraries = [
  '(?:^|/)node_modules/(?:keytar|keychain|dotenv|execa|open)(?:/|$)',
  '(?:^|/)node_modules/[.]pnpm/[^/]+/node_modules/(?:keytar|keychain|dotenv|execa|open)(?:/|$)',
]

function refuse(name, from, to, comment) {
  return { name, severity: 'error', comment, from, to }
}

export const forbidden = [
  refuse(
    'not-to-unresolvable',
    {},
    { couldNotResolve: true },
    'Every import must resolve, including blocked package exports.',
  ),
  refuse('no-circular', {}, { circular: true }, 'Type-only cycles are cycles too.'),
  refuse(
    'contracts-browser-only',
    { path: contracts },
    { pathNot: [contracts, ...zod] },
    'Public definitions depend only on their own browser-safe schemas and Zod.',
  ),
  refuse(
    'contracts-leaf-direction',
    { path: `${contracts}identity[.]ts$` },
    { path: `${contracts}(?:state|resources|blocker|operations|wire|internal/actions)[.]ts$` },
    'Neutral identity cannot acquire public read or operation meaning.',
  ),
  refuse(
    'contracts-leaf-direction',
    { path: `${contracts}(?:state|resources|blocker|internal/actions)[.]ts$` },
    { path: `${contracts}(?:operations|wire)[.]ts$` },
    'Read schemas do not import operation or transport envelopes.',
  ),
  refuse(
    'contracts-leaf-direction',
    { path: `${contracts}operations[.]ts$` },
    { path: `${contracts}wire[.]ts$` },
    'Staged state-bearing outcomes require state, but never wire.',
  ),
  refuse(
    'server-private-not-to-public-dto',
    { path: server, pathNot: [tests, translators] },
    { path: contracts, pathNot: `${contracts}identity[.]ts$` },
    'Private owners may reuse neutral identities, never public DTOs as domain authority.',
  ),
  refuse(
    'projection-only-to-public-state',
    { path: `${server}application/projection[.]ts$` },
    { path: `${contracts}(?:operations|wire)[.]ts$` },
    'Pure projection translates private facts to public state.',
  ),
  refuse(
    'operations-only-to-public-operations',
    { path: `${server}application/operations[.]ts$` },
    { path: `${contracts}(?:state|wire)[.]ts$` },
    'Operation translation consumes its staged operation contract.',
  ),
  refuse(
    'application-not-to-wire',
    { path: `${server}application/application[.]ts$` },
    { path: `${contracts}wire[.]ts$` },
    'The application facade is transport independent.',
  ),
  refuse(
    'transport-only-to-public-wire',
    { path: `${server}transport[.]ts$` },
    { path: contracts, pathNot: `${contracts}wire[.]ts$` },
    'Transport consumes wire and infers facade types from RoadmapApplication.',
  ),
  refuse(
    'transport-through-application',
    { path: `${server}transport[.]ts$` },
    { path: server, pathNot: `${server}application/application[.]ts$` },
    'Transport executes only through the RoadmapApplication facade, not private owners.',
  ),
  refuse(
    'server-policy-not-to-adapters-or-composition',
    { path: policy, pathNot: tests },
    { path: [`${server}main[.]ts$`, concreteAdapters] },
    'Policy depends on private contracts; main wires concrete adapters.',
  ),
  refuse(
    'server-policy-not-to-adapters-or-composition',
    { path: policy, pathNot: [tests, translators] },
    { path: translators },
    'Private policy does not depend on application orchestration or public translation.',
  ),
  refuse(
    'production-not-to-test-fixtures',
    {
      path: [`${prefix}apps/(?:server|web|docs)/src/`, `${prefix}packages/(?:contracts|ui)/src/`],
      pathNot: tests,
    },
    { path: tests },
    'Test inputs cannot forward public DTOs or host capabilities into production owners.',
  ),
  ...adapterGroups.map((group) =>
    refuse(
      'adapters-not-to-adapters',
      { path: group },
      { path: concreteAdapters, pathNot: group },
      'Each adapter consumes its owner contract, not another adapter.',
    ),
  ),
  refuse(
    'host-capabilities-only-in-adapters',
    { pathNot: [tests, hostOwners, purePathOwners] },
    { dependencyTypes: ['core'] },
    'Node capabilities belong to approved server adapters and composition.',
  ),
  refuse(
    'host-capabilities-only-in-adapters',
    { path: purePathOwners },
    { dependencyTypes: ['core'], pathNot: '^(?:node:)?path$' },
    'Canonical path checks are pure policy; filesystem/process capabilities are not.',
  ),
  refuse(
    'host-capabilities-only-in-adapters',
    { pathNot: [tests, hostOwners] },
    { path: hostLibraries },
    'Keychain, environment readers and process/launcher packages remain host-only even when type-only.',
  ),
  refuse(
    'web-not-to-server-private',
    { path: web },
    { path: server },
    'Browser consumers use the four public contract leaves.',
  ),
  refuse(
    'web-not-to-private-contract-subpaths',
    { path: web },
    { path: contracts, pathNot: `${contracts}(?:identity|state|operations|wire)[.]ts$` },
    'Relative traversal cannot bypass the package export map.',
  ),
  refuse(
    'consumers-only-to-contract-leaves',
    { path: [`${prefix}apps/(?:server|web|docs)/src/`, ui] },
    { path: contracts, pathNot: `${contracts}(?:identity|state|operations|wire)[.]ts$` },
    'Every consumer uses the public export leaves; translator exceptions never expose internal helpers.',
  ),
  refuse(
    'web-views-through-store',
    { path: `${web}views/`, pathNot: tests },
    { path: `${web}store/`, pathNot: `${web}store/roadmap-provider[.]tsx$` },
    'Views read through useRoadmap, never the transport/store implementation.',
  ),
  refuse(
    'web-views-through-workflows',
    { path: `${web}views/`, pathNot: tests },
    { path: `${contracts}wire[.]ts$` },
    'Views use named workflows rather than public transport envelopes.',
  ),
  refuse(
    'web-workflows-pure',
    { path: `${web}workflows/`, pathNot: tests },
    {
      path: [
        `${web}(?:store/|views/|navigation[.]tsx$|App[.]tsx$|main[.]tsx$)`,
        ui,
        '(?:^|/)node_modules/(?:react|react-dom)(?:/|$)',
        '(?:^|/)node_modules/[.]pnpm/[^/]+/node_modules/(?:react|react-dom)(?:/|$)',
      ],
    },
    'Workflow policy depends directly on public facts and pure helpers, never rendering or store.',
  ),
  refuse(
    'web-workflows-pure',
    { path: `${web}workflows/`, pathNot: tests },
    { path: `${contracts}wire[.]ts$`, dependencyTypesNot: ['type-only'] },
    'Workflow policy may reuse erased rejection types but never transport schemas or decoding.',
  ),
  refuse(
    'web-resource-results-pure',
    { path: `${web}resources/`, pathNot: tests },
    {
      path: [
        `${web}(?:views/|store/|workflows/|router[.]ts$|navigation[.]tsx$|App[.]tsx$|main[.]tsx$)`,
        `${contracts}(?:operations|wire)[.]ts$`,
        ui,
        '(?:^|/)node_modules/(?:react|react-dom|react-router)(?:/|$)',
        '(?:^|/)node_modules/[.]pnpm/[^/]+/node_modules/(?:react|react-dom|react-router)(?:/|$)',
      ],
      pathNot: `${web}views/shared/gist[.]ts$`,
    },
    'Pure app-local resource results interpret accepted read facts without rendering, route, transport or operation dependencies.',
  ),
  refuse(
    'ui-not-to-roadmap-domain',
    { path: ui },
    { path: [`${prefix}apps/(?:server|web|docs)/`, `${prefix}packages/contracts/`] },
    'Generic UI is independent of application/domain/docs.',
  ),
  refuse(
    'docs-only-to-ui',
    { path: docs },
    { path: [`${prefix}apps/(?:server|web)/`, `${prefix}packages/contracts/`] },
    'Docs consumes generic UI and its own static-site code.',
  ),
  refuse(
    'server-not-to-web-ui-docs',
    { path: server, pathNot: `${server}session-authority[.]test[.]ts$` },
    { path: [web, ui, docs] },
    'Only the explicit real transport/store integration test crosses process graphs.',
  ),
]

export function leafConfiguration(tsconfig, environment) {
  return {
    forbidden,
    options: {
      parser: 'tsc',
      tsPreCompilationDeps: true,
      detectProcessBuiltinModuleCalls: true,
      combinedDependencies: false,
      preserveSymlinks: false,
      tsConfig: { fileName: fileURLToPath(new URL(`../../${tsconfig}`, import.meta.url)) },
      webpackConfig: {
        fileName: fileURLToPath(new URL('./typescript-resolve.mjs', import.meta.url)),
        env: { tsconfig: fileURLToPath(new URL(`../../${tsconfig}`, import.meta.url)) },
      },
      doNotFollow: { path: '(^|/)node_modules/' },
      enhancedResolveOptions: {
        exportsFields: ['exports'],
        conditionNames: [environment, 'import', 'types', 'default'],
      },
    },
  }
}
