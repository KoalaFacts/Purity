// ---------------------------------------------------------------------------
// Purity Compiler — JIT compiled html`` tag
//
// First call: parse → AST → codegen → new Function() → cached
// Subsequent calls: run cached function directly. Zero overhead.
// ---------------------------------------------------------------------------

import { watch } from '../signals.ts';
import { generateHydrateLinked, generateLinked } from './codegen.ts';
import {
  type CompiledCreateFactory,
  type DeferredTemplate,
  type HydrateFactory,
  isHydrating,
  type JitCompiler,
  setJitCompiler,
} from './hydrate-runtime.ts';
import { parse } from './parser.ts';
import { flattenValue, swapSlot } from './value-helpers.ts';

// Generated code references the value helpers as free names; bind them here.
const bindHelpers = (code: string) =>
  new Function('__purity_fl__', '__purity_sw__', `return ${code}`)(flattenValue, swapSlot);

interface CacheEntry {
  ast: ReturnType<typeof parse> | null;
  client: CompiledCreateFactory | null;
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

function ensureClient(strings: TemplateStringsArray): CompiledCreateFactory {
  const entry = getOrInitEntry(strings);
  return (entry.client ??= bindHelpers(generateLinked((entry.ast ??= parse(strings)))));
}

function ensureHydrate(strings: TemplateStringsArray): HydrateFactory {
  const entry = getOrInitEntry(strings);
  return (entry.hydrate ??= bindHelpers(generateHydrateLinked((entry.ast ??= parse(strings)))));
}

const jitCompiler: JitCompiler = { create: ensureClient, hydrate: ensureHydrate };

/**
 * Capture a JIT template during hydration. Only these deferreds need the
 * compiler to inflate, so registering it here rather than at module load
 * keeps the parser out of bundles that never use the JIT tag (a top-level
 * call would survive tree-shaking).
 */
export function makeDeferred(strings: TemplateStringsArray, values: unknown[]): DeferredTemplate {
  setJitCompiler(jitCompiler);
  // Freeze the carrier so the brand can't be flipped off and the strings/
  // values references can't be hot-swapped after capture. The arrays
  // themselves are shared by reference (the tag-array is interned by V8;
  // values is the caller's array) — freezing only the carrier is cheap and
  // closes the brand-bypass surface.
  return Object.freeze({ __purity_deferred__: true, strings, values });
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
  return ensureClient(strings)(values, watch);
}

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
