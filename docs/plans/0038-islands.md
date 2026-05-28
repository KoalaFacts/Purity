# 0038: Islands — implementation plan

Companion to ADR [0038](../decisions/0038-islands.md). The ADR fixes
the design; this plan fixes the order, the file-level touchpoints, and
the acceptance criteria for each PR. Line numbers are accurate as of
commit `f0fc56f` and should be re-checked at the start of each PR.

## Conventions

- One PR per phase. Each PR is independently mergeable and leaves the
  framework in a working state.
- Test before code where the test is cheap to write first (brand
  recognition, marker emission).
- New public exports go into `packages/core/src/index.ts` only when
  the PR that ships the feature lands — no exporting half-built
  primitives.
- Bundle-size assertion: every PR runs the existing size budget check
  in `packages/core/scripts/size.*` (or wherever `npm run check`
  exercises it). PRs that grow the shell budget without an island in
  play are rejected; the whole point is zero cost when unused.

## Dependency graph

```
P1 (brand)
  ├── P2 (bootstrap + hydrate per root)   needs P1
  │     ├── P3 (vite chunk split)         needs P2
  │     │     └── P4 (all triggers)       needs P3
  │     │           └── P5 (example)      needs P4
```

P6 (`signalChannel`) is a separate ADR and not on this plan's critical
path.

---

## P1 — `island()` brand + SSR passthrough

**Goal.** Ship `island(view, options)` as a no-op brand. Calling it
records `{ trigger, view }` and renders the wrapped view unchanged on
SSR and client. No bootstrap script yet, no chunk split yet. Validates
the brand mechanism end-to-end and lets users start annotating without
behaviour change.

**New files.**

- `packages/core/src/island.ts` — `island(view, options)` factory,
  `IslandBrand` symbol + interface, `isIsland(v)` guard. ~50 LOC.
- `packages/core/tests/island-brand.test.ts` — brand recognition,
  passthrough rendering, default trigger is `'load'`. ~80 LOC.

**Edits.**

- `packages/core/src/index.ts` — add `export { island } from './island'`.
- `packages/core/src/compiler/ssr-runtime.ts` (~lines 17–24, where
  the `SSRHtml` brand lives) — add an `IslandBrand` recognition case
  in whatever helper renders branded values. The case calls through
  to the wrapped view's renderer. No new HTML emitted; the bootstrap
  is P2.
- `packages/ssr/src/render-to-string.ts` — no edit needed if P1's
  brand is fully transparent. Verify by running existing SSR tests.

**API delta.**

```ts
export type IslandTrigger = 'load' | 'idle' | 'visible' | 'interact' | `media:${string}`;

export interface IslandOptions {
  hydrate?: IslandTrigger; // default 'load'
}

export function island<V>(view: V, options?: IslandOptions): V;
```

The return type is `V` — the brand is invisible at the type level.
The runtime brand is attached as a non-enumerable symbol property so
it survives function passing without polluting `typeof view`.

**Acceptance.**

- `island(MyComp)()` renders identically to `MyComp()` in CSR.
- `renderToString(() => island(MyComp)())` produces identical bytes to
  `renderToString(() => MyComp())`.
- `npm test --workspaces` green; no shell bundle-size delta on the
  size-budget check (brand is dead-code-eliminated when only its
  passthrough behaviour is used).

**Risks.**

- _Brand survives `Function.prototype.bind` / wrapper functions_?
  Mitigation: brand the _return value_ of `view()`, not `view` itself,
  if the closure form proves fragile. The test suite makes both forms
  fail loudly.
- _TypeScript inference loses the original signature_? Mitigation:
  the `<V>` generic preserves it; tests assert this with a
  type-only test (`expectTypeOf`).

**Estimate.** ~150 LOC, half-day.

---

## P2 — Per-island bootstrap + `hydrate(root)` on island roots

**Goal.** SSR emits a per-island bootstrap `<script type="module">`
sibling that awaits the trigger, dynamic-imports the main bundle, and
calls `hydrate(root, View)` on the island's root. Only two triggers
ship in this phase: `'load'` (immediate) and `'visible'`
(`IntersectionObserver`). Chunks are _not_ split yet — the bootstrap
imports the main bundle. This phase validates the trigger machinery
and the per-root hydration handoff in isolation from the bundler
work.

**New files.**

- `packages/core/src/island-bootstrap.ts` — bootstrap template
  generators. One function per trigger (`bootLoad`, `bootVisible`),
  each returning the inline script source string. ~80 LOC.
- `packages/core/tests/island-hydrate.test.ts` — `hydrate()` on an
  island root, no shell hydration, bindings work. ~120 LOC.
- `packages/ssr/tests/island-bootstrap.test.ts` — SSR output
  contains the bootstrap script with the right `data-pi` ID; bytes
  match snapshot. ~80 LOC.

**Edits.**

- `packages/core/src/component.ts:311` — `hydrate(container, View)`
  already accepts any Element. Verify: add a test that hydrates an
  island root mid-document without touching the shell. No code
  change expected; this is a contract pin.
- `packages/core/src/compiler/ssr-runtime.ts` — extend the island
  brand case from P1: after rendering the wrapped view, append the
  bootstrap script string. Allocate a monotonic `pi` ID per
  `SSRRenderContext` (parallel to suspense's `s:N`).
- `packages/ssr/src/render-to-string.ts:67, 220–246` — the resource
  script injection (`<script id="__purity_resources__">`) is the
  reference for "where inline scripts go". Confirm the bootstrap
  emits _inline next to the island_, not in the document tail —
  otherwise the trigger fires before the DOM exists.
- Marker grammar for non-custom-element islands: add `<!--pi:N-->`
  and `<!--/pi:N-->` to the same comment-marker family as
  `<!--s:N-->` (ADR 0006). Document next to the existing markers in
  the codegen comments.

**Bootstrap shape (load trigger).**

```html
<my-counter data-pi="0">
  <template shadowrootmode="open">…</template>
</my-counter>
<script type="module" data-pi-boot="0">
  import('/_purity/main.js').then((m) => m.__pi[0](document.querySelector('[data-pi="0"]')));
</script>
```

The `__pi` array is a per-page registry of `(root) => void` functions,
one per island, emitted into the main entry by the codegen pass added
to the existing client-entry generation. In P3 this is replaced by
per-island chunks; in P2 it's all bundled together.

**Bootstrap shape (visible trigger).**

```html
<script type="module" data-pi-boot="0">
  const el = document.querySelector('[data-pi="0"]');
  new IntersectionObserver((es, o) => {
    if (es.some((e) => e.isIntersecting)) {
      o.disconnect();
      import('/_purity/main.js').then((m) => m.__pi[0](el));
    }
  }).observe(el);
</script>
```

**Acceptance.**

- An island wrapping a custom element renders DSD on the server, the
  bootstrap fires on the configured trigger, and `hydrate()` runs on
  the island root only.
- The shell outside the island has no marker pairs and no client
  bindings.
- Click handlers inside the island fire after hydration.
- `visible` trigger: hydration does not run if the island is below
  the fold and never scrolled into view (assert by intercepting the
  dynamic import).
- CSP: when `renderToString({ nonce })` is passed, every emitted
  bootstrap script carries `nonce="..."`. Mirror the existing nonce
  plumbing from ADR 0006 (`renderToStream`).

**Risks.**

- _The bootstrap fires before the island element exists._ Mitigation:
  `<script type="module">` is deferred and executes after DOM parsing
  in document order; sibling-after-element placement guarantees the
  element exists.
- _Multiple islands of the same component on one page collide on
  `data-pi`._ Each gets its own monotonic ID; the test suite covers
  N>1.
- _Hydration mismatch warnings fire because the shell has no
  markers._ The hydrator only walks where called; this is a non-issue
  but the test suite pins it.

**Estimate.** ~350 LOC across core + SSR + tests, two days.

---

## P3 — Vite plugin: per-island chunk split

**Goal.** Identify `island(...)` call sites at build time, emit a
virtual `purity:island/N` module per island, and switch the bootstrap
from `import('/_purity/main.js')` to `import('/_purity/island-N.js')`.
The main bundle now contains only non-islanded interactivity (often
_nothing_ for content pages). This phase delivers the headline byte
savings.

**New files.**

- `packages/vite-plugin/src/islands.ts` — `detectIslandCalls(source)`
  (regex), island registry, virtual-module ID minting,
  `generateIslandModule(islandId)` (the per-island chunk source).
  ~250 LOC.
- `packages/vite-plugin/tests/islands.test.ts` — detection regex
  cases (named import, aliased import, comments, false positives in
  strings); virtual-module resolution; emitted bootstrap references
  the right chunk URL. ~200 LOC.

**Edits.**

- `packages/vite-plugin/src/index.ts:154, 160, 193` — wire
  `resolveId` / `load` / `transform` hooks to the islands registry,
  mirroring the existing `purity:routes` virtual-module wiring in
  `routes.ts`.
- `packages/vite-plugin/src/routes.ts:279–298` — `detectLoaderExport`
  is the regex precedent. Mirror its shape: `\bisland\s*\(` with
  an exclusion for `// `-style comments and string-literal contexts.
- `packages/core/src/compiler/ssr-runtime.ts` — the bootstrap
  template (from P2's `island-bootstrap.ts`) now reads the chunk URL
  from a build-time injected map rather than hardcoding
  `/_purity/main.js`. The map is a small JSON manifest emitted by
  the Vite plugin at build time, served at `/_purity/island-map.json`
  in dev and inlined into the SSR HTML at build.

**Chunk shape.**

The per-island virtual module exports:

```ts
export function boot(root: Element): void;
```

Its implementation:

```ts
import { hydrate } from '@purityjs/core';
import { View } from './island-N-view'; // generated; imports user code
export function boot(root) {
  hydrate(root, View);
}
```

Rollup deduplicates shared imports across islands automatically — no
`manualChunks` config needed. The dynamic `import()` from the
bootstrap is what drives chunk emission.

**Dev vs build.**

- _Dev_: Vite serves each virtual module on demand via `load()`. The
  bootstrap imports `/_purity/island-N.js` which Vite resolves to
  the in-memory virtual module. HMR for the island's user code
  triggers a full re-import (acceptable for islands; hot-swap inside
  a hydrated island is a separate problem).
- _Build_: Rollup emits each virtual module as a real chunk; the
  bootstrap's URL is rewritten to the hashed filename. The
  island-map JSON is inlined into every SSR HTML response so the
  bootstrap script knows where to import from.

**Acceptance.**

- A page with one island and otherwise-static content has a main
  bundle of `0 B` (or near-zero, only what's actually used by
  non-island reactive code).
- The island's chunk contains only the island's view + its
  transitive deps + the minimum `@purityjs/core` runtime it touches
  (verified by chunk-bytes assertion in tests).
- Two islands sharing a helper module produce a third shared chunk
  (Rollup's default dedup); the test pins this.
- Dev mode HMR: editing the island's source triggers a re-bundle of
  its chunk only.

**Risks.**

- _Regex detection misses dynamically-imported `island()` calls_ (e.g.
  `const isle = await import('./isle'); isle.default(...)`). Acceptable
  miss in MVP — documented limitation. Static detection covers the
  authored pattern, and runtime registration is a follow-up if real
  apps hit this.
- _The island's view function captures a closure over module-scope
  state_ (e.g. a top-level `state()` shared with the shell). When the
  island is split into its own chunk, the closure is duplicated, not
  shared. Document this loudly in the JSDoc and the example.
  Cross-island state belongs in URL / `persist()` / server.
- _Build-time codegen for the bootstrap depends on knowing chunk URLs
  before they're hashed._ Standard Vite plugin pattern — use Rollup's
  `generateBundle` hook to rewrite the bootstrap script content with
  the final hashed filenames.

**Estimate.** ~600 LOC, three to four days. This is the load-bearing
phase.

---

## P4 — Remaining triggers (`'idle'`, `'interact'`, `media:(...)`)

**Goal.** Fill in the trigger templates omitted from P2. Each is a
small, specialised inline script. No new architecture.

**Edits.**

- `packages/core/src/island-bootstrap.ts` — add `bootIdle`,
  `bootInteract`, `bootMedia(query)` generators.
- `packages/core/tests/island-triggers.test.ts` (new) — one test per
  trigger asserting (a) the emitted script source, (b) the trigger
  semantics in a jsdom environment with `IntersectionObserver` /
  `matchMedia` / `requestIdleCallback` mocked. ~250 LOC.

**Bootstrap templates.**

- `'idle'`: `requestIdleCallback(() => import(...), { timeout: 2000 })`,
  fallback `setTimeout(() => import(...), 1)` for Safari pre-17.
- `'interact'`: `['pointerdown','focusin','keydown'].forEach(e =>
el.addEventListener(e, h, { once: true, capture: true }))`, handler
  removes the other listeners and triggers the import.
- `'media:(min-width: 768px)'`: `const mq = matchMedia('(min-width:
768px)'); if (mq.matches) import(...); else mq.addEventListener(
'change', e => e.matches && import(...), { once: true })`.

**Acceptance.**

- Each trigger fires under its condition and doesn't fire under
  others, verified in jsdom tests.
- `'interact'`: the click that _fires_ the trigger is replayed after
  hydration so it doesn't get lost. (See ADR's "Out of scope" — we
  said event replay is out of scope, but the click that _causes_ the
  hydration is the trivially-replayable case. Tracks separately if
  it proves harder than expected.)
- `media:(...)` query string is escaped to avoid script-injection
  via a crafted query.

**Estimate.** ~300 LOC, one day.

---

## P5 — Example + docs

**Goal.** Make the feature discoverable and copy-pasteable. One
working example, one docs page, JSDoc on the public API.

**New files.**

- `examples/islands-blog/` — a content-heavy blog page with two
  islands: a comment counter and a theme toggle. Sibling pages exist
  in `examples/` (compare `examples/ssr/`, `examples/dashboard/`) —
  match their `package.json` shape.
- `docs/islands.md` — when to use islands, the trigger matrix, the
  cross-island state patterns, the bundle-size guarantee.

**Edits.**

- `packages/core/src/island.ts` — JSDoc covering: trigger semantics,
  the cross-island-state warning, the
  closure-over-shell-state warning.
- `README.md` — one paragraph mention + link to the docs page.
- `CLAUDE.md` (root) — add `island()` to the function inventory if
  the count is maintained there (it's not — leave it).

**Acceptance.**

- `cd examples/islands-blog && npm install && npm run build` produces
  a main bundle measurable in single-digit kB or less, with each
  island as its own chunk.
- `npm run dev` serves the example with islands hydrating on their
  triggers (manual check: scroll to bring the counter into view,
  watch the network panel for the chunk request).
- The docs page is linked from the root README and the decisions
  README.

**Estimate.** ~400 LOC of example + ~200 lines of docs, one day.

---

## Out-of-band tasks

These don't gate any phase but should land alongside the work:

- **Bundle-size budget update.** Add an explicit budget line for the
  island bootstrap (per trigger) so accidental growth is caught. The
  shell budget (5.8 kB gzipped per the root CLAUDE.md) does not
  move — islands cost only when used.
- **Public type re-exports.** Confirm `IslandTrigger` and
  `IslandOptions` are exported from `@purityjs/core` so users can
  type their own island helpers.
- **Telemetry of `island()` call counts** in dev mode console (gated
  by an env flag) — useful for the docs example and for catching the
  "I accidentally made everything an island" anti-pattern.

## What this plan deliberately leaves out

- The `signalChannel(name)` follow-up (its own ADR).
- Per-island Suspense boundaries (ADR 0006 said no, this plan agrees).
- Streamed island chunks via `<link rel="modulepreload">` — perf
  optimisation, not architectural. Can be added later without
  changing the surface.
- A `client:only` equivalent — the user can already produce this
  by wrapping the view in a `when(typeof window !== 'undefined',
...)` gate inside the island. If real apps need an ergonomic
  shortcut, file a follow-up.
