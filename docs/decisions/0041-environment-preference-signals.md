# 0041: Environment + system preference signals

**Status:** Proposed
**Date:** 2026-05-28

## Context

Eight pieces of always-queryable browser/OS state recur in apps so
often that hand-rolled signal wrappers for them appear in nearly
every Purity app started so far:

- `prefers-color-scheme`, `prefers-reduced-motion`,
  `prefers-contrast` — accessibility-driven branches.
- `navigator.onLine` + `online`/`offline` events — offline
  indicators, retry-on-reconnect.
- `screen.orientation` — responsive layout, kiosk apps.
- `navigator.language` + `languagechange` — i18n.
- `window.devicePixelRatio` — image asset switching, canvas
  setup. Changes when the user zooms or drags a window across
  monitors.
- `document.fullscreenElement` + `fullscreenchange` — fullscreen
  UX, exit detection.

ADR 0040 shipped `mediaSignal(query)` which technically handles
three of these (`prefers-*` queries), but `mediaSignal` returns a
boolean — apps wrap it in `compute(() => mq() ? 'dark' : 'light')`
boilerplate at every call site. The other five aren't media-query
shaped at all.

This ADR ships eight named, typed signal constructors. Each is a
thin wrapper that picks the canonical query / event and exposes
a meaningfully-typed return value.

## Decision

**Add eight environment signals to `@purityjs/core`:**

```ts
export function onlineSignal(): ComputedAccessor<boolean>;
export function prefersColorSchemeSignal(): ComputedAccessor<'light' | 'dark'>;
export function prefersReducedMotionSignal(): ComputedAccessor<boolean>;
export function prefersContrastSignal(): ComputedAccessor<
  'no-preference' | 'more' | 'less' | 'custom'
>;
export function screenOrientationSignal(): ComputedAccessor<'portrait' | 'landscape'>;
export function localeSignal(): ComputedAccessor<string>;
export function devicePixelRatioSignal(): ComputedAccessor<number>;
export function fullscreenSignal(): ComputedAccessor<Element | null>;
```

All eight return `ComputedAccessor` (read-only). All eight are
lazy singletons — first call registers exactly one listener,
subsequent calls return the cached accessor. All eight return
constant accessors in an SSR context.

### Layered on ADR 0040 where it fits

The three `prefers-*` signals compose on top of `mediaSignal`:

```ts
export function prefersReducedMotionSignal(): ComputedAccessor<boolean> {
  if (isSSR()) return compute(() => false);
  const mq = mediaSignal('(prefers-reduced-motion: reduce)');
  return compute(() => mq());
}
```

This reuses `mediaSignal`'s per-query cache — calling
`prefersReducedMotionSignal()` and
`mediaSignal('(prefers-reduced-motion: reduce)')` share one
underlying `MediaQueryList` listener.

`prefersColorSchemeSignal` is the same shape but maps the boolean
to a typed string. `prefersContrastSignal` reads three queries
and reduces to a discriminated value.

### Direct platform-event signals

The other five wrap events directly:

- `onlineSignal` — `navigator.onLine` initial value, then `online`
  / `offline` window events.
- `screenOrientationSignal` — reads `screen.orientation.type`
  (or falls back to `innerWidth > innerHeight` when the API is
  unavailable), listens to `screen.orientation` `change`. Maps
  the four spec values (`portrait-primary`, etc.) down to
  `'portrait'` / `'landscape'`.
- `localeSignal` — `navigator.language` initial value, listens to
  the `languagechange` window event.
- `devicePixelRatioSignal` — reads `window.devicePixelRatio`,
  watches `(resolution: ${currentDPR}dppx)` via `matchMedia`. When
  that media query stops matching, the signal re-reads DPR and
  re-binds against the new value. This is the documented way to
  observe DPR changes.
- `fullscreenSignal` — `document.fullscreenElement` initial value,
  listens to `fullscreenchange` on document.

### SSR defaults

Each constant SSR accessor returns the spec's "most likely"
default branch so isomorphic code reads naturally without
guards:

| Signal                       | SSR value         |
| ---------------------------- | ----------------- |
| `onlineSignal`               | `true`            |
| `prefersColorSchemeSignal`   | `'light'`         |
| `prefersReducedMotionSignal` | `false`           |
| `prefersContrastSignal`      | `'no-preference'` |
| `screenOrientationSignal`    | `'portrait'`      |
| `localeSignal`               | `'en'`            |
| `devicePixelRatioSignal`     | `1`               |
| `fullscreenSignal`           | `null`            |

Apps that need a request-aware default (e.g. `Accept-Language`
header drives `localeSignal`'s server value) wire that up
outside this ADR — the constants are floors, not contracts.

### Explicit non-features

- **No setter on any signal.** These reflect platform state;
  the platform owns the source of truth. Apps wanting to
  _control_ color scheme write the class onto `document.documentElement`
  themselves; the signal will reflect the eventual platform value.
- **No `setLocale()` / language-override helper.** Out of
  scope. Apps that internationalise build their own `currentLocale`
  signal seeded from `localeSignal()` plus user preference.
- **No `'portrait-primary' | 'portrait-secondary' | …`
  granularity from `screenOrientationSignal`.** The four-state
  return is rarely useful; apps that need it use
  `screen.orientation.type` directly.
- **No `forced-colors` signal.** `forced-colors` is a real
  preference (Windows high-contrast mode), but it shares
  semantics with `prefersContrastSignal` for most consumers.
  Worth a follow-up if apps actually need to distinguish them.
- **No SSR header sniffing.** This ADR doesn't read
  `Accept-Language` / `Sec-CH-Prefers-Color-Scheme` /
  `Sec-CH-Viewport-Width` from the request. Header-driven
  defaults are a routing / loader concern; the signals
  consume the result.

## Consequences

**Positive:**

- Eight named primitives replace eight different per-app
  helpers people are writing anyway. Discoverability
  (named import) and tree-shaking (one file each) are wins
  over "just use `mediaSignal`."
- Three of the eight (`prefers-*`) compose on top of
  `mediaSignal` — they pay the cache cost only once, even if
  user code also imports `mediaSignal` directly with the same
  query.
- SSR-safe by construction. Each signal's SSR fallback is a
  constant `compute()` — isomorphic code doesn't need
  `typeof window !== 'undefined'` guards.
- ~600 bytes gzipped for all eight combined (estimate from
  comparable shapes).

**Negative:**

- API surface grows from 36 to 44. Mitigated by:
  (a) the grouping ("environment signal") makes the increase
  coherent, (b) tree-shaking means apps pay only for what
  they import, (c) all eight follow the same shape — there's
  nothing new to learn after the first one.
- `devicePixelRatioSignal`'s re-bind dance is the most
  complex code in this ADR — every DPR change creates a new
  `MediaQueryList`. Acceptable: DPR changes are rare (zoom,
  monitor drag), so listener churn is minimal.
- The `screen.orientation` API is Baseline-but-not-universal.
  Older iOS Safari fell back to `window.orientation`
  (deprecated). The signal degrades to the
  `innerWidth > innerHeight` heuristic in that case;
  documented.

**Neutral:**

- Tests cover SSR constants + jsdom-driven event dispatch
  for each signal. `matchMedia` and `screen.orientation`
  need lightweight test mocks (jsdom doesn't ship either).
- No SSR pipeline changes. Each signal is client-only by
  side effect.

## Alternatives considered

**Ship only the `mediaSignal` recipes in ADR 0040's docs;
skip the named wrappers.** Rejected: `onlineSignal`,
`localeSignal`, `screenOrientationSignal`, `devicePixelRatioSignal`,
and `fullscreenSignal` aren't media-query-shaped. And for the
three that are, the typed return (`'light' | 'dark'` vs
`boolean`) is meaningfully more ergonomic than every app
writing the same ternary.

**Bundle into one `environment()` factory** that returns an
object with all eight as properties. Rejected: hostile to
tree-shaking. Apps that import only `onlineSignal` would pay
for all eight.

**Make each signal a `StateAccessor` so apps can mock the
value in tests.** Rejected: confuses the platform-state
contract. Tests mock the underlying browser API (matchMedia,
fullscreen, etc.) directly — same as they mock observers in
ADR 0040.

**Expose `screen.orientation.type` (four-state) and let apps
narrow themselves.** Rejected: 95% of callers want
`'portrait' | 'landscape'`. The four-state can be read from
`screen.orientation.type` directly when needed.

**Cache `devicePixelRatioSignal` per discrete DPR value
(separate signal per DPR).** Rejected: there's no use case for
"signal for DPR=2 vs signal for DPR=3"; the relevant signal is
"what is the current DPR?" — one singleton suffices.
