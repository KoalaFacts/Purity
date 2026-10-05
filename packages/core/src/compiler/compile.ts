// ---------------------------------------------------------------------------
// Purity Compiler — JIT compiled html`` tag
//
// First call: parse → AST → codegen → new Function() → cached
// Subsequent calls: run cached function directly. Zero overhead.
// ---------------------------------------------------------------------------

import { watch } from '../signals.ts';
import { generate, generateHydrate } from './codegen.ts';
import {
  checkHydrationCursor,
  type DeferredTemplate,
  type HydrateFactory,
  hydrationTextRewriteEnabled,
  hydrationWarningsEnabled,
  isDeferred,
  isHydrating,
  makeDeferred,
} from './hydrate-runtime.ts';
import { parse } from './parser.ts';

type CompiledFn = (
  values: unknown[],
  watch: typeof import('../signals.ts').watch,
  materializeChild?: (value: unknown) => unknown,
) => Node | DocumentFragment;

interface CacheEntry {
  ast: ReturnType<typeof parse> | null;
  client: CompiledFn | null;
  hydrate: HydrateFactory | null;
}

const compiledCache = new WeakMap<TemplateStringsArray, CacheEntry>();

function getOrInitEntry(strings: TemplateStringsArray): CacheEntry {
  let entry = compiledCache.get(strings);
  if (!entry) {
    entry = { ast: null, client: null, hydrate: null };
    compiledCache.set(strings, entry);
  }
  return entry;
}

function ensureClient(entry: CacheEntry, strings: TemplateStringsArray): CompiledFn {
  if (entry.client) return entry.client;
  const ast = entry.ast ?? parse(strings);
  entry.ast = ast;
  const code = generate(ast);
  entry.client = new Function(`return ${code}`)() as CompiledFn;
  return entry.client;
}

function ensureHydrate(entry: CacheEntry, strings: TemplateStringsArray): HydrateFactory {
  if (entry.hydrate) return entry.hydrate;
  const ast = entry.ast ?? parse(strings);
  entry.ast = ast;
  const code = generateHydrate(ast);
  entry.hydrate = new Function(`return ${code}`)() as HydrateFactory;
  return entry.hydrate;
}

/**
 * Tagged template literal for creating DOM. JIT compiled on first use, then cached.
 *
 * Supports all binding types:
 * - `${value}` — static text/node
 * - `${() => signal()}` — reactive text (auto-updates)
 * - `@event=${handler}` — event listener
 * - `:prop=${value}` — one-way prop binding
 * - `::prop=${signal}` — two-way binding (input, checkbox, select)
 * - `?attr=${bool}` — boolean attribute
 * - `.prop=${value}` — DOM property
 *
 * @example
 * ```ts
 * // Static:
 * html`<p>Hello World</p>`
 *
 * // Reactive text:
 * html`<p>Count: ${() => count()}</p>`
 *
 * // Events + binding:
 * html`
 *   <input ::value=${text} placeholder="Type here" />
 *   <button @click=${() => count(v => v + 1)} ?disabled=${() => !valid()}>
 *     Save
 *   </button>
 * `
 *
 * // Nesting:
 * html`<div>${html`<span>Nested</span>`}</div>`
 *
 * // Lists and conditionals:
 * html`
 *   ${when(() => ok(), () => html`<p>Yes</p>`)}
 *   ${each(() => items(), (item) => html`<li>${() => item()}</li>`)}
 * `
 * ```
 *
 * @returns DOM Node or DocumentFragment. During `hydrate()` returns a
 * DeferredTemplate object instead — inflated against the SSR DOM by the
 * hydrator. The deferred return is internal: user code that treats the
 * result as a DOM Node is hydration-safe because it only stores the value
 * in a slot, where the hydrate factory recognizes and inflates it.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment | Node {
  if (isHydrating()) {
    return makeDeferred(strings, values) as unknown as Node;
  }
  const entry = getOrInitEntry(strings);
  return ensureClient(entry, strings)(values, watch);
}

/**
 * Inflate a DeferredTemplate against the SSR-rendered subtree in `target`.
 * Called by the hydrator (and recursively by hydrate factories for nested
 * templates).
 *
 * `target` is a Node container whose direct children are the SSR roots for
 * this template — typically a DocumentFragment carved out of the parent
 * slot's marker pair, or the hydration root container's children.
 *
 * Suspense boundary markers (`<!--s:N-->` / `<!--/s:N-->`) wrapping the
 * SSR view content are stripped here — they wrap the slot's bytes but
 * aren't part of the inner template's structural shape, so the hydrate
 * factory shouldn't see them.
 *
 * @internal
 */
export function inflateDeferred(
  deferred: DeferredTemplate,
  target: Node,
  skipFirstNode = false,
  createIfEmpty = false,
): Node {
  stripSuspenseMarkers(target);
  const first = target.firstChild;
  const firstNode = skipFirstNode && first?.nodeName === 'STYLE' ? first.nextSibling : first;
  if (!firstNode && (deferred.create || createIfEmpty)) {
    target.appendChild(createDeferred(deferred));
    return target;
  }
  const fn =
    deferred.hydrate ?? ensureHydrate(getOrInitEntry(deferred.strings!), deferred.strings!);
  // Pass the cursor checker if either warnings or text-rewrite is enabled —
  // the helper handles both behaviors and the codegen guard (`_c && _c(...)`)
  // makes this a single null check per cursor step when both are off.
  const check =
    hydrationWarningsEnabled() || hydrationTextRewriteEnabled() ? checkHydrationCursor : undefined;
  return fn(
    deferred.values,
    watch,
    target,
    inflateDeferred,
    check,
    inflateDeferredEachThunk,
    inflateDeferredMatchThunk,
    firstNode,
  );
}

function createDeferred(deferred: DeferredTemplate): Node | DocumentFragment {
  // A missing SSR row needs fresh DOM. Its nested templates were also
  // captured as deferred values, including templates inside array slots.
  const create =
    deferred.create ?? ensureClient(getOrInitEntry(deferred.strings!), deferred.strings!);
  return create(deferred.values, watch, materializeDeferredValue);
}

function materializeDeferredValue(value: unknown, seen: WeakSet<object> | null = null): unknown {
  if (isDeferred(value)) return createDeferred(value);
  if (!Array.isArray(value)) return value;
  seen ??= new WeakSet<object>();
  if (seen.has(value)) return [];
  seen.add(value);
  // Client factories accept flat arrays of Nodes/scalars. Flatten here while
  // preserving null/false/zero semantics and avoiding cyclic-array recursion.
  return value.flatMap((item: unknown) => materializeDeferredValue(item, seen));
}

// control.ts (the `each()` / `match()` runtimes) register their adoption
// helpers here when capturing a hydration handle via
// setInflateDeferredEach / setInflateDeferredMatch.
// The thunk indirection avoids a static `compile.ts → control.ts` import
// cycle (control.ts already imports `inflateDeferred` from this module).
type InflateDeferredFn = (deferred: unknown, contNodes: Node[], closeMarker: Node) => void;

let _inflateDeferredEach: InflateDeferredFn | null = null;
let _inflateDeferredMatch: InflateDeferredFn | null = null;

/** @internal — called by control.ts before returning an each() hydration handle. */
export function setInflateDeferredEach(fn: InflateDeferredFn): void {
  _inflateDeferredEach = fn;
}

/** @internal — called by control.ts before returning a match() hydration handle. */
export function setInflateDeferredMatch(fn: InflateDeferredFn): void {
  _inflateDeferredMatch = fn;
}

function inflateDeferredEachThunk(deferred: unknown, contNodes: Node[], closeMarker: Node): void {
  /* v8 ignore start -- each() registers before returning a hydration handle */
  if (!_inflateDeferredEach) {
    throw new Error('[Purity] inflateDeferredEach not registered (control.ts not loaded)');
  }
  /* v8 ignore stop */
  _inflateDeferredEach(deferred, contNodes, closeMarker);
}

function inflateDeferredMatchThunk(deferred: unknown, contNodes: Node[], closeMarker: Node): void {
  /* v8 ignore start -- match() registers before returning a hydration handle */
  if (!_inflateDeferredMatch) {
    throw new Error('[Purity] inflateDeferredMatch not registered (control.ts not loaded)');
  }
  /* v8 ignore stop */
  _inflateDeferredMatch(deferred, contNodes, closeMarker);
}

const SUSPENSE_MARKER = /^\/?s:\d+$/;

function isSuspenseMarker(node: Node): boolean {
  return node.nodeType === 8 && SUSPENSE_MARKER.test((node as Comment).data);
}

function stripSuspenseMarkers(target: Node): void {
  // Single linear sweep over direct children — removes any `<!--s:N-->` /
  // `<!--/s:N-->` comments regardless of position. Today's emitters only
  // wrap (edge markers), but interior pairs can arise from SSR drift or a
  // nested boundary whose unwrap was lossy. Stripping them defends the
  // cursor walk in the compiled hydrate factory (which would otherwise
  // mis-step onto a suspense marker and either warn or break).
  let n = target.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (isSuspenseMarker(n)) target.removeChild(n);
    n = next;
  }
}

/**
 * Get the compiled factory for a template — used by each() to bypass
 * mapFn overhead for subsequent items. Clone + bind directly.
 *
 * @internal
 */
export function getCompiledFactory(strings: TemplateStringsArray): CompiledFn {
  const entry = getOrInitEntry(strings);
  return ensureClient(entry, strings);
}

/** @internal */
export { watch as _watch } from '../signals.ts';

// Re-export hydration helpers for callers (hydrate(), Custom Element
// connectedCallback) that need to toggle the mode without importing the
// hydrate-runtime module directly.
export {
  disableHydrationTextRewrite,
  disableHydrationWarnings,
  enableHydrationTextRewrite,
  enableHydrationWarnings,
  enterHydration,
  exitHydration,
  isDeferred,
  isHydrating,
} from './hydrate-runtime.ts';
export type { DeferredTemplate } from './hydrate-runtime.ts';
