import { posix } from 'node:path'
import ts from 'typescript'

const tests =
  /(?:\.test\.[cm]?[jt]sx?$|(?:^|\/)(?:source-test-fixtures|public-test-fixtures|test-fixtures)\.ts$)/
const factories = new Set(['createConfigurationDocument', 'createAutomationDatabaseDocument'])
const environmentOwners = /^apps\/server\/src\/(?:main\.ts|automation\/launcher\.ts)$/
const browser = /^apps\/web\/src\//

function literalName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text
  if (ts.isComputedPropertyName(node)) {
    const expression = node.expression
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
      return expression.text
  }
  return null
}

function member(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
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
  const viewConsumer = /^apps\/web\/src\/views\//.test(path)
  const rawActions = new Set(['execute', 'query'])
  const selectorParameters = new Set()
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
    return literalName(node.propertyName ?? node.name)
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
  function unwrapped(node) {
    while (
      node &&
      (ts.isParenthesizedExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isSatisfiesExpression(node))
    )
      node = node.expression
    return node
  }
  // Import paths identify authorities; bound declarations preserve lexical shadowing.
  // Only static aliases are followed, never assignments or runtime object flow.
  function publicModule(name) {
    if (name === '@roadmap/contracts/operations') return 'operations'
    if (name === '@roadmap/contracts/identity') return 'identity'
    const resolved = name.startsWith('@/')
      ? posix.normalize(`apps/web/src/${name.slice(2)}`)
      : name.startsWith('.')
        ? posix.normalize(posix.join(posix.dirname(path), name))
        : null
    if (!resolved) return null
    const module = resolved.replace(/\.[cm]?[jt]sx?$/, '')
    if (module === 'apps/web/src/store/roadmap-provider') return 'facade'
    if (module === 'packages/contracts/src/operations') return 'operations'
    if (module === 'packages/contracts/src/identity') return 'identity'
    return null
  }
  function importedMember(module, name) {
    if (module === 'facade' && ['useRoadmap', 'RoadmapViewState'].includes(name)) return name
    if (module === 'operations' && ['Command', 'commandSchema'].includes(name)) return name
    if (module === 'identity' && name === 'configurationVersionSchema') return name
    return null
  }
  function importedProperty(root, name) {
    if (root?.startsWith('module:')) return importedMember(root.slice(7), name)
    if (root === 'commandSchema' && name === 'parse') return 'commandSchema.parse'
    if (root === 'configurationVersionSchema' && ['parse', 'safeParse'].includes(name))
      return `configurationVersionSchema.${name}`
    return null
  }
  function imported(node, seen = new Set()) {
    node = unwrapped(node)
    if (!node || seen.has(node)) return null
    seen.add(node)
    if (ts.isIdentifier(node)) {
      for (const declaration of symbol(node)?.declarations ?? []) {
        if (ts.isImportSpecifier(declaration)) {
          const statement = declaration.parent.parent.parent
          if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier))
            return importedMember(
              publicModule(statement.moduleSpecifier.text),
              declaration.propertyName?.text ?? declaration.name.text,
            )
        }
        if (ts.isNamespaceImport(declaration)) {
          const statement = declaration.parent.parent
          if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            const module = publicModule(statement.moduleSpecifier.text)
            return module ? `module:${module}` : null
          }
        }
        if (ts.isVariableDeclaration(declaration)) return imported(declaration.initializer, seen)
        if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
          const owner = declaration.parent.parent
          if (ts.isVariableDeclaration(owner)) {
            return importedProperty(imported(owner.initializer, seen), bindingName(declaration))
          }
        }
      }
      return null
    }
    if (ts.isQualifiedName(node)) {
      const root = imported(node.left, seen)
      return importedProperty(root, node.right.text)
    }
    const name = member(node)
    if (name) {
      const root = imported(node.expression, seen)
      return importedProperty(root, name)
    }
    return null
  }
  function publicType(node, name, seen = new Set()) {
    if (!node || seen.has(node)) return false
    seen.add(node)
    if (ts.isParenthesizedTypeNode(node)) return publicType(node.type, name, seen)
    if (!ts.isTypeReferenceNode(node)) return false
    if (imported(node.typeName) === name) return true
    if (
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === 'Extract' &&
      !symbol(node.typeName)?.declarations?.length
    )
      return publicType(node.typeArguments?.[0], name, seen)
    for (const declaration of symbol(node.typeName)?.declarations ?? [])
      if (ts.isTypeAliasDeclaration(declaration)) return publicType(declaration.type, name, seen)
    return false
  }
  function selectorFunction(node, seen = new Set()) {
    node = unwrapped(node)
    if (!node || seen.has(node)) return null
    seen.add(node)
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node
    if (ts.isIdentifier(node))
      for (const declaration of symbol(node)?.declarations ?? []) {
        if (ts.isFunctionDeclaration(declaration)) return declaration
        if (ts.isVariableDeclaration(declaration))
          return selectorFunction(declaration.initializer, seen)
      }
    return null
  }
  function collectSelectors(node) {
    if (ts.isCallExpression(node) && imported(node.expression) === 'useRoadmap') {
      const selector = selectorFunction(node.arguments[0])
      if (selector?.parameters[0]) selectorParameters.add(selector.parameters[0])
    }
    ts.forEachChild(node, collectSelectors)
  }
  function readMember(root, name, seen) {
    if (!root || root === 'read') return null
    if (!ts.isObjectLiteralExpression(root)) return null
    for (const property of root.properties) {
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === name)
        return readRoot(property.name, seen)
      if (ts.isPropertyAssignment(property) && literalName(property.name) === name)
        return readRoot(property.initializer, seen)
    }
    return null
  }
  function parameterRoot(parameter) {
    return selectorParameters.has(parameter) || publicType(parameter.type, 'RoadmapViewState')
      ? 'read'
      : null
  }
  function readBinding(node, seen) {
    if (!ts.isObjectBindingPattern(node.parent)) return null
    const declaration = node.parent.parent
    if (ts.isVariableDeclaration(declaration)) return readRoot(declaration.initializer, seen)
    if (ts.isParameter(declaration)) return parameterRoot(declaration)
    if (ts.isBindingElement(declaration))
      return readMember(readBinding(declaration, seen), bindingName(declaration), seen)
    return null
  }
  function readRoot(node, seen = new Set()) {
    node = unwrapped(node)
    if (!node || seen.has(node)) return null
    seen.add(node)
    if (ts.isIdentifier(node)) {
      for (const declaration of symbol(node)?.declarations ?? []) {
        if (ts.isParameter(declaration)) return parameterRoot(declaration)
        if (ts.isVariableDeclaration(declaration)) return readRoot(declaration.initializer, seen)
        if (ts.isBindingElement(declaration))
          return readMember(readBinding(declaration, seen), bindingName(declaration), seen)
      }
      return null
    }
    if (ts.isObjectLiteralExpression(node)) return node
    if (ts.isCallExpression(node) && imported(node.expression) === 'useRoadmap') {
      const selector = selectorFunction(node.arguments[0])
      if (!selector?.body) return null
      if (!ts.isBlock(selector.body)) return readRoot(selector.body, seen)
      let root = null
      function returns(child) {
        if (ts.isReturnStatement(child)) root ??= readRoot(child.expression, new Set(seen))
        else if (!ts.isFunctionLike(child)) ts.forEachChild(child, returns)
      }
      ts.forEachChild(selector.body, returns)
      return root
    }
    const name = member(node)
    return name ? readMember(readRoot(node.expression, seen), name, seen) : null
  }
  // Command-derived candidate types are legal. Only object expressions used as
  // complete public commands cross the workflow construction boundary.
  function commandObject(node) {
    let expression = node
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent)) {
        expression = parent
        continue
      }
      if (
        ts.isSatisfiesExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isTypeAssertionExpression(parent)
      ) {
        if (publicType(parent.type, 'Command')) return true
        expression = parent
        continue
      }
      if (ts.isVariableDeclaration(parent) && parent.initializer === expression)
        return publicType(parent.type, 'Command')
      if (ts.isCallExpression(parent) && parent.arguments.includes(expression))
        return imported(parent.expression) === 'commandSchema.parse'
      if (ts.isReturnStatement(parent)) {
        for (let owner = parent.parent; owner; owner = owner.parent)
          if (ts.isFunctionLike(owner)) return publicType(owner.type, 'Command')
      }
      if (ts.isArrowFunction(parent) && parent.body === expression)
        return publicType(parent.type, 'Command')
      return false
    }
    return false
  }
  if (viewConsumer) collectSelectors(source)
  function refuse(rule, node) {
    const location = source.getLineAndCharacterOfPosition(node.getStart(source))
    violations.push({ rule, path, line: location.line + 1 })
  }
  function visit(node) {
    const property = typeReference(node) ? null : member(node)
    if (viewConsumer) {
      if (property && rawActions.has(property) && readRoot(node.expression) === 'read')
        refuse('web-views-through-workflows', node)
      if (
        ts.isBindingElement(node) &&
        rawActions.has(bindingName(node)) &&
        readBinding(node, new Set()) === 'read'
      )
        refuse('web-views-through-workflows', node)
      if (ts.isObjectLiteralExpression(node) && commandObject(node))
        refuse('web-views-through-workflows', node)
      if (
        ts.isCallExpression(node) &&
        ['configurationVersionSchema.parse', 'configurationVersionSchema.safeParse'].includes(
          imported(node.expression),
        )
      )
        refuse('web-views-through-workflows', node)
    }
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
