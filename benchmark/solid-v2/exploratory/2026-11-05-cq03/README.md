# CQ-03 benchmark runs — 2026-11-05 (exploratory)

> **Status: exploratory.** Not SV2-001 baseline evidence. One 2-vCPU container; run-to-run noise is larger than any effect expected from this change (Solid's own medians moved −29% to +30% between the two runs).

- Runner: `benchmark/run-bench.ts`, `FRAMEWORKS=purity,solid PAGES=index,selection WARMUP=3 ITERATIONS=7 MEM_ITERATIONS=0`, `CHROMIUM_PATH=/usr/bin/google-chrome` (Google Chrome for Testing 153.0.8010.12, headless).
- Machine: Intel Xeon @ 2.10 GHz, 2 logical CPUs, 8 GB, Linux x64, Node 24.22.2.
- Comparator: `solid-js`/`@solidjs/web` 2.0.0-rc.20, `@solidjs/signals` 2.0.0-rc.21 (see `benchmarkWorkspaceComparator` in [`target.json`](../../target.json)).
- [`before-88157d8.json`](./before-88157d8.json): Purity `88157d8` (main before CQ-03).
- [`after-772be2f.json`](./after-772be2f.json): Purity `772be2f` (CQ-03 commit; `sourceDirty` only from uncommitted changelog/ledger edits).

No measurable timing change on these pages. The deterministic effect is in `packages/core/tests/binding-memo.test.ts`: zero attribute mutations and no `.value` reset when a sibling binding changes.
