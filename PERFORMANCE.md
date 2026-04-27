# How Modern Frameworks Optimize

Research notes on the techniques used by today's mainstream and
high-performance frameworks (React, Solid, Svelte 5, Vue 3 / Vapor, Qwik,
Million.js, Preact Signals, Marko, Inferno) to make UI updates fast. Compiled
April 2026.

The goal is to map each technique to the framework that best exemplifies it,
note the cost it eliminates, and call out which ideas are already present in
Purity's design vs. which could inform future work.

---

## 1. Compile-time templates → cloned DOM nodes

**Frameworks:** Solid.js, Vue Vapor, Svelte, Marko, Purity (already).

**Idea:** At build time, parse JSX/template strings into a static HTML
skeleton plus a small "edits list" of where dynamic values plug in. At
runtime, the skeleton is parsed once into a `<template>` element, and each
render `cloneNode(true)`s it and binds the dynamic slots.

**Why it's fast:**
- `template.content.cloneNode(true)` is the fastest way to mint a DOM tree —
  the parser ran once, ever.
- Static attributes/text never participate in any diff or update path.
- The "edits" can target nodes by positional path, no `querySelector` and no
  `TreeWalker`.

**In Solid:** the JSX compiler "extracts static HTML into cloned template
nodes and wraps dynamic expressions in fine-grained subscriptions" ([Solid
docs](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity)).

**In Vue Vapor:** "the Vue-Vapor compiler analyzes components during the
build, optimizing reactivity, conditional render paths, loops and event
handlers by hard-wiring them into DOM manipulations" ([BLUESHOE](https://www.blueshoe.io/blog/vue-vapor-performance-without-virtual-dom/)).

**In Purity today:** This is exactly what `packages/core/src/compiler/`
already does — `parser.ts` builds an AST, `codegen.ts` emits a function that
clones a template and runs positional binders, and `compile.ts` caches per
`TemplateStringsArray` via `WeakMap`.

---

## 2. Fine-grained reactivity (signals, no component re-execution)

**Frameworks:** Solid.js, Preact Signals, Vue 3 (refs), Svelte 5 (runes),
Qwik (signals), Angular (v17+ signals), Purity (TC39 Signals).

**Idea:** Replace "re-run the whole component on state change" with a
dependency graph: each binding subscribes only to the signals it reads, and
only those bindings re-execute when those signals change.

**Why it's fast:**
- Update cost scales with the number of *changed bindings*, not the size of
  the component tree.
- No reconciliation. No keyed-children diff at the component level.
- "Components run once as factory functions to set up a reactive graph,
  then never re-execute" ([Solid
  docs](https://docs.solidjs.com/concepts/intro-to-reactivity)).

**Lazy / pull-based computeds.** In Svelte 5, "the `$derived` rune is *lazy*
— it doesn't calculate the value until something actually needs to read it"
([Svelte blog](https://svelte.dev/blog/runes)). Vue 3.4+, Preact Signals,
and signal-polyfill all do this via version counters: a computed only
recomputes if a transitive source has actually changed.

**Push-pull hybrid.** Most modern signal libraries push *invalidations* eagerly
(mark dirty) but pull *values* lazily (only recompute on read). This avoids
recomputing hidden / off-screen branches.

**Diamond-dependency stability.** A → B, A → C, B and C → D should re-run D
once, not twice. Implemented via topological scheduling (Solid, Preact
Signals) or version vectors (Vue 3.4+, signal-polyfill).

**In Purity today:** uses `signal-polyfill` (TC39 reference impl) which
gives push-pull, lazy computeds, and version-counter diamond resolution out
of the box. The work in `packages/core/src/signals.ts` is mostly scheduling
glue around the polyfill.

---

## 3. Compiler-driven auto-memoization

**Framework:** React Compiler (1.0 shipped late 2025).

**Idea:** Static analysis of every JSX subtree and hook in a component to
determine which props/values are *actually* used to produce which JSX nodes,
then auto-insert `useMemo`/`memo`-equivalent caching at exactly the right
granularity.

**Why it's fast:**
- "By default, it targets granular memoization at the prop level rather than
  entire component trees. Instead of wrapping every component with
  `React.memo`, the compiler injects checks around individual props,
  skipping subtrees whose inputs haven't changed" ([Pockit
  blog](https://pockit.tools/blog/react-compiler-automatic-memoization-performance-guide/)).
- "The compiler memoizes each JSX element independently rather than
  memoizing the component as a whole."
- Real-world impact: Meta reports "up to 12% faster loads and 2.5× quicker
  interactions" ([InfoQ](https://www.infoq.com/news/2025/12/react-compiler-meta/));
  Sanity Studio reported "20–30% overall reduction in render time and
  latency."

**Why frameworks with fine-grained reactivity don't need this:** in Solid /
Svelte / Vue Vapor / Purity, the compiler/runtime already updates exactly
the bindings that read changed signals — there's no subtree to memoize
because there's no subtree re-execution.

---

## 4. Block / static-analysis VDOM

**Framework:** Million.js (and the original blockdom).

**Idea:** Keep a virtual DOM, but compile each component into a "block": a
static skeleton plus an *edit map* listing only the dynamic positions. Diffs
walk the edit map (size = number of dynamic holes), not the rendered tree.

**Why it's fast:**
- "The virtual DOM is analyzed to extract dynamic parts of the tree into an
  Edit Map… once a difference is determined, the DOM can be directly
  updated" ([Million.js docs](https://old.million.dev/blog/virtual-dom)).
- Million claims it "turns React reconciliation from O(n) to O(1)" relative
  to the static portion of the tree — i.e. static content is free at diff
  time.
- A useful framing for codebases that *can't* abandon the VDOM (large React
  apps).

**Conceptually adjacent to:** Solid's compiler-extracted templates and
Inferno's `createVNode` flags. The common idea is "tell the runtime which
parts can possibly change, so it never looks at the rest."

---

## 5. Resumability (skip hydration entirely)

**Framework:** Qwik.

**Idea:** Don't re-execute the component tree on the client to "hydrate"
event listeners and reactivity graphs. Instead, serialize all of that state
into the HTML on the server and *resume* execution only when the user
interacts.

**Why it's fast:**
- "Hydration is when an application is downloaded and executed twice, once
  as HTML and again as JavaScript… [it] must execute before the app becomes
  interactive" ([Builder.io](https://www.builder.io/blog/resumability-vs-hydration)).
- "By serializing the component boundaries, event listeners, and
  reactivity graph, a resumable framework can continue executing where the
  server left off" ([Qwik
  docs](https://qwik.dev/docs/concepts/resumable/)).
- "A button is interactive before any code execution with resumability."
- "Qwik allows any component to be resumed without the parent component
  code being present" — letting you fetch only the JS for the component the
  user is interacting with.

**Cost paid:** non-trivial serialization format and a build-time
chunker/optimizer that splits the app into per-listener bundles.

---

## 6. Server-aware compilation (don't ship reactivity to SSR)

**Framework:** Svelte 5.

**Idea:** Reactivity primitives are only useful where the value can change.
On the server, output is a one-shot string — the whole signal apparatus is
dead weight.

**Implementation:** "When compiling in server-side rendering mode, the
compiler can ditch the signals altogether, since on the server they're
nothing but overhead" ([Svelte blog](https://svelte.dev/blog/runes)). Svelte
also strips the `$state` wrapper entirely if a value is never written:
"Runes are not dumb wrappers — if a value is effectively a constant, the
wrapper gets erased" ([PkgPulse](https://www.pkgpulse.com/blog/svelte-5-runes-complete-guide-2026)).

**Generalization:** the same compiler can emit different runtimes for
different targets (SSR, hydration, CSR-only, edge). Svelte and Vue Vapor
both ship multiple per-mode outputs from one source.

---

## 7. Keyed-list reorder via Longest Increasing Subsequence

**Frameworks:** Inferno, Vue 3, Svelte, Purity (already).

**Idea:** When the keyed children of a list re-order, you want to perform
the **minimum** number of DOM moves. The set of nodes that *don't* need to
move is the longest increasing subsequence of new-position indices indexed
by old positions; everything else must move.

**Cost:** O(n log n) for LIS, but the move count is provably minimal.
Allocations are a few small arrays per list update.

**In Purity today:** implemented in `packages/core/src/control.ts:458-509`,
with a fast path for append-only updates at `control.ts:406-424`.

---

## 8. Batched, microtask-scheduled effect flush

**Frameworks:** Vue 3, Solid (createRoot/batch), Preact Signals, Purity.

**Idea:** A signal write doesn't run effects synchronously; it just marks
them dirty. A microtask scheduled at the first dirty mark drains the queue
once. This deduplicates updates from a burst of synchronous writes (e.g.
inside an event handler) into a single DOM update.

**In Purity today:** see `packages/core/src/signals.ts:73-117` (`watcher` →
`flush` via `queueMicrotask`) and the explicit `batch()` API.

---

## 9. Concurrent rendering and time-slicing

**Framework:** React 18+ (concurrent mode).

**Idea:** Treat rendering as cooperative work. The scheduler can pause a
long render at component boundaries, yield to the browser, and resume —
keeping the main thread responsive. Updates have priority levels
(`startTransition`, `useDeferredValue`).

**Trade-off:** requires render to be pure and replayable. Doesn't combine
naturally with fine-grained reactivity, where there's no "render pass" to
pause — instead Solid/Svelte/Vue handle responsiveness by keeping individual
updates O(changed bindings) rather than by yielding mid-render.

---

## 10. Islands and streaming SSR

**Frameworks:** Astro (islands), Marko (streaming + resumable), Solid Start,
Next.js (RSC + streaming).

**Islands** ship JavaScript only for the interactive components on a page,
not the whole tree. Static parts are HTML-only and never hydrate.

**Streaming SSR** writes HTML to the response as soon as each component
resolves, rather than buffering the whole page. The browser starts
parsing/painting before the server is done. Combined with Suspense
boundaries this also defers slow data-dependent regions without blocking
the shell.

---

## 11. Avoiding allocations on the hot path

A grab-bag that shows up across all of the above:

- **Pre-bound methods.** Cache `signal.get.bind(signal)` once per signal so
  every read is one function call, not a property lookup + bind. Solid does
  this; Purity does this at `packages/core/src/signals.ts:158-159`.
- **DOM Range / DocumentFragment** for batch insertion and removal of
  contiguous nodes. Used by every framework that supports list rendering.
  Purity uses both in `packages/core/src/control.ts:214-237`.
- **Charcode comparisons over string methods** in the parser hot path —
  avoids regex allocation and `.charAt` boxing. Purity does this in
  `packages/core/src/compiler/parser.ts`.
- **WeakMap caches keyed by template strings array.** Stable identity per
  callsite, GC'd when the module is. Purity in
  `packages/core/src/compiler/compile.ts:17-70`; Lit and Solid use the same
  pattern.
- **Skip data structures for tiny n.** Linear scan over a 4-element array
  beats a `Set`. Many runtimes special-case n ≤ 1 or n ≤ 4 in their
  scheduler.

---

## How Purity stacks up

| Technique | Purity status |
|---|---|
| Compile-time cloned templates | ✓ (`compiler/codegen.ts`, `compile.ts`) |
| Fine-grained signal reactivity | ✓ (TC39 `signal-polyfill`) |
| Lazy / version-counter computeds | ✓ (inherited from polyfill) |
| Microtask-batched flush + `batch()` | ✓ (`signals.ts:73-117`) |
| LIS keyed-list reorder + append fast path | ✓ (`control.ts:406-509`) |
| WeakMap-cached compiled templates | ✓ (`compile.ts:17-70`) |
| Charcode parser, no regex on hot path | ✓ (`compiler/parser.ts`) |
| Scoped CSS via Shadow DOM (+ regex-free fallback) | ✓ (`styles.ts`) |
| Compiler-driven auto-memoization (React Compiler-style) | N/A — fine-grained reactivity makes it unnecessary |
| Block VDOM (Million.js) | N/A — no VDOM |
| Resumability (Qwik) | ✗ — not currently a goal |
| Server-mode signal stripping (Svelte) | ✗ — could inform a future SSR build target |
| Concurrent rendering (React) | N/A — fine-grained model handles responsiveness differently |
| Islands / streaming SSR | ✗ — depends on a future SSR story |

The patterns Purity already uses match the consensus across Solid, Svelte 5,
and Vue Vapor. The two ideas worth flagging for future exploration if Purity
ever adds an SSR story: **server-mode signal stripping** (compile out the
reactivity layer when emitting HTML) and **resumability-style listener
serialization** (skip a hydration pass entirely).

---

## Sources

- [React — Introducing the React Compiler](https://react.dev/learn/react-compiler/introduction)
- [React Compiler 1.0 — InfoQ](https://www.infoq.com/news/2025/12/react-compiler-meta/)
- [React Compiler Deep Dive — Pockit](https://pockit.tools/blog/react-compiler-automatic-memoization-performance-guide/)
- [Vue 3.6 Vapor Mode — Jeff Bruchado](https://jeffbruchado.com.br/en/blog/vue-36-vapor-mode-performance-revolution-2026)
- [Vue Vapor — BLUESHOE](https://www.blueshoe.io/blog/vue-vapor-performance-without-virtual-dom/)
- [vuejs/vue-vapor — GitHub](https://github.com/vuejs/vue-vapor)
- [Reactivity in Depth — Vue.js docs](https://vuejs.org/guide/extras/reactivity-in-depth)
- [Introducing Runes — Svelte blog](https://svelte.dev/blog/runes)
- [Svelte 5 Runes guide — PkgPulse](https://www.pkgpulse.com/blog/svelte-5-runes-complete-guide-2026)
- [Fine-grained reactivity — Solid Docs](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity)
- [Intro to reactivity — Solid Docs](https://docs.solidjs.com/concepts/intro-to-reactivity)
- [Resumable concept — Qwik docs](https://qwik.dev/docs/concepts/resumable/)
- [Resumability vs Hydration — Builder.io](https://www.builder.io/blog/resumability-vs-hydration)
- [Virtual DOM: Back in Block — Million.js](https://old.million.dev/blog/virtual-dom)
- [Million.js paper (arXiv 2202.08409)](https://arxiv.org/pdf/2202.08409)
