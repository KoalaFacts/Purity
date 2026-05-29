# 0048: `query()` — stale-while-revalidate over `resource()`

**Status:** Proposed

## Context

`resource()` (ADRs 0024 / 0026) already handles the per-component
"fetch this and react to deps" case well. What it doesn't do is the
**cross-component shared-cache** pattern: two components reading
`/users/42` simultaneously trigger two requests; navigating away and
back triggers a third; coming back from bfcache triggers a fourth.

Every app rebuilds the same wrapper:

- A module-scoped Map keyed on a serialized cache key.
- Watches on `pageVisibilitySignal`, `onlineSignal`, and
  `bfcacheRestoreSignal` (ADRs 0039 / 0041) that selectively
  refresh stale entries.
- A `staleTime` debounce so a tab-flip doesn't slam every query at
  once.
- An `invalidate(key)` escape hatch for mutations.

This is the "SWR" / "React Query" pattern. Every signals-based
framework eventually ships one, and the wrappers all converge on
the same shape. This ADR ships that shape now that the substrate
(lifecycle signals from ADR 0039, online signal from ADR 0041) is
in place.

## Decision

**Add `query()` and `invalidateQuery()` to `@purityjs/core`:**

```ts
export type QueryKey = string | readonly unknown[];

export interface QueryOptions<T> {
  /** Cache key. Same key = shared in-flight + shared data. */
  key: QueryKey;
  /** Fetcher. Called with the key and an abort-aware info object. */
  fetcher: (key: QueryKey, info: ResourceFetchInfo) => T | Promise<T>;
  /** Initial value before the first fetch resolves. */
  initialValue?: T;
  /** ms; entries younger than this skip revalidation triggers. Default 0. */
  staleTime?: number;
  /** Revalidate when the page becomes visible. Default true. */
  revalidateOnVisible?: boolean;
  /** Revalidate when the browser reports back online. Default true. */
  revalidateOnReconnect?: boolean;
  /** Revalidate on bfcache restore. Default true. */
  revalidateOnBfcacheRestore?: boolean;
}

export function query<T>(options: QueryOptions<T>): ResourceAccessor<T>;
export function invalidateQuery(key: QueryKey): void;
```

The returned accessor is **structurally identical to `ResourceAccessor`** —
no new API to learn. Components that read `query({...})()` /
`.loading()` / `.error()` / `.refresh()` / `.mutate()` are reading
the same shape as `resource()`.

### Module-level cache

`query()` keys an internal `Map<string, QueryEntry>` by
`JSON.stringify`-style serialization of the `QueryKey`. The first
call with a given key creates a `resource()` instance and the
shared entry; subsequent calls with the same key return the same
`ResourceAccessor`. This is the dedup mechanism — N components
reading `query({ key: ['user', 42] })` share one in-flight
request, one cached value, one error state.

### Revalidation triggers

The first `query()` call lazily wires three module-scoped watches
on the lifecycle signals shipped in ADR 0039 + 0041:

- `pageVisibilitySignal` — when the value flips to `'visible'`,
  iterate the cache and `refresh()` every entry whose `staleTime`
  has elapsed since `lastFetchedAt` and whose
  `revalidateOnVisible` is `true`.
- `onlineSignal` — same shape, on `false → true` transition,
  honour `revalidateOnReconnect`.
- `bfcacheRestoreSignal` — same shape, on every increment,
  honour `revalidateOnBfcacheRestore`.

Each trigger is opt-out per-entry. The defaults match the SWR
convention: revalidate aggressively in the foreground, never in
the background.

### `staleTime` semantics

`staleTime` is a **trigger debounce**, not a TTL. An entry is
"fresh" for `staleTime` ms after the last successful fetch.
Within that window, the revalidation triggers skip the entry.
Outside the window, the next trigger refreshes it. Reads always
return the cached value immediately — there's no
"this query is stale, await first" behaviour. That stays as
`resource()`'s `loading()` accessor for the initial fetch.

Default `staleTime` is `0` — every trigger refreshes every
matching entry. Apps that want "max once per minute" set
`staleTime: 60_000`.

### `invalidateQuery(key)`

Imperative cache-bust + refetch. Used after mutations:

```ts
const saveUser = serverAction('/api/user', async (data) => {
  /* ... */
});
await saveUser.invoke({ id: 42, name: 'X' });
invalidateQuery(['user', 42]); // mark stale + refresh
```

Resets the entry's `lastFetchedAt` to 0 and calls
`entry.resource.refresh()`. No-op if the key isn't in the cache.

### First-call-wins config

Same trade-off as ADR 0039's `broadcastSignal`. Two `query()` calls
with the same key but different options (e.g. different
`staleTime`s) — the first wins; subsequent calls reuse the
cached entry and ignore their config. Mismatches log a
`console.warn` so the silent footgun is visible in dev.

### SSR

`query()` delegates to `resource()` on the server. The SSR
streaming machinery (ADR 0006) already handles two-pass rendering
and embedded payloads — `query()` adds no SSR-specific machinery
of its own. The cache is per-request when called inside an SSR
context (we hand the key off to `resource(..., { key })` so its
existing per-context cache handles dedup); on the client, the
cache is page-lifetime.

### Explicit non-features

- **No reactive `key` in v1.** `key` is a static `QueryKey`.
  Apps with dynamic data (e.g. switching the user ID a route
  shows) call `resource(() => userId(), fetcher)` directly, or
  wrap `query({ key: ['user', userId()] })` inside a `compute`
  with the understanding that each new key creates a new cache
  entry. Reactive-key support lands in a follow-up once the
  shape is exercised.
- **No `gcTime` / cache eviction.** Entries live for the page
  lifetime. Apps that worry about memory pressure call
  `invalidateQuery(key)` themselves; v1 is "the cache only
  grows," matching the dedup-by-key behavior. Eviction is a
  follow-up.
- **No optimistic mutations / mutation queue.** Apps use
  `resourceFromQuery.mutate(next)` (inherited from
  `ResourceAccessor`) for optimistic updates and roll back in
  the server-action error handler. A dedicated `mutation()` or
  `optimistic()` helper is a separate ADR.
- **No window-focus trigger.** Only `pageVisibilitySignal`
  (visibility) — not the older `focus` event. The new
  visibility model from ADR 0039 covers the practical SWR
  "user came back to the tab" case; `focus` adds noise
  (every alt-tab cycle without leaving the tab) without
  meaningful value.
- **No subscription-aware refcounting.** Entries don't track
  how many components read them. Triggers refresh based on
  cache membership alone. Combined with no `gcTime`, this is
  intentionally simple — apps that want fine-grained control
  bypass `query()` and use `resource()` directly.

## Consequences

**Positive:**

- Closes the most-requested "we have parts but not the glue"
  loop. `resource()` + lifecycle signals + `query()` =
  production-grade SWR.
- Drop-in compatible with `resource()` — same accessor shape,
  callers don't learn a new API.
- Exercises ADR 0039 (`pageVisibilitySignal`,
  `bfcacheRestoreSignal`) and ADR 0041 (`onlineSignal`) with a
  real consumer. Validates the lifecycle-signal design under
  realistic load.
- ~250 LOC + ~150 LOC tests. Tree-shakes when unused.

**Negative:**

- Module-level cache means tests need a reset hook (`@internal
_resetQueryCache()` — same pattern as other module-state
  signals).
- First-call-wins on config is a footgun. Mitigated by dev-time
  warn on mismatch (same pattern as `broadcastSignal`).
- Static-only `key` is a real limitation for the "switching
  IDs" use case. Documented; the workaround
  (`resource()` directly) is one line. Reactive-key follow-up
  can ship without breaking the v1 API.
- The three revalidation triggers depend on the lifecycle
  signals being correct. A bug in `pageVisibilitySignal`
  surfaces as silent over-refetching across every `query()`
  caller. Bounded by the lifecycle-signal singletons' test
  coverage.

**Neutral:**

- New exports: `query`, `invalidateQuery`, `QueryKey`,
  `QueryOptions<T>`. The accessor stays `ResourceAccessor<T>`.
- Bundle delta: ~500 bytes gzipped (estimate).
- Tests cover: dedup-by-key, first-call-wins warn, three
  trigger types, `staleTime` debounce, `invalidateQuery`,
  no-trigger options, SSR delegation.

## Alternatives considered

**Build `query()` as a separate `@purityjs/query` package.**
Rejected: depends transitively on five `@purityjs/core` internals
(`resource`, lifecycle signals, online signal). Cross-package
versioning churn outweighs the ~500-byte tree-shake benefit.
Tree-shaking inside core works fine.

**Make the cache request-scoped on the client too.** Rejected: SWR's
whole point is durable cross-component cache. Request-scoping
would require app-level glue (a "QueryProvider" component
threading context) — exactly the boilerplate this ADR removes.
Module-scope page-lifetime cache is the standard shape; eviction
follow-ups address the "what about long-lived sessions" concern.

**Bake `key` into the `fetcher` signature** — `fetcher(info)`
instead of `fetcher(key, info)`. Rejected: the key is data the
fetcher almost always needs (build the URL from it, build the
request body from it). Passing it explicitly avoids the closure
juggle and matches the SWR / React Query precedent.

**Optimistic mutations + rollback in v1.** Rejected:
optimistic-update semantics deserve their own ADR. The mutation
pattern is `serverAction()` already; the missing piece is the
optimistic local update + rollback-on-error pairing, which has
its own design space (key-based invalidation vs. function-based,
multi-key invalidation, snapshot-rollback granularity). Ships in
ADR 0049 or later.

**Auto-evict entries with no readers** (refcount + GC). Rejected
for v1: per-entry refcounting needs a `WeakRef`-style or
`disposable` accessor pattern that breaks the
`ResourceAccessor` shape. Eviction policy + refcount is a
follow-up; v1 ships the cache-only-grows shape with
`invalidateQuery` as the user-driven escape hatch.

**Take a thunk for `key` (`key: () => QueryKey`) but don't track
reactivity.** Rejected: looks like reactivity but isn't.
Confusing surface; the static `QueryKey` is honest about what v1
does.
