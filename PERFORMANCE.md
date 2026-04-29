# Closing the gap — research

Notes from the head-to-head benchmark (`benchmark/run-bench.ts`) comparing
Purity 0.1 against Solid 1.9, Svelte 5.55, and Vue 3.6β. We have the
honest numbers now. This document is the plan to close the gaps that
matter, in priority order.

**TL;DR:** the dominant cost is **watch() creation** at ~5μs per call. A
keyed list with 10k rows × 5 reactive bindings = 50k watches = **~250ms
of pure setup overhead**, which is most of the gap to Solid/Svelte. Three
attack vectors close most of this, ranked by leverage.

---

## What the bench measured

After fixing the broken render and dropping the unfair vanilla-DOM
hand-tuning that was masking it, Purity's honest numbers (medians,
3 timed iterations after 3 warmups, double-rAF paint timing in headless
Chromium):

| Workload | Purity | Solid | Svelte | Vue |
|---|---|---|---|---|
| Create 10k rows | **598** | 519 | 509 | 525 |
| Append 10k rows | **1417** | 526 | 517 | 590 |
| Replace 10k rows | **715** | 512 | 512 | 569 |
| Add 10k cart items | **513** | 401 | 339 | 286 |
| Create 10k components | **182** | 129 | 142 | 162 |
| Update every 10th (10k) | 157 | 127 | **125** | 145 |
| Sort 10k by ID ↓ | 253 | 251 | 4591¹ | 255 |
| Update all 10k bound inputs | **32** | 199 | 192 | 211 |
| Toggle/Select/Deselect all 10k | **62-69** | 134-145 | **47-53** | 49-53 |

¹ Svelte regression on this op only.

**Wins** are real: granular per-row signal updates (`update`, `toggle`,
`select`) where the per-row signal architecture (Path B) shines — Purity
ties or beats Solid by 2× on these.

**Losses** cluster on bulk creation/replacement at 10k scale where the
gap is 17–80%. Memory tells the same story: Purity uses ~3× the heap of
Solid/Svelte during creation (28MB vs 9MB for 10k rows). The leak is now
fixed (`57f796f`); the **structural** cost remains.

## Where the cost actually lives

Per-op probe in jsdom (10k iterations each, on this branch's source):

```
Signal.State allocation:                      0.1μs/op
state() (Signal.State + bind + accessor):     0.2μs/op
Signal.Computed allocation:                   0.2μs/op
compute() (Signal.Computed + bind + accessor): 1.3μs/op
watch() create + dispose:                     4.9μs/op   ← the killer
signal read:                                 ~0.05μs/op
signal write (no watchers):                   0.2μs/op
```

The polyfill's `Signal.Computed` itself is cheap (0.2μs). What costs is
`watch()` — wrapping a fn into a Computed, registering with the
`Signal.subtle.Watcher`, and running once. Each reactive `${() => ...}`
in a template = one watch.

**Per 10k-row render with 5 reactive bindings per row:**

| Cost | Calculation | ms |
|---|---|---|
| Per-item state() (Path B) | 10k × 0.2μs | 2 |
| Per-binding watch() create + run | 50k × ~3μs | **~150** |
| watcher.watch() registrations | 50k × ~0.5μs | **~25** |
| DOM creation | (varies, dominates total) | ~300-400 |
| **Total signal-machinery overhead** |  | **~175ms** |

The 175ms is exactly the gap to Svelte (89–200ms across these workloads).
Closing it means cutting the watch() cost.

For comparison — Solid's `createSignal` is a 4-field object with a bound
closure. Polyfill's `Signal.Computed` is `Object.create(COMPUTED_NODE)`
with **16 inherited fields** plus per-instance `value`, `error`, `equal`,
`computation`, `wrapper` — roughly 350-400 bytes per instance vs Solid's
~150-200. That's the 2× memory ratio we see in benchmark heap snapshots.

## Three attack vectors, ranked

### 1. Single-watch-per-template-instance — biggest leverage

**The ask.** Today, the codegen emits one `_w(function(){...})` call per
reactive `${...}` in a template. A 5-field row creates 5 Computeds per
row × 10k rows = 50k Computeds.

A row template's bindings overwhelmingly read the **same per-item
signal**. They invalidate together. There's no benefit from independent
dependency tracking — they all want to re-run when `item()` changes.

**The fix.** Emit one `_w(function(){...})` per template instance whose
body updates **all** the reactive bindings:

```js
// before — N watches per row
_w(() => { td0.firstChild.data = String(item().id) });
_w(() => { td1.firstChild.data = item().label });
_w(() => { td2.firstChild.data = String(item().qty) });

// after — one watch per row
_w(() => {
  const v = item();
  td0.firstChild.data = String(v.id);
  td1.firstChild.data = v.label;
  td2.firstChild.data = String(v.qty);
});
```

**Tradeoff.** When any one of `id`/`label`/`qty` changes, all three
update — even the ones whose value didn't change. For row templates this
is irrelevant (they all change together, or none do). Text-node assignment
is ~50ns per binding so worst-case cost is negligible.

**Where it doesn't apply.** Templates where bindings track *different*
upstream signals (e.g. `${a()}` and `${b()}` in the same template, where
`a` and `b` are independent module-level signals). Detect at compile
time: if two bindings' AST source overlaps in identifiers they read,
fold them; if disjoint, keep separate.

**Implementation.**
- Codegen change in `packages/core/src/compiler/codegen.ts` —
  `genPositionalBindings` already collects all reactive slots; instead of
  emitting one `_w` per slot, accumulate the body of all of them into one
  `_w`.
- Static analysis: scan the expression sources of each `${}` for shared
  identifier reads. If they share at least one (e.g. `item`), fold.
- If split needed, emit two separate watches.

**Estimated gain.** With 5 bindings per row collapsed to 1 watch:
- watch() cost: 50k × 3μs → 10k × 3μs = saves **120ms** on Create 10k.
- Memory: 50k Computeds × 350 bytes → 10k = saves **14MB**.

Closes most of the gap to Svelte on the bulk-creation workloads. Doesn't
hurt the per-row update workloads where Purity already wins.

**Effort.** Compiler-only change in `codegen.ts`. ~1–2 days plus
careful tests around the binding-folding heuristic. Risk: medium —
correctness of the binding-grouping analysis matters.

### 2. Hand-tuned signal implementation — replaces polyfill

**The ask.** Replace `signal-polyfill` with a Solid-shaped 4-field
signal + minimal effect runner. The polyfill is generic and pays
fields/methods we never use (`equal.call(node.wrapper, ...)`,
`producerRecomputeValue`, `consumerOnSignalRead`, `liveConsumerNode`,
`producerLastReadVersion`, etc.).

**The fix.** A ~300-400 line module under `packages/core/src/reactivity/`:

```ts
interface State<T> { value: T; observers: Effect[] | null; equals?: (a:T,b:T)=>boolean }
interface Effect { fn: () => void; sources: State<any>[]; clean: () => void; }

let listener: Effect | null = null;

function read<T>(s: State<T>): T {
  if (listener && !listener.sources.includes(s)) {
    listener.sources.push(s);
    (s.observers ??= []).push(listener);
  }
  return s.value;
}
function write<T>(s: State<T>, v: T): void {
  if (s.equals ? s.equals(s.value, v) : Object.is(s.value, v)) return;
  s.value = v;
  if (s.observers) schedule(s.observers);
}
function effect(fn: () => void): () => void {
  const e: Effect = { fn, sources: [], clean: noop };
  const prev = listener; listener = e;
  try { fn(); } finally { listener = prev; }
  return () => unsubscribe(e);
}
```

Plus a microtask flush, dirty-bit dedupe, and a `compute` that's a
read-cached effect. No `Symbol(SIGNAL)` indirection, no wrapper objects,
no introspection API surface, no consumer/producer dual-direction
tracking we don't use.

**Tradeoff.** We lose the future "drop-in TC39 Signal API" — but we can
keep the public Purity API (`state`, `compute`, `watch`) identical and
swap the implementation underneath. Migration to native Signals later is
still possible because the public API doesn't expose polyfill internals.

**Estimated gain.** Per-op: about 2× on the signal hot path (Solid's
numbers from public benchmarks). For 10k-row rendering: state allocation
2ms → 1ms (negligible), watch creation 150ms → ~75ms — saves another
**~75ms** on top of #1. Memory drops further (~150 bytes per Computed
instead of 350).

**Effort.** ~3–5 days including tests + benchmarks for diamond,
fan-out, dynamic dependency, transition-to-clean, glitch-freedom. Risk:
medium-high. Reactivity correctness is hard; the polyfill is battle-
tested. Mitigation: keep polyfill behind a build flag for one minor
release while the new impl proves out.

### 3. AOT-compile bindings to direct DOM mutations — Svelte/Vapor approach

**The ask.** Skip the `watch()` wrapper entirely for compile-time-known
bindings. Vue Vapor and Svelte 5 do this: at build time they know the
shape of the DOM and which signals each text node depends on, so they
emit `signal.onChange((v) => textNode.data = v)` directly.

**The fix.** In the Vite plugin (`packages/vite-plugin/src/index.ts`),
when compiling `<td>${() => item().label}</td>`:

```js
// Today (after codegen):
_w(() => { textNode.data = String(item().label); });

// AOT-compiled direct subscription:
__purity_subscribe__(itemSignal, (v) => textNode.data = String(v.label));
```

`__purity_subscribe__` is a primitive on our hand-tuned signal (#2)
that takes `(signal, callback)` and pushes `callback` into the signal's
observers list. **No `Effect` object, no listener dance, just
`signal.observers.push(cb)`.**

**Tradeoff.** Only works when the compiler can statically identify the
upstream signal — i.e. for templates inside `each()` (where item is the
known signal) and for top-level reactive scopes where the signal is a
named binding. Doesn't work for arbitrary `${() => fn(a(), b())}` —
falls back to `_w()`.

**Combined with #1 + #2.** With single-watch-per-row + hand-tuned signals
+ direct subscription for static cases:
- Per row: 1 subscribe call, no Effect alloc, ~0.5μs setup
- 10k rows: 5ms total signal-machinery overhead
- Closes the gap to Svelte completely; possibly beats it.

**Effort.** ~3–4 days. Requires #2 (we can't direct-subscribe on the
polyfill — its `Signal.subtle.Watcher` requires a Computed wrapper).

## Other ideas considered, parked

| Idea | Why parked |
|---|---|
| **Signal pooling** (recycle State/Computed) | The polyfill's State has internal version counters and observer lists; resetting is comparable in cost to allocation. Only worth it on the hand-tuned impl. |
| **Avoid per-row state() wrapper** (Path B opt-out) | Would silently break correctness for the in-place update path that motivated Path B. |
| **`flush()` micro-optimization** (small-batch dedupe etc.) | Already done in B3. ~9% on raw effect throughput; further gains here are sub-1ms in real workloads. |
| **WASM signal primitives** | Cross-boundary call overhead exceeds the savings. |
| **Concurrent rendering / time-slicing** | Architectural mismatch — Purity is fine-grained, not VDOM. |

## Suggested order of attack

1. **Ship #1 first** (single-watch-per-template). Compiler-only,
   no API change, ~80% of the gain. Effort: 1–2 days.
2. **Validate #1 closes most of the gap** with a re-run of the
   head-to-head bench. If it does (likely lands within 5–10% of Svelte
   on bulk creation), stop and ship.
3. **Decide on #2** (replace polyfill) based on whether the residual gap
   matters for the use case Purity targets. Cost is real (3–5 days +
   risk); benefit is real but smaller after #1.
4. **#3 (AOT direct-subscribe) is gated on #2** and only relevant if
   we want to compete with Svelte on the *very* tight workloads.

## Where this won't matter

Purity already wins on per-row update workloads (Path B's per-item
signal). It already ties on small/medium workloads (paint-floor noise).
It already has a 6kB gzipped bundle vs Vue's 33kB and Solid's 7kB. The
gap to close is specifically: **bulk creation/replacement at 10k+ rows**,
which is the row-rendering benchmark that frameworks compete on.

For real apps with hundreds (not tens of thousands) of rows, current
Purity is already competitive. These optimizations are about benchmarks
and the kind of large list/table apps that make framework choice
decisions.
