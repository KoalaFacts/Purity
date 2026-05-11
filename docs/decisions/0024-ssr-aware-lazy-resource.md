# 0024: SSR-aware `lazyResource.fetch()` — register pending promises with multipass

**Status:** Accepted
**Date:** 2026-05-11

## Context

`resource()` already participates in the SSR multipass cycle: when
called inside a `renderToString` / `renderToStream` / `renderStatic`
pass, it pushes its fetcher's promise onto
`ssrCtx.pendingPromises` and stashes the resolved value in
`ssrCtx.resolvedDataByKey` (or the positional `resolvedData` for
unkeyed instances). The renderer awaits the pending set between
passes; pass 2 reads the cached value and renders synchronously.

`lazyResource()` is built on top of `resource()`:

```ts
export function lazyResource<T, A = void>(fetcher, options) {
  const argsState = state<{ value: A } | null>(null);
  const r = resource(
    () => argsState(), // ← source = argsState; null skips fetch
    (wrapped, info) => fetcher(wrapped.value, info),
    options,
  );
  r.fetch = (a: A) => argsState({ value: a });
  return r;
}
```

The lazy gate (`argsState` starts null → `resource()` sees falsy
source → skip) is the whole point: nothing fetches until the user
calls `.fetch(args)`. But on the server this is a silent footgun:

- Pass 1: `resource()` sees `argsState()` is null → `skip = true` →
  no promise registered.
- User code calls `r.fetch(args)`. This sets `argsState`, queues a
  microtask to fire the reactive watch. **The SSR pass returns
  before the microtask flushes.**
- Renderer awaits `pendingPromises` (still empty), assumes nothing
  to wait for, ships the synchronous pass-1 markup — which is the
  suspense fallback because `r.data()` was still `initialValue`.

The `examples/ssr/` manifest migration hit this directly. The
user-land composer pattern

```ts
const stack = lazyResource(() => loadStack(entry, params));
stack.fetch();
return suspense(
  () => when(() => stack.data(), Stack),
  () => fallback,
);
```

ships the fallback on every SSR response. ADR 0023 made `when()`
SSR-safe, but the underlying resource doesn't block the renderer.
Hand-waved past in ADRs 0020-0022; documented as a Migration
Finding in the handoff. This ADR closes it.

## Decision

**When `r.fetch(args)` is called inside an SSR render context,
bypass the argsState/watch plumbing and engage the SSR multipass
path directly.** Fire the fetcher synchronously, push the resulting
promise onto `ssrCtx.pendingPromises`, and cache the resolved value
in `ssrCtx.resolvedDataByKey`. On the second pass, the same
`r.fetch(args)` call sees the cached value and writes it through
`r.mutate()`. Outside SSR, the existing argsState-based behavior is
unchanged.

```ts
// User-side, unchanged:
const stack = lazyResource(() => loadStack(entry, params), {
  key: `route:${entry.pattern}`, // required for SSR support
});
stack.fetch();

// Now correctly blocks the SSR renderer until loadStack resolves.
// Pass 2 sees the resolved factory; the view renders with real data.
```

Concretely:

- **A `key` option is required for SSR registration.** Without
  one, the lazy fetch silently falls back to the existing
  client-only behavior (argsState gate, no SSR registration).
  Positional indices (`resourceCounter`) don't work here: the
  `resource()` underneath ran during creation when argsState was
  null and incremented the counter for itself; reusing that
  index for the lazy fetch would collide.
- **Behavior under the SSR path:**
  - **Pass 1** — key absent from `ssrCtx.resolvedDataByKey`. Call
    `fetcher(args, { signal })` (a fresh `AbortController` is
    created — the abort never fires during SSR but the signature
    is preserved). Wrap in `Promise.resolve(…)` so sync returns
    are handled. Push the promise onto `pendingPromises`. The
    promise's `.then` writes `ssrCtx.resolvedDataByKey[key] =
value` (and the `Errors` mirror on rejection).
  - **Pass 2** — key present in `ssrCtx.resolvedDataByKey`. Call
    `r.mutate(value)` immediately so the lazyResource's `data`
    accessor returns the resolved value within the synchronous
    pass. The argsState write is skipped (it would fire the
    client watch, which is harmless but redundant).
- **Outside SSR** — unchanged. `argsState({ value })` fires the
  reactive watch; `resource()` underneath runs its fetcher; the
  client navigates / reads `r.data()` reactively.
- **Errors propagate.** On pass 1 rejection, the error is stored
  in `ssrCtx.resolvedErrorsByKey[key]` parallel to `resource()`'s
  existing behavior. Pass 2 calls `r.mutate(undefined)` and the
  resource's `error()` accessor surfaces the cached error
  through the same mechanism `resource()` uses.

### Explicit non-features

- **No automatic key generation.** Apps that want SSR support
  pass `key`. Generating a stable key from the fetcher function's
  source / identity would work for unique closures but breaks
  when the same lazyResource is created in multiple call sites
  (e.g. inside a route-iteration loop), so explicit keys are
  the only contract that scales. Documented; consistent with
  `resource()` advice from ADR 0004.
- **No retroactive registration.** If the user creates a
  `lazyResource` but doesn't call `.fetch()` during the SSR
  pass, no promise is registered. That matches the lazy contract
  — the framework can't fetch on the user's behalf.
- **No streaming-fetcher support.** The fetcher returns `T |
Promise<T>`. Async iterators / ReadableStreams aren't recognised.
  Apps that need streaming use `suspense()` (ADR 0006) inside the
  component, not loader-style pre-fetch.
- **No cross-resource dependency tracking.** Each lazyResource is
  registered independently. The renderer awaits `Promise.all`;
  resources can't declare "wait for resource X before starting."
  Sequential dependencies happen inside one fetcher (await the
  earlier value, then derive).
- **No abort during SSR.** The `AbortController` is created so
  the fetcher's signature is consistent across server + client,
  but `signal.aborted` never flips on the server. The renderer
  always awaits to completion; SSR doesn't "navigate away" mid-
  render the way the client does.
- **No `args` snapshot caching across passes.** The args passed
  to `.fetch()` on pass 1 are the args used; pass 2's call has
  no way to express a different intent because the cache lookup
  is key-only. Apps that want re-fetch on changed args use
  `resource(sourceFn, fetcher)` instead — that's what it's for.

## Consequences

**Positive:**

- Closes gap 2 from the manifest migration. The user-land
  manifest-driven composer can stop using static imports — the
  per-route lazy `importFn()` works end-to-end on both server
  and client.
- Symmetry with `resource()`. Both primitives now block the SSR
  renderer the same way; the user picks `resource` for declarative
  data + `lazyResource` for imperative refetch without a
  different SSR story.
- Composes with ADR 0023. The user's `when(() => stack.data(),
…)` pattern (made SSR-safe by 0023) now sees `stack.data()`
  return real values on pass 2; the SSR markup includes the
  resolved view, not the suspense fallback.
- ~30 LOC of new code; one new code path inside `r.fetch()`. No
  new exports.

**Negative:**

- SSR support is opt-in via the `key` option. Apps that forget
  to pass a key (or use a non-unique key) will see the same
  ships-fallback behavior they did before. Documented; the
  alternative (auto-generated keys) is worse on every dimension.
- The lazy gate's "nothing fires until `.fetch()`" semantics
  shifts slightly: on the server, `.fetch()` synchronously
  starts the fetcher and pushes a promise. The user sees no
  observable difference (the resource's `.data()` accessor is
  still `undefined` until the promise resolves) but the timing
  changes for instrumentation.
- One more synchronous fetcher call per pass-1 `.fetch()`.
  Negligible — the fetcher would have run on the client anyway;
  this just moves the start to the SSR render frame.

**Neutral:**

- No new exports. `lazyResource` keeps its existing signature.
  The `key` option already exists on `ResourceOptions<T>` (ADR
  0004); this ADR extends its responsibility from "client cache
  key for hydration" to "SSR multipass cache key + hydration".
- Tests cover both pass-1 (promise registration) and pass-2
  (cached-value mutate) paths, plus the error mirror.
- The example `examples/ssr/src/app.ts` migration documented in
  the handoff can now drop its static-import workaround. Done
  in a follow-on edit to this ADR's commit.

## Alternatives considered

**Auto-register on creation, not on `.fetch()`.** Run the fetcher
during `lazyResource(...)`'s synchronous body and push the promise
immediately. Rejected: defeats the lazy contract — apps would
fetch data they never use, especially in code paths where the
resource is conditionally returned (e.g. inside a `matchRoute`
loop's else branches).

**Eagerly resolve `argsState` and let the existing `resource()`
SSR path handle it.** Make `r.fetch(args)` flush the microtask
queue synchronously so the watch fires within the SSR pass.
Rejected: synchronous flushing isn't safe — it can reorder
unrelated reactive updates and breaks debouncing / batching
invariants. The existing `resource()` SSR registration would
fire correctly but only after a fragile global state mutation.

**Introduce a separate `ssrLazyResource(fetcher, opts)` primitive
and leave `lazyResource` alone.** Two names, two test surfaces,
same fetcher signature. Rejected: forces the user to know which
to pick. The "register with SSR if SSR context is active" check
is the same one-line dispatch that closed ADR 0023 — applying it
to lazyResource costs nothing and avoids API duplication.

**Add an `ssrAwait(promise)` primitive that pushes a promise onto
`pendingPromises` regardless of which resource owns it.** Lets
users wire SSR-aware behavior into any async machinery, not just
lazyResource. Rejected for Phase 1: the framework can't know how
to thread the resolved value back into the user's render without
the resource's signal plumbing. `ssrAwait` would only block the
renderer, not feed the result anywhere — apps would re-fetch in
the component to get the resolved value back. Net loss.

**Require an explicit `ssrAwait: true` option on `lazyResource()`.**
Make SSR registration opt-in twice — once via `key`, once via
the flag. Rejected: noise. Having `key` set + being inside an SSR
context is unambiguous intent.

**Auto-generate the key from the fetcher's source string.** The
fetcher function's `.toString()` could seed a hash. Rejected:
fragile (different bundlers minify differently, JS engines might
de-duplicate identical strings into one reference, identical
fetcher bodies at different call sites collide). Explicit `key`
remains the only correct contract.
