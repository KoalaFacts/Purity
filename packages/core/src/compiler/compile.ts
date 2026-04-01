// ---------------------------------------------------------------------------
// Purity Compiler — JIT compiled html`` tag
//
// First call: parse → AST → codegen → new Function() → cached
// Subsequent calls: run cached function directly. Zero overhead.
// ---------------------------------------------------------------------------

import { watch } from '../signals.js';
import { generate } from './codegen.js';
import { parse } from './parser.js';

type CompiledFn = (
  values: unknown[],
  watch: typeof import('../signals.js').watch,
) => Node | DocumentFragment;

const compiledCache = new WeakMap<TemplateStringsArray, CompiledFn>();

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
 *   ${each(() => items(), (item) => html`<li>${item}</li>`)}
 * `
 * ```
 *
 * @returns DOM Node or DocumentFragment.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment | Node {
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
export { watch as _watch } from '../signals.js';
