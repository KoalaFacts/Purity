# 0035: Expose `ElementInternals.states` for component lifecycle

**Status:** Proposed
**Date:** 2026-05-27

## Context

Purity components have no first-class way to surface lifecycle / async
status to CSS. In practice users either:

- Toggle a class on the host element via `.host.classList.toggle('loading')`
  inside an `onMount`/`watch` (works but leaks DOM concerns into render
  code, and the host element isn't even reachable from the render fn
  without escape hatches).
- Bind a `data-loading` attribute through a template binding (works but
  bloats every component template and only styles via attribute selectors
  with their own specificity).
- Style purely with adjacent-child selectors in user CSS (fragile —
  breaks the moment markup changes).

Meanwhile the platform has shipped `ElementInternals.states` (Baseline
since May 2024 — Chrome 125, Safari 17.4, Firefox 126) and the CSS
`:state(name)` pseudo-class with the bare-ident form. The pseudo is
combinable with `:host()` and `::part()`. This is the native answer.

The two design questions are:

1. Where does the host's `ElementInternals` live, and how do render
   functions reach it?
2. How do multiple sources in the same component (multiple `resource()`
   calls, plus user code) coordinate writes to the same state name
   without stomping on each other?

## Decision

We expose two new public functions and auto-wire `resource()`:

- **`internals(): ElementInternals | null`** — accessor returning the
  host element's `ElementInternals` from inside a `component()` render
  (or `null` for non-CE roots like `mount()`).

- **`bindComponentState(name, accessor)`** — reactively syncs a state's
  membership in `internals.states` to the truthiness of `accessor()`.
  Auto-disposed on unmount. **Ref-counted per state name**: multiple
  binders to the same name compose, the host only flips on the 0↔1
  boundary. This means two `resource()`s both binding `'loading'`
  cleanly produce "host is loading iff any resource is loading".

- **Auto-wire `resource()`** — every `resource()` call inside a
  `component()` context calls `bindComponentState('loading',
r.loading)` and `bindComponentState('error', () => r.error() !==
undefined)` at creation. No-op outside a component or when the
  runtime lacks `attachInternals`/`.states`.

Implementation:

- `PurityElement` calls `attachInternals()` once in its constructor
  and stashes the result on the instance (`this._internals`).
  `connectedCallback` copies the reference to `_ctx._internals` so
  the render scope can read it via `getCurrentContext()`.
- `bindComponentState` stores per-name ref counts in a lazy
  `_stateRefs: Map<string, number>` on the context.
- `attachInternals` is wrapped in `try/catch` for runtimes that don't
  expose it; the whole feature degrades to no-op.

## Consequences

**Public API surface grows by 2 functions** (`internals`,
`bindComponentState`). The "21 functions" headline in the core README
becomes 23.

**Per-instance memory cost**: one `ElementInternals` + one
`CustomStateSet` per custom element instance. Both are trivial.

**resource() now has a side effect on the host element by default.**
This is a behavior change. The choice is deliberate: users who want
loading/error styles get them for free, and ref-counting prevents
multi-resource collisions. The escape hatch is to not write a
`:state(loading)` rule — the state membership is then a no-op.

**Tests need a polyfill in jsdom.** jsdom (as of the version pinned)
implements `attachInternals` but the returned object has no `.states`.
Per the spec a `CustomStateSet` is set-like, so the test file replaces
the missing slot with a `Set<string>`. Production code paths defensively
no-op when `.states` is absent.

**Composition with `:host`**. Inside a component's Shadow DOM the
canonical selector is `:host(:state(loading))`. From outside (light DOM)
the selector is `p-card:state(loading)`. Both work without any
framework changes.

## Alternatives considered

- **Toggle a class on `this.host` via `connectedCallback`** — works,
  but leaks the host into the render fn (which is otherwise pure),
  and forces every styled state to live in an attribute selector
  fighting for specificity with user CSS.

- **Toggle a `data-state="loading"` attribute** — same downsides as
  class-toggling, plus the host element gets visibly noisy in devtools
  and the attribute conflicts if the user wants to set their own.

- **No auto-wire; expose only `internals()` and let users call
  `bindComponentState` themselves** — clean separation, but the most
  common case (loading spinner styling on the host) becomes
  boilerplate. Auto-wire pays off the new dependency.

- **Auto-wire without ref-counting** — works for the single-resource
  case but breaks the moment a component has two resources binding
  the same name. The 0↔1 boundary discipline is small and avoids a
  whole class of "why does my state flicker?" bugs.

- **Wait for `:has()`-based styling instead** — possible but indirect.
  `:state` is the native, intended primitive and is already Baseline.

## Browser support

Baseline since May 2024:

- Chrome / Edge 125+ (May 2024)
- Safari 17.4 (Mar 2024)
- Firefox 126 (May 2024)

Both the `.states` API and the `:state(bare-ident)` pseudo are in the
same support window. Pre-2024 engines fall through to no-op behavior;
the feature is purely additive.
