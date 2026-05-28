# 0040: Observer-as-signal primitives

**Status:** Proposed
**Date:** 2026-05-28

## Context

Four browser observer APIs — `IntersectionObserver`,
`MutationObserver`, `matchMedia`, `ResizeObserver` — back
ubiquitous UI patterns:

- "Hydrate / load when visible," infinite scroll, view-tracking
  analytics → `IntersectionObserver`.
- React to slotted children, third-party script DOM injection →
  `MutationObserver`.
- `prefers-color-scheme`, viewport breakpoints, reduced-motion →
  `matchMedia`.
- Component-scoped breakpoints, responsive layout math →
  `ResizeObserver` (and, by composition, container-query-like
  behavior).

In every Purity app today, these are written by hand as imperative
callbacks that flip a `state()`. The boilerplate is the same every
time — instantiate observer, set up handler, schedule a sync write,
keep a teardown function to disconnect — and it's the same shape
across all four observers.

ADR 0039 established the "lift a platform API into a signal"
pattern with persistence + page-lifecycle primitives. This ADR
applies the same pattern to the observer family.

Why now: the islands ADR (0038) wants
`island(view, { when: intersectionSignal(el) })`-style triggers.
The `query()` SWR helper sketched in the recent feature
discussion wants `revalidateOn: ['focus', mediaSignal('(...)')]`-
style conditions. Shipping the observer signals removes a
recurring custom-helper pattern across our own roadmap.

## Decision

**Add four observer-backed signal constructors to
`@purityjs/core`:**

```ts
export function intersectionSignal(
  target: Element,
  options?: IntersectionObserverInit,
): ComputedAccessor<boolean>;

export function mutationSignal(
  target: Node,
  options?: MutationObserverInit,
): ComputedAccessor<MutationRecord[]>;

export function mediaSignal(query: string): ComputedAccessor<boolean>;

export function resizeSignal(
  target: Element,
  options?: ResizeObserverOptions,
): ComputedAccessor<DOMRectReadOnly>;
```

All four return `ComputedAccessor` — read-only by design (only the
observer should write). All four return inert constants in an SSR
context. All four follow the ADR 0039 "lazy attach on first call"
shape.

### `intersectionSignal`

```ts
function LazyImage({ src }: { src: string }) {
  let img!: HTMLImageElement;
  onMount(() => {
    const onScreen = intersectionSignal(img, { rootMargin: '200px' });
    watch(onScreen, (visible) => {
      if (visible) img.src = src;
    });
  });
  return html`<img ${(el) => (img = el)} alt="" />`;
}
```

- **Server.** Returns `compute(() => false)`.
- **Client.** Creates one `IntersectionObserver` per call,
  observes `target`. The observer fires once on `observe()` with
  the current intersection state, so the signal converges to its
  initial value within a microtask. Subsequent intersection
  changes update the signal synchronously inside the observer
  callback.
- **Value.** Plain boolean (`entry.isIntersecting`). Apps that
  need the full `IntersectionObserverEntry` (intersection ratio,
  bounding rects) instantiate `IntersectionObserver` directly —
  the signal layer keeps the common case lean.

### `mutationSignal`

```ts
function SlotCounter() {
  let host!: HTMLElement;
  onMount(() => {
    const muts = mutationSignal(host, { childList: true });
    watch(muts, (records) => analytics.track('children-changed', records.length));
  });
  return html`<div ${(el) => (host = el)}><slot></slot></div>`;
}
```

- **Server.** Returns `compute(() => [])`.
- **Client.** Creates one `MutationObserver` per call, calls
  `.observe(target, options)`. The latest batch of records is
  written to the signal in the observer callback; older batches
  are dropped (apps that need accumulation reduce inside a
  `compute`).
- **Caveat.** `MutationObserver` holds a strong reference to its
  target. The signal therefore keeps `target` alive until the
  accessor is GC'd. Documented; apps observing short-lived nodes
  use the raw API.

### `mediaSignal`

```ts
const dark = mediaSignal('(prefers-color-scheme: dark)');
manageTitle(() => (dark() ? '🌙 ' : '☀ ') + 'My Site');
```

- **Server.** Returns `compute(() => false)`.
- **Client.** Caches a singleton per query string —
  `mediaSignal('(min-width: 600px)')` called twice returns the
  same accessor and one underlying `MediaQueryList` listener.
- **Value.** Plain boolean (`mql.matches`). Initial read is
  synchronous; subsequent changes propagate via the `change`
  event.

### `resizeSignal`

```ts
let box!: HTMLElement;
onMount(() => {
  const rect = resizeSignal(box);
  const wide = compute(() => rect().width > 600);
  // wide() is the container-query-style accessor
});
```

- **Server.** Returns `compute(() => ZERO_RECT)` where
  `ZERO_RECT` is a frozen DOMRect-like with `width`, `height`,
  `x`, `y`, `top`, `right`, `bottom`, `left` all zero.
- **Client.** Creates one `ResizeObserver` per call, observes
  `target`. Each observed entry's `contentRect` (default) or
  `borderBoxSize` (resolved into a rect-like) becomes the signal
  value. Initial value is `target.getBoundingClientRect()` so
  callers don't see a zero rect on first read.

### Cache + lifetime semantics

- `mediaSignal` caches per query string (queries are cheap keys).
- The three element-bound primitives do **not** cache — each
  call creates a fresh observer. Apps that want one observer
  across many readers wire the deduping themselves (a single
  `state()` updated by an outer observer + many readers
  derived from it).
- Observers are not auto-disconnected. The accessor holds the
  observer closure; when the accessor is GC'd, the observer is
  eligible for GC. For `IntersectionObserver` /
  `ResizeObserver` this is clean (they hold weak refs to
  targets). For `MutationObserver` see the strong-ref caveat
  above.

### Explicit non-features

- **No `containerSignal(el, '(min-width: 600px)')`.** There's
  no JS API for evaluating CSS `@container` queries
  programmatically. The honest substrate is `resizeSignal` +
  `compute(() => …width > 600)`. Worth revisiting if the
  platform adds a JS-side container-query API.
- **No `IntersectionObserverEntry` return.** Apps needing
  intersection ratio / bounding rects use the raw API. The
  signal-layer surface stays small.
- **No explicit `disconnect()` method on the accessor.** Adding
  it would either: (a) extend the `ComputedAccessor` type
  (pollutes inference), or (b) require a `{ value, dispose }`
  return that breaks the rest of the signal family's shape.
  Trade-off accepted: apps that need early disconnect use raw
  observers.
- **No accessor-typed `target` (no auto-rebind when target
  changes).** Each constructor takes a concrete `Element`/`Node`.
  Apps with dynamic targets recreate the signal inside an
  `onMount` / `effect` instead.
- **No `ResizeObserverEntry.borderBoxSize` direct exposure.**
  `resizeSignal` returns the `contentRect` shape only; the
  `borderBoxSize`-derived variant could ship as a follow-up if
  apps actually need border-box dimensions.
- **No `IntersectionObserver.takeRecords()` integration.**
  Synchronous record draining is rare; apps that need it
  reach for the raw observer.

## Consequences

**Positive:**

- Four observer primitives shipped as signals — replaces ~30
  LOC of imperative wiring per use case with one call.
- Pairs directly with the islands ADR (0038):
  `island(view, { when: intersectionSignal(el) })` becomes a
  one-liner. Removes a planned per-island ad-hoc IO helper.
- Pairs with the future `query()` SWR helper:
  `revalidateOn: [mediaSignal('(...)')]` is a one-line
  subscription.
- All four are tree-shakable. Apps that import none pay zero
  bytes; importing one pulls only that file.
- SSR-safe by construction. The `compute(() => constant)`
  fallback means observer-derived expressions evaluate without
  touching a `window` / `document` reference at all on the
  server.

**Negative:**

- Surface area grows by four functions (32 → 36 with ADR
  0039's contributions counted). The grouping ("lift an
  observer into a signal") makes the increase coherent —
  there's nothing new to learn per primitive once one is
  understood.
- No accessor-level disconnect → MutationObserver targets
  outlive their host node until the accessor is GC'd.
  Documented limitation; matches the rest of the observer
  family's natural lifetime model.
- No caching for the element-bound primitives means calling
  the same constructor twice for the same target creates two
  observers. Acceptable: real apps call each constructor once
  per component instance. Apps that want sharing dedup at the
  call site.

**Neutral:**

- Tests cover: SSR constants for each primitive, jsdom-driven
  callback fan-out for `intersectionSignal` / `mutationSignal`
  / `resizeSignal` (jsdom provides stub observers; we exercise
  them via direct callback dispatch), and `matchMedia` change
  events for `mediaSignal`.
- Bundle delta: ~1.0 kB gzipped for all four combined (rough
  estimate from comparable shapes).
- No SSR pipeline changes. The primitives are client-only by
  side effect; the SSR fallback is a constant compute.

## Alternatives considered

**A single `observerSignal({ kind, target, options })` factory.**
Rejected: the four observers have meaningfully different
target/options/value shapes. Forcing them into one signature
either weakens type inference or balloons the union types.
Separate named constructors keep the call site explicit.

**Return tuples `[ComputedAccessor<T>, Dispose]` from every
constructor.** Rejected: breaks the rest of the signal family's
single-return shape; introduces a destructuring pattern just
for observers. Most apps never call `dispose`; the few that
need it use the raw observer API.

**Cache element-bound signals by `(target, options)` key
internally.** Rejected for v1. Cache eviction is unclear (when
the element is GC'd? when no readers track it?), and the
dedup gain is marginal — apps call each constructor at most
once per component mount. Worth revisiting if profiling shows
duplicate observers in practice.

**Make `target` accept a reactive accessor so the signal
auto-rebinds when the target changes.** Rejected: complicates
the constructor (it needs its own `watch` for the target),
and the rebind story for observers like `IntersectionObserver`
(must disconnect + observe new target) is fiddly. Apps with
dynamic targets re-create the signal inside an effect.

**Return `IntersectionObserverEntry` from
`intersectionSignal`.** Rejected: 90% of callers want a
boolean. The full entry is available via raw API. Could add a
sibling `intersectionEntrySignal` if real apps need both — but
that's a future ADR call.

**Ship a `containerSignal(el, '(min-width: 600px)')` that
internally combines `resizeSignal` with a parsed query.**
Rejected for v1: parsing CSS `@container` query syntax in JS
opens a large surface (axis, units, queries beyond
inline-size). The composition
`compute(() => resizeSignal(el)().width > 600)` is honest
about what the runtime actually does.
