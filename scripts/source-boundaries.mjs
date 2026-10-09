import ts from 'typescript'

const tests =
  /(?:\.test\.[cm]?[jt]sx?$|(?:^|\/)(?:source-test-fixtures|public-test-fixtures|test-fixtures)\.ts$)/
const factories = new Set(['createConfigurationDocument', 'createAutomationDatabaseDocument'])
const environmentOwners = /^apps\/server\/src\/(?:main\.ts|automation\/launcher\.ts)$/
const browser = /^apps\/web\/src\//

function member(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteral(expression.argumentExpression)
  )
    return expression.argumentExpression.text
  return null
}

export function inspectSource(path, text) {
  if (tests.test(path)) return []
  const filename = `/__roadmap_architecture_source__.${path.endsWith('.tsx') ? 'tsx' : 'ts'}`
  // Bind this source only. No imports, libraries, diagnostics or emit are
  // needed to distinguish ambient capabilities from lexical declarations.
  const options = {
    noLib: true,
    noResolve: true,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    moduleDetection: ts.ModuleDetectionKind.Force,
  }
  const source = ts.createSourceFile(
    filename,
    text,
    {
      languageVersion: ts.ScriptTarget.Latest,
      setExternalModuleIndicator: ts.getSetExternalModuleIndicator(options),
    },
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const host = {
    getSourceFile: (path) => (path === filename ? source : undefined),
    getDefaultLibFileName: () => '',
    writeFile() {
      throw new Error('Architecture binding cannot emit files.')
    },
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: (path) => path === filename,
    readFile: (path) => (path === filename ? text : undefined),
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }
  let checker
  const violations = []
  const transport = new Set(['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource'])
  const globalObjects = new Set(['globalThis', 'window', 'self'])
  const browserConsumer = browser.test(path) && !/^apps\/web\/src\/store\//.test(path)
  const privateConsumer = /^apps\/server\/src\//.test(path) && path !== 'apps/server/src/main.ts'
  const storageModule = (name) =>
    /(?:^|\/)(?:configuration\/document|automation\/database)(?:\.ts)?$/.test(name)

  function symbol(node) {
    checker ??= ts.createProgram([filename], options, host).getTypeChecker()
    return ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node)
  }
  function ambient(node, names) {
    return (
      !!node && ts.isIdentifier(node) && names.has(node.text) && !symbol(node)?.declarations?.length
    )
  }
  function bindingName(node) {
    if (node.dotDotDotToken) return null
    const name = node.propertyName ?? node.name
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
  }
  function bindingOwner(node, seen = new Set()) {
    if (!ts.isObjectBindingPattern(node.parent)) return null
    const declaration = node.parent.parent
    if (ts.isVariableDeclaration(declaration)) return sourceOwner(declaration.initializer, seen)
    if (ts.isBindingElement(declaration)) return sourceOwner(declaration, seen)
    return null
  }
  function ownerMember(owner, name) {
    if (owner !== 'global') return null
    if (name === 'process') return 'process'
    return globalObjects.has(name) ? 'global' : null
  }
  // Resolve only static lexical aliases of global objects and process.
  // Computed names, assignments and runtime object flow are not tracked.
  function sourceOwner(node, seen = new Set()) {
    if (!node || seen.has(node)) return null
    seen.add(node)
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return sourceOwner(node.expression, seen)
    if (ts.isIdentifier(node)) {
      const declarations = symbol(node)?.declarations ?? []
      if (!declarations.length) {
        if (node.text === 'process') return 'process'
        return globalObjects.has(node.text) ? 'global' : null
      }
      for (const declaration of declarations) {
        if (ts.isVariableDeclaration(declaration)) return sourceOwner(declaration.initializer, seen)
        if (ts.isBindingElement(declaration)) return sourceOwner(declaration, seen)
      }
      return null
    }
    if (ts.isBindingElement(node)) return ownerMember(bindingOwner(node, seen), bindingName(node))
    const property = member(node)
    return property ? ownerMember(sourceOwner(node.expression, seen), property) : null
  }
  function typeReference(node) {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (ts.isTypeNode(parent)) return true
    return false
  }
  function valueReference(node) {
    if (ts.isShorthandPropertyAssignment(node.parent)) return true
    if (
      node.parent.name === node ||
      ts.isImportSpecifier(node.parent) ||
      ts.isExportSpecifier(node.parent) ||
      ts.isBindingElement(node.parent)
    )
      return false
    return !typeReference(node)
  }
  function moduleOf(node, seen = new Set()) {
    if (!node || seen.has(node)) return null
    seen.add(node)
    if (
      ts.isAwaitExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return moduleOf(node.expression, seen)
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      return node.arguments[0].text
    if (!ts.isIdentifier(node)) return null
    for (const declaration of symbol(node)?.declarations ?? []) {
      if (ts.isNamespaceImport(declaration)) {
        const statement = declaration.parent.parent
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier))
          return statement.moduleSpecifier.text
      }
      if (ts.isVariableDeclaration(declaration)) return moduleOf(declaration.initializer, seen)
    }
    return null
  }
  function refuse(rule, node) {
    const location = source.getLineAndCharacterOfPosition(node.getStart(source))
    violations.push({ rule, path, line: location.line + 1 })
  }
  function visit(node) {
    const property = typeReference(node) ? null : member(node)
    if (
      browserConsumer &&
      ((ts.isIdentifier(node) && valueReference(node) && ambient(node, transport)) ||
        (property && transport.has(property) && sourceOwner(node.expression) === 'global'))
    )
      refuse('web-views-through-store', node)
    if (
      property === 'env' &&
      sourceOwner(node.expression) === 'process' &&
      !environmentOwners.test(path)
    )
      refuse('host-capabilities-only-in-adapters', node)
    if (privateConsumer && property && factories.has(property)) {
      const module = moduleOf(node.expression)
      if (module && storageModule(module))
        refuse('server-policy-not-to-adapters-or-composition', node)
    }
    if (
      privateConsumer &&
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      storageModule(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      if (
        node.importClause.namedBindings.elements.some((element) =>
          factories.has(element.propertyName?.text ?? element.name.text),
        )
      )
        refuse('server-policy-not-to-adapters-or-composition', node)
    }
    if (
      privateConsumer &&
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      storageModule(node.moduleSpecifier.text)
    ) {
      if (
        !node.exportClause ||
        ts.isNamespaceExport(node.exportClause) ||
        (ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.some((element) =>
            factories.has(element.propertyName?.text ?? element.name.text),
          ))
      )
        refuse('server-policy-not-to-adapters-or-composition', node)
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const owner = bindingOwner(node)
      const name = bindingName(node)
      if (browserConsumer && transport.has(name) && owner === 'global')
        refuse('web-views-through-store', node)
      if (name === 'env' && owner === 'process' && !environmentOwners.test(path))
        refuse('host-capabilities-only-in-adapters', node)
    }
    if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent)
    ) {
      const owner = node.parent.parent.initializer
      const name =
        node.propertyName && ts.isIdentifier(node.propertyName)
          ? node.propertyName.text
          : ts.isIdentifier(node.name)
            ? node.name.text
            : null
      const module = moduleOf(owner)
      if (privateConsumer && factories.has(name) && module && storageModule(module))
        refuse('server-policy-not-to-adapters-or-composition', node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}
