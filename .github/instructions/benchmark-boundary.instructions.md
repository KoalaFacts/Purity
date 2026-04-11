---
description: "Use when editing benchmark harness code, scenario pages, framework benchmark apps, history snapshots, or report generation for benchmark outputs."
applyTo: "benchmark/**"
---

# Benchmark Boundary

- Scope benchmark work to [benchmark](../../benchmark) and related generated output only when required.
- Use benchmark scripts from [benchmark/package.json](../../benchmark/package.json): `vp dev`, `vp build`, `vp preview`.
- Use orchestrator and report generator as the source of truth:
  - [benchmark/run-bench.ts](../../benchmark/run-bench.ts)
  - [benchmark/generate-pages.ts](../../benchmark/generate-pages.ts)
- Treat framework app pages under `benchmark/apps/*` as benchmark fixtures; avoid applying package-runtime refactors that change scenario semantics.
- When updating results, keep artifacts consistent across:
  - [benchmark/benchmark-results.md](../../benchmark/benchmark-results.md)
  - [benchmark/history](../../benchmark/history)
  - [gh-pages](../../gh-pages)
- Prefer benchmark-targeted validation before workspace-wide checks (for example: `vp check benchmark/**`).
