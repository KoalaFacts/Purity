import { parseSync } from 'oxc-parser';

/** Select the ordinary list runtime only when every use is an unambiguous direct call. */
export function specializeOrdinaryLists(code: string, id: string): string | null {
  if (!code.includes('@purityjs/core') || !code.includes('each')) return null;
  const parsed = parseSync(id.split('?')[0]!, code);
  if (parsed.errors.length) return null;
  const imports: any[] = [];
  const candidates = new Set<string>();
  for (const statement of parsed.program.body) {
    if (
      statement.type !== 'ImportDeclaration' ||
      statement.source.value !== '@purityjs/core' ||
      statement.importKind === 'type' ||
      statement.attributes.length ||
      !statement.specifiers.every((specifier) => specifier.type === 'ImportSpecifier')
    )
      continue;
    imports.push(statement);
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === 'ImportSpecifier' &&
        specifier.importKind !== 'type' &&
        specifier.imported.type === 'Identifier' &&
        specifier.imported.name === 'each'
      )
        candidates.add(specifier.local.name);
    }
  }
  if (!candidates.size) return null;
  const used = new Set<string>();
  let hasEval = false;
  const visit = (node: any, parent?: any): void => {
    if (!node || typeof node !== 'object' || node.type === 'ImportDeclaration') return;
    if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
      if (node.name === 'eval') hasEval = true;
      if (candidates.has(node.name)) {
        const args = parent?.arguments;
        if (
          parent?.type === 'CallExpression' &&
          parent.callee === node &&
          !parent.optional &&
          args.every((argument: any) => argument.type !== 'SpreadElement') &&
          (args.length === 2 ||
            (args.length === 3 &&
              ['ArrowFunctionExpression', 'FunctionExpression'].includes(args[2].type)))
        )
          used.add(node.name);
        // This also rejects shadowing declarations, exported references,
        // property access, dynamic options, and passing the binding elsewhere.
        else candidates.delete(node.name);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child, node);
      else if (value && typeof value === 'object') visit(value, node);
    }
  };
  visit(parsed.program);
  if (hasEval) return null;
  const edits: { start: number; end: number; text: string }[] = [];
  for (const statement of imports) {
    const selected = statement.specifiers.filter(
      (specifier: any) => candidates.has(specifier.local.name) && used.has(specifier.local.name),
    );
    if (!selected.length) continue;
    const remaining = statement.specifiers.filter(
      (specifier: any) => !selected.includes(specifier),
    );
    const original = remaining.length
      ? `import { ${remaining.map((specifier: any) => code.slice(specifier.start, specifier.end)).join(', ')} } from '@purityjs/core';\n`
      : '';
    edits.push({
      start: statement.start,
      end: statement.end,
      text:
        original +
        `import { ${selected.map((specifier: any) => `each as ${specifier.local.name}`).join(', ')} } from '@purityjs/core/list-runtime';`,
    });
  }
  if (!edits.length) return null;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  return code;
}
