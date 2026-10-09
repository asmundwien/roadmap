import { dirname, resolve } from 'node:path'
import ts from 'typescript'

export default function typescriptResolve({ tsconfig }) {
  const filename = resolve(tsconfig)
  const parsed = ts.getParsedCommandLineOfConfigFile(
    filename,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )
  if (!parsed || parsed.errors.length) {
    throw new Error(
      parsed
        ? parsed.errors
            .map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, '\n'))
            .join('\n')
        : `Cannot parse ${filename}`,
    )
  }
  // TypeScript records the defining config directory even without deprecated
  // baseUrl. Dependency-cruiser's default paths plugin substitutes './' at
  // repository root, so provide enhanced-resolve aliases from that same
  // compiler-owned base instead of changing any source or leaf configuration.
  const base = parsed.options.baseUrl ?? parsed.options.pathsBasePath ?? dirname(filename)
  const alias = Object.fromEntries(
    Object.entries(parsed.options.paths ?? {}).map(([name, paths]) => [
      name.includes('*') ? name : `${name}$`,
      paths.map((path) => resolve(base, path)),
    ]),
  )
  return { resolve: { alias } }
}
