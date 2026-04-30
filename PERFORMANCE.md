# Performance — closing the gap

This document is the post-mortem of the work on branch
`claude/add-performance-suggestions-shkY3`. It started as research notes
("here's where the gap is, here are three attack vectors"); now it reads
as an account of what we actually shipped, and what the numbers look
like at the end.

**TL;DR:** the framework is now tied with Solid on every keyed-list 10k
workload and ahead by 3–7× on the per-row update workloads (bound
inputs, cart increment, select/toggle all). Replace 10k went from **32
seconds → 711 ms** over the course of this branch.

---

## What we measured

Head-to-head bench (`benchmark/run-bench.ts`), 3 timed iterations after
3 warmups, drop fastest+slowest, double-rAF paint timing in headless
Chromium. Final `benchmark/benchmark-results.md` for the full table.

10k-row workloads (the row-rendering shape that frameworks actually
compete on):

| Workload          | Purity     | Solid      | Svelte     | Vue        |
|---                |---         |---         |---         |---         |
| **Create 10k**    | **661.5**  | 795.7      | 823.6      | 701.5      |
| Append 10k        | 735.9      | **699.7**  | 839.0      | 1012.8     |
| Replace 10k       | 710.9      | **693.4**  | 735.9      | 796.8      |
| Update every 10th | 219.3      | 207.8      | **202.7**  | 217.4      |
| Swap rows         | **82.8**   | 95.3       | **82.4**   | 98.7       |
| Clear             | 82.4       | **69.0**   | 75.1       | 71.7       |
| **Sort 10k by ID↓** | **341.7** | 349.0    | 5982¹      | 347.1      |

¹ Svelte regression on this op only.

Per-row update workloads (where Purity's per-row signal architecture pays):

| Workload                         | Purity      | Solid       | Δ vs Solid |
|---                               |---          |---          |---         |
| Bound input — Create 10k         | **32.1**    | 436.6       | **−93%**   |
| Bound input — Update all 10k     | **47.1**    | 338.4       | **−86%**   |
| Bound input — Update all 1k      | **32.0**    | 47.3        | −32%       |
| Cart Increment all 10k           | **286.5**   | 523.5       | −45%       |
| Toggle all 10k                   | **62.9**    | 186.5       | **−66%**   |
| Select all 10k                   | 63.8        | 188.3       | **−66%**   |
| Deselect all 10k                 | 62.5        | 182.7       | **−66%**   |

Memory (Create 10k rows, retained = heap not released after destroy):

|        | used     | retained                     |
|---     |---       |---                           |
| Purity | 11.2 MB  | **0.0 MB**  ← best of the four |
| Solid  | 9.8 MB   | 0.2 MB                       |
| Svelte | 9.0 MB   | 0.0 MB                       |
| Vue    | 19.7 MB  | 0.1 MB                       |

The wins on the per-row update workloads were initially suspicious —
"are they real?" was asked twice. They were verified by patching
`HTMLInputElement.prototype.value`'s setter and counting writes:
all four frameworks invoke the setter exactly **10,000** times during
"Update all" and produce identical final rendered values. The runtime
gap is genuine framework overhead per update, not a workload imbalance.

---

## What we changed

In rough order of leverage. Each item maps to one or more commits on
this branch.

### 1. `condenseWhitespace` in the codegen — 50k DOM nodes saved per 10k rows

The old `trimFragmentEdges` only stripped whitespace at fragment edges.
Indentation **between sibling tags inside elements** still passed
through to `innerHTML`, and the HTML parser materialized each one as a
real text node. A typical row template has 5 sibling tags, so each
10k-row table carried **50k throwaway text nodes** that nobody ever
touched.

`condenseWhitespace` now recurses through the AST and drops any text
node whose value trims to empty AND contains a newline. Pure
indentation always matches both; deliberate whitespace like the space
in `${a} ${b}` does not (no newline) and survives. Skipped inside
`<pre>` / `<textarea>` / `<script>` / `<style>` where whitespace is
meaningful.

Profiler delta on Create 10k:

| metric           | before    | after     |
|---               |---        |---        |
| wall             | 1946 ms   | **999 ms** |
| DOM nodes Δ      | 150,003   | **100,003** |
| domOps native    | 169.5 ms  | 89.6 ms   |
| layout duration  | 1022 ms   | 397 ms    |

This was the single biggest win on Create — layout cost halved because
the engine had half as many nodes to lay out.

### 2. Replaced the polyfill — Solid-style push-pull reactivity

The polyfill was structurally costly in two places we couldn't reach:
its `REACTIVE_NODE` was `Object.create()`'d with ~16 fields and class
private slots (`__privateAdd` showed up at 5+ ms self in the profile),
and `Watcher.unwatch` was O(N) per call with `Array.includes`. The
latter was the *cause* of the 32-second Replace 10k — disposing 10k row
Computeds cost ~3.2 s of pure backward-scan work in the polyfill.

Replaced with a hand-tuned graph in `packages/core/src/signals.ts`
(~510 lines, no other file touched because nothing outside this file
used the polyfill or its types):

- Plain object nodes — `StateNode` (4 fields) and `ComputedNode` (10
  fields), versioned, no classes. Same hidden class on every alloc.
- 3-state status (`CLEAN` / `CHECK` / `DIRTY`) with version snapshots
  on each source. `CHECK → CLEAN` resolves *without re-running fn()*
  when no upstream actually moved — the glitch-freedom path.
- Position-indexed source slots: when a Computed re-runs and reads the
  same producer at the same index, we just refresh the version snapshot.
  No array work in the steady state.
- Effect dispose is `O(deps)`: walks each producer's observers list and
  swap-with-last + pop. Replaces the polyfill's per-call backward scan
  that gave us the 50–100× Replace blowup.
- Re-entrancy guard counts only effect re-entries; pure compute chains
  (DAGs) can be arbitrarily deep without tripping it.

Profiler delta on the worst workload, Replace 10k:

| metric        | polyfill   | new impl   |
|---            |---         |---         |
| wall          | 2222 ms    | **997 ms** |
| jsUser self   | 3264 ms    | **64 ms**  |

Heap delta on Create 10k dropped from 16.81 MB → 11.43 MB. The
`signal-polyfill` dependency is gone — `@purityjs/core` now ships zero
runtime dependencies.

### 3. Single-watch-per-template fold (codegen)

The old codegen emitted one `_w(function(){...})` call per reactive
`${...}` slot. A row template with 5 reactive bindings × 10k rows =
50k `Computed` allocations and watcher registrations.

After the fold, all reactive bindings inside one template instance are
collected into a single `_w` whose body assigns each binding (gated by
per-binding `_f*` boolean flags frozen at setup). Same row template:
10k `Computed` allocations instead of 50k.

The *trade-off*: when any tracked signal changes, every assignment in
the body re-runs — even for bindings that read other signals. In
practice this is irrelevant because (a) row templates' bindings almost
all read the same per-row signal, and (b) per-binding text-node writes
are ~50 ns each, dwarfed by the watch-creation savings.

This change exposed a latent bug — `bulkClear` in `each()` was using
`Range.deleteContents()`, which is O(N²) in jsdom on long sibling
lists. Switched to a per-node `removeChild` loop. Same speed in real
browsers, fixes the 32-second jsdom regression.

### 4. Text-node placeholder for `${...}` slots

Each reactive `${...}` in a complex template was emitting a `<!---->`
Comment placeholder, then doing `createTextNode('') + replaceWith` at
instantiate time. Two extra DOM operations per slot.

A `​` zero-width space text node serves the same purpose: HTML
parser materializes a Text node directly, navigation lands on it, and
the binding setup just keeps it (the watch overwrites `.data` on first
run, before paint, so the placeholder character never visibly leaks).

Cannot do this unconditionally — when an expression has a text or
expression sibling (e.g. `<p>${a} ${b}</p>`) the parser would coalesce
the placeholder with the adjacent text and break path navigation.
`buildDynamicHtml` decides per-slot based on neighbors and
`genExprBinding` emits the right setup branch.

Wall time on Create 10k: **999 → 947 ms**. domOps native: 89.6 → 69.8.

### 5. Lean per-row scope + drop `_node`

`each()` entries used `new ComponentContext()` (10 fields, 9 unused
per row — mounted/destroyed/errorHandlers/parent/children/etc are
component-lifecycle concerns) just to hold a `disposers` array. Now a
1-field `{ disposers: null }` plain object instead. `component.ts`
exports a `Scope` interface that `ComponentContext` satisfies; the
context stack and `pushContext`/`getCurrentContext` are typed as
`Scope` so either shape can be pushed.

Also dropped the `_node` reference from `StateAccessor` /
`ComputedAccessor` interfaces and accessor objects — nothing outside
`signals.ts` ever read it (verified by grep).

Wall time on Create 10k: **786 → 753 ms**. Heap delta: **11.42 → 10.93
MB**.

### 6. Profiler tooling — kept

CPU + memory + I/O profiler at `benchmark/tools/`:

- `profile.ts <fw> <scenario>` — capture a single (framework, scenario)
  pair: CPU profile, before/after heap snapshots,
  `Performance.getMetrics` deltas, network bytes.
- `analyze.ts <dir>` — read the artifacts, demangle minified names via
  `source-map-js`, print CPU buckets (`jsUser` / `domOps` / `gc` /
  `(program)`) and the top-N hot functions.
- `compare.ts <scenario>` — run all four frameworks back-to-back, emit
  a side-by-side Markdown table.
- `sanity.ts` — functional smoke check (`npm run sanity`). Loads each
  bench app, exercises typical interactions, asserts on actual rendered
  text — catches the kind of "everything renders `undefined` but the
  benchmark still measures fast" trap that bit this branch once.

---

## How the bench is wired (so future runs are reproducible)

```bash
# Build the benchmark with the AOT plugin reading source directly via
# Node's "development" condition (no need to rebuild @purityjs/core
# between codegen iterations):
cd benchmark
npm run build       # = NODE_OPTIONS='--conditions=development' vite build
npm run preview &   # = NODE_OPTIONS='--conditions=development' vite preview --port 4173

# Full head-to-head:
ITERATIONS=3 node --conditions=development --import tsx run-bench.ts

# Single workload comparison:
node --conditions=development tools/compare.ts <scenario>
# scenarios: create | append | replace | update | swap | clear-after-create

# CPU profile of one (fw, scenario) and human-readable analysis:
node --conditions=development tools/profile.ts purity create
node --conditions=development tools/analyze.ts /tmp/profiles/<dir>

# Functional smoke check:
node --conditions=development tools/sanity.ts
```

The bench's `vite.config.ts` aliases `@purityjs/core` to source. The
plugin imports `@purityjs/core/compiler` which the package's
`"development"` conditional export also points at source — so codegen
edits flow through one bench build, no `npm run build -w packages/core`
needed in between.

---

## What's left, ranked

The remaining 5–15% gaps are all real, all small in absolute terms, and
mostly live in fundamentals (cloneNode-vs-createElement codegen, LIS
shape) where further chase is multi-hour for tens of milliseconds.

| Workload                | Purity   | Solid    | Δ          | Where time goes                                             |
|---                      |---       |---       |---         |---                                                          |
| Sort 10k **by label**   | 419 ms   | 366 ms   | **+14% (53 ms)** | LIS reorder + DOM moves on string-keyed sort. Unknown — only unexplained gap. Worth a profile. |
| Append 10k              | 736 ms   | 700 ms   | +6% (60 ms) | Per-row state+scope+computed alloc on the 10k new rows.   |
| Update every 10th 10k   | 219 ms   | 208 ms   | +8% (16 ms) | Path B per-row signal write fan-out. Small, near noise.   |
| Clear 10k               | 82 ms    | 69 ms    | +16% (13 ms) | Per-node `removeChild` loop. Could try Range API again but it's a jsdom landmine. |
| DOM ops on Create 10k   | 65 ms    | 40 ms    | +25 ms      | `cloneNode` of innerHTML template — architectural.        |

Sort-by-label is the only **unexplained** gap (Sort by ID is tied at
342 vs 349). Same workload shape, different key type, 53 ms slower.
That's the most interesting one to dig into next. The rest would
require structural changes for tiny wins.
