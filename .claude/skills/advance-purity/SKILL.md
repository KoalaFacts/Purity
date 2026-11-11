---
name: advance-purity
description: How the scheduled "Purity 推进计划" task advances Purity — goal, metric, gate, work order, scope and project rules. Read with agent-harness/skills/autonomous-dev at the start of every run.
---

# Advance Purity

Repo-specific half of the scheduled development task; the run loop is `agent-harness/skills/autonomous-dev` and verification is `agent-harness/skills/verification-first` (plus this repo's `.claude/skills/verification-first` and `verify-purity`). Created from the owner's seed `agent-harness/projects/purity.md`. The task keeps this file current through its own PRs. It may make rules stricter, never looser, and never relaxes the hard limits in the scheduled task's prompt. Where this file and the seed differ, the stricter wins.

## Goal and metric

- PurityJS: a minimal web framework on TC39-Signals-inspired reactivity, direct DOM templates, zero runtime dependencies.
- Goal: **surpass SolidJS v2** while staying differentiated — Web Components + Shadow DOM, direct DOM templates with a no-build JIT and CSP-safe strict AOT, zero runtime dependencies, modular entries, non-lossy SSR/hydration/islands — very easy to use and excellent in performance.
- Headline metric: ledger rows done (CQ and SV2 rows in `docs/plans/surpass-solid.md`), with `benchmark/run-bench.ts` medians against an exact Solid version and `npm run check:bundle` sizes as the performance/size evidence.
- Real progress: merged code + tests, measured improvements, or docs that change what a user can do.
- Schedule: every 4 hours (6 runs a day), 50 minutes per run. ADRs are in English.

## Setup

- Node 24 and npm 11. If older: `npm i node@24 npm@11` into a scratch folder and put its `node_modules/.bin` first on `PATH`.
- Read root `CLAUDE.md`, the `CLAUDE.md`/README of every package you touch, the ledger, the audit doc (`docs/code-quality-audit-2026-11-05.md`), the Solid v2 gap docs (`docs/solid-v2-gap-analysis.md`, `docs/solid-v2-gaps.json`), `docs/solid-competitor-roadmap.md`, `docs/framework-capabilities.md` and the ADRs in `docs/decisions/` for the area. Trust the tree over any doc's package table or paths.
- Browser checks: Playwright's Chromium is preinstalled in the cloud container; set `CHROMIUM_PATH` if Playwright's own browser revision is absent (see `verify-purity` Traps).

## Gate

In order; warnings are errors (`check` runs `--deny-warnings`):

1. `npm ci`
2. `npm run check` (oxfmt, oxlint, `scripts/check-docs.ts`)
3. `npm run build:packages`
4. `npm test` (all workspaces)
5. `npm run check:bundle`
6. `npm run typecheck` and `npm run check:declarations` (after the build)
7. The browser/memory scripts relevant to what changed (`test:browser:*`, `test:ssr:memory`, `test:inspector:memory`) when Chromium is available.

## Ledger

`docs/plans/surpass-solid.md` — id, item, why it beats or matches Solid, status, evidence (test names, benchmark numbers with environment). Its "Last docs tidy" line is the housekeeping date.

## Work order

One PR each unless trivially small.

1. Audit items in the audit doc's section 4 order: CQ-06+07+10 → CQ-04+03 → CQ-01+02 → CQ-05 (keep `root-dynamic-unmount.test.ts` green) → CQ-09 → CQ-08, CQ-11–13.
2. SV2 capability rows in the roadmap's order: SV2-003 async derivation, SV2-006 error/reset boundaries, SV2-004 client loading/retained content, SV2-005 property-granular stores, SV2-008 current keyed index, SV2-007 async transactions/optimistic, SV2-009/010 independent streaming and early interactivity, SV2-017 owner composition, SV2-013 diagnostics. Each starts with its ADR (API, semantics, intentional differences from Solid, acceptance tests); then implementation slices, each a mergeable PR with value of its own. Other open SV2 rows in the gap docs (e.g. SV2-014, SV2-015) follow when these are done or blocked.
3. Ease of use with every capability: typed public API, README/docs examples, CLI scaffold update when it changes how apps are written, clear dev-mode errors. Fewer, composable APIs.
4. Performance evidence: every perf PR runs `benchmark/run-bench.ts` for purity and solid on the affected pages (warmup 3, iterations ≥ 5) before and after; record medians and the raw run file in the PR and ledger. Re-run when a difference is under ~10%; never claim a win from one noisy run.

Tests first; cover error/disposal paths; keep `generate` / `generateSSR` / `generateHydrate` in lockstep; review your own diff adversarially **before** opening, because Codex reviews only the opening commit.

## Authority

- Branch prefixes opened by this task: `perf/`, `feat/`, `fix/`, `test/`, `docs/`; housekeeping branch docs/tidy-YYYY-MM-DD; plus the PR for branch `audit/code-quality-2026-11-05`. Squash merge pinned to the head SHA.
- Other sessions and Dependabot work in this repo: never push to, merge or close their PRs or branches (e.g. a PR another session is actively pushing to).
- Publishing to npm stays the owner's: never run or dispatch the publish workflow, never bump versions for a release, never tag or create Releases. Merging deploys nothing beyond what the repo's workflows do on `main`.

## Project rules (stricter than the shared defaults)

- **Review:** Codex (`chatgpt-codex-connector`) reviews only the commit a PR was opened with. Its summary for the opening commit must show Completed (wait up to 30 minutes after opening; if it never completes, the PR waits for the next run). Every finding it raised plus every other review comment is fixed in a later commit with its thread resolved, or answered with a traced reason and resolved. A re-review of later commits is not required. Never close and reopen a PR or push empty commits to get Codex or CI to run again. Open question for the owner: since #373 Codex's summary ends "Failed" (account usage limit); PRs #373–#380 treated that as "cannot review" (`autonomous-dev` §3.5) and used an independent review agent. This file does not widen that; the owner's answer is recorded here when given.
- The independent verifier verdict (`verification-first`) is separate from the Codex rule and does not replace it.
- Every hosted CI check on the head ran and passed (a job cancelled by runner infrastructure may be re-run once; a second failure is real).
- **Bundle budgets:** never raise an existing budget to pass; a new capability that needs bytes goes into an opt-in entry with its own new budget stated in the PR; unavoidable growth of an existing entry is an owner decision.
- Removing a genuinely duplicated test is fine when the PR names the surviving copy.
- **Stuck rule:** if this task's open PR is still not mergeable at the start of its third run, or the same failure survived two fix attempts, shrink it to the green mergeable part (split the rest) or close it with a comment, mark the ledger item blocked with what would unblock it, and move on. If hosted CI or Codex is unavailable for more than a day, say so once and keep the single PR ready.
- Benchmark claims name the exact Solid version, Purity commit, browser and machine; never rewrite `benchmark/history`.
- **Verification boundary:** a built app (CLI scaffold or the benchmark pages) in headless Chromium — JIT and strict AOT, SSR then hydration, DOM mutation counts — and, for performance, `benchmark/run-bench.ts` against Solid.

## Owner decisions (never taken by the task)

- Growth of an existing bundle budget entry.
- npm publishing, versions, tags, releases.
- Adding Codex credits or any paid service.

## Docs scope

- Ledger `docs/plans/surpass-solid.md`. The audit, gap and roadmap docs (`docs/code-quality-audit-2026-11-05.md`, `docs/solid-v2-gap-analysis.md`, `docs/solid-v2-gaps.json`, `docs/solid-competitor-roadmap.md`, `docs/framework-capabilities.md`) are edited in place; a finished one is folded into the ledger or `framework-capabilities.md` and deleted. Handoff notes are folded and deleted.
- One exception to "no new docs": each SV2 capability may get one new numbered ADR in `docs/decisions/` (next free number), only one per capability.
- `benchmark/history` and recorded benchmark runs are data.
- Housekeeping (branch docs/tidy-YYYY-MM-DD, once per Sydney day): every `*.md` — broken relative links and anchors, references to missing files/exports, ADR numbering/index gaps (`scripts/check-docs.ts` finds these); stale facts against the tree and manifests (package lists and paths, versions, test/ADR/scenario counts, commands, comparator versions), preferring wording that does not go stale. Consolidate superseded docs and delete the rest. Never delete or renumber ADRs (mark superseded ones in their status line). Agent-facing files (root and package `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) match the tree, stay short and point to the canonical doc. Update the ledger's "Last docs tidy" line.

## Report extras

Report in Chinese. Add bundle and benchmark deltas for each merged PR, and items marked blocked with what would unblock them.
