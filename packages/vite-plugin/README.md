# @purityjs/vite-plugin

**Breaking default:** `purity()` now produces strict client-only AOT. SSR clients and hydrated component libraries must explicitly use `purity({ hydratable: true })`. Runtime fallback requires `strictAot: false`. See [migration and complete-application evidence](../../docs/client-first-aot.md).

[![npm version](https://img.shields.io/npm/v/@purityjs/vite-plugin.svg)](https://www.npmjs.com/package/@purityjs/vite-plugin)
[![npm downloads](https://img.shields.io/npm/dm/@purityjs/vite-plugin.svg)](https://www.npmjs.com/package/@purityjs/vite-plugin)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@purityjs/vite-plugin?label=gzipped)](https://bundlephobia.com/package/@purityjs/vite-plugin)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

AOT template compilation for Purity. Compiles `html` tagged templates at build time into direct DOM creation code.

## Why

|                         | Runtime JIT path                         | Successfully compiled AOT path                           |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------- |
| First render            | Parse, generate code, evaluate and cache | Run precompiled DOM factory                              |
| Dynamic code generation | JIT uses `Function`                      | AOT factories and hydration walkers avoid JIT evaluation |
| Browser compiler        | Parser and code generator retained       | Compiled templates use `@purityjs/core/runtime`          |

By default, compilation failures stop the build and client output must not retain the runtime compiler. Only explicit `strictAot: false` permits nonfatal warning-and-JIT fallback.

## Install

```bash
npm install -D @purityjs/vite-plugin
```

## Setup

```ts
// vite.config.ts
import { purity } from "@purityjs/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [purity()],
});
```

This is the client-only setup. For an SSR client, use `purity({ hydratable: true })`; otherwise compiled templates do not adopt server DOM.

## What It Does

Your code:

```ts
html`<div @click=${handler}>${() => count()}</div>`;
```

Compiled output:

```js
const _e0 = document.createElement("div");
_e0.addEventListener("click", handler);
const _x0 = document.createTextNode("");
__watch(() => {
  _x0.data = String(count());
});
_e0.appendChild(_x0);
```

No runtime parsing. No `new Function()`. Direct DOM calls.

## Options

```ts
purity({
  strictAot: true, // fail compilation and reject retained client JIT code (default: true)
  hydratable: false, // opt in only for SSR clients or hydrated component libraries
  devtools: true, // opt-in reactive graph panel during vite dev only (default: false)
  include: [".ts", ".js", ".tsx", ".jsx"], // file extensions to transform (default)
});
```

The **Purity** button opens a searchable snapshot of state, computed and
effect nodes, including versions and source/observer connections. Close or
Escape stops polling and clears the snapshot. Production builds and preview
exclude the panel. See [Debugging Purity apps](../../docs/debugging.md) for details.

## Strict AOT builds

Strict AOT is the default; the explicit form is:

```ts
export default defineConfig({
  plugins: [purity({ strictAot: true })],
});
```

With `strictAot: true`, a module syntax error or a template parse/code-generation
failure stops transformation with the source filename, line and column, plus the
underlying error and a repair hint. This includes nested templates. Explicit
`strictAot: false` permits warning-and-JIT fallback for nonfatal errors;
unsupported or unsafe bindings remain fatal in either mode.

During `vite build`, strict AOT also checks every emitted **client** JavaScript
chunk. It examines the bundler's rendered module code after tree shaking and
rejects Purity's retained runtime `Function` compilation. Package ownership is
checked using `@purityjs/core` and `@purityjs/ssr` package manifests, so this covers both source
modules and bundled distribution/shared chunks, including linked packages. The
check catches an aliased JIT tag such as `import { html as template }` and source
skipped by your `include` filter. A JIT import removed by tree shaking does not
fail the build. Application strings, comments, or an unrelated application
`Function` constructor do not fail this check.

When `@purityjs/core/jit` or `@purityjs/ssr` is external, its body is unavailable to the bundler.
Strict AOT checks the emitted imports instead: retained `html`/`makeDeferred`
imports or re-exports, namespace/default imports, dynamic imports, export-all,
and CommonJS `require` calls fail. Remapped ES import paths are tracked. IIFE
output is checked using its emitted external namespace arguments and retained
compiler references, including escaped namespaces. Explicit `output.globals`
settings are preserved. For IIFE chunks retaining a compiler-bearing external
package and an emitted namespace binding, strict mode requires an explicit
`output.globals` mapping so that binding can be verified. Without one, the build
fails with a “cannot verify external binding” diagnostic: configure the mapping
or bundle the package. This check does not depend on warnings being enabled and
never changes global names. Dead imports with no retained namespace binding
pass. ES, CommonJS, UMD, and IIFE library outputs are
covered by the build regressions. A side-effect-only ES import or a named
hydration-helper import is not itself evidence of a JIT call. For namespace,
dynamic, and CommonJS imports this is deliberately conservative; use named
imports from `@purityjs/core/runtime` for compiler-free runtime helpers.

For an IIFE library that externalizes an SSR helper, for example, keep the
consumer's actual global name explicit:

```ts
build: {
  lib: { entry: 'src/library.ts', name: 'MyLibrary', formats: ['iife'] },
  rolldownOptions: {
    external: ['@purityjs/ssr'],
    output: { globals: { '@purityjs/ssr': 'puritySSR' } },
  },
}
```

This allows a retained helper such as `renderToString` while a retained `html`
compiler reference still fails. Use `rollupOptions` for Vite versions backed by
Rollup.

To fix a failure:

1. Follow the template diagnostic and correct invalid markup, unsupported
   bindings, or module syntax.
2. Use the named `html` tag from `@purityjs/core/jit` so the plugin recognizes it,
   and include the source file's extension in the `include` option. Raw container
   files need their framework plugin to expose a JavaScript/TypeScript script
   submodule.
3. Remove client calls to JIT `html`/`makeDeferred`, including calls in dependencies
   that were not compiled. Import precompiled runtime helpers from
   `@purityjs/core/runtime`. An output failure reports the chunk and the retained
   Purity module (or external JIT package).

**Server and development behavior:** strict template transformation also applies
in SSR and development, so a compilation failure still stops transformation.
The final client-output check runs only for build output; it does not inspect or
ban Vite's development dependency graph. SSR output is exempt, allowing the
server renderer to retain its legitimate parser/code-generator support. The
option enforces this Purity JIT boundary; it is not a universal CSP or security
audit of application code, other libraries, or code loaded outside the bundle.

## How It Works

1. Finds `html` tagged template literals in your source
2. Extracts template strings and expression positions
3. Parses into AST using `@purityjs/core`'s parser
4. Generates optimized JS using `@purityjs/core`'s codegen
5. Replaces the `html`...`` call with the compiled output
6. Removes `html` from imports (dead code eliminated)
7. Calls client create factories with the shared `watch` implementation by default; only `hydratable: true` emits hydration walkers and the mode-selecting runtime helper

The plugin only transforms user code — framework internals are skipped.

## License

[Apache-2.0](./LICENSE) starting with 0.5.0 (currently unreleased). Releases
through 0.4.0 remain MIT; their copyright and permission notice is retained in
[LICENSES/Purity-MIT.txt](./LICENSES/Purity-MIT.txt). Third-party components retain
their own licenses.
