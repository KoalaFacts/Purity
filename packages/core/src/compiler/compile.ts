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
  hydrationWarningsEnabled,
  isHydrating,
  makeDeferred,
} from './hydrate-runtime.ts';
import { parse } from './parser.ts';

type CompiledFn = (
  values: unknown[],
  watch: typeof import('../signals.ts').watch,
) => Node | DocumentFragment;

type HydrateFn = (
  values: unknown[],
  watch: typeof import('../signals.ts').watch,
  root: Node,
  inflate: (deferred: DeferredTemplate, target: Node) => void,
  check: ((node: Node | null, expected: string, detail?: string) => void) | undefined,
  inflateEach: (deferred: unknown, contNodes: Node[], closeMarker: Node) => void,
) => Node;

interface CacheEntry {
  ast: ReturnType<typeof parse> | null;
  client: CompiledFn | null;
  hydrate: HydrateFn | null;
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

function ensureHydrate(entry: CacheEntry, strings: TemplateStringsArray): HydrateFn {
  if (entry.hydrate) return entry.hydrate;
  const ast = entry.ast ?? parse(strings);
  entry.ast = ast;
  const code = generateHydrate(ast);
  entry.hydrate = new Function(`return ${code}`)() as HydrateFn;
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
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): DocumentFragment | Node | DeferredTemplate {
  if (isHydrating()) {
    return makeDeferred(strings, values);
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
export function inflateDeferred(deferred: DeferredTemplate, target: Node): Node {
  stripSuspenseMarkers(target);
  const entry = getOrInitEntry(deferred.strings);
  const fn = ensureHydrate(entry, deferred.strings);
  const check = hydrationWarningsEnabled() ? checkHydrationCursor : undefined;
  return fn(deferred.values, watch, target, inflateDeferred, check, inflateDeferredEachThunk);
}

// control.ts (the `each()` runtime) registers its row-adoption helper here at
// module load via {@link setInflateDeferredEach}. The thunk indirection
// avoids a static `compile.ts → control.ts` import cycle (control.ts
// already imports `inflateDeferred` from this module).
type InflateDeferredEachFn = (deferred: unknown, contNodes: Node[], closeMarker: Node) => void;

let _inflateDeferredEach: InflateDeferredEachFn | null = null;

/** @internal — called once by control.ts during module init. */
export function setInflateDeferredEach(fn: InflateDeferredEachFn): void {
  _inflateDeferredEach = fn;
}

function inflateDeferredEachThunk(deferred: unknown, contNodes: Node[], closeMarker: Node): void {
  /* v8 ignore start -- control.ts always registers before any hydrate runs */
  if (!_inflateDeferredEach) {
    throw new Error('[Purity] inflateDeferredEach not registered (control.ts not loaded)');
  }
  /* v8 ignore stop */
  _inflateDeferredEach(deferred, contNodes, closeMarker);
}

const SUSPENSE_MARKER = /^\/?s:\d+$/;

function isSuspenseMarker(node: Node): boolean {
  return node.nodeType === 8 && SUSPENSE_MARKER.test((node as Comment).data);
}

function stripSuspenseMarkers(target: Node): void {
  while (target.firstChild && isSuspenseMarker(target.firstChild)) {
    target.removeChild(target.firstChild);
  }
  while (target.lastChild && isSuspenseMarker(target.lastChild)) {
    target.removeChild(target.lastChild);
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
  disableHydrationWarnings,
  enableHydrationWarnings,
  enterHydration,
  exitHydration,
  isDeferred,
  isHydrating,
} from './hydrate-runtime.ts';
export type { DeferredTemplate } from './hydrate-runtime.ts';
