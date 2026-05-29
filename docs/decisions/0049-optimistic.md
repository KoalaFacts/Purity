# 0049: `optimistic()` — optimistic-update server-action wrapper

**Status:** Proposed

## Context

ADR 0012 ships `serverAction(url, handler)`: register a handler at a
URL; get back `{ url, invoke(body, init) }`. The handler is
`(Request) => Promise<Response>` — a deliberately low-level shape
that maps directly to HTML form posts and `fetch`.

ADR 0048 ships `query()` + `invalidateQuery()`: a shared SWR cache
keyed on `QueryKey`.

The mutation half of the loop is still hand-rolled in every app:

```ts
// Without optimistic():
async function rename(id: number, name: string) {
  const userQ = query({ key: ['user', id], fetcher });
  const prev = userQ.peek();
  userQ.mutate((cur) => (cur ? { ...cur, name } : cur)); // optimistic
  try {
    const res = await saveUser.invoke(JSON.stringify({ id, name }));
    if (!res.ok) {
      userQ.mutate(prev); // rollback
      throw new Error(`HTTP ${res.status}`);
    }
    invalidateQuery(['user', id]);
    return res;
  } catch (err) {
    userQ.mutate(prev); // rollback
    throw err;
  }
}
```

Every mutation site re-implements snapshot → mutate → fire →
invalidate-on-success → rollback-on-error. It's also the most
common place to forget the rollback path. This ADR ships the
wrapper.

## Decision

**Add `optimistic()` to `@purityjs/core`:**

```ts
export interface OptimisticOptions<TArgs> {
  /** Serialize typed args into the request body. */
  body: (args: TArgs) => BodyInit | null;
  /**
   * Apply optimistic local state synchronously before the request fires.
   * Return a rollback thunk; void = no rollback to perform.
   */
  apply?: (args: TArgs) => (() => void) | void;
  /**
   * Queries to invalidate when the response is treated as success.
   * Static array or a function over args + response.
   */
  invalidates?: QueryKey[] | ((args: TArgs, response: Response) => QueryKey[] | void);
  /**
   * Called after settle. Receives the response (on resolve) OR the
   * thrown error (on reject) — never both.
   */
  onSettle?: (args: TArgs, response: Response | undefined, error: unknown | undefined) => void;
  /**
   * Extra RequestInit applied to the underlying `serverAction.invoke()`.
   * A function form lets the init depend on the args.
   */
  init?: RequestInit | ((args: TArgs) => RequestInit);
  /**
   * Decide whether the response counts as "success" — drives invalidation
   * and rollback. Default: `(res) => res.ok`.
   */
  isSuccess?: (response: Response) => boolean;
}

export interface OptimisticAction<TArgs> {
  /** Same URL as the underlying serverAction. */
  url: string;
  /** Typed entry-point. Returns the underlying Response. */
  invoke(args: TArgs): Promise<Response>;
}

export function optimistic<TArgs>(
  action: ServerAction,
  options: OptimisticOptions<TArgs>,
): OptimisticAction<TArgs>;
```

### Execution order

`invoke(args)` runs the following sequence:

1. **Compute body + init** — `body(args)` and (if `init` is a
   function) `init(args)`. Done _before_ `apply` so a throwing
   serializer (circular structure, bad input) bails before any
   optimistic mutation — a doomed request never strands the UI in an
   optimistic state with no rollback.
2. **`apply(args)`** — synchronous. Capture the rollback thunk (or
   `undefined`). The UI sees the optimistic change immediately.
3. **`action.invoke(body, init)`** — fire the request.
4. **On `Response`:**
   - If `isSuccess(response)` (default: `response.ok`):
     - Resolve `invalidates(args, response)` if it's a function;
       call `invalidateQuery(key)` for each key.
     - Call `onSettle(args, response, undefined)`.
     - Return the response.
   - Else (treated as failure):
     - Call the rollback thunk if present.
     - Call `onSettle(args, response, undefined)`.
     - Return the response (no throw — same as `fetch`).
5. **On reject** (network error / abort):
   - Call the rollback thunk if present.
   - Call `onSettle(args, undefined, error)`.
   - Re-throw.

### Why a typed-args wrapper, not raw `(body, init)`

`serverAction.invoke()` accepts `BodyInit | null` — a raw
`FormData` / `Blob` / `string`. Every optimistic site needs to
parse those bytes back into a typed shape to compute the local
mutation. Forcing the wrapper to do the same parse is busywork.
Taking `TArgs` lets `apply` / `invalidates` / `onSettle` work on
the structured data and `body` does the serialization once.

This is the same trade-off `serverAction` itself made for the
handler side (you get a `Request`, you call `await req.json()` or
`await req.formData()` yourself); `optimistic()` adds the matching
typed entry point on the client side.

### Why rollback-as-thunk, not `onMutate` / `onError` split

The React Query precedent splits "snapshot before mutate" and
"restore on error" because their hook model needs lifecycle slots.
We don't — `apply` runs synchronously and returns a closure that
captures whatever state it needs. The thunk shape is tighter (one
callback, one return value, both colocated) and avoids the
"snapshot is `unknown`, cast it" pattern.

### Why `isSuccess` defaults to `response.ok`

The most common server-action shape is JSON over POST with
standard status codes; `res.ok` (200–299) cleanly separates "the
mutation landed" from "the server rejected it." Apps with
nonstandard conventions (e.g. 200 with `{ error: ... }` in body)
override `isSuccess` to inspect the body — but that requires
reading the body, which the wrapper can't do without consuming it.
**Documented limitation**: `isSuccess` only sees the `Response`
headers + status; body inspection happens in the caller after
`invoke` resolves.

### Explicit non-features

- **No automatic invalidation on failure.** Some libs invalidate
  after error too, to force a refresh to authoritative state.
  Skipped for v1: rollback already restores the snapshot, and a
  network failure usually means there's nothing new to fetch.
  Apps that want post-error refresh call `invalidateQuery(...)`
  in `onSettle`.
- **No optimistic-mutation queueing.** Concurrent `invoke()` calls
  each capture their own rollback. If two updates race and the
  first fails, rolling back the first restores its snapshot
  (potentially clobbering the second's optimistic state). This is
  the standard optimistic-UI failure mode; apps that need
  transactional consistency don't optimistic-update.
- **No body-aware `isSuccess`.** The default reads
  `response.status`. Inspecting JSON bodies would consume the
  stream, blocking the caller's own read. Out of scope.
- **No retry.** The wrapper does not auto-retry failed requests.
  Use `resource()`'s `retry` option for that pattern, or wrap
  the action yourself.
- **No abort signal threading.** v1 takes `init` as the escape
  hatch — pass `{ signal }` if you need it. A first-class
  `AbortController` integration is a follow-up.

## Consequences

**Positive:**

- Closes the SWR loop. `query()` (read side, ADR 0048) +
  `optimistic()` (write side, this ADR) = the standard pattern,
  shipped, no boilerplate.
- The rollback-as-thunk shape is honest about the contract:
  whatever you mutated in `apply`, your thunk un-mutates.
- Decoupled from `query()` at the type level. Apps that use
  `resource()` directly can still use `optimistic()` — their
  `apply` calls `someResource.mutate(...)`, returns a thunk that
  restores. The `invalidates` option is the only `query()`
  touch-point.
- ~150 LOC + ~100 LOC tests. Tree-shakes when unused.

**Negative:**

- API surface gains one function + three types
  (`OptimisticOptions<TArgs>`, `OptimisticAction<TArgs>`, plus
  inherits `ServerAction` / `QueryKey`). Cost mitigated by the
  same grouping argument as the other writer-side helpers:
  one shape per use case.
- `apply` is synchronous-only. Mutations that need an async
  derivation before applying (e.g. compute optimistic value from
  the server's current state via `fetch`) don't fit. Documented;
  apps that need async-derived optimistic state compute the
  value before calling `invoke`.
- The "no body-aware `isSuccess`" limitation will bite apps with
  legacy `{ ok: false, error: ... }`-in-200 conventions. Worth
  a follow-up if it shows up.

**Neutral:**

- New exports: `optimistic`, `OptimisticOptions<T>`,
  `OptimisticAction<T>`.
- Bundle delta: ~400 bytes gzipped (estimate).
- Tests cover: apply + commit on success, rollback on error,
  rollback on `!ok` response, custom `isSuccess`, static and
  function-form `invalidates`, `init` as object and function,
  `onSettle` on both paths, no-apply case, no-invalidates case.

## Alternatives considered

**Bake `optimistic` into `serverAction()` as `serverAction(url,
handler, { optimistic: true })`.** Rejected: the wrapper composes
on the call site, not the registration site. The handler doesn't
know which queries to invalidate; the callers do.

**Use the `onMutate` / `onError` / `onSuccess` lifecycle split
from React Query.** Rejected: see "Why rollback-as-thunk" above.
The thunk shape is tighter and avoids the snapshot-cast pattern.

**Auto-derive `invalidates` from a `key` option** (have the user
declare which query the action mutates; auto-invalidate on
success). Rejected: action ↔ query mapping is many-to-many. A
"save user" action might invalidate `['user', id]`,
`['user-list']`, and `['recent-activity']`. The function form
of `invalidates` handles all of these without baking the wrong
abstraction.

**Make `apply` return a `Promise<() => void>`** so async derivation
fits. Rejected for v1: the whole point of optimistic UI is the
synchronous local change. Async-derived optimistic state is a
real pattern but rare; it can compute the value outside and pass
it in to `apply` (which then runs synchronously).

**Return a `LazyResourceAccessor`-shaped object** with `.fetch()` /
`.loading()` / `.error()` / `.data()`. Rejected: the action result
is intentionally a `Response` (matching `serverAction.invoke()`),
not a parsed value. Apps that want resource-shaped post-write state
use `query()` for the read side after the write resolves.

**Take an optional `commit?: () => void`** as the success-path
counterpart to `rollback`. Rejected: the standard pattern is
"applied state IS the committed state" — the optimistic value
matches what the server will return. Apps where success requires
_replacing_ the optimistic value with a server-derived one call
`someQuery.mutate(serverValue)` themselves in `onSettle`.
