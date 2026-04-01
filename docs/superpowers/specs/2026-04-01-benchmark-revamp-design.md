# Benchmark Suite Revamp

## Goals

1. Benchmark Purity using only its public APIs (`state`, `watch`, `each`, `html`) — the same code a real user would write
2. Produce a js-framework-benchmark submission for the official leaderboard
3. Provide an automated runner for CI regression tracking
4. Eliminate file duplication and debug artifacts accumulated during initial development

## Prerequisite: Watcher dedup fix (signals.ts)

`flush()` in `signals.ts` calls `watcher.getPending()` which returns duplicates when the same computed is watched multiple times across flush cycles. The flush loop calls `watcher.watch(computed)` for each entry, doubling the internal `producerNode` array every cycle (2^N growth). After ~30 signal changes this hits "Invalid array length" and crashes the page.

**Fix:** Deduplicate `getPending()` results with a `Set` before iterating. Already implemented on this branch, all 155 core tests pass. This is a real framework bug affecting any user code with frequent signal updates — not benchmark-specific.

## File structure

```
benchmark/
  src/
    app.ts        — createApp(tbody): Purity rendering + operation handles
    runner.ts     — benchmark harness: warmup, iterations, stats, flush
  index.html      — js-framework-benchmark submission (buttons -> createApp)
  bench.html      — interactive runner + ?auto headless mode
  run-bench.mjs   — Playwright orchestrator
  vite.config.ts  — two-entry build (index + bench)
  package.json    — vite dependency only
```

## src/app.ts — shared benchmark app

Exports a single function:

```ts
createApp(tbody: HTMLElement): AppHandle
```

### AppHandle interface

```ts
interface AppHandle {
  run(count: number): void   // create N rows (replaces existing)
  add(): void                // append 1000 rows
  update(): void             // update every 10th label
  select(id: number): void   // highlight row
  swapRows(): void           // swap indices 1 and 998
  remove(id: number): void   // remove row by id
  clear(): void              // remove all rows
}
```

### Purity APIs used

- `state()` — reactive state for `data` (row list) and `selectedId`
- `each()` — keyed list rendering with built-in LIS reconciliation
- `html` — JIT-compiled tagged template for row creation inside `each()`'s mapFn
- `watch()` — two explicit watches:
  1. `watch(data, ...)` — in-place label patching when items have same key but different label
  2. `watch(selectedId, ...)` — toggling row className for selection highlighting

These two manual watches represent real gaps in the `each()` API. `each()` detects same-key same-order and updates an internal signal, but raw DOM created by `html` templates doesn't react to that signal for content updates. And external signals (like selection) affecting per-row rendering have no built-in mechanism. The benchmark exposes these costs honestly.

### Data generation

Standard js-framework-benchmark pattern: each row has a numeric `id` (sequential) and a `label` (random three-word string from adjective/color/noun arrays).

### Event delegation

Single click listener on `tbody` inside `createApp`. Dispatches to `select(id)` or `remove(id)` based on the click target's class (`.lbl` for select, `.remove` for remove). The caller doesn't wire any row-level events.

### Row cache

A `Map<number, { tr, labelNode, label }>` tracks DOM elements by item id. Used by the label-update watch and selection watch to patch DOM in O(1) per row. Entries are created inside `each()`'s mapFn and cleaned up when rows leave the list.

## index.html — js-framework-benchmark submission

Follows the official spec exactly:
- Bootstrap CSS classes
- Specific button IDs: `run`, `runlots`, `add`, `update`, `clear`, `swaprows`
- Table with `id="tbody"`

The script section is minimal: import `createApp` from `./src/app.ts`, call it with the tbody element, wire each button to the corresponding `AppHandle` method.

## bench.html — interactive + automated runner

### Interactive mode

Click "Run Full Benchmark Suite" to execute all 10 operations with statistical analysis. Results displayed in a table with median, mean, stddev, min, max.

### Headless mode

Add `?auto` to the URL. The suite auto-runs on page load. On completion:
- Sets `window.__benchResults` (array of result objects)
- Prints `BENCHMARK_COMPLETE` text marker to the page

### Operations tested

| # | Name | Setup | Run | Teardown |
|---|------|-------|-----|----------|
| 1 | Create 1,000 rows | clear | run(1000) | — |
| 2 | Replace 1,000 rows | clear + run(1000) | run(1000) | — |
| 3 | Update every 10th row | run(1000) | update() | clear |
| 4 | Select row | run(1000) | select(id of row at index 500) | clear |
| 5 | Swap rows | run(1000) | swapRows() | clear |
| 6 | Remove row | run(1000) | remove(first) | clear |
| 7 | Clear 1,000 rows | run(1000) | clear() | — |
| 8 | Create 10,000 rows | clear | run(10000) | — |
| 9 | Clear 10,000 rows | — | clear() | — |
| 10 | Append 1,000 rows | run(1000) | add() | clear |

## src/runner.ts — benchmark harness

### Config

- Warmup: 3 rounds
- Iterations: 10
- Discard worst: 2

### Flush mechanism

Purity effects are microtask-scheduled (`queueMicrotask` in the Watcher). The runner must await a microtask to let `watch()` callbacks fire, then force synchronous layout to ensure the browser has completed DOM mutations.

```ts
function tick(): Promise<void>        // new Promise(r => queueMicrotask(r))
async function flush(): Promise<void> // await tick(); document.body.offsetHeight
```

Every setup/run/teardown boundary calls `flush()`.

### Core function

```ts
benchmarkOp(name, setup, run, teardown): Promise<BenchResult>
```

Warmup phase runs setup-run-teardown N times without recording. Measurement phase records `performance.now()` around run + flush. Stats computed after discarding worst results.

### Stats

Median, mean, stddev, min, max — computed from the trimmed sorted times array.

### Exports

`benchmarkOp`, `flush`, `sleep`, `calcStats`, `formatStats` — ES module exports consumed by bench.html. No globals.

## run-bench.mjs — Playwright orchestrator

1. Launches headless Chromium
2. Navigates to the production build of `bench.html?auto`
3. Waits for `BENCHMARK_COMPLETE` text (up to 5 min timeout)
4. Reads `window.__benchResults` via `page.evaluate`
5. Prints a formatted markdown table to stdout
6. Exits 0 on success, 1 on failure/timeout

Designed to run against `vite preview` (production build, no HMR).

## Files deleted

All superseded or debug artifacts:

- `harness.html` — replaced by bench.html + createApp
- `auto-bench.html` — merged into bench.html `?auto` mode
- `standalone.html` — obsolete
- `bench/runner.js` — replaced by src/runner.ts
- `run-diag.mjs` — debug artifact
- `run-crash-test.mjs` — debug artifact
- `crash-test.html` — debug artifact
- `diag.html` — debug artifact
- `src/Main.ts` — replaced by src/app.ts

## Files unchanged

- `packages/core/tests/benchmark.test.ts` — unit-level microbenchmarks, separate concern
- `benchmark/package.json` — vite dependency only

## Known framework gaps exposed

1. **`each()` in-place content updates**: when keys match and order is unchanged, `each()` updates an internal signal but `html`-created DOM doesn't react. Users must add a manual `watch(data, ...)` to patch labels.
2. **External signals affecting list items**: `each()` has no mechanism for an external signal (like selection) to affect per-row rendering. Users must maintain a row cache and a `watch(signal, ...)` to toggle classes.

These are framework design decisions to address in `@purity/core` — not benchmark workarounds.
