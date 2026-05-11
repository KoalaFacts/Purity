# 0035: Smart `serverAction()` body-only stripping

**Status:** Accepted
**Date:** 2026-05-12

## Context

ADR [0018](./0018-server-module-strip.md) shipped the convention-based
strip: any file matching `*.server.{ts,js,tsx,jsx}` is replaced with
`export {};` in client bundles. This is the safe default — users who
want to share an action URL between client and server keep the URL in a
non-server module.

ADR 0018 explicitly deferred the smart variant:

> **Approach #2 — Smart serverAction transform** (Next App Router
> `"use server"`): bundler parses each `serverAction(url, handler)`
> call and replaces just the handler body with an empty stub,
> preserving the action object's other exports (`url`, `invoke`).
> More complex; preserves the "client imports the action" pattern.

Two motivations to revisit it now:

1. **Defense-in-depth.** ADR 0018 is opt-in via a filename convention.
   A user who calls `serverAction()` from a regular `.ts` file (route
   module, mixed server/client utility, accidental import boundary
   violation) ships the handler body to the browser. The smart strip
   catches that case automatically.
2. **Mixed-file ergonomics.** Some apps want a single route module to
   export both a route component and the `serverAction()` it calls.
   The component is client-relevant (hydration, navigation, event
   handlers); the action handler is not. ADR 0018 forces the user to
   split the file. The smart strip lets the file stay intact.

The two strips compose cleanly: `*.server.ts` files short-circuit the
transform pipeline and never reach the per-call pass; non-server files
get the per-call pass on top of regular `html\`\`` AOT compilation.

## Decision

Add `stripServerActions: boolean` (default `true`) to the Vite plugin.
In client builds (`opts.ssr !== true`), the transform parses each
non-server-convention file with `oxc-parser` and replaces the second
argument of every `serverAction(url, handler)` call with a stub
thrower:

```ts
() => {
  throw new Error(
    '[Purity] serverAction handler is server-only ' +
      '(stripped from client bundle by @purityjs/vite-plugin — ADR 0035). ' +
      'Call action.invoke() instead, or move the call to a *.server.ts module.',
  );
} /* @purity stripped */;
```

The stub is a function expression in the same syntactic position the
handler occupied, so the surrounding `serverAction(url, handler)` call
type-checks unchanged. `.url` and `.invoke()` are unaffected — the
client-side helper that posts to `action.url` keeps working. The
handler body and its server-only imports stop shipping (the imports
fall away under standard tree-shaking once nothing references them).

Detection rules — defense-in-depth, not a security guarantee:

- **Import-bound.** Only calls whose callee resolves to `serverAction`
  imported from `@purityjs/core` are stripped. Aliases
  (`import { serverAction as sa }`) and namespace imports
  (`import * as p from '@purityjs/core'; p.serverAction(...)`) both
  work; calls of an unrelated `serverAction` from another module are
  left alone.
- **Inline handlers only.** `ArrowFunctionExpression` and
  `FunctionExpression` arguments are stripped. Identifier references
  (`serverAction(url, handlerVar)`) are left alone — the binding may
  be reused elsewhere in the file. Users with a non-inline handler
  fall back to the `*.server.ts` convention.
- **Cheap precheck.** Files that don't textually mention both
  `@purityjs/core` and `serverAction` skip the parser entirely. The
  parser cost is paid only on actual hits.

Implementation lives in
`packages/vite-plugin/src/server-action-strip.ts`. The transform
runs before `html\`\`` AOT compilation; the rewritten source flows
through the existing template pipeline unchanged.

## Why oxc-parser

The plugin had no JS-parser dependency before this. Candidates:

- **`acorn`** — small but ESM-only, no TypeScript. Would need a
  separate strip pass to handle TS syntax.
- **`@swc/core` / `swc-wasm-typescript`** — fast Rust, but a large
  install footprint relative to the helper's needs.
- **Carve out esbuild's parser** — couples to esbuild's private
  surface; brittle across Vite upgrades.
- **`oxc-parser`** — Rust-native, ESTree-compatible JSON output,
  TypeScript-aware out of the box, same family as `oxlint` and
  `oxfmt` already in this repo's lint stack. Single dependency, no
  WASM.

`oxc-parser` wins on ecosystem fit (the repo already runs Oxc
tooling), API shape (sync `parseSync(filename, source)`, ESTree
output with `start`/`end` byte offsets), and footprint.

## Non-features (deferred)

- **Build-time URL derivation for stripped handlers.** Next-style
  stable opaque IDs that replace the user's URL with a build-derived
  one. Would let the plugin guarantee URL uniqueness across the app.
  Out of scope; users still pick their own URLs.
- **Identifier-reference stripping.** Tracking the binding flow of
  `const handler = ...; serverAction(url, handler);` and stripping
  the `handler` declaration when its only consumer is the
  `serverAction()` call. Requires use-def analysis; not worth the
  complexity for the rare pattern. Convention-based strip handles it.
- **CSRF helper / wrapper around stripped handlers.** Orthogonal to
  the strip itself; tracked under ADR 0012 non-features.
- **Auto-serialization of typed args / return.** RPC sugar over
  `serverAction()`; tracked under ADR 0012 non-features.

## Rejected alternatives

- **Strip the whole `serverAction(...)` call expression.** Removes
  `.url` and `.invoke()` from the client side, breaking the entire
  point of allowing a client-side reference to the action. Rejected.
- **Replace the handler with `null` / `undefined`.** The stub is a
  callable function so the surrounding type signature stays intact
  and any accidental call surfaces a clear error rather than a
  TypeError on `null()`.
- **Run the strip in `enforce: 'post'` instead of `'pre'`.** Would
  let other plugins see the original handler first, which is fine
  for transforms but defeats the goal of stripping before the code
  reaches the bundler-cache. Pre-stage matches ADR 0018's stripping
  point.

## Test surface

`packages/vite-plugin/tests/server-action-strip.test.ts`:

- Inline arrow handler (block + expression body) is replaced.
- Block-bodied function expression handler is replaced.
- Aliased + namespace imports resolve correctly.
- Files without a `@purityjs/core` import are skipped.
- Identifier-reference handlers are left alone.
- Multiple calls in one file all get stripped.
- TypeScript syntax (param annotations + return type) parses cleanly.
- Plugin option `stripServerActions: false` opts out.
- SSR builds pass through unchanged.
- Composes with ADR 0018 (a `*.server.ts` file is stripped whole, never
  reaches the per-call pass).
- Composes with `html\`\`` AOT compilation in non-server files.
