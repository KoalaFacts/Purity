# 0039: Persistence + lifecycle signal primitives

**Status:** Proposed
**Date:** 2026-05-28

## Context

Three categories of state today fall outside Purity's signal model
and force apps into hand-rolled event plumbing:

1. **Persisted state** — theme, layout preferences, draft form
   contents, cart snapshots. Apps either reach for an external
   "store with persist middleware," or wire `state()` to
   `localStorage` by hand inside `effect`/`watch` and re-parse on
   every read.
2. **Cross-tab state** — "log out everywhere," live unread counts,
   shared cart updates between two open tabs. Apps either ignore
   the problem (each tab drifts), or wire `BroadcastChannel`
   listeners imperatively.
3. **Page lifecycle state** — bfcache restore, visibility change,
   `freeze`/`resume`. Today `resource()` and the upcoming
   `query()` (see Consequences) have no signal-shaped way to ask
   "did the page just resume from bfcache?" and so they
   over-fetch or serve stale data.

These problems share constraints:

- The underlying browser APIs are already event-driven; lifting
  them into signals is mostly plumbing.
- All three need SSR-safe defaults — `localStorage`,
  `BroadcastChannel`, `pageshow` don't exist on the server.
- All three want to compose with `effect`, `compute`, `each()`,
  `when()`, and route loaders without callers learning a new
  subscription shape.
- Each primitive on its own is ~30-80 LOC. Bundled, they justify
  a single ADR; shipped as a set they reinforce a "lift the
  platform into signals" pattern that already shows up in
  `currentPath`, `currentSearch` (0014), and `manageTitle` (0030).

This ADR ships three primitives together and reserves namespace
for a fourth (`sharedSignal`) once the localStorage +
BroadcastChannel composition pattern is exercised in real apps.

## Decision

**Add three signal primitives to `@purityjs/core`:**

- `localSignal<T>(key, default, options?)` — `StateAccessor<T>`
  mirrored to `localStorage` (or `sessionStorage`), kept in sync
  across tabs via the `storage` event.
- `broadcastSignal<T>(channel, default)` — `StateAccessor<T>`
  whose `.set()` writes propagate to every other tab listening
  on the same `BroadcastChannel` name.
- Page lifecycle signal trio:
  - `pageVisibilitySignal(): ComputedAccessor<'visible' | 'hidden'>`
  - `pageLifecycleSignal(): ComputedAccessor<'active' | 'passive' | 'hidden' | 'frozen' | 'terminated'>`
  - `bfcacheRestoreSignal(): StateAccessor<number>` — increments
    every time the page is restored from bfcache (callers compare
    against a stashed value or use it as a `watch` dependency).

All five return existing accessor types from `signals.ts` so
they compose with `compute`, `watch`, `each()`, `when()`, and
template bindings exactly like a hand-built `state()`.

### `localSignal`

```ts
import { localSignal } from '@purityjs/core';

const theme = localSignal('theme', 'light');
theme.set('dark'); // persists to localStorage + broadcasts to other tabs

const cart = localSignal('cart', [] as CartItem[], {
  storage: 'session',
  version: 2,
  migrate: (old, oldVersion) => (oldVersion === 1 ? upgrade(old) : []),
});
```

Signature:

```ts
export interface LocalSignalOptions<T> {
  storage?: 'local' | 'session'; // default 'local'
  serialize?: (value: T) => string; // default JSON.stringify
  deserialize?: (raw: string) => T; // default JSON.parse
  version?: number; // default 0
  migrate?: (old: unknown, oldVersion: number) => T;
}

export function localSignal<T>(
  key: string,
  defaultValue: T,
  options?: LocalSignalOptions<T>,
): StateAccessor<T>;
```

Behavior:

- **Server.** Returns a `state(defaultValue)` with no storage
  side-effects. `.set()` updates the in-memory value only.
- **Client first read.** Lazily reads + deserializes from
  storage on construction. If the stored value has a different
  `version`, calls `migrate(old, oldVersion)` once and writes
  the upgraded value back.
- **Client writes.** `.set(newValue)` updates the signal, then
  writes the serialized value to storage inside a try/catch.
  Quota errors are silent in prod, logged in dev (the same
  warning channel `enableHydrationWarnings` uses).
- **Cross-tab.** A single `window` `storage` listener fans out
  to every active `localSignal` keyed by `key`. Receiving a
  `storage` event updates the signal without re-writing (no
  echo loop).
- **Hydration.** On first hydration the signal reads from
  storage before any template binding runs, so the first paint
  sees the persisted value, not the SSR default. Apps that
  must avoid flash use `when()` to gate the dependent content
  on a "hydrated" signal.

### `broadcastSignal`

```ts
import { broadcastSignal } from '@purityjs/core';

const session = broadcastSignal<Session | null>('auth', null);
session.set(null); // logs out every tab on the same origin
```

Signature:

```ts
export function broadcastSignal<T>(channel: string, defaultValue: T): StateAccessor<T>;
```

Behavior:

- **Server.** Returns `state(defaultValue)`; `.set()` is in-memory
  only. The channel is never opened.
- **Client.** Opens one `BroadcastChannel(channel)` per channel
  name, refcounted across `broadcastSignal` callers; closes when
  the last subscriber disposes. `.set(value)` updates the local
  signal and posts the value to the channel. Incoming messages
  update the signal without re-posting.
- **Serialization.** Uses structured clone (the channel's
  native format). No `JSON.stringify` — `Date`, `Map`, `Set`,
  `Uint8Array` all round-trip.
- **Late joiners.** A tab opened after a broadcast missed the
  event — `broadcastSignal` does not replay history. That's the
  motivation for the `sharedSignal` follow-up below.

### Page lifecycle signals

```ts
import {
  pageVisibilitySignal,
  pageLifecycleSignal,
  bfcacheRestoreSignal,
  watch,
} from '@purityjs/core';

const visible = pageVisibilitySignal();
const lifecycle = pageLifecycleSignal();
const bfcacheTick = bfcacheRestoreSignal();

watch([bfcacheTick], () => {
  refetch(); // runs on every bfcache restore
});
```

Signatures:

```ts
export function pageVisibilitySignal(): ComputedAccessor<'visible' | 'hidden'>;
export function pageLifecycleSignal(): ComputedAccessor<
  'active' | 'passive' | 'hidden' | 'frozen' | 'terminated'
>;
export function bfcacheRestoreSignal(): StateAccessor<number>;
```

Behavior:

- **Server.** All three return constant accessors:
  `pageVisibilitySignal()` is `'visible'`, `pageLifecycleSignal()`
  is `'active'`, `bfcacheRestoreSignal()` is `0`. No listeners
  attached.
- **Client.** Each primitive lazily registers exactly one global
  listener on first call (refcounted, removed when the last
  subscriber disposes). `pageVisibilitySignal` listens on
  `visibilitychange`; `pageLifecycleSignal` listens on `freeze`,
  `resume`, `pagehide`, `pageshow`, `visibilitychange` and
  derives the page-lifecycle state per the spec;
  `bfcacheRestoreSignal` increments only when `pageshow.persisted`
  is `true`.
- **Hydration.** Reads from `document.visibilityState` on first
  client call; no SSR/CSR drift since this state isn't
  serialized into the SSR markup.

### Explicit non-features

- **No `sharedSignal(key, default)` in this ADR.** The "persistent
  snapshot + live broadcast" composition is real, but the API
  shape — same options bag as `localSignal`? extra `channel`
  parameter? automatic channel name from `key`? — needs at least
  one app exercising both primitives to inform. Reserve the name;
  ship it in a follow-up.
- **No reactive `IndexedDB` signal.** Async reads / writes break
  the synchronous `StateAccessor` contract. Apps that need IDB
  build a `resource()` over it.
- **No revert-on-teardown for `localSignal`.** Disposing the
  signal does not delete the storage key; persistence outlives
  the signal by design. Apps that want clear-on-logout call
  `localStorage.removeItem(key)` themselves.
- **No `cookieSignal`.** Cookies are mostly read by the server,
  not mutated reactively on the client. The need would be better
  served by a server-action helper.
- **No schema-validation hook in `localSignal`.** `migrate` runs
  on version mismatch only; mid-version corruption (someone
  edits localStorage in devtools) deserializes to whatever
  `deserialize` returns. Apps that need structural validation
  wrap `deserialize`.
- **No "online" signal in this ADR.** `navigator.onLine` is
  notoriously misleading (it reports interface state, not real
  connectivity). A useful online primitive needs a heartbeat
  ping policy, which belongs in its own ADR alongside the
  streaming primitives (0006 follow-ups).
- **No automatic loader re-run on `bfcacheRestoreSignal`.**
  Apps wire `watch([bfcacheTick], refetch)` themselves. A
  built-in `revalidateOn: ['bfcache']` option on loaders /
  `query()` is the right place to make it declarative; that
  belongs in the loader / `query()` ADRs, not here.

## Consequences

**Positive:**

- Closes three of the most common "why is this not a signal?"
  questions newcomers ask. Each one collapses 30-100 LOC of
  imperative event wiring into one line.
- Composes natively with `compute`, `watch`, `each()`,
  `loaderData()`, `currentPath()` — no new subscription shape
  to learn.
- SSR-safe by construction. Each primitive returns the same
  accessor type on both runtimes; only side-effects differ.
- Unblocks the `query()` SWR helper sketched in the recent
  feature discussion: `revalidateOn: ['focus', 'bfcache']`
  becomes a one-line subscription to
  `pageVisibilitySignal` + `bfcacheRestoreSignal`.
- Unblocks the live-data ADR sketch (`webSocketSignal`,
  `eventSourceSignal`) which want `pageLifecycleSignal` for
  reconnect policy.
- Each primitive is independently tree-shakable. Apps that
  don't import them pay zero bytes.

**Negative:**

- Five new exports. Surface area grows from 21 to 26 functions.
  Mitigated by clear grouping (all are "lift a platform API
  into a signal") and by the fact that all five compose into
  the existing accessor types — no new concept to learn.
- `localSignal` first-paint can flash from SSR default →
  persisted value during hydration. Documented; the `when()`
  gating pattern matches how `enableHydrationTextRewrite`
  (ADR 0007) handles analogous mismatches.
- `broadcastSignal` is same-origin only. Apps spanning
  subdomains can't share state through it. Documented; out of
  scope for a browser-only primitive.
- `bfcacheRestoreSignal` returning a counter is awkward
  ergonomics ("increment on event" rather than "fire callback").
  Chosen because signals can't model one-shot events directly —
  a callback API would require a separate concept. The
  counter shape forces apps to use `watch` (correct) instead
  of `effect` with manual deduping.

**Neutral:**

- Tests cover: jsdom `Storage` for `localSignal` reads /
  writes / cross-tab fan-out via synthetic `storage` events;
  a mocked `BroadcastChannel` for `broadcastSignal`
  refcounting; jsdom dispatch of `visibilitychange` / `pageshow`
  with `persisted: true` for the lifecycle trio.
- No changes to the SSR pipeline. The primitives are
  client-effect only on the server.
- Bundle delta: ~700 bytes gzipped for all five primitives
  combined (rough estimate from comparable shapes).

## Alternatives considered

**One mega-primitive `persistedSignal(key, default, options)`
that subsumes `localSignal` and `broadcastSignal` via a
`sync: 'tab' | 'cross-tab' | 'both'` option.** Rejected: the
two primitives have different serialization stories
(JSON vs. structured clone), different SSR fallbacks, and
different failure modes. Bundling them forces every caller
to load both code paths.

**Ship `localSignal` only; treat broadcast as out-of-scope.**
Rejected: the "log out everywhere" / "shared cart" patterns
are common enough that apps building them in user-land
inevitably re-implement the same channel-refcount logic
incorrectly. The whole point of Purity is that the platform's
already-good primitives become signal-shaped.

**Expose a generic `eventSignal(target, eventName, project)`
and let apps build the three lifecycle signals themselves.**
Rejected: the lifecycle-state derivation (which combines
`freeze`/`resume`/`pagehide`/`pageshow`/`visibilitychange`
per the Page Lifecycle spec) is not obvious. Apps would
reimplement it wrong, and the per-app implementations would
all register duplicate listeners. The opinionated trio amortizes
one listener per primitive across the whole app.

**Make `localSignal` async** (return `Promise<StateAccessor<T>>`)
to support IndexedDB-backed implementations behind the same
API. Rejected: async accessor construction breaks the existing
synchronous component-body idiom (`const theme = localSignal(...)`).
Async storage belongs in `resource()`.

**Auto-revalidate loaders on `bfcacheRestoreSignal`.**
Rejected for this ADR — auto-revalidation policy is the loader /
`query()` ADR's call. This ADR just exposes the signal.

**Reactive `effect` cleanup tied to `pageLifecycleSignal`'s
`frozen` state** (auto-pause `watch`/`effect` when frozen).
Rejected: frozen pages don't run JS at all, so the runtime
optimization is moot — the browser already pauses the event
loop. Apps that want explicit pause/resume read the signal
directly.
