# 0005: Marker-walking, non-lossy hydration

**Status:** Accepted
**Date:** 2026-05-10

## Context

ADR [0004](./0004-ssr-mvp.md) shipped the SSR MVP with **lossy hydration**:
`hydrate()` cleared the SSR-rendered children of the container and ran the
component fresh via the standard `mount()` path. SSR's main UX win — the
browser painting the initial HTML before JS loads — was preserved, but
matching content produced a brief invisible flash and mismatching content
produced a visible jump. The SSR codegen already wrapped each `${...}` slot
in `<!--[--><!--]-->` markers in preparation for this follow-up; the only
question was whether marker-walking was worth the engineering cost.

The lossy MVP was a known concession. Three things forced the issue once
the MVP shipped:

1. **DOM identity matters for any code that reaches into the DOM by
   reference.** Lossy hydration replaces SSR nodes, so any handle
   captured before hydration (third-party widget mounted server-side
   in a slot, focus state, scroll position, video playback) is silently
   broken. Users assumed hydration was identity-preserving and were
   surprised by the flash.
2. **Resource-cache priming exists for parity.** `renderToString`
   embeds resolved fetcher data so the first client render shows server
   data immediately — but lossy hydration immediately re-renders, so the
   "no flash" benefit was undermined by the rebuild itself.
3. **Implementation cost was lower than expected.** The hard part was
   nested-template scope: when an outer template embeds an inner one
   (`html\`<p>${html\`<span>${name}</span>\`}</p>\``), JS evaluates the
   inner tag _before_ the outer factory runs, so the inner has no way to
   reach the outer's SSR slot at the moment it would normally build DOM.
   The solution — return a "deferred template" thunk during hydration
   and inflate later — turned out to be a small additive change to the
   compiler (a third codegen mode, no AST changes, no parser changes).

## Decision

**Hydration walks `<!--[--><!--]-->` marker pairs against the existing
SSR DOM and attaches reactive bindings without rebuilding nodes.**
Concretely:

- A new module-scoped `isHydrating` flag is set by `hydrate()` (and by
  the DSD-aware `connectedCallback` of registered components when their
  shadow root has parser-attached content). While set, the html tag
  returns a `DeferredTemplate` thunk — `{ strings, values }` — instead
  of building DOM. The thunk lets a nested template scope its inflation
  against the _outer_ template's slot, which JS evaluation order
  otherwise prevents.
- A third codegen mode `generateHydrate(ast)` emits a factory of shape
  `(values, watch, root, inflate) => Node` parallel to the existing
  client `generate` and SSR `generateSSR`. The factory walks the SSR
  subtree using a cursor that threads through siblings: element children
  consume one DOM node, expression children consume `<!--[--> content
  <!--]-->` (variable-content) and the cursor advances past the close
  marker. Reactive bindings hook into the existing content text nodes;
  attribute/event/prop bindings install on the existing elements.
- `inflateDeferred(deferred, target)` is the runtime entry point for
  thunks. The hydrator carves a DocumentFragment out of the slot's
  marker pair, inflates the thunk against it, then re-inserts.
- Compiled hydrate factories are JIT-cached per `TemplateStringsArray`
  alongside the existing client factory (lazy — only paid for if the
  template is hydrated). The AST is shared; codegen runs once per mode.
- Custom Elements with Declarative Shadow DOM hydrate their own shadow
  tree: `connectedCallback` checks `this._shadow.firstChild`, sets
  hydration mode, runs the renderer (which now returns a thunk), and
  inflates against the existing shadow content. No upgrade-timing hook
  needed — the check is per-element and self-contained.
- Empty-container fallback: `hydrate(emptyContainer, App)` falls through
  to `mount(App, emptyContainer)`. Keeps `hydrate()` a drop-in for
  `mount()` in dev/test setups that skip SSR.

This change is internal to `@purityjs/core` and `@purityjs/ssr`; no
public API surface changes. The SSR codegen output is unchanged — the
markers were already there. Bundle impact: hydration code grows by
~500 bytes (a third codegen mode + the runtime hydrator), but is
tree-shaken from apps that don't import `hydrate`.

This decision **partially supersedes ADR 0004**: the "Lossy hydration"
bullet under "Decision" and the corresponding bullet under "Negative
consequences" no longer apply. ADR 0004's "Out of scope:
Marker-walking hydration" is now done.

## Out of scope (intentionally)

- _(closed)_ **Per-slot lossy fallback for control-flow helpers.**
  Originally listed here as out-of-scope; both halves are now done.
  - **`each()`** — `eachSSR` emits `<!--er:K-->row<!--/er-->` row
    markers (URL-encoded keys, dashes rewritten to `%2D` so `--` can
    never appear in comment data); `each()` returns a `DeferredEach`
    handle during hydration; `inflateDeferredEach` adopts SSR rows in
    place by key match before installing the reactive watch. Mismatched
    keys per row fall through to fresh DOM for that row only.
  - **`when()` / `match()`** — `matchSSR` and `whenSSR` now embed the
    rendered key in the boundary marker (`<!--m:KEY-->...<!--/m-->`).
    `match()` returns a `DeferredMatch` handle during hydration;
    `inflateDeferredMatch` parses the boundary, compares the SSR key
    against the current `sourceFn()` value, and inflates the matching
    case's `html\`\`` template against the SSR view nodes. The adopted
    nodes seed the per-case DOM cache, so toggling away and back to the
    SSR key reuses the original SSR-derived DOM. SSR-key / client-key
    drift falls through to a fresh render of the current view.

- _(superseded by [ADR 0007](./0007-text-rewrite-on-mismatch.md))_
  **Static text-content rewriting.** ADR 0005 detected text drift but
  preserved SSR bytes by default. ADR 0007 keeps that default and adds
  an opt-in `enableHydrationTextRewrite()` flag — when set, the
  hydrator overwrites the SSR `Text` node's `data` to match the
  template (same node reference, no structural change). Independent of
  warnings; combine the two flags to fix-and-log.
- **Streaming hydration.** Out of scope per ADR 0004.

## Consequences

**Positive:**

- DOM identity is preserved across hydration. Captured node references,
  focus state, scroll position, in-progress media playback, and any
  third-party DOM mutation done before hydrate now survive.
- The "invisible flash" of lossy hydration is gone for the typical
  matching-content case — there's no rebuild at all, just bindings being
  attached to existing nodes. First interaction also lands on the same
  nodes the user is already looking at.
- Resource-cache priming actually delivers what its name promises:
  server data shows immediately and _stays_, no per-frame rebuild.
- Nested templates inflate correctly. The deferred-thunk mechanism makes
  a template embedded inside another template's expression slot work
  across the SSR/hydrate boundary without changing how the html tag is
  called.

**Negative:**

- Hand-rolled SSR markup must include the `<!--[--><!--]-->` marker
  pairs. Anyone who was building SSR strings outside `renderToString`
  and relied on lossy hydration to "fix" it must now emit markers or
  pre-clear the container. Tests that staged SSR-style markup without
  markers had to be updated (this PR updates `hydrate.test.ts` and
  `hydrate-resource.test.ts`).
- The compiler now has three codegen modes (`generate`,
  `generateSSR`, `generateHydrate`) instead of two. The new mode shares
  the AST + parser but adds ~120 lines to `codegen.ts`. The third
  factory is JIT-compiled lazily, so client-only apps pay zero cost.
- Control-flow slots (`each` / `when` / `match`) remain per-slot lossy.
  The surrounding tree is preserved but the list/conditional itself
  rebuilds on first render. Acceptable for now; full reconciliation is
  a follow-up.

**Neutral:**

- The html tag now sometimes returns a `DeferredTemplate` object instead
  of a Node. User code that captures the return value into a slot (the
  typical case) is unaffected — the hydrate factory recognizes the
  brand. Code that captures and _manipulates_ the return value (e.g.
  appends it manually with `appendChild`) wouldn't work during
  hydration anyway, since it'd duplicate the SSR DOM.
- The DSD-aware Custom Element constructor path is unchanged; only the
  `connectedCallback` learns to enter hydration mode when the shadow
  root already has children.

## Implementation summary

Single PR, scope:

| File                                            | Change                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/core/src/compiler/hydrate-runtime.ts` | New — `isHydrating` flag, `DeferredTemplate` brand, `enter`/`exit` (refcounted), `makeDeferred`      |
| `packages/core/src/compiler/codegen.ts`         | Added `generateHydrate(ast)` (cursor-walks the SSR DOM, mirrors client codegen's slot semantics)     |
| `packages/core/src/compiler/compile.ts`         | Cache entry now holds AST + client factory + hydrate factory; `inflateDeferred` runtime entry        |
| `packages/core/src/component.ts`                | `hydrate()` rewritten to inflate against existing children (with empty-container `mount()` fallback) |
| `packages/core/src/elements.ts`                 | `connectedCallback` enters hydration mode when shadow root already has children                      |
| `packages/core/tests/hydrate.test.ts`           | Rewritten to assert SSR-DOM identity preservation across hydration                                   |
| `packages/core/tests/hydrate-resource.test.ts`  | Updated SSR fixtures to include `<!--[--><!--]-->` markers                                           |
| `packages/core/tests/hydrate-mismatch.test.ts`  | Covers `enableHydrationWarnings()` + the top-level catch + fresh-mount recovery path                 |
| `packages/ssr/tests/hydrate-parity.test.ts`     | End-to-end SSR → hydrate parity (renderToString output, then hydrate, asserts node identity)         |
| `docs/decisions/0005-non-lossy-hydration.md`    | This document                                                                                        |

**Test count:** 466 core + 57 ssr + 85 vite-plugin = 608 passing
(net +15 vs ADR 0004 — SSR parity tests + mismatch warning tests +
static text-content drift tests).

### Mismatch warnings + recovery

Shipped opt-in dev diagnostics in a follow-up commit:

- `enableHydrationWarnings()` / `disableHydrationWarnings()` exported
  from `@purityjs/core`. Off by default. When on, the hydrate factory
  receives a cursor-check fn as its 5th arg and calls it before each
  consume step (text / comment / expression-`open` marker / element
  tag). Mismatches log a `console.warn` with expected vs. observed.
- `hydrate()` wraps `inflateDeferred` in a try/catch. If the walker
  goes off the rails (e.g. cursor becomes null because SSR omitted a
  marker), it logs a `console.error` and falls back to a fresh
  `mount()` so the page keeps working.
- Cost when warnings are off: one `_c && _c(...)` short-circuit per
  cursor step (single var read + truthy check). Tree-shaken from prod
  builds that never call `enableHydrationWarnings()`.

## Alternatives considered

- **Pre-walk the SSR DOM into a marker queue, then index by slot
  number.** Works but requires a separate O(n) walk before the per-
  template binding pass. The chosen cursor-based approach folds the
  walk into the existing AST traversal — same complexity, fewer
  intermediate data structures, and the cursor advances naturally
  past variable-size slot content (empty / single text / arbitrary
  subtree) without bookkeeping.
- **Always emit a placeholder text node in SSR output, even for empty
  slots, so each expression occupies exactly 3 sibling nodes.** Would
  let us reuse the client codegen's positional `firstChild`/
  `nextSibling` paths verbatim. Rejected because it adds a visible
  zero-width character (or extra empty text node) to every SSR-rendered
  reactive slot; the marker-walking approach handles variable slot
  sizes naturally.
- **Make the html tag synchronously inflate against a hydration-scope
  passed via a stack instead of returning a deferred thunk.** JS
  evaluation order forecloses this: in a nested-template expression
  the inner tag runs before the outer tag is even called, so there's
  no opportunity to push the outer's slot scope onto a stack between
  them. The thunk approach is the natural fix.
- **Defer the change to a future major version.** Rejected because the
  marker emission was already shipped in 1.0 SSR output; we can drop in
  non-lossy hydration as a behavior improvement under the same SSR API
  without a major bump.
