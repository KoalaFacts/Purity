// Client-only, no-build JIT: keep the hydration code generator outside apps
// that only mount fresh DOM. SSR/hydration apps must use ./jit instead.
import { watch } from '../signals.ts';
import { generateLinked } from './codegen.ts';
import { type CompiledCreateFactory, isHydrating } from './hydrate-runtime.ts';
import { parse } from './parser.ts';
import { flattenValue, swapSlot } from './value-helpers.ts';

const compiledCache = new WeakMap<TemplateStringsArray, CompiledCreateFactory>();

/**
 * Compile a template when first used on a client-only page.
 * Never returns a deferred hydration template: use @purityjs/core/jit when
 * hydrating server-rendered DOM. AOT builds remove this JIT path entirely.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Node | DocumentFragment {
  if (isHydrating()) {
    throw new Error('[Purity] @purityjs/core/jit-client cannot hydrate; use @purityjs/core/jit.');
  }
  let factory = compiledCache.get(strings);
  if (!factory) {
    const code = generateLinked(parse(strings));
    // Only source produced by the validated Purity generator is evaluated.
    // codeql[js/code-injection] — codegen.ts validates all names and literals.
    factory = new Function('__purity_fl__', '__purity_sw__', `return ${code}`)(
      flattenValue,
      swapSlot,
    ) as CompiledCreateFactory;
    compiledCache.set(strings, factory);
  }
  return factory(values, watch);
}
