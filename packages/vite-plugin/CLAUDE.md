# @purityjs/vite-plugin

AOT template compilation for Purity. Transforms `html` tagged templates at build time.

## What It Does

- **Template AOT compile** — finds `html`...``in user source, parses via`@purityjs/core/compiler`(separate subpath — no runtime code), generates direct`document.createElement`calls (or string-builder factories on the SSR build path), replaces the template literal with compiled output, removes`html`from imports (dead code eliminated), auto-injects`import { watch as **purity_w** } from '@purityjs/core'` once per file
- **Server-module strip (ADR 0018)** — replaces `*.server.{ts,js,tsx,jsx}` files with `export {};` in client builds (`opts.ssr !== true`); SSR builds pass through unchanged. Default-on, opt out with `purity({ stripServerModules: false })`. Handler bodies + transitive imports (DB driver, secrets, API tokens) stop shipping to the browser.
- Skips framework internals (only compiles user code)
- Emits a hand-rolled v3 source map (line-anchored — each output line maps back to the original line) so stack traces land in user source
- Reports compile failures as `[purity] file:line:col — ...` warnings via the Vite plugin context (or `console.warn` outside Vite); failed templates are left as-is so the rest of the file still builds

## File Layout

```
src/
  index.ts    — plugin export, template extraction, compilation
```

## Key Functions

- `purity(options?)` — Vite plugin factory, returns { name, enforce, transform }
- `compileTemplates(source, id)` — collects `Edit[]` for each html``, hoist insert, and `html`import strip; defers all writes to`applyEdits`
- `compileNestedTemplates(source, ctx)` — handles `html` inside `${...}` expressions
- `extractTemplateLiteral(source, pos)` — extracts strings + expression sources
- `extractExpression(source, start)` — handles nested braces, strings, templates
- `findHtmlImportEdits(code)` — emits edits to drop `html` from `@purityjs/core` imports
- `applyEdits(source, edits, lineStarts, id)` — applies sorted edits and emits the v3 sourcemap (`vlqEncode` for VLQ, `buildLineStarts` / `offsetToLineCol` for position math)

## Testing

```bash
npx vitest run
```

## Code Patterns

- Plugin runs in `enforce: 'pre'` phase
- Skips files containing `@purityjs/` or `packages/core/` paths
- Generated code uses `__purity_w__` as watch import alias
