# CQ-01+02 benchmark runs — 2026-11-05 (exploratory)

> **Status: exploratory.** Not SV2-001 baseline evidence. One 2-vCPU container; Solid's own medians moved by up to ±20% between these runs, so only differences well above that are read as signal.

- Runner: `benchmark/run-bench.ts`, `FRAMEWORKS=purity,solid PAGES=index,filter,sort WARMUP=3 ITERATIONS=7 MEM_ITERATIONS=0`, `CHROMIUM_PATH=/usr/bin/google-chrome` (Google Chrome for Testing 153.0.8010.12, headless).
- Machine: Intel Xeon @ 2.10 GHz, 2 logical CPUs, 8 GB, Linux x64, Node 24.22.2.
- Comparator: `solid-js`/`@solidjs/web` 2.0.0-rc.20, `@solidjs/signals` 2.0.0-rc.21, `@solidjs/vite-plugin` 3.0.0-next.55 (see `benchmarkWorkspaceComparator` in [`target.json`](../../target.json)).
- [`before-34b21d8.json`](./before-34b21d8.json): Purity `34b21d8` (main before CQ-01+02). A first `before` run on the same commit was overwritten by the next build of `benchmark/dist`; only its console medians survive and they are not used below.
- [`after-8215705-run1.json`](./after-8215705-run1.json), [`after-8215705-run2.json`](./after-8215705-run2.json): Purity `8215705` (CQ-01+02 branch, two runs).

## What the browser runs show

Pooled medians of the raw samples, Purity before → after (Solid before → after in brackets):

| Operation        | Purity           | Solid            |
| ---------------- | ---------------- | ---------------- |
| Swap rows (1k)   | 3.8 → 4.0 ms     | 5.1 → 3.9 ms     |
| Swap rows (10k)  | 44.7 → 40.9 ms   | 42.9 → 45.6 ms   |
| Sort 1k by ID ↓  | 22.8 → 21.0 ms   | 21.1 → 22.3 ms   |
| Sort 10k by ID ↓ | 208.5 → 220.7 ms | 200.6 → 208.9 ms |
| Clear filter 10k | 196.9 → 196.3 ms | 209.3 → 211.3 ms |

Every Purity change in these pages is inside the run-to-run spread of the Solid column. In the browser the swap/sort/filter rows are dominated by layout and DOM work, not by the diff bookkeeping this change removes; the PR claims no browser timing win.

## Deterministic and jsdom evidence

- `packages/core/tests/each-reconcile.test.ts`: the key function runs once per item per reconcile (twice before for any order change); a two-row swap in 1,000 rows moves exactly two rows; a middle insertion removes no node; property tests (fast-check) for `each()`/`list()` first-occurrence order, row identity and disposal, `each()` inside a `when()` branch, and an `each()` that is the root of another `each()` row (fails if the owner node list is not updated).
- jsdom probe (before and after interleaved, 5 runs × 30 updates per case, median ms per update, `each()` keyed by id, Node 24.22.2, same machine). Before = `34b21d8`; after = the PR head, which differs from `8215705` only by bundle-size trims (fragment `prepend` for batched moves, spread pushes). jsdom has no `moveBefore`, so this exercises the batched-fragment path; the browser runs above use `moveBefore`.

| Case                                           | Before | After |
| ---------------------------------------------- | -----: | ----: |
| Update one row of 5k                           |   1.13 |  1.16 |
| Update one row of 5k inside `when()`           |   2.41 |  1.10 |
| Swap two rows of 10k                           |   4.57 |  3.04 |
| Swap two rows of 10k inside `when()`           |   8.48 |  3.77 |
| Remove one + append one of 10k                 |   4.98 |  2.93 |
| Remove one + append one of 10k inside `when()` |   9.18 |  4.29 |

A one-shot jsdom probe of whole-list operations (reverse, sort, filter, unfilter, replace 10k) moved by ±15% in both directions across three repeats and is not used as evidence.
