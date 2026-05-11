# 0023: Isomorphic conditional primitives — `when` / `match` / `each` SSR auto-detect

**Status:** Accepted
**Date:** 2026-05-11

## Context

Purity ships two parallel families of control-flow helpers:

- **Client / hydration-aware**: `match()`, `when()`, `each()`. They
  build DOM via `document.createComment` and friends; from inside a
  `hydrate()` call they return deferred handles that the hydrate
  factory routes through marker-walking adoption.
- **Server-only**: `matchSSR()`, `whenSSR()`, `eachSSR()`. They emit
  string-builder output (`SSRHtml` tagged strings) suitable for the
  SSR codegen pipeline. No DOM reference.

The split predates ADR 0019's file-system manifest. While the
template compiler picks the right one inside `html` template
interpolations (SSR codegen swaps `each` → `eachSSR` and so on),
**user code outside templates always reaches for the unsuffixed
name**. The recent `examples/ssr/` migration to the file-system
manifest (ADRs 0019-0022) hit this directly:

```ts
function App() {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) {
      const stack = lazyResource(() => loadStack(entry, m.params));
      return when(
        // ← crashes on the server
        () => stack.data(),
        (Stack) => Stack(),
        () => html`<p>loading…</p>`,
      );
    }
  }
}
```

`when()` calls `document.createComment` immediately on the SSR pass
and crashes with `ReferenceError: document is not defined`. The fix
is straightforward — call `whenSSR` instead — but discoverability is
poor. Users reach for `when` first; the framework error is opaque
("`document is not defined` at line 1285 of compiled bundle"); the
fix requires reading the ADR / source / SSR docs.

The right Phase-1 step: make the unsuffixed names auto-detect the
SSR render context and dispatch to the SSR variant when present.
Existing explicit `whenSSR` / `matchSSR` / `eachSSR` keep working
(they're the canonical names the template codegen targets).

## Decision

**Add an SSR-context check to `match()`, `when()`, and `each()` that
dispatches to `matchSSR` / `whenSSR` / `eachSSR` when `getSSRRender
Context()` is non-null.** Existing `*SSR` exports stay (the template
compiler still emits them; user code that already uses them keeps
working). The unsuffixed names become **isomorphic** — safe to call
from any execution context.

The dispatch order inside `match()` (and the parallel logic in
`when()` / `each()`) becomes:

1. **Hydration mode** — `isHydrating()` → return a deferred handle
   so the hydrate factory can adopt against SSR markers (unchanged).
2. **SSR render context** — `getSSRRenderContext() !== null` → dispatch
   to the SSR variant (`matchSSR` / `whenSSR` / `eachSSR`) returning
   `SSRHtml`. **New.**
3. **Default — client DOM construction** (unchanged).

Concretely:

- **Type signature change** is additive: each function's return type
  grows `| SSRHtml`.
  - `match()`: `DocumentFragment | DeferredMatch<T>` → `DocumentFragment | DeferredMatch<T> | SSRHtml`
  - `when()`: `DocumentFragment` → `DocumentFragment | SSRHtml`
  - `each()`: `DocumentFragment | DeferredEach<T>` → `DocumentFragment | DeferredEach<T> | SSRHtml`
- **No runtime cost when not in SSR**: one extra
  `getSSRRenderContext()` call per invocation, which is a single
  module-scope variable read. Negligible vs. the surrounding
  `document.createComment` path.
- **No behavior change for explicit `*SSR` callers**: the codegen and
  any user code that imports the suffixed names continues to call
  them directly without going through the dispatch.
- **Hydration check still fires first**: `isHydrating()` precedes the
  SSR check so deferred-handle adoption (ADR 0005) keeps working in
  the hydration codepath. Hydration only ever runs on the client; the
  SSR check below it is reached only outside hydration.
- **Cases / mapFn signature compatibility**: `MatchView` (the client
  case type) is `() => Node | DocumentFragment | string`; `matchSSR`
  accepts `() => unknown`. The intersection is the client type, so
  passing client-shaped cases into `matchSSR` typechecks. Same for
  `each`'s `mapFn`.

### Explicit non-features

- **No deprecation of `whenSSR` / `matchSSR` / `eachSSR`.** The
  template codegen still emits them; the explicit names remain useful
  for code that wants a guaranteed sync `SSRHtml` return without the
  `DocumentFragment | SSRHtml` union. Keep both.
- **No SSR-aware `lazyResource`.** The `examples/ssr/` migration
  surfaced TWO gaps; this ADR addresses only the conditional-
  primitive one. `lazyResource()` not registering with the SSR
  multipass context is a separate ADR (Phase 2 of the runtime
  composer story). Without that fix, `when()` is now safe in SSR
  but the user-land async-route pattern still ships the suspense
  fallback because the resource doesn't block the renderer.
- **No `asyncRoute()` / `loaderData()` runtime helpers.** Those are
  the higher-level composer + context-data primitives the manifest
  migration's static-import workaround motivates. They depend on the
  `lazyResource` SSR fix landing first.
- **No automatic `list()` SSR dispatch.** `list()` (and its
  `listSSR` counterpart) follows the same pattern but isn't called
  from outside-template user code in the wild yet. Add when needed —
  the same dispatch line drops in trivially.
- **No `each()` mapFn return-type widening to `SSRHtml`.** Inside
  the SSR dispatch path, `eachSSR` already accepts a
  `() => unknown` mapFn. The unsuffixed `each()` still types its
  mapFn as returning `Node | DocumentFragment | string`; passing a
  function that returns `SSRHtml` (e.g. nested `html\`\`` template
  output on the server) was always allowed at runtime via the
  string branch and stays that way.

## Consequences

**Positive:**

- Closes one of the two ergonomics gaps the manifest migration
  surfaced. Users writing manifest-driven composers now reach for
  `when()` and get correct SSR behavior automatically.
- Zero breakage. Both name sets keep working; existing tests +
  examples don't change.
- Simplifies the mental model. The `*SSR` names become an
  optimization tool ("I want a guaranteed sync `SSRHtml` return")
  rather than a correctness requirement.
- Composes cleanly with ADR 0005's deferred-handle adoption — the
  hydration check keeps firing first, so client-side adoption of
  per-row / per-case SSR markers is unchanged.

**Negative:**

- Return types widen to a 3-way / 2-way union. Most call sites are
  inside `html` template interpolations where the union is consumed
  by `valueToHtml` (or the DOM-builder equivalent), which already
  handles every member. Top-level user calls that need a specific
  concrete type need a cast or pick the explicit `*SSR` variant.
- One extra function-call per invocation in the client path
  (`getSSRRenderContext()` returns null synchronously). Negligible
  but real on hot paths.
- Doesn't fully fix the manifest migration. The static-import
  workaround in `examples/ssr/src/app.ts` stays — `lazyResource`
  not registering with SSR multipass is the harder-to-fix half.

**Neutral:**

- No new exports. The change is to the bodies of three existing
  functions plus their TS signatures. The `*SSR` names already
  shipped (ADR 0005); they keep their public-API status.
- The SSR detection adds a new code path in three functions but
  doesn't add a new module / file. Tests for the dispatch live
  alongside the existing each/match/when test files.

## Alternatives considered

**Single `match` / `when` / `each` set with the SSR variants
deleted.** Cleanest from an API-surface standpoint; rejected because
the template codegen targets the explicit `*SSR` names. Renaming
those would require rewriting the compiler's call sites and breaking
any user code that already imports the SSR names (used in
`examples/ssr/src/app.ts`'s old layout via `eachSSR`).

**Compiler-time rewrite of `when` / `match` / `each` in user code
(outside `html\`\`` templates) for SSR builds.** The Vite plugin
already swaps codegen modes via `transformOpts.ssr`. Extending it to
rewrite top-level user code calls would close the gap at build time.
Rejected: the rewrite needs an AST parser pass to identify top-level
vs. inside-template calls vs. references in dead code, and gives no
benefit over the runtime dispatch which is one-line. A future ADR
can add it as an optimization if call-site overhead matters.

**Throw a clearer error in the client `when()` when `document` is
undefined.** Detect the missing global, throw `Error("when() called
during SSR — use whenSSR or import { when } from
'@purityjs/core/ssr'")`. Rejected: still requires the user to fix
each call site. Auto-dispatch is the same one-line check that
_does the right thing_ instead of just diagnosing.

**Move the SSR variants to a `@purityjs/core/ssr` subpath import.**
Forces explicit "I want SSR" via the import path. Rejected: the
codegen's SSR mode still needs to emit the names; bare-string
imports are easier to maintain than subpath imports. The ADR-0005
explicit-name convention is fine.

**Make `each()`'s SSR dispatch use `listSSR` instead of `eachSSR`
when the mapFn produces a flat list of single-tag rows.** Skip — the
detection is itself non-trivial (inspect the mapFn's return shape?
require an opt-in flag?). Apps that want `listSSR`'s codegen
optimization opt in by calling `list()` explicitly.
