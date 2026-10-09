import { leafConfiguration } from './base.mjs'

const configuration = leafConfiguration('apps/docs/tsconfig.json', 'browser')
export default {
  ...configuration,
  options: { ...configuration.options, extraExtensionsToScan: ['.astro'] },
}
