// ---------------------------------------------------------------------------
// Purity Compiler — JIT compiled html`` tag
//
// First call: parse → AST → codegen → new Function() → cached
// Subsequent calls: run cached function directly. Zero overhead.
// ---------------------------------------------------------------------------

import { watch } from '../signals.ts';
import { generate, generateHydrate } from './codegen.ts';
import { parse } from './parser.ts';

type CompiledFn = (
  values: unknown[],
  watch: typeof import('../signals.ts').watch,
) => Node | DocumentFragment;

type HydrateFn = (
  values: unknown[],
  watch: typeof import('../signals.ts').watch,
  root: Element,
) => Node | null;

const compiledCache = new WeakMap<TemplateStringsArray, CompiledFn>();
const hydrateCache = new WeakMap<TemplateStringsArray, HydrateFn>();

// ---------------------------------------------------------------------------
// Hydration context
//
// `hydrate()` pushes a context that captures the next existing DOM root the
// hydrator will bind against. The `html\`\`` tag, when this context is
// active, dispatches to the cached hydrate factory instead of the render
// factory and feeds it the captured root. The factory walks the existing
// tree, installs watches in place, and returns the root unchanged — so the
// SSR-rendered DOM is preserved (no flash, no re-creation).
//
// When the hydrate factory returns null (its AST shape isn't covered by the
// Phase 1 hydrator — e.g., custom-element subtrees), the caller falls back
// to the render path. The caller is responsible for swapping the resulting
// fresh DOM into place if it does.
// ---------------------------------------------------------------------------

interface HydrationCtx {
  root: Element | null; // the next existing DOM root to bind against, or null
}

let currentHydrationCtx: HydrationCtx | null = null;

/** @internal — used by `hydrate()` to scope a single render pass. */
export function pushHydrationCtx(ctx: HydrationCtx): void {
  currentHydrationCtx = ctx;
}

/** @internal */
export function popHydrationCtx(): void {
  currentHydrationCtx = null;
}

/** @internal — true when an `html\`\`` call should attempt hydration. */
export function getHydrationCtx(): HydrationCtx | null {
  return currentHydrationCtx;
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
 * @returns DOM Node or DocumentFragment.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment | Node {
  // Hydration fast path: when hydrate() has captured a root for the next
  // html`` call, try to bind against the existing DOM in place. The ctx is
  // single-shot — consumed once, then null'd so deeper html`` calls fall
  // through to the regular render path.
  const ctx = currentHydrationCtx;
  if (ctx !== null && ctx.root !== null) {
    const root = ctx.root;
    ctx.root = null; // single-shot consume
    let hydrate = hydrateCache.get(strings);
    if (!hydrate) {
      const ast = parse(strings);
      const code = generateHydrate(ast);
      hydrate = new Function(`return ${code}`)() as HydrateFn;
      hydrateCache.set(strings, hydrate);
    }
    // null signals "shape not handled by Phase 1 hydrator" → fall through to
    // the render path. A throw signals "shape was supposed to match but the
    // SSR DOM doesn't actually conform" (e.g. wrong tag, missing children) →
    // also fall through. Either way, the caller swaps in the fresh tree.
    try {
      const result = hydrate(values, watch, root);
      if (result !== null) return result;
    } catch {
      // Drop through to render. The hydrate factory may have partially
      // mutated `root`, but the caller will replace it wholesale.
    }
  }

  let compiled = compiledCache.get(strings);

  if (!compiled) {
    const ast = parse(strings);
    const code = generate(ast);
    compiled = new Function(`return ${code}`)() as CompiledFn;
    compiledCache.set(strings, compiled);
  }

  return compiled(values, watch);
}

/**
 * Get the compiled factory for a template — used by each() to bypass
 * mapFn overhead for subsequent items. Clone + bind directly.
 *
 * @internal
 */
export function getCompiledFactory(strings: TemplateStringsArray): CompiledFn {
  let compiled = compiledCache.get(strings);
  if (!compiled) {
    const ast = parse(strings);
    const code = generate(ast);
    compiled = new Function(`return ${code}`)() as CompiledFn;
    compiledCache.set(strings, compiled);
  }
  return compiled;
}

/** @internal */
export { watch as _watch } from '../signals.ts';
