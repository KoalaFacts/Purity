// ---------------------------------------------------------------------------
// Smart `serverAction()` body-only stripping (ADR 0043).
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

/**
 * Stub that replaces a stripped handler body. Uses rest-args so introspection
 * code reading `handler.length` doesn't observe a misleading zero arity —
 * the original handler took at least one positional `Request` arg.
 */
const STUB =
  '((..._args) => { throw new Error("[Purity] serverAction handler is server-only " + ' +
  '"(stripped from client bundle by @purityjs/vite-plugin — ADR 0043). " + ' +
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
  id?: OxcNode | null;
  specifiers?: OxcNode[];
  source?: { value?: string };
  imported?: OxcNode | null;
  local?: OxcNode | null;
  name?: string;
}

/** Active set of import-bound names while walking a particular scope. */
interface ActiveBindings {
  direct: Set<string>;
  ns: Set<string>;
}

function withoutShadows(active: ActiveBindings, shadows: Set<string>): ActiveBindings {
  if (shadows.size === 0) return active;
  let nextDirect = active.direct;
  let nextNs = active.ns;
  for (const name of shadows) {
    if (nextDirect.has(name)) {
      if (nextDirect === active.direct) nextDirect = new Set(active.direct);
      nextDirect.delete(name);
    }
    if (nextNs.has(name)) {
      if (nextNs === active.ns) nextNs = new Set(active.ns);
      nextNs.delete(name);
    }
  }
  if (nextDirect === active.direct && nextNs === active.ns) return active;
  return { direct: nextDirect, ns: nextNs };
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
    // Skip `import type { … }` — type-only imports erase at runtime, so
    // their names can't refer to the runtime `serverAction` we want to
    // strip. Treating them as bindings would false-positive-strip a
    // local function that happens to share the name.
    if ((stmt as OxcNode & { importKind?: string }).importKind === 'type') continue;

    for (const spec of stmt.specifiers ?? []) {
      // Same logic per-specifier — `import { type serverAction, … }` is
      // also runtime-erased even when the surrounding declaration isn't
      // type-only.
      if ((spec as OxcNode & { importKind?: string }).importKind === 'type') continue;
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
 * Recursively collect the Identifier-bound names introduced by a parameter
 * pattern. Handles the realistic shapes that come up in user code:
 *   - `serverAction`               → Identifier
 *   - `serverAction = default`     → AssignmentPattern (default param)
 *   - `...serverAction`            → RestElement
 *   - `{ serverAction }`           → ObjectPattern → Property.value
 *   - `{ serverAction: alias }`    → Property.value Identifier
 *   - `[serverAction]`             → ArrayPattern element
 *
 * Anything we can't decode is silently ignored — the consequence of missing
 * a binding is over-eager stripping, which is already gated behind the
 * `*.server.ts` filename convention as defense-in-depth.
 */
function collectPatternIdentifiers(pattern: OxcNode | null | undefined, out: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      if (pattern.name) out.add(pattern.name);
      return;
    case 'AssignmentPattern':
      // `param = default` — only the `left` introduces a binding.
      collectPatternIdentifiers(pattern.left, out);
      return;
    case 'RestElement':
      collectPatternIdentifiers(pattern.argument, out);
      return;
    case 'ArrayPattern':
      for (const el of pattern.elements ?? []) collectPatternIdentifiers(el, out);
      return;
    case 'ObjectPattern':
      for (const prop of pattern.properties ?? []) {
        if (prop.type === 'RestElement') {
          collectPatternIdentifiers(prop.argument, out);
        } else {
          // Property: `{ key: value }` (shorthand has key === value as same Identifier).
          collectPatternIdentifiers(prop.value, out);
        }
      }
      return;
  }
}

/**
 * Names locally declared at the top of `scope` (function params + body's
 * top-level `let/const/var/function/class` declarations). Used to prune
 * shadowed bindings before walking into the scope.
 *
 * Handles the common shadowing shapes:
 *   - Identifier params, default params (`= x`), rest params (`...x`), and
 *     destructured params (`{ x }`, `[x]`).
 *   - `function foo() {}` declarations
 *   - `var/let/const foo = …` with an identifier binding (and destructured
 *     identifiers thereof)
 *   - `class Foo {}` declarations
 *
 * Deeper shadowing (TDZ tricks, block-scoped declarations inside nested
 * if/for/try blocks) is rare enough that the false-positive risk is
 * acceptable — the worst case is over-eager stripping that the `*.server.ts`
 * filename convention already handles defensively.
 */
function localScopeBindings(scope: OxcNode): Set<string> {
  const names = new Set<string>();
  if (Array.isArray(scope.params)) {
    for (const p of scope.params) collectPatternIdentifiers(p, names);
  }
  let bodyStatements: OxcNode[] | null = null;
  const body = scope.body;
  if (body && !Array.isArray(body) && body.type === 'BlockStatement') {
    bodyStatements = (body.body as OxcNode[] | undefined) ?? null;
  }
  if (bodyStatements) {
    for (const stmt of bodyStatements) {
      if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
        names.add(stmt.id.name);
      } else if (stmt.type === 'VariableDeclaration') {
        for (const d of (stmt.declarations as OxcNode[] | undefined) ?? []) {
          // Decode the binding pattern so `const { serverAction } = …` and
          // `const [serverAction] = …` also shadow.
          collectPatternIdentifiers(d.id, names);
        }
      } else if (stmt.type === 'ClassDeclaration' && stmt.id?.name) {
        names.add(stmt.id.name);
      }
    }
  }
  return names;
}

/**
 * Visit every CallExpression in the tree, prunning import-bound names
 * shadowed by local declarations along the way. A `function serverAction`
 * declared inside a user function will mask the `@purityjs/core` import
 * within its scope so we don't false-positive-strip its handler arg.
 */
function walkWithScope(
  node: OxcNode | null | undefined,
  active: ActiveBindings,
  onCall: (call: OxcNode, active: ActiveBindings) => void,
): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type !== 'string') return;

  if (node.type === 'CallExpression') onCall(node, active);

  let scoped = active;
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  ) {
    scoped = withoutShadows(active, localScopeBindings(node));
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && typeof (c as OxcNode).type === 'string') {
          walkWithScope(c as OxcNode, scoped, onCall);
        }
      }
    } else if (child && typeof child === 'object' && typeof (child as OxcNode).type === 'string') {
      walkWithScope(child as OxcNode, scoped, onCall);
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
  // `(serverAction as any)(...)` / `(serverAction)(...)` — peel the type-only
  // wrappers so the user can't dodge stripping with a cast.
  const target = unwrapTypeWrappers(callee);
  if (target.type === 'Identifier' && target.name && directNames.has(target.name)) {
    return true;
  }
  if (target.type === 'MemberExpression' && !target.computed) {
    const obj = target.object ? unwrapTypeWrappers(target.object) : null;
    const prop = target.property;
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
 * Peel off purely-syntactic wrappers that don't contribute to the runtime
 * value of a CallExpression argument — TS casts (`as`, `satisfies`, `!`,
 * `<T>x`) and parentheses. The wrapped expression IS the function we want
 * to strip, so without this peel a `(async () => SECRET) as any` handler
 * would slip through the `ArrowFunctionExpression` type check and leak its
 * body into the client bundle.
 *
 * Returns the unwrapped node (always non-null when given non-null input).
 */
function unwrapTypeWrappers(node: OxcNode): OxcNode {
  let cur: OxcNode = node;
  while (
    cur.type === 'TSAsExpression' ||
    cur.type === 'TSSatisfiesExpression' ||
    cur.type === 'TSNonNullExpression' ||
    cur.type === 'TSTypeAssertion' ||
    cur.type === 'ParenthesizedExpression'
  ) {
    const inner = cur.expression as OxcNode | null | undefined;
    if (!inner) break;
    cur = inner;
  }
  return cur;
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
  walkWithScope(parsed.program, { direct: directNames, ns: namespaceNames }, (call, active) => {
    if (!isServerActionCallee(call.callee, active.direct, active.ns)) return;
    const args = call.arguments;
    if (!args || args.length < 2) return;
    const rawHandler = args[1]!;
    // Strip purely-syntactic wrappers (TS casts, parens) before deciding —
    // `(async () => SECRET) as any` is still an inline handler we must strip.
    const handler = unwrapTypeWrappers(rawHandler);
    if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') {
      // Identifier reference / spread / object — leave alone (out of scope).
      return;
    }
    // Replace from the OUTER wrapper start to its end so we don't leave a
    // stale `as any` trailer or stray parens behind the stub.
    edits.push({ start: rawHandler.start, end: rawHandler.end, replacement: STUB });
  });

  if (edits.length === 0) return null;

  // Drop edits nested inside another edit's range. A serverAction handler
  // can itself contain a serverAction() call, so the walker emits an outer
  // edit that fully encloses an inner one. The outer STUB already discards
  // the inner handler, and right-to-left application only stays correct for
  // DISJOINT ranges — applying the inner edit first shifts the string length
  // and invalidates the outer edit's stale `end` offset, corrupting
  // everything after the outer handler. Keep only the outermost edits.
  edits.sort((a, b) => a.start - b.start);
  const disjoint: Edit[] = [];
  let lastEnd = -1;
  for (const edit of edits) {
    if (edit.start < lastEnd) continue; // contained in the previous kept edit
    disjoint.push(edit);
    lastEnd = edit.end;
  }

  // Apply right-to-left so earlier offsets stay valid.
  disjoint.sort((a, b) => b.start - a.start);
  let out = code;
  for (const edit of disjoint) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return { code: out, stripped: disjoint.length };
}
