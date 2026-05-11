# @purityjs/vite-plugin

AOT template compilation for Purity. Transforms `html` tagged templates at build time. Optionally exposes a file-system route manifest.

## What It Does

- **Template AOT compile** — finds `html`...``in user source, parses via`@purityjs/core/compiler`(separate subpath — no runtime code), generates direct`document.createElement`calls (or string-builder factories on the SSR build path), replaces the template literal with compiled output, removes`html`from imports (dead code eliminated), auto-injects`import { watch as **purity_w** } from '@purityjs/core'` once per file
- **Server-module strip (ADR 0018)** — replaces `*.server.{ts,js,tsx,jsx}` files with `export {};` in client builds (`opts.ssr !== true`); SSR builds pass through unchanged. Default-on, opt out with `purity({ stripServerModules: false })`. Handler bodies + transitive imports (DB driver, secrets, API tokens) stop shipping to the browser.
- **Smart serverAction strip (ADR 0035)** — for non-server-convention files: parses each user file with `oxc-parser`, finds `serverAction(url, handler)` calls (import-bound — direct, aliased, or namespace member), and replaces just the inline arrow/function-expression handler with a stub thrower. `.url` and `.invoke()` survive on the client; the handler body and its server-only imports are dropped via tree-shaking. Defense-in-depth on top of ADR 0018. Default-on, opt out with `purity({ stripServerActions: false })`. Cheap precheck: skip files that don't textually mention both `@purityjs/core` and `serverAction` so the parser cost is paid only on hits.
- **File-system routing (ADR 0019)** — opt-in `routes: { dir }` (or `routes: true` for `pages/`). Scans the directory and exposes a virtual `purity:routes` module exporting a sorted `RouteEntry[]`. Convention: `index.ts` → `/`, `[id].ts` → `:id`, `[...slug].ts` → `*` splat, `_*` reserved (skipped). HMR-aware via `handleHotUpdate`.
- **Layouts (ADR 0020)** — `_layout.{ts,tsx,js,jsx}` per directory inside the routes dir. Each `RouteEntry` gets a `layouts: LayoutEntry[]` field with the inherited chain (root → leaf). Composer is user-land (`reduceRight` over the array). No new plugin option — convention-discovered.
- **Error boundaries + 404 (ADR 0021)** — `_error.{ts,tsx,js,jsx}` per directory under the routes dir; `_404.{ts,tsx,js,jsx}` at the root only (Phase 1). Each `RouteEntry` gets an optional `errorBoundary?: LayoutEntry` (nearest in chain, single entry — no chained composition). The manifest gains a top-level `notFound?: LayoutEntry`. Both are emitted only when the corresponding files exist; consumers reading just `routes` keep working.
- **Data loaders (ADR 0022)** — any route or layout module exporting a named `loader` gets a `hasLoader: true` flag in the manifest. Detection is regex-based on the module source (no parser dep); recognises `export const|let|var|function loader`, `export async function loader`, `export { loader }`, `export { x as loader }`, plus TypeScript-typed forms. Plugin reads each route + layout file once per build (cached via `attachLoaderInfo`'s internal map). Component-data plumbing stays user-land for Phase 1.
- **Sibling routes.d.ts (ADR 0036)** — when `emitTo` is set, the plugin also writes a `.d.ts` next to the `.ts` (path swap: `.ts` → `.d.ts`, append for any other extension). The `.d.ts` declares the virtual `'purity:routes'` module with literal tuple types whose `importFn` is `() => Promise<typeof import('<abs>')>` per-entry, so apps that import from `'purity:routes'` get the same per-route typing surface as apps that import from the on-disk `.ts`. `LoaderDataOf<'/users/:id', typeof routes>` (ADR 0034) works against either import. Same content-equality skip as the `.ts` emit so dev-mode filesystem-watch loops stay quiet.
- Skips framework internals (only compiles user code)
- Emits a hand-rolled v3 source map (line-anchored — each output line maps back to the original line) so stack traces land in user source
- Reports compile failures as `[purity] file:line:col — ...` warnings via the Vite plugin context (or `console.warn` outside Vite); failed templates are left as-is so the rest of the file still builds

## File Layout

```
src/
  index.ts                — plugin export, template extraction, compilation, routes wiring
  routes.ts               — pure helpers: filename → pattern, sort, manifest codegen (ADR 0019)
  server-action-strip.ts  — oxc-parser-backed `serverAction()` body strip (ADR 0035)
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
