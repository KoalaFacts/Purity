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
- jsdom probe of the **first revision** (`d46657b`, window map + incremental owner re-tracking), before = `34b21d8`, interleaved, median of 5 × 30 updates, ms per update: one-row update of 5k inside `when()` 2.41 → 1.10; swap two of 10k 4.57 → 3.04 (8.48 → 3.77 inside `when()`); remove one + append one of 10k 4.98 → 2.93 (9.18 → 4.29 inside `when()`). That revision grew 5 of 17 complete application fixtures by 211–239 B Brotli and was replaced (see the PR review thread).
- jsdom probe of the **size-neutral revision** (the PR head: keys array, one key call per item, unchanged-keys owner skip, head/tail trimming and LIS on the window, append/prepend fast paths folded into the window path), same method:

| Case                                           | Before | After |
| ---------------------------------------------- | -----: | ----: |
| Update one row of 5k                           |   1.22 |  1.16 |
| Update one row of 5k inside `when()`           |   2.29 |  1.20 |
| Swap two rows of 10k                           |   4.53 |  4.62 |
| Swap two rows of 10k inside `when()`           |   7.95 |  8.50 |
| Remove one + append one of 10k                 |   5.28 |  3.97 |
| Remove one + append one of 10k inside `when()` |   8.80 |  8.61 |

The size-neutral revision keeps the full-list `newEntries` map and the old owner rebuild for structural changes, so swaps and owned structural updates do not improve; the unchanged-keys owner skip and one key call per item remain. jsdom has no `moveBefore`, so these probes exercise the batched-fragment path; the browser runs above (first revision) use `moveBefore`.

A one-shot jsdom probe of whole-list operations (reverse, sort, filter, unfilter, replace 10k) moved by ±15% in both directions across three repeats and is not used as evidence.

## Final size (PR head after the size review)

All 22 package entries and 17 complete apps against main `34b21d8` (local `check:bundle`, same container): every row is smaller or equal in raw, gzip and Brotli. `runtime-all` Brotli is equal at 43,020 B (raw −534 B, gzip −63 B). The full table is in the PR thread. Behaviour is unchanged from `4d61432`; only equivalent source forms differ.
