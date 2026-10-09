export function roadmapArchitectureGraph(rootDirectory: string): {
  name: string
  apply: 'build'
  buildStart(): void
  moduleParsed(module: {
    id: string
    importedIds: readonly string[]
    dynamicallyImportedIds: readonly string[]
  }): void
  buildEnd(
    this: { error(message: string): never; info(message: string): void },
    error?: Error,
  ): void
}
