# 0047: Live data signals — `eventSourceSignal`, `webSocketSignal`

**Status:** Proposed

## Context

ADR 0039 lifted persistence + lifecycle state into signals. ADR 0040
lifted the observer APIs. ADRs 0041–0042 lifted system preferences and
capabilities. The remaining ubiquitous live-data sources are
**Server-Sent Events** (`EventSource`) and **WebSocket** — the two
push-data primitives the platform ships. Apps wire them by hand today,
and the wiring is consistently wrong in two ways:

1. **Reconnect on page-lifecycle changes.** Apps open the connection
   eagerly, leave it open while the page is hidden / bfcached, and then
   discover the connection is stale on resume. Or they over-correct and
   never reconnect at all. The new lifecycle signals from ADR 0039
   (`pageVisibilitySignal`, `bfcacheRestoreSignal`) are exactly the
   right reconnect triggers, but every app re-derives the same wiring.
2. **Trust boundary.** Incoming messages are written into app state
   without validation — the same security pattern that motivated
   `broadcastSignal`'s required `validate` predicate. A malicious or
   compromised server can poison the signal with arbitrary structured
   data; an unvalidated receiver carries that data straight into
   templates.

This ADR ships two named primitives that handle both concerns. The
streaming-control-flow helper `progressively(asyncIterable, view)` is
explicitly deferred to its own ADR — it touches `each()` /
hydration / ADR 0006's streaming SSR machinery and deserves the room.

## Decision

**Add two live-data signal constructors to `@purityjs/core`:**

```ts
export type LiveValidator<T> = (value: unknown) => value is T;
export type LiveReconnectPolicy = 'never' | 'on-visible' | 'always';

export interface EventSourceSignalOptions<T> {
  initialValue: T;
  validate: LiveValidator<T>;
  eventName?: string; // default 'message'
  withCredentials?: boolean;
  parse?: (raw: string) => unknown; // default JSON.parse
  reconnect?: LiveReconnectPolicy; // default 'on-visible'
}

export function eventSourceSignal<T>(
  url: string | URL,
  options: EventSourceSignalOptions<T>,
): ComputedAccessor<T>;

export type WebSocketSignal<T> = ComputedAccessor<T> & {
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  readyState(): 'connecting' | 'open' | 'closing' | 'closed';
};

export interface WebSocketSignalOptions<T> {
  initialValue: T;
  validate: LiveValidator<T>;
  protocols?: string | string[];
  parse?: (raw: MessageEvent['data']) => unknown;
  reconnect?: LiveReconnectPolicy; // default 'on-visible'
}

export function webSocketSignal<T>(
  url: string | URL,
  options: WebSocketSignalOptions<T>,
): WebSocketSignal<T>;
```

### Trust-boundary validation

Both functions require a `validate` predicate. The contract mirrors
ADR 0039's `BroadcastValidator<T>`: incoming messages flow through
`parse(raw)` first (default `JSON.parse`), then through
`validate(parsed)`. Values that fail the predicate are dropped, and a
`console.warn` is emitted so attack signal is visible in dev. Parse
errors are caught and warned identically. Local writes via
`webSocketSignal.send()` skip validation — same-tab writes don't
cross the trust boundary.

### Reconnect policy

Both functions take a `reconnect` option:

- **`'on-visible'`** (default) — Open the connection when the page is
  visible. Close when hidden. Force a clean reconnect on each
  `bfcacheRestoreSignal` tick (the underlying connection is paused
  during bfcache freeze; refreshing it on resume avoids stale state).
  Battery-friendly, matches what production apps mean by "keep this
  feed live."
- **`'always'`** — Stay open regardless of page state. Still
  reconnects on `bfcacheRestoreSignal` for the same freeze-reset
  reason. Appropriate for kiosks / dashboards.
- **`'never'`** — Open once on construction; never reopen. Caller
  owns the lifecycle entirely.

The wiring uses `pageVisibilitySignal` and `bfcacheRestoreSignal`
from ADR 0039 — every app's "should I be connected right now?"
heuristic in two lines, exercising the exact subsystem that ADR
shipped.

### `send()` on a closed/closing socket

`webSocketSignal(...)` returns a `ComputedAccessor<T>` extended with
two methods. Calling `.send(data)` when `readyState() !== 'open'`
logs a `console.warn` and silently drops the message. Rationale:

- Matches `localSignal`'s quota-error pattern (log + survive).
- Lets fire-and-forget telemetry stay synchronous without
  `try/catch` at every call site.
- The `readyState()` accessor is there for callers that need to
  pre-check or queue manually.

Buffering writes until the socket opens is **explicitly out of
scope** — unbounded queue if the socket never opens; better as a
follow-up option flag (`buffered: true`) than the default.

### SSR + unavailable-platform fallbacks

Server contexts and browsers without `EventSource` / `WebSocket`
return inert constants — `compute(() => options.initialValue)` for
`eventSourceSignal`; for `webSocketSignal`, a `ComputedAccessor`
returning `initialValue` plus a `.send()` no-op and a
`.readyState()` that always returns `'closed'`. No connection
attempted, no validator invoked. Isomorphic code reads naturally
without `typeof window` guards.

### Explicit non-features

- **No exponential-backoff retry.** When the spec-mandated
  EventSource retry exhausts or a WebSocket closes due to error /
  network drop, the signal stays closed (apart from the bfcache /
  visibility reconnect triggers above). Apps that need
  network-error retry instantiate raw `WebSocket` / `EventSource`.
- **No buffered `send()`.** Closed-socket `send()` warns and
  drops. Queue-until-open is a follow-up option.
- **No cross-tab dedup.** Each call opens its own connection. Apps
  that want one socket fanned out to many UI consumers use a
  module-scoped `state()` + one outer `webSocketSignal` and read
  derived signals.
- **No URL-keyed caching.** Same trade-off as `intersectionSignal`
  / `resizeSignal` (ADR 0040). Predictable lifetimes beat
  ambiguous cache eviction.
- **No `progressively(asyncIterable, view)` streaming control-flow
  in this ADR.** That primitive integrates with `each()`,
  hydration, and ADR 0006's streaming SSR pipeline. Reserve its
  own ADR.
- **No explicit `disconnect()` on the returned accessor.** The
  reconnect wiring + bfcache reset cover the typical lifecycles.
  Apps that need hard early disconnect use raw `WebSocket` /
  `EventSource`.

## Consequences

**Positive:**

- Two named primitives close the live-data gap and exercise the
  lifecycle signals shipped in ADR 0039 with a real consumer.
- `validate` required from day one — same lesson as
  `broadcastSignal`. No "we'll add validation later" trapdoor.
- `webSocketSignal.send()` + `.readyState()` keep the bidirectional
  flow honest while preserving the signal-as-read-only spirit
  (validate-on-receive only).
- SSR-safe by construction. Tree-shakes per primitive.

**Negative:**

- API surface grows by two functions + four exported types.
  Mitigated by the same grouping argument as the prior signal
  ADRs: one shape, one trust-boundary contract, one reconnect
  policy — nothing new to learn after the first.
- The `on-visible` default introduces a subtle dependency on
  ADR 0039's lifecycle signals being correct. A bug in
  `pageVisibilitySignal` would cause silent reconnect storms. That
  risk is bounded — the lifecycle ADR ships per-signal singletons
  with full test coverage, and the reconnect helper consumes them
  via the existing `watch` plumbing.
- `WebSocketSignal<T>` is an augmented `ComputedAccessor` — the
  first signal in the codebase that's not a pure accessor. The
  precedent matches `LazyResourceAccessor` (`resource()` exposes
  `.refresh()` / `.mutate()`), so the pattern is already in the
  family.

**Neutral:**

- Tests cover SSR constants + mocked `EventSource` / `WebSocket`
  with the four lifecycle paths (initial open, hidden close,
  visible reopen, bfcache reconnect), validator drop with warn,
  parse-error drop with warn, send-while-closed warn + drop,
  readyState transitions. jsdom doesn't ship either API in usable
  form, so tests install controllable mocks.
- Bundle delta: ~600 bytes gzipped for both combined (rough
  estimate from comparable shapes).

## Alternatives considered

**Optional `validate` with a `(v): v is T => true` default.**
Rejected: same as `broadcastSignal`'s breaking-change follow-up.
Network-sourced data crosses a trust boundary; making validation
opt-in defeats the point because the path of least resistance
ships an unvalidated receiver.

**`reconnect` default of `'always'`.** Rejected: doesn't exercise
the lifecycle signals at all, burns battery on backgrounded tabs,
and the only apps it benefits (kiosks) are the ones most likely to
already configure their own policy. Opting in to `'always'` is a
one-line override.

**Buffer `send()` writes until the socket opens.** Rejected for
the default: introduces an unbounded queue if the socket never
opens. Worth a follow-up `buffered: true` option flag once apps
exercise the un-buffered shape.

**Throw on `send()` to a closed socket.** Rejected: forces every
fire-and-forget call site (telemetry, presence pings) to wrap in
`try/catch`. The signal-as-eventual-consistency model prefers
log+drop, matching `localSignal`'s quota-error handling.

**Auto-reconnect with exponential backoff after network errors.**
Rejected for v1: backoff policy is the kind of thing every app
disagrees about (cap, jitter, max attempts, give-up signal). Apps
that need it wrap raw `WebSocket`; the signal layer handles the
page-lifecycle case which is the universal one.

**Cache one connection per URL.** Rejected: same trade-off as
`intersectionSignal` from ADR 0040. URL alone isn't a unique key
once `protocols`, `validate`, `parse`, and `reconnect` are factored
in; caching by the full options bag is opaque and apps that want
sharing build it via a module-scope wrapper.

**One `liveSignal(adapter)` factory taking a transport plugin.**
Rejected: forces every consumer to know about the transport
abstraction even for the single-transport case. `EventSource` and
`WebSocket` have meaningfully different surfaces (send + readyState
exist only for WebSocket; SSE has built-in retry, WS doesn't). Two
named constructors keep the call sites honest.
