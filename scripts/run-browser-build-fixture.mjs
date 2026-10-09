import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const [entry, directory] = process.argv.slice(2)
const relativeEntry = entry && directory ? relative(directory, entry) : null
if (
  !relativeEntry ||
  relativeEntry.startsWith('..') ||
  isAbsolute(relativeEntry) ||
  dirname(directory) !== resolve(root) ||
  !basename(directory).startsWith('.architecture-fixtures-')
) {
  throw new Error('This internal build seam requires an isolated fixture entry and directory.')
}
const consumer = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { build } = await import(pathToFileURL(consumer.resolve('vite')).href)
const messages = []
const loggedErrors = new Set()
const logger = {
  hasWarned: false,
  info(message) {
    messages.push(String(message))
  },
  warn(message) {
    messages.push(String(message))
    this.hasWarned = true
  },
  warnOnce(message) {
    if (!messages.includes(String(message))) this.warn(message)
  },
  error(message, options) {
    messages.push(String(message))
    if (options?.error) loggedErrors.add(options.error)
  },
  clearScreen() {
    messages.push('Terminal clear requested.')
  },
  hasErrorLogged(error) {
    return loggedErrors.has(error)
  },
}
try {
  await build({
    root: join(root, 'apps/web'),
    configFile: join(root, 'apps/web/vite.config.ts'),
    configLoader: 'runner',
    mode: 'production',
    envDir: false,
    publicDir: false,
    cacheDir: join(directory, 'cache'),
    customLogger: logger,
    clearScreen: false,
    build: {
      outDir: join(directory, 'output'),
      emptyOutDir: false,
      write: false,
      minify: false,
      rolldownOptions: { input: entry },
    },
  })
  console.log(
    '\nROADMAP_BUILD_FIXTURE_RESULT ' +
      JSON.stringify({ status: 'accepted', config: 'apps/web/vite.config.ts', entry, messages }),
  )
} catch (error) {
  console.log(
    '\nROADMAP_BUILD_FIXTURE_RESULT ' +
      JSON.stringify({
        status: 'rejected',
        config: 'apps/web/vite.config.ts',
        entry,
        message: error.message,
        messages,
      }),
  )
  process.exitCode = 1
}
