// ---------------------------------------------------------------------------
// SSR html`` tag — compiles templates with generateSSR (string-rendering)
// instead of generate (DOM-rendering). Drop-in replacement for the client
// `html` tag exported by @purityjs/core when running in a Node SSR build.
//
// Per-template caching uses the same WeakMap-keyed-by-strings pattern as the
// client compiler, so each unique template literal is parsed and codegen'd
// exactly once per process.
// ---------------------------------------------------------------------------

import {
  generateSSR,
  parse,
  type SSRHelpers,
  ssrHelpers,
  type SSRHtml,
} from '@purityjs/core/compiler';

type SSRCompiledFn = (values: unknown[], helpers: SSRHelpers) => SSRHtml;

const cache = new WeakMap<TemplateStringsArray, SSRCompiledFn>();

/**
 * Server-side counterpart of `@purityjs/core`'s `html` tag. Returns a
 * branded SSR HTML wrapper. The compiled factory itself wraps via
 * `_h.mark(...)` so this entry point is a thin parse + cache layer.
 *
 * In SSR Vite builds (PR 6) the plugin AOT-compiles `html\`\`` calls
 * directly to the factory output, so this runtime function is only used
 * in unit tests and SSR-without-Vite scripts.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SSRHtml {
  let compiled = cache.get(strings);
  if (!compiled) {
    const ast = parse(strings);
    const code = generateSSR(ast);
    compiled = new Function(`return ${code}`)() as SSRCompiledFn;
    cache.set(strings, compiled);
  }
  return compiled(values, ssrHelpers);
}
