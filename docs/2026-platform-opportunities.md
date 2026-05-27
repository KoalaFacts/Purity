# 2026 Web Platform Opportunities for Purity

**Status:** Research note — not an ADR. Captures findings from a May 2026
review of new(ish) web platform specs that Purity could lean on.
**Date:** 2026-05-27
**Branch:** `claude/new-specs-forward-planning-9NBW9`

## Purpose

A single inventory of the platform features that have either become
Baseline since the last major Purity design pass, or are now mature
enough to consider as progressive enhancements. Each item lists the
status, the concrete code Purity would touch, the expected win, the
trade-offs, and a **re-verify checklist** that should be run immediately
before the item is implemented — browser support and spec details drift
fast, and this doc is a snapshot.

## How to use this document

1. Pick one opportunity from the list below.
2. Run its **Re-verify before executing** checklist — fetch the current
   MDN / caniuse / spec pages, confirm the support matrix hasn't
   regressed, and confirm the API surface hasn't changed.
3. If still applicable, follow the **Execution plan** for that item. If
   the item warrants an ADR (marked with **ADR required**), draft the
   ADR first and land it as a separate commit before implementation.
4. After executing, update this doc with a "Landed in <commit/PR>" note
   in the header of the relevant section.

## Snapshot of platform status (May 2026)

| Feature                         | Status        | Notes                                                            |
| ------------------------------- | ------------- | ---------------------------------------------------------------- |
| Declarative Shadow DOM          | Baseline      | Shipped. Already used by Purity SSR.                             |
| `adoptedStyleSheets` + ctor     | Baseline      | Shipped. Already used by Purity's Shadow-scoped `css()`.         |
| Form-associated custom elements | Baseline      | Safari 16.4, Mar 2023. Not yet exposed by Purity.                |
| `ElementInternals.states`       | Baseline      | Bare-ident `:state(x)` since May 2024 (Chrome 125, Safari 17.4). |
| CSS `@layer`                    | Baseline      | All evergreens since Mar 2022.                                   |
| CSS `@scope`                    | Baseline      | Firefox 146 shipped Jan 6 2026. Newly safe.                      |
| `Element.moveBefore` + callback | Chromium-only | Chrome 133, Feb 2025. Firefox positive, WebKit "support".        |
| Serializable shadow roots       | Baseline      | `getHTML({ serializableShadowRoots: true })`.                    |
| `::part()` / `exportparts`      | Baseline      | Universally supported. Use as primary styling hook.              |
| `:host-context()`               | Chromium-only | WebKit declined. Do not expose.                                  |
| Cross-root ARIA / Reference Tgt | Not interop   | Interop 2026 goal; Chromium-experiment only. Watch.              |
| CSS Module Scripts (`with css`) | Partial       | Firefox gap. Keep current `css\`\`` runtime path.                |

Sources current as of 2026-05-27: MDN, caniuse, Chrome Status, WebKit
release notes, web-standards.dev. Re-fetch before relying on any row.

---

## Opportunity 1 — Wrap framework CSS in `@layer purity`

**Status:** Landed on `claude/new-specs-forward-planning-9NBW9`. No ADR required.
**Files:** `packages/core/src/styles.ts` (non-Shadow fallback path,
roughly lines 99–145).
**Why:** Today's non-Shadow `css()` injects `<style>` tags with a
scoped class. The class raises specificity above unlayered user CSS,
forcing users to reach for `!important` to override Purity-emitted
rules. Wrapping the emitted block in `@layer purity { … }` and emitting
a one-time `@layer purity, user;` ordering rule lets unlayered user CSS
win by default.
**Expected win:** Better CSS ergonomics. No bundle size change of note.
**Trade-offs:** Pre-`@layer` browsers ignore the wrapper, falling back
to source-order — same outcome as today. No regression risk.

**Re-verify before executing:**

- [ ] WebFetch caniuse for `css-cascade-layers` — confirm ≥ 95% support
      and no regressions.
- [ ] Confirm MDN `@layer` semantics still match: unlayered rules win
      over layered rules; named layers cascade in declaration order.
- [ ] Sanity-check that `replaceSync()` on a `CSSStyleSheet` accepts an
      `@layer` wrapper (it does, but verify against current spec).

**Execution plan:**

1. Add a module-scoped guard: on first `css()` call in the non-Shadow
   path, prepend `@layer purity, user;` to a single shared
   `<style data-purity-layers>` element (idempotent).
2. Wrap each emitted scoped block in `@layer purity { … }`.
3. Tests: add a Vitest case that asserts the emitted CSS text starts
   with `@layer purity {` and asserts the layer-ordering rule is
   inserted exactly once across multiple `css()` calls.

---

## Opportunity 2 — Adopt `@scope` for the non-Shadow fallback

**Status:** Ready as of Jan 2026. No ADR required (compiler-internal).
**Files:** `packages/core/src/styles.ts` — retires
`scopeSelectors()` (lines 223–256), `allPlaceholdersInBodies()`
(161–188), `precomputeScopedChunks()` (195–219), and most of the
reactive `<style>` rebuild machinery.
**Why:** Hand-rolled selector rewriting is the largest non-compiler
chunk of `styles.ts`. `@scope (.p-N)` provides real DOM-bounded
scoping (lower boundary stops at nested component roots — something
the regex/walker approach can't express), proximity-based tie-breaks,
and removes ~100 LOC of CSS string manipulation.
**Expected win:** Smaller `styles.ts`, smaller emitted CSS per
component, correct lower-boundary semantics for nested components,
fewer edge cases to test.
**Trade-offs:** Drops support for browsers older than Firefox 146
(Jan 2026), Chrome 118 (Oct 2023), Safari 17.4 (Mar 2024) in the
non-Shadow fallback path. Acceptable if Purity's stated target is
current evergreen — needs explicit confirmation in CLAUDE.md /
README before landing.

**Re-verify before executing:**

- [ ] WebFetch caniuse for `css-cascade-scope` — confirm Firefox 146+
      still reflected and global support hasn't regressed.
- [ ] Re-check `@scope` syntax on MDN, specifically the `to (.boundary)`
      clause and whether `:scope` specificity is still 0,1,0.
- [ ] Confirm interaction with `@layer`: `@layer purity { @scope (...) { ... } }` is legal and behaves as expected (it is, but verify).
- [ ] Check the Purity README / CLAUDE.md for any stated minimum
      browser version. If the target predates the support matrix
      above, raise this as a conscious decision before landing.

**Execution plan:**

1. Replace the scope-class emission with `@scope (.p-N) { :scope { ... }
.x { ... } }`.
2. Delete `scopeSelectors`, `allPlaceholdersInBodies`,
   `precomputeScopedChunks`. The reactive path simplifies to "rebuild
   the body of the `@scope` block on signal change".
3. Land this on top of Opportunity 1 so the emitted text becomes
   `@layer purity { @scope (.p-N) { ... } }`.
4. Tests: port every existing styles.ts test; add cases that verify
   lower-boundary behavior (nested components don't bleed).

---

## Opportunity 3 — Expose `ElementInternals.states` for `resource()` lifecycle

**Status:** Baseline since May 2024. **ADR required** — adds a new
public capability tied to `resource()` and to `component()`.
**Files:** `packages/core/src/elements.ts` (custom element constructor
to call `attachInternals()`), `packages/core/src/resource.ts` (drive
state set/clear from `loading()` / `error()`).
**Why:** Purity components today have no idiomatic way to expose async
status to user CSS. Users hand-roll `data-loading` attributes or
toggle classes. `internals.states.add('loading')` lets users write
`:state(loading) { … }` (in light DOM) or `:host(:state(loading)) { … }`
(inside the component's own Shadow). Same semantics across browsers,
zero JS overhead.
**Expected win:** Cleaner styling story for resource lifecycle.
Potential to extend to `each()` empty state, `when()` branch tracking,
form validity for Opportunity 4.
**Trade-offs:** Adds an `ElementInternals` field per `component()`
instance — small memory cost. New public surface to document and
maintain. Needs to interact correctly with Shadow DOM (host element
selectable via `:host(:state(x))`).

**Re-verify before executing:**

- [ ] WebFetch MDN `ElementInternals.states` and confirm the API hasn't
      changed (still a `CustomStateSet` with `add`/`delete`/`has`).
- [ ] Confirm `:state()` bare-ident form is still the recommendation and
      dashed-ident is still only a compat shim.
- [ ] Verify that `attachInternals()` can be called once per instance
      and that calling it twice throws (it does — design around this).
- [ ] Check whether any Purity user has already shipped a competing
      `data-*` convention we should match the naming of.

**Execution plan:**

1. Draft ADR: "Expose ElementInternals.states for component lifecycle".
2. In `PurityElement` constructor, call `this.attachInternals()` and
   stash on `_ctx._internals`.
3. Add an internal helper `setComponentState(name, on)` that resource /
   future helpers route through.
4. Wire `resource()`: when `loading()` flips, toggle `'loading'`; when
   `error()` flips, toggle `'error'`. Auto-cleared on `onDispose`.
5. Tests: assert states on the host element across a fetch lifecycle.

---

## Opportunity 4 — `formAssociated` opt-in for `component()`

**Status:** Baseline. **ADR required** — expands `component()`'s public
signature with an options bag, and adds four new lifecycle hooks.
**Files:** `packages/core/src/elements.ts` (option bag + custom element
class wiring), `packages/core/src/component.ts` (new lifecycle hooks:
`onFormReset`, `onFormDisabled`, `onFormStateRestore`,
`onFormAssociated`).
**Why:** Purity has no first-class story for components that
participate in forms. Users either bypass the framework
(plain `<input>` underneath) or hand-write `formAssociated` on a raw
custom element. With this in, `p-input`-style components become a
drop-in `<form>` participant: FormData submission, validity
constraints, reset, disabled propagation, state restore.
**Expected win:** Unblocks the entire "real form components"
category for Purity. Pairs naturally with existing `::prop`
two-way binding.
**Trade-offs:** Adds API surface — an options bag on `component()`,
four lifecycle hooks, and documentation responsibility for validity
constraints. Bumps the "21 functions" tagline if we count the new
hooks. May warrant introducing the options bag as a general extension
point (e.g. for future `delegatesFocus`).

**Re-verify before executing:**

- [ ] WebFetch caniuse `wf-form-associated-custom-elements` — confirm
      Safari 16.4 still the floor and no regressions.
- [ ] Re-read MDN `ElementInternals` for the form lifecycle callback
      shapes. Specifically `formStateRestoreCallback(state, mode)` and
      what `mode` values exist.
- [ ] Check Firefox's ARIA-mixin gap on `ElementInternals` — confirm it
      only affects ARIA properties, not form participation (per
      research it does).
- [ ] Survey 2026 references (Lit, FAST, vanilla examples) for
      idiomatic API shapes — does our options bag match community
      conventions?

**Execution plan:**

1. Draft ADR: "Form-associated components via options bag".
2. Add `component(tag, fn, { formAssociated?: boolean, delegatesFocus?:
boolean })` overload.
3. When `formAssociated`, set `static formAssociated = true` on the
   element class, call `attachInternals()` in the constructor.
4. Add the four lifecycle hooks. Route to `_ctx` arrays parallel to
   `mounted` / `destroyed`.
5. Add `internals` accessor inside the render function so user code can
   call `setFormValue` / `setValidity`.
6. Tests: a `p-test-input` that participates in FormData submission;
   reset round-trip; validity propagation.

---

## Opportunity 5 — `moveBefore` + `connectedMoveCallback` in `each()` reorder

**Status:** Progressive enhancement (Chromium-only today).
**ADR required** — touches the hydration + lifecycle invariants.
**Files:** `packages/core/src/control.ts` (the LIS reorder path in
`each()`), `packages/core/src/elements.ts` (define
`connectedMoveCallback` on `PurityElement` so its semantics opt in).
**Why:** Today, `each()`'s LIS reorder relocates a keyed row by
`insertBefore`. For a row whose root is a Purity custom element, this
triggers `disconnectedCallback` → `connectedCallback`, destroying
`_ctx`, re-firing `onMount`, re-rendering the shadow tree, and
re-subscribing every resource. State that should be visually stable
across a reorder (focus inside a row, an in-flight CSS transition, an
iframe's load state, a `<video>`'s playback) is lost. `moveBefore`
preserves all of these on supporting engines; `insertBefore` remains
the cross-browser fallback so correctness is unaffected.
**Expected win:** Real bug fix for `each()` reorder on Chromium; no-op
elsewhere. Opens the door to similar treatment in `match()` cache
re-attach and `teleport()`.
**Trade-offs:** Adds a feature-detect branch in the reorder hot path.
Slightly subtle semantics for users: `connectedMoveCallback` is
"state-preservation, not correctness" — must be documented.
Hydration interaction needs thought: if SSR DOM is already in the
right order, hydration is unaffected; only client-side reorder
benefits.

**Re-verify before executing:**

- [ ] WebFetch MDN `Element.moveBefore` and Chrome blog for
      `connectedMoveCallback` — confirm the API + semantics haven't
      shifted (especially the throw conditions).
- [ ] Check standards-positions repo for Firefox + WebKit updates —
      if either has shipped since May 2026, this becomes a
      no-feature-detect change.
- [ ] Confirm the precise `moveBefore` preconditions: same document,
      both connected (or both detached), refNode is a child of the
      target, no ancestor moves.
- [ ] Decide handling for cases where `moveBefore` throws at runtime
      (corrupt structural assumption): fall back to `insertBefore` and
      log a warning behind `enableHydrationWarnings()`.

**Execution plan:**

1. Draft ADR: "Use moveBefore in each() reorder for state-preserving
   keyed list updates".
2. Add `connectedMoveCallback() {}` (empty body) to `PurityElement` so
   it opts into the move semantics without changing behavior.
3. In the LIS reorder loop, branch on `'moveBefore' in Element.prototype`;
   wrap in `try/catch` and fall back to `insertBefore` on throw.
4. Tests: a focus-preservation test (focus inside a row, trigger
   reorder, assert focus survives) — runs in Chromium-flavored
   Playwright/Vitest browser mode only, with an explicit skip on
   non-supporting engines.

---

## Out of scope for now

These came up in the research but are not on the action list yet:

- **CSS Module Scripts** (`import sheet from './x.css' with { type:
'css' }`) — Firefox gap as of May 2026. Re-evaluate quarterly.
- **`:host-context()`** — Chromium-only; WebKit explicitly declined.
  Do not expose as a documented styling hook.
- **Cross-root ARIA / Reference Target** — Interop 2026 target, but
  only in a Chromium origin trial. Watch for Firefox + WebKit
  intent-to-ship signals.
- **Serializable shadow roots** (`getHTML({ serializableShadowRoots:
true })`) — useful in-browser, but Purity's SSR runs on Node where
  this API isn't present. Revisit if a browser-side SSR target
  emerges.
- **Scoped custom-element registries** — Chromium-only shipped path;
  not yet a clear Purity benefit since `component()` already uses the
  global registry intentionally.

## Re-verify cadence

Every item above includes a per-item checklist. In addition: re-fetch
the **Snapshot of platform status** table itself before starting any
opportunity that hasn't moved in 60 days — the row that mattered most
may have shifted (e.g. WebKit shipping `moveBefore` would change
Opportunity 5 from progressive-enhancement to baseline).
