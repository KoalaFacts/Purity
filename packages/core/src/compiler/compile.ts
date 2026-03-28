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

export function html(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment | Node {
  let compiled = compiledCache.get(strings);

  if (!compiled) {
    const ast = parse(strings);
    const code = generate(ast);
    // biome-ignore lint: eval is intentional for compiled template performance
    compiled = new Function(`return ${code}`)() as CompiledFn;
    compiledCache.set(strings, compiled);
  }

  return compiled(values, watch);
}
