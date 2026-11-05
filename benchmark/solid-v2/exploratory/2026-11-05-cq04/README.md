# CQ-04 benchmark runs — 2026-11-05 (exploratory)

> **Status: exploratory.** Not SV2-001 baseline evidence. One 2-vCPU container; differences of the size seen here are within run-to-run noise (rows the change cannot affect, such as swap rows, moved by up to 35% between runs).

- Runner: `benchmark/run-bench.ts`, `FRAMEWORKS=purity,solid PAGES=index,binding WARMUP=3 ITERATIONS=7 MEM_ITERATIONS=0`, `CHROMIUM_PATH=/usr/bin/google-chrome` (Google Chrome for Testing 153.0.8010.12, headless).
- Machine: Intel Xeon @ 2.10 GHz, 2 logical CPUs, 8 GB, Linux x64, Node 24.22.2.
- Comparator: `solid-js`/`@solidjs/web` 2.0.0-rc.20, `@solidjs/signals` 2.0.0-rc.21, `@solidjs/vite-plugin` 3.0.0-next.55 (see `benchmarkWorkspaceComparator` in [`target.json`](../../target.json)).
- [`before-826d5ce.json`](./before-826d5ce.json): Purity `826d5ce` (main before CQ-04).
- [`after-28f7b31.json`](./after-28f7b31.json): Purity `28f7b31` (CQ-04 branch; `sourceDirty` is true only because the changelog/ledger edit was uncommitted, no source change).

The runs show no measurable timing change in either direction for these pages. The deterministic effect of CQ-04 is in `packages/core/tests/swap-slot-text.test.ts`: zero DOM mutations for an unchanged text write (previously one per write).
