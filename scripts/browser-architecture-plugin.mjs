import { builtinModules } from 'node:module'
import { resolve } from 'node:path'

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
function normalize(id) {
  return id.replace(/^\0+/, '').replaceAll('\\', '/').split('?')[0]
}

export function roadmapArchitectureGraph(rootDirectory) {
  const root = normalize(resolve(rootDirectory)) + '/'
  const modules = new Map()
  const forbidden = (id) => {
    const path = normalize(id)
    return (
      path.startsWith('node:') ||
      builtins.has(path) ||
      path.includes('__vite-browser-external') ||
      path.startsWith(`${root}apps/server/`) ||
      /(?:^|\/)node_modules\/(?:keytar|keychain|dotenv|execa|open)\//.test(path)
    )
  }
  return {
    name: 'roadmap-architecture-graph',
    apply: 'build',
    buildStart() {
      modules.clear()
    },
    moduleParsed(module) {
      modules.set(module.id, [...module.importedIds, ...module.dynamicallyImportedIds])
    },
    buildEnd(error) {
      const violations = []
      for (const [id, imports] of modules) {
        if (forbidden(id)) violations.push(normalize(id))
        for (const imported of imports) {
          if (forbidden(imported))
            violations.push(`${normalize(id)} imports ${normalize(imported)}`)
        }
      }
      if (violations.length)
        this.error(`ROADMAP_ARCHITECTURE_GRAPH: ${[...new Set(violations)].sort().join('\n')}`)
      if (error) return
      this.info(
        `ROADMAP_ARCHITECTURE_GRAPH: inspected ${modules.size} resolved modules before tree shaking`,
      )
    },
  }
}
