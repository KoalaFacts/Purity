# 0038: Islands — opt-in per-subtree hydration

**Status:** Proposed
**Date:** 2026-05-27

## Context

The SSR pipeline shipped under ADRs [0004](./0004-ssr-mvp.md) and
[0005](./0005-non-lossy-hydration.md) treats every page as one tree:
the server emits a complete HTML document (DSD + marker pairs), the
client downloads the full app bundle, and `hydrate()` walks the whole
tree to wire up reactivity. That's the right shape for app-like pages
where most of the document is interactive — dashboards, editors, mail
clients. It's the wrong shape for content-heavy pages where most of
the document is static — marketing pages, docs, blog posts, landing
pages, listing pages — and only a few regions actually need to react
to anything.

The shipping ecosystem has converged on **islands architecture** for
this workload:

- **Astro** — `client:load`, `client:idle`, `client:visible`,
  `client:media`, `client:only` directives on imported framework
  components. The surrounding HTML is rendered once on the server and
  ships zero JS; each islanded component ships its own framework runtime
  - component code on its own schedule.
- **Fresh (Deno)** — `islands/` directory; anything imported from it is
  an island, anything else is server-only.
- **Marko** — `.marko` files declare per-tag boundaries; the compiler
  emits server-only HTML for static tags and a small runtime for
  interactive ones.
- **Eleventy + is-land** — runtime-only islands via a `<is-land>`
  custom element that defers loading the inner component.

The shape is stable across frameworks: a build-time annotation marks
certain subtrees as interactive, the rest of the page renders to plain
HTML with no client runtime, and each island has its own hydration
trigger (immediate, idle, visible, on-interaction, on-media-query).

Purity has the pieces to do it cleanly:

1. The compiler already runs three codegen modes — `generate` (DOM),
   `generateSSR` (string), `generateHydrate` (marker-walk + bind). The
   missing piece is **which subtree gets which mode**. Today the answer
   is "the whole tree gets all three"; for islands it becomes "the whole
   tree gets `generateSSR`, but only island subtrees get `generate` /
   `generateHydrate`".
2. The hydration runtime (ADR 0005) walks `<!--[--><!--]-->` marker
   pairs to attach bindings without rebuilding the DOM. The same walker
   can run on an island subtree in isolation — there's nothing in the
   walker that assumes "from `document.body`". An island's bootstrap
   passes the island's root element to `hydrate()` and the walker takes
   it from there.
3. Custom Elements + Declarative Shadow DOM (`<template
shadowrootmode="open">`) work in the browser _before_ the element's
   JS class is registered — the DSD content renders as visual content
   immediately, and the element upgrades in place when
   `customElements.define()` is later called. This is the foundation
   that makes non-lossy hydration possible for islands: an islanded
   component looks identical pre- and post-hydration, no re-render, no
   flash.
4. The Vite plugin already does build-time module-graph analysis for
   ADR [0018](./0018-server-module-strip.md) (server-module strip) and
   ADR [0019](./0019-file-system-routing.md) (route manifest). Adding a
   per-island chunk split is the same shape of work — identify the
   modules reachable only from `island(...)` calls and emit them as
   separate chunks.

The reason we didn't ship islands with the SSR MVP was scope and
prioritisation: the whole-page hydration story had to land first
because islands depend on it (an island _is_ a non-lossy hydration
boundary). With ADRs 0005, 0006, and 0019–0034 shipped, the
foundations are now in place and the missing work is small enough to
fit in one ADR.

## Decision (proposed)

**Add an `island(view, options?)` wrapper that marks a view as a
hydration boundary, and teach `@purityjs/vite-plugin` to split each
island's module subgraph into its own chunk loaded by a tiny inline
bootstrap that defers hydration until the configured trigger fires.**
The surrounding page renders to static HTML with no client runtime;
only island chunks ship JS.

### User-facing API

```ts
import { island, component, html, state } from '@purityjs/core';

const Counter = component('my-counter', () => {
  const n = state(0);
  return html`<button onclick=${() => n.update((v) => v + 1)}>${n}</button>`;
});

// Mark it as an island; the wrapped view IS the original view,
// with a brand the compiler / SSR codegen recognises.
export const InteractiveCounter = island(Counter, { hydrate: 'visible' });
```

```ts
// Anywhere in the surrounding (static) page:
const Page = () => html`
  <article>
    <h1>Hello</h1>
    <p>Lots of static content…</p>
    ${InteractiveCounter()}
    <p>More static content. None of this paragraph or its surroundings ship JS.</p>
  </article>
`;
```

`island(view, options)` takes any view function (a `component()` host,
a plain html-returning function, or a `match()` / `each()` subtree)
and returns a view branded as an island boundary. The brand is opaque
to user code; the SSR codegen and the Vite plugin look for it.

### Hydration triggers

| Trigger       | Semantics                                                                      |
| ------------- | ------------------------------------------------------------------------------ |
| `'load'`      | Hydrate immediately after the chunk loads. Default.                            |
| `'idle'`      | Hydrate inside `requestIdleCallback` (fallback: `setTimeout(0)`).              |
| `'visible'`   | Hydrate when the island enters the viewport (`IntersectionObserver`).          |
| `'interact'`  | Hydrate on first `pointerdown` / `focusin` / `keydown` inside the island root. |
| `media:(...)` | Hydrate when the given media query matches (`matchMedia`).                     |

Triggers are mutually exclusive in the MVP — one per island. Composite
triggers (`['visible', 'interact']`, "whichever fires first") can be
added without breaking the API.

### Server output

For an island wrapping a custom element, the server emits exactly what
it emits today (DSD + marker pairs) plus a per-island bootstrap
sibling:

```html
<my-counter data-pi="0">
  <template shadowrootmode="open">
    <!--[-->
    <button>0</button>
    <!--]-->
  </template>
</my-counter>
<script type="module" data-pi-boot="0">
  // Inlined per-trigger waiter, then dynamic import + hydrate.
  import('/_purity/island-0.js').then((m) => m.boot('[data-pi="0"]'));
</script>
```

For an island wrapping a non-custom-element view (a plain html-returning
function), the server wraps the rendered subtree in `<!--pi:N-->...

<!--/pi:N-->` markers so the bootstrap can locate the root by marker

ID rather than by data attribute.

The bootstrap script is per-trigger: `'load'` calls `boot()`
immediately; `'visible'` constructs an `IntersectionObserver`;
`'interact'` adds `{ once: true }` listeners; etc. Each bootstrap is a
~150-byte template specialised for one trigger at compile time. No
client-side trigger registry.

### Client chunk shape

For each `island(view, ...)` call site the Vite plugin emits a chunk
that exports:

```ts
export function boot(rootSelector: string | Element): void;
```

The chunk contains:

- The island's view function compiled in `generate` + `generateHydrate`
  modes (both — `generate` for the case where the chunk loads _before_
  the SSR HTML has been parsed for this region, e.g. a Suspense
  boundary mid-stream; `generateHydrate` for the normal case).
- The minimum `@purityjs/core` runtime the view actually uses
  (`hydrate`, `mount`, `state` / `compute` if reactivity is used,
  control-flow helpers if used). Tree-shaken per island.
- Any user modules transitively imported only from this island.

If two islands share imports (e.g. both use a shared `signals.ts`
helper), Vite's standard chunk-deduplication splits the shared piece
into a separate chunk — the same behaviour as any other
dynamic-import shape.

### Compiler & plugin changes

| Component                                   | Change                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/island.ts`               | New file. `island(view, options)` returns a branded view; brand carries `{ trigger, viewRef }` for codegen pickup. ~30 LOC.                                                                                                                                                             |
| `packages/core/src/compiler/ssr-runtime.ts` | When emitting an island brand: render the wrapped view, then append the per-trigger bootstrap script next to it.                                                                                                                                                                        |
| `packages/core/src/compiler/index.ts`       | New `generateIsland` pass: produces the per-island `boot()` chunk's source.                                                                                                                                                                                                             |
| `packages/vite-plugin/src/index.ts`         | Scan modules for `island(...)` call sites (regex-based, similar to ADR 0022's loader detection); register each as a virtual `purity:island/N` module backed by `generateIsland`; surface them to Rollup as dynamic-import targets so `manualChunks` keeps the default per-island split. |
| `packages/vite-plugin/src/islands.ts`       | New file. Island registry, brand discovery, bootstrap template per trigger.                                                                                                                                                                                                             |
| `packages/ssr/src/render-to-string.ts`      | Unchanged — island brands fall through `_h.island(view, opts)` which the SSR runtime already handles per the row above.                                                                                                                                                                 |
| `packages/core/src/hydrate.ts`              | Unchanged — `hydrate(root, View)` already accepts any element as the starting point.                                                                                                                                                                                                    |

Bundle delta on the shell: **zero** for pages with no islands; the
brand wrapper is dead-code-eliminated. For pages with islands, each
bootstrap script adds ~150 bytes (specialised per trigger) and each
chunk pays whatever its imports cost — but the shell itself stays
JS-free.

### Cross-island state

Two islands on the same page have independent signal graphs. Three
documented patterns cover the realistic use cases:

1. **URL / hash / search params** as the shared store, via the existing
   `currentSearch()` / `currentHash()` signals (ADR 0014). Works
   without any new primitive.
2. **`persist()`** (see brainstorm in ADR backlog) when it lands —
   shared key in `localStorage` / `sessionStorage` / cookie, with
   `storage` event propagation. Out of scope for this ADR.
3. **Server round-trip via `serverAction()`** (ADR 0012) for state
   that has to be authoritative.

A `signalChannel(name)` BroadcastChannel-backed primitive is an
obvious follow-up but explicitly out of scope here — the first three
patterns handle the realistic cases without new API surface.

## Out of scope

- **Automatic island detection.** No "this component uses signals,
  therefore it's an island" heuristic. Islands are an explicit
  authorial choice — the wrong default for app-like pages, and
  surprising in either direction. Opt-in via `island(...)`.
- **Server Components / `client:only` equivalent.** Astro's
  `client:only` skips SSR entirely for the island. Out of scope — the
  current `resource()` + suspense path handles client-only fetches
  inside a normally-hydrating island already.
- **Per-island Suspense boundaries.** ADR 0006 marked
  "per-Suspense code splitting / islands" as out of scope; this ADR
  inherits that. A streamed Suspense boundary can _contain_ an island,
  but the boundary itself is not an island.
- **Selective hydration order driven by user interaction.** Triggers
  fire when their condition fires; there's no priority queue. Good
  enough for the MVP; revisit if real apps complain.
- **Cross-island event replay.** If a user clicks an island that
  hasn't hydrated yet, the click is lost. Acceptable for `'visible'`
  and `'idle'` triggers (the user is unlikely to be interacting yet);
  for `'interact'` it's exactly the trigger that hydrates, so the
  click that hydrates _is_ the click that wires up the handler — a
  separate spec issue worth a follow-up if real users notice the lost
  first event.
- **`signalChannel(name)` BroadcastChannel primitive.** Useful for
  cross-island state but unrelated to the islands mechanism itself;
  belongs in its own ADR.
- **File-system "islands directory" convention** (à la Fresh). The
  Vite plugin already discovers islands via the `island(...)` call
  site; a directory convention adds a second source of truth.

## Consequences

**Positive:**

- Content-heavy pages can ship zero client JS for everything outside
  islands. A blog post with a single comment-counter island pays the
  bytes for the counter, not for the framework.
- The hydration story is unchanged inside an island. ADR 0005's
  non-lossy walker runs on the island root the same way it runs on
  `document.body` today — no second hydration model, no second
  hydrator to maintain.
- Custom Elements + DSD make the pre-/post-hydration handoff
  invisible: the island looks identical before its chunk loads and
  after, because the DOM is identical. Astro / Fresh both have a
  visible flash on hydration for non-trivial components; Purity
  doesn't.
- The opt-in shape preserves the current default. Apps that don't
  call `island(...)` see no change in build output, bundle size, or
  runtime behaviour.

**Negative:**

- Per-island chunks mean more HTTP requests for content-heavy pages
  with many islands. Mitigations: HTTP/2 multiplexing (default in
  every modern server), and the
  ADR 0029 hover-prefetch story works for island chunks too if the
  user hovers near an island before its trigger fires.
- The per-island bootstrap script is inline `<script type="module">`.
  Strict CSP setups need a nonce on each one. The bootstrap
  inherits the same `nonce` option already added to `renderToStream`
  for ADR 0006; we surface it from `renderToString` too.
- Cross-island state requires user discipline (URL / `persist()` /
  server). Apps that put two islands on a page and expect them to
  share an in-memory signal will hit a surprise; the docs and the
  `island()` JSDoc need to flag this prominently.
- Routing across pages with different island sets behaves like an
  MPA boundary — the SPA router (ADR 0011 ff.) either treats
  island-only navigations as full reloads, or has to teach
  `navigate()` how to re-evaluate the island set on the destination
  page. Phase 1 takes the simpler path: SPA navigation works as
  today, and islands hydrate per the destination page's bootstraps
  on first visit. Cross-page island state survives via the same
  URL / `persist()` story.

**Neutral:**

- The `island()` brand adds one new exported symbol to
  `@purityjs/core`. Tiny API surface delta.
- The Vite plugin grows a new pass but reuses the existing
  module-graph analysis from ADR 0018. No new dependencies.
- Tests need a streaming-chunk-aware harness similar to ADR 0006's
  but for dynamic imports. The existing `@vitest/web-worker` setup
  covers the import side; we add a small "wait for chunk N" helper.

## Implementation plan

Phases, each landable as its own PR:

1. **`island()` brand + SSR codegen passthrough.** Ship `island(view,
options)` as a no-op brand that records `{ trigger, view }` and
   delegates rendering to the wrapped view. SSR emits the wrapped
   view's HTML unchanged. No chunk split yet — the island's code still
   ships in the main bundle. Validates the brand mechanism end-to-end
   and lets users start annotating without behaviour change. ~150 LOC,
   one PR.

2. **Per-island bootstrap script + `hydrate(root)` on island roots.**
   SSR appends a `<script type="module" data-pi-boot="N">` sibling per
   island; the script awaits the trigger, then calls `hydrate()` on
   the island's root element. Chunks are still in the main bundle —
   the bootstrap imports the main bundle and finds the island's view
   by ID. Validates the trigger machinery and the hydration handoff.
   ~250 LOC, one PR. End-state for this phase: islands work
   end-to-end, but the JS-savings story isn't there yet.

3. **Vite plugin: per-island chunk split.** New scan pass identifies
   `island(...)` call sites, registers each as a virtual module, and
   uses Rollup's `manualChunks` to emit them as separate chunks. The
   bootstrap from Phase 2 switches from `import('/main.js')` to
   `import('/_purity/island-N.js')`. The main bundle is empty for
   pages with no non-islanded interactivity. ~400 LOC, one PR. This is
   the phase that delivers the headline byte savings.

4. **All triggers (`'load'`, `'idle'`, `'visible'`, `'interact'`,
   `media:(...)`).** Phase 2 ships `'load'` and `'visible'` only
   (enough to validate the trigger plumbing). This phase fills in the
   rest with per-trigger bootstrap templates. ~100 LOC, one PR.

5. **Documentation + example.** A new `examples/islands-blog/`
   showing a content-heavy blog page with one or two islands, plus a
   docs section explaining when to reach for `island()` vs leaving a
   region as part of the main bundle. ~200 LOC of example code + docs.

6. **(Follow-up, separate ADR) `signalChannel(name)` for cross-island
   state.** BroadcastChannel-backed signal; tab-local propagation. Not
   strictly part of islands but the most-asked-for follow-up.

Each phase has its own test + docs requirements; ADRs may follow if
any phase reveals decisions that contradict this plan.

## Alternatives considered

- **Directory convention instead of a function brand
  (Fresh-style `islands/`).** Implicit and easy to grep, but adds a
  second source of truth (the directory _and_ the import graph) and
  means a single-file refactor — moving a component out of `islands/`
  to colocate it with its caller — silently changes its hydration
  behaviour. The function brand is explicit at the call site.

- **Per-component "client directive" attribute on the template
  (Astro-style `client:visible` HTML attribute).** Reads nicely in the
  template but ties the trigger to the call site, not the component
  definition; every caller of a counter has to remember the
  directive. Function brand at the definition site is the
  default-correct shape; an opt-out at the call site is a follow-up
  if needed.

- **Resumability instead of islands (Qwik-style).** Strictly larger
  scope and conflicts with the marker-based hydration model (ADR 0005).
  Islands are a small additive change; resumability is a re-architect.
  We picked islands.

- **Ship islands only for custom-element-rooted views.** Simpler
  (no marker-only island variant) but excludes the common case of an
  island that wraps an `each()` or `match()` subtree without
  introducing a custom element. The marker-pair fallback adds ~20 LOC
  to the SSR runtime and removes a sharp edge users would otherwise
  hit immediately.

- **Treat every `component(...)` as an island by default.** Surprising
  and wrong for app-like pages where the whole document is interactive
  — every component would split into its own chunk, and the network
  request count would balloon. Opt-in is the correct default; opt-out
  per-component (`island.never(...)`) can be added if real apps
  request it.

- **Stream the island chunks alongside the shell instead of
  dynamic-import on the client.** Possible (the shell could embed a
  `<link rel="modulepreload">` per island), but adds spec surface
  without changing the behavioural picture much — the chunks still
  execute on their trigger, the preload just shaves the round-trip
  latency. Worth doing as a perf optimisation later; not a separate
  architectural decision.
