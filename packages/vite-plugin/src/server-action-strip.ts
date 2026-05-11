// ---------------------------------------------------------------------------
// Smart `serverAction()` body-only stripping (ADR 0035).
//
// Complements ADR 0018's `*.server.{ts,js,tsx,jsx}` filename convention.
// Where ADR 0018 strips the entire module, this pass finds inline
// `serverAction(url, handler)` calls in any client-bundled file and
// replaces just the handler argument with a stub thrower. `.url` and
// `.invoke()` accessors keep working on the client; the handler body
// (and the imports it uses, via tree-shaking) stops shipping.
//
// Scope (defense-in-depth, not a security guarantee):
//   - Only inline ArrowFunctionExpression / FunctionExpression handlers
//     get stripped. Identifier references (`serverAction(url, handlerVar)`)
//     are left alone — the handler binding may be used elsewhere.
//   - Detection is import-bound: we resolve `serverAction` (or its alias /
//     namespace member) from `@purityjs/core` imports only.
//   - Cheap pre-filter: skip files that don't mention `@purityjs/core` AND
//     `serverAction` so the parser cost is paid only on actual hits.
// ---------------------------------------------------------------------------

import { parseSync } from 'oxc-parser';

/** The stub that replaces a stripped handler body. */
const STUB =
  '(() => { throw new Error("[Purity] serverAction handler is server-only " + ' +
  '"(stripped from client bundle by @purityjs/vite-plugin — ADR 0035). " + ' +
  '"Call action.invoke() instead, or move the call to a *.server.ts module."); }) ' +
  '/* @purity stripped */';

/**
 * Per-call stripping output. `null` when no `serverAction()` call was found
 * (or the file didn't import from `@purityjs/core`).
 */
export interface StripResult {
  code: string;
  /** Number of handler args replaced. */
  stripped: number;
}

interface OxcNode {
  type: string;
  start: number;
  end: number;
  // ESTree-shaped fields the walker uses; typed loose so we can avoid
  // pulling the full estree types into a lightweight helper.
  body?: OxcNode | OxcNode[];
  declarations?: OxcNode[];
  init?: OxcNode | null;
  expression?: OxcNode | null;
  argument?: OxcNode | null;
  arguments?: OxcNode[];
  callee?: OxcNode | null;
  object?: OxcNode | null;
  property?: OxcNode | null;
  computed?: boolean;
  consequent?: OxcNode | OxcNode[] | null;
  alternate?: OxcNode | null;
  cases?: OxcNode[];
  block?: OxcNode | null;
  handler?: OxcNode | null;
  finalizer?: OxcNode | null;
  params?: OxcNode[];
  test?: OxcNode | null;
  left?: OxcNode | null;
  right?: OxcNode | null;
  elements?: (OxcNode | null)[];
  properties?: OxcNode[];
  value?: OxcNode | null;
  key?: OxcNode | null;
  specifiers?: OxcNode[];
  source?: { value?: string };
  imported?: OxcNode | null;
  local?: OxcNode | null;
  name?: string;
}

/**
 * Quick text precheck — avoids paying the parser cost on the vast majority
 * of files that can't possibly contain a `serverAction()` call we care about.
 */
function couldContainServerAction(code: string): boolean {
  return code.includes('@purityjs/core') && code.includes('serverAction');
}

/**
 * Walk the import declarations of a parsed module and return:
 *   - the set of local identifier names bound to `serverAction` from
 *     `@purityjs/core` (handles default + alias)
 *   - the set of local namespace import names whose `.serverAction` member
 *     should be treated as the function (handles `import * as p`)
 */
function collectServerActionBindings(program: OxcNode): {
  directNames: Set<string>;
  namespaceNames: Set<string>;
} {
  const directNames = new Set<string>();
  const namespaceNames = new Set<string>();
  const body = program.body as OxcNode[] | undefined;
  if (!body) return { directNames, namespaceNames };

  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const sourceValue = stmt.source?.value;
    if (sourceValue !== '@purityjs/core') continue;

    for (const spec of stmt.specifiers ?? []) {
      if (spec.type === 'ImportSpecifier') {
        const importedName = spec.imported?.name;
        const localName = spec.local?.name;
        if (importedName === 'serverAction' && localName) directNames.add(localName);
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        const localName = spec.local?.name;
        if (localName) namespaceNames.add(localName);
      }
    }
  }
  return { directNames, namespaceNames };
}

/**
 * Recursively visit every node in the tree, calling `visit` for each one.
 * No parent tracking — call-site identification doesn't need it.
 */
function walk(node: OxcNode | null | undefined, visit: (n: OxcNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type !== 'string') return;
  visit(node);

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && typeof (c as OxcNode).type === 'string') {
          walk(c as OxcNode, visit);
        }
      }
    } else if (child && typeof child === 'object' && typeof (child as OxcNode).type === 'string') {
      walk(child as OxcNode, visit);
    }
  }
}

/**
 * Test whether `callee` references a serverAction binding we recognise.
 * Direct: `serverAction(...)` or `<alias>(...)`.
 * Namespace member: `<ns>.serverAction(...)`.
 */
function isServerActionCallee(
  callee: OxcNode | null | undefined,
  directNames: Set<string>,
  namespaceNames: Set<string>,
): boolean {
  if (!callee) return false;
  if (callee.type === 'Identifier' && callee.name && directNames.has(callee.name)) {
    return true;
  }
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const obj = callee.object;
    const prop = callee.property;
    if (
      obj?.type === 'Identifier' &&
      obj.name &&
      namespaceNames.has(obj.name) &&
      prop?.type === 'Identifier' &&
      prop.name === 'serverAction'
    ) {
      return true;
    }
  }
  return false;
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Strip inline handler bodies from `serverAction(url, handler)` calls.
 *
 * @returns `null` when no transform is needed (no relevant import or no
 *   inline handler found). When something is stripped, returns the rewritten
 *   source plus a count.
 */
export function stripServerActionBodies(code: string, _id: string): StripResult | null {
  if (!couldContainServerAction(code)) return null;

  let parsed: { program: OxcNode };
  try {
    parsed = parseSync(_id, code) as unknown as { program: OxcNode };
  } catch {
    // Parse failure shouldn't crash the build — fall through to no-op so
    // downstream handlers can surface their own diagnostics.
    return null;
  }

  const { directNames, namespaceNames } = collectServerActionBindings(parsed.program);
  if (directNames.size === 0 && namespaceNames.size === 0) return null;

  const edits: Edit[] = [];
  walk(parsed.program, (node) => {
    if (node.type !== 'CallExpression') return;
    if (!isServerActionCallee(node.callee, directNames, namespaceNames)) return;
    const args = node.arguments;
    if (!args || args.length < 2) return;
    const handler = args[1]!;
    if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') {
      // Identifier reference / spread / object — leave alone (out of scope).
      return;
    }
    edits.push({ start: handler.start, end: handler.end, replacement: STUB });
  });

  if (edits.length === 0) return null;

  // Apply edits right-to-left so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return { code: out, stripped: edits.length };
}
