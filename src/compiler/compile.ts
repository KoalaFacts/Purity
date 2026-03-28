// ---------------------------------------------------------------------------
// Purity Compiler — Compiled html`` tag
//
// Replaces the runtime html`` with a version that:
// 1. On first call: parses template → AST → generates optimized JS → compiles
// 2. On subsequent calls: runs the cached compiled function directly
//
// This eliminates: regex parsing, TreeWalker, marker comments, querySelector
// at the cost of one-time compilation per unique template.
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

    // Compile the generated code into a function
    // biome-ignore lint: eval is intentional for compiled template performance
    compiled = new Function('return ' + code)() as CompiledFn;
    compiledCache.set(strings, compiled);
  }

  const result = compiled(values, watch);

  // Ensure we always return a DocumentFragment for consistency
  if (result instanceof DocumentFragment) return result;
  const frag = document.createDocumentFragment();
  frag.appendChild(result);
  return frag;
}
