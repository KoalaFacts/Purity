# Code quality audit — 2026-11-05

**Purity source:** `1c76af6` (main, 0.5.2 published). **Comparator in the benchmark workspace:** `solid-js` / `@solidjs/web` 2.0.0-rc.20, `@solidjs/vite-plugin` 3.0.0-next.55. **Environment:** Node 24.22.2 / npm 11.21.2, Google Chrome for Testing 153.0.8010.12 (headless), 2 vCPU Linux container.

This is a **code-level** audit: hot paths, duplication, test placement, type gates and documentation drift. It complements the capability-level [Solid v2 gap analysis](./solid-v2-gap-analysis.md) and does not re-litigate its rows; each finding below names the SV2 row it serves, where one applies. Findings carry `file:line` at `1c76af6` and the probe or profile that produced the evidence.

## 1. Baseline at `1c76af6`

| Gate                               | Result                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (oxfmt + oxlint)   | clean, 808 files                                                                                                                    |
| `npm run build:packages`           | all 8 packages                                                                                                                      |
| `npm test` (all workspaces)        | 3,464 tests, 0 failures                                                                                                             |
| `npm run check:bundle`             | budgets pass; `runtime-all` 43,024 B Brotli, counter-csr-aot 2,500 B                                                                |
| Coverage (statements, own package) | signals 86.7 · compiler 60.7 · core 92.3 · ssr 90.5 · router 92.4 · platform 91.7 · vite-plugin 93.6                                |
| Static metrics                     | 24,732 src lines; `: any`/`as any` 53 (35 in vite-plugin); 0 `@ts-ignore`; 0 TODO/FIXME; 0.26% duplicated lines (jscpd, ≥60 tokens) |

The codebase is in good shape by the usual static measures. The findings are therefore about **where the remaining cost and risk concentrate**, not about broad cleanup.

## 2. Benchmark snapshot: where Purity trails Solid v2 rc.20

`benchmark/run-bench.ts` with `FRAMEWORKS=purity,solid`, warmup 3, iterations 5, drop fastest+slowest: the rendering page (`index`) was run twice, every other page once. The container is noisy (Append 1k moved 36.6 → 59.5 ms between the two index runs), so single-run rows are indicative only and the index rows list both runs. Raw runs are in `benchmark/dist/benchmark-runs/` for this session only; they are not a new SV2-015 baseline.

| Scenario                        | Purity (run 1 / run 2) | Solid (run 1 / run 2) | Pattern            |
| ------------------------------- | ---------------------- | --------------------- | ------------------ |
| Create 10,000 rows              | 427 / 449 ms           | 402 / 376 ms          | behind 6–19%       |
| Clear 10,000 rows               | 48.5 / 46.5 ms         | 43.9 / 44.2 ms        | behind 5–10%       |
| Swap rows (1k)                  | 5.0 / 4.2 ms           | 4.2 / 3.7 ms          | behind 14–19%      |
| Sort 10k by ID ↓ / by label     | 198 / 241 ms           | 172 / 225 ms          | behind 7–15%       |
| Filter 10k                      | 27.6 ms                | 21.3 ms               | behind ~30%        |
| Replace 1k / 10k components     | 14.4 / 115.5 ms        | 12.6 / 107.2 ms       | behind 8–14%       |
| Update every 10th (10k)         | 103 / 134 ms           | 120 / 99 ms           | mixed              |
| Selection, ticker, increment    | —                      | —                     | Purity ahead 2–5×  |
| Replace rows, computed, diamond | —                      | —                     | Purity level/ahead |

Reading: Purity wins where fine-grained signal updates dominate and trails where **row creation/teardown and keyed reordering** dominate. The profiles below point at specific code for both.

`tools/profile.ts purity create` (10k rows): script 169 ms, GC **78.5 ms**, `cloneNode` 30.6 ms, `swapSlot` **11.4 ms self**, `insertBefore` 11.2 ms, `trackOwnedNodes` 1.6 ms; heap +13.35 MB (Solid +12.2 MB).
`tools/profile.ts purity swap` (10k rows, swap 2): JS 12.8 ms, GC **12.3 ms**, `reconcileEachImpl` 8.9 ms total, `lis` 2.8 ms — for a two-row move.

## 3. Findings

Priority uses the gap-analysis vocabulary: P0 correctness/evidence integrity, P1 measurable application impact, P2 maintainability.

### P1 — hot paths

<a id="cq-01"></a>

**CQ-01 · `reconcileEachImpl` has no common-prefix/suffix trimming and allocates ~6 O(N) structures per diff.** `packages/core/src/control.ts:505-695`. Every reconcile starts with `Array.from(keyToEntry.keys())` (line 515), and any order change that is not a pure append/prepend builds `newKeys`, `newEntries` (Map), `oldKeyIndex` (Map), `sources`, `lis(sources)` and a `Set` of LIS indices over the **whole** list. A swap of two rows in 10k therefore costs a full LIS plus 12 ms of GC (profile above); Solid's `reconcileArrays` trims equal head/tail first and runs LIS only on the changed window.
_Serves:_ SV2-015 (swap/sort/filter rows). _Fix:_ (a) keep `keys: unknown[]` in `EachState` next to the map so the fast path and the diff never call `Array.from`; (b) trim equal head/tail keys before building the index maps and run LIS on the middle window only; (c) size `oldKeyIndex` to the window. The existing `each-move-before` and `control` suites already pin node identity, so this is a pure-performance change.

<a id="cq-02"></a>

**CQ-02 · Owned `each()` pays O(N) ownership rewrites on every reconcile.** `packages/core/src/control.ts:477-503`. When the list's end marker is owned (an `each` inside a `when`/`match` branch or inside another row), `reconcileEach` snapshots **all** row nodes before the diff (`ownedEntryNodes`), builds a `Set` of them, snapshots them again after, then `filter`s and re-spreads `owner.nodes`. Probe (jsdom, 5,000 rows, single-row update ×30): **2.30 ms/op inside `when()` vs 1.23 ms/op unwrapped** — the bookkeeping doubles the update cost and does not depend on the size of the change.
_Serves:_ SV2-015, SV2-008. _Fix:_ represent an owned `each` in `owner.nodes` as one range token (`[endMarker]` with the rows reachable through `eachState`) or update `owner.nodes` incrementally from the diff's add/remove sets, so the cost is proportional to the change.

<a id="cq-03"></a>

**CQ-03 · Grouped template watcher re-applies sibling bindings with no per-binding memo.** `packages/compiler/src/codegen.ts:974-1068` folds every reactive binding of a template into one `_w()`; the reactive lines (lines 1099, 1141, 1148, 1155) call the accessor and write the DOM unconditionally. Probe: in `<div class=${cls}><input .value=${val}><span>${label}</span></div>`, changing **only** `label` calls `setAttribute('class')` once and sets `input.value` once; changing `cls` does the same to the other two. The comment at 980-983 budgets this as "~50 ns text writes"; it misses that attribute re-sets trigger style invalidation and that re-assigning `.value` on a focused input disturbs caret, selection and IME composition in several engines — the editing-state contract SV2-008 asks for.
_Serves:_ SV2-008, SV2-015 (update every 10th). _Fix:_ keep the single effect, add one `var _l<id>` per binding, initialised to a private sentinel (for example a module-level `UNSET = {}`) so the first run always writes, and guard each later write with `if (v !== _l<id>) { _l<id> = v; … }` (strings/numbers/booleans compare by value; nodes/arrays by identity). The sentinel matters: reactive slots are left untouched during setup (`codegen.ts:1095-1099`) and still hold the zero-width `EXPR_PLACEHOLDER`, so an uninitialised cache would skip the first write of an accessor that returns `undefined` and leave the placeholder in place. No new effect nodes, so the bundle budgets and the 10k-watches argument are unaffected.

<a id="cq-04"></a>

**CQ-04 · `swapSlot` allocates before its text fast path and writes unchanged text.** `packages/core/src/runtime/csr-runtime.ts:88-112`. `leaves = [v]` and `next = []` are built before the `cur.nodeType === 3` check, and `cur.data = text` runs even when equal. Every text binding goes through this on first render and on every group re-run (CQ-03); in the create profile it is the hottest Purity-owned function (11.4 ms self for 10k rows).
_Fix:_ first statement: `if (typeof v !== 'object' && typeof v !== 'function' && !Array.isArray(cur) && cur.nodeType === 3) { const s = v === undefined || v === false ? '' : String(v); if (cur.data !== s) cur.data = s; return cur; }`. It must keep the existing normalisation of `undefined` and `false` to empty content (`csr-runtime.ts:93`; `null` is an object and takes the normal path), or conditional and optional bindings would render the strings `"undefined"`/`"false"`. Pin it with tests for `undefined`, `false`, `null`, `0` and `''`.

<a id="cq-05"></a>

**CQ-05 · Per-row allocation profile.** Each `each()` row creates an `EachEntry`, a `nodes` array, one `state()` (a node plus **four** function objects — the accessor and `get`/`set`/`peek` closures, `packages/signals/src/signals.ts:801-814`), a grouped effect node with 13 fields plus `sources`/`sourceMeta`/`disposers` arrays, and a `WeakMap.set` per root node (`trackOwnedNodes`, `control.ts:72-78`; undone per node in `untrackOwnedNodes` on clear). Create 10k: GC 78 ms, heap +13.35 MB vs Solid +12.2 MB; Clear 10k trails by 5–10%.
_Fix candidates, cheapest first:_ share `get`/`set`/`peek` as prototype-style functions reading the node from the accessor (saves three closures per signal everywhere, not only rows); reduce `trackOwnedNodes` churn without losing the registrations `replaceOwnedNodes` needs. Gating on whether the `each` is owned is **not** safe: a top-level list whose row root is a slot that swaps nodes relies on those registrations to update `entry.nodes`, or the next reorder moves detached roots (pinned by `root-dynamic-unmount.test.ts` "reorders list rows whose root template slots have replaced their nodes"). Viable options are registering a row only when one of its root nodes is a dynamic slot (known at compile time from the row template), or registering lazily on the first slot replacement; either must keep that test green.

### P1 — evidence and type gates

<a id="cq-06"></a>

**CQ-06 · `@purityjs/core` tests run against the compiler's built `dist`, not its source.** `packages/core/vitest.config.ts` aliases `@purityjs/signals` and `@purityjs/ssr/runtime` to `src` but not `@purityjs/compiler`, whose `development` export condition points at `dist` (`packages/compiler/package.json`). Verified: with `packages/compiler/dist` removed, `npx vitest run tests/compiler.test.ts` in core fails to resolve the import. Consequences: editing `codegen.ts` and running `npm test -w packages/core` tests the **previous build**; core's suite contributes 0% coverage to compiler source; the compiler's own suite covers only 60.7% (codegen 60%, escape 20%, parser 68%).
_Serves:_ SV2-014, SV2-002. _Fix:_ add the compiler alias in core's and vite-plugin's vitest configs; move the codegen/parser/escape cases that currently live in `packages/core/tests/compiler*.test.ts` and `conformance.test.ts` to `packages/compiler/tests`, or at least add the alias and set a coverage floor for the compiler package.

<a id="cq-07"></a>

**CQ-07 · Duplicate and misplaced test files after the package split.** `packages/core/tests/signals.test.ts` (1,504 lines, 75 cases) and `packages/signals/tests/signals.test.ts` (1,628 lines, 81 cases) share 74 identical case names; the core copy predates the `@purityjs/signals` extraction and exercises the same source through the alias. `packages/signals/src/debounced.ts` has 0% coverage from its own package (97% from core). Cost: ~1,500 lines of maintenance and CI time, and the risk that a fix lands in one copy only.
_Fix:_ delete the core copy, keep one re-export assertion in core, move the `debounced` suite to `packages/signals/tests`.

<a id="cq-08"></a>

**CQ-08 · The standalone `__purity_sw__` (public `generate()` output) diverges from the runtime `swapSlot`.** `packages/compiler/src/codegen.ts:395-405` versus `csr-runtime.ts:88-151`. The standalone version has no text fast path: for a plain text update it builds two arrays, a `Set`, a `DocumentFragment`, **detaches** the existing `Text` node into the fragment and re-inserts it. JIT and AOT bind the runtime `swapSlot`, so only consumers of the public `generate()`/`generateHydrate()` strings see this, but the two implementations are maintained by hand and the comment at 387-390 relies on conformance tests that compare results, not DOM mutation counts.
_Fix:_ derive the standalone helper text from the runtime source at build time (the runtime functions are already written in helper-free style), or port the fast path and add a `MutationObserver`-counting equivalence test.

<a id="cq-09"></a>

**CQ-09 · Type gates cover one package and no tests.** `.github/workflows/ci.yml:72` runs `tsc --noEmit` for core only (the other packages are type-checked incidentally by `tsc --emitDeclarationOnly` in `build`). Every `tsconfig.json` excludes `tests`, so test files — including `types.test.ts` and `loader-data-of.test.ts`, which exist to pin public types — are never type-checked; a removed diagnostic cannot fail CI. `vite.config.ts` turns off `typescript/no-explicit-any` and the whole oxlint `perf` category. `packages/vite-plugin/src/index.ts` types every hook as `this: any` and walks the oxc AST as `node: any` (35 of the repo's 53 `any`s); `purity()` returns an untyped object literal rather than Vite's `Plugin`, so a consumer's strict config sees a structural type that is not guaranteed to satisfy `PluginOption`.
_Serves:_ SV2-014 directly. _Fix:_ a root `tsconfig.tests.json` (or per-package) that includes `tests/**` with `noEmit`, run for all packages in CI; type the plugin as `Plugin` (type-only import from the `vite` peer) and the AST walk with `oxc-parser`'s exported node types; re-enable `no-explicit-any` as `warn` with the current count as the ceiling.

<a id="cq-10"></a>

**CQ-10 · Agent-facing documentation describes a layout that no longer exists.** Root `CLAUDE.md` says "the four published packages" (there are eight), places the compiler at `packages/core/src/compiler/` (it is `packages/compiler/src/`), and `packages/core/CLAUDE.md` lists `signals.ts`, `compiler/ast.ts`, `parser.ts`, `codegen.ts` and `hydrate-runtime.ts` under `core/src`. `NEXT_HANDOFF.md` narrates a historical branch ("100 commits ahead of main, ADRs 0007–0034") against a tree with 53 ADRs. These files are the first thing every Claude Code / agent session reads before editing, so they actively misdirect edits. Separately, `benchmark/package.json` now resolves Solid rc.20 while `benchmark/solid-v2/target.json` and the SV2 ledger freeze rc.18 — the SV2-001 freeze is stale again and the rc.18 → rc.20 move is not recorded as a baseline change.
_Serves:_ SV2-001, working-agreement hygiene. _Fix:_ regenerate the package table and file layouts in both `CLAUDE.md`s; retire `NEXT_HANDOFF.md` to `docs/plans/` with a date; add an rc.20 entry to `target.json` and a one-line baseline-change note in the gap analysis.

### P2 — maintainability

<a id="cq-11"></a>

**CQ-11 · Concentrated long functions.** `parse` 485 lines (`compiler/src/parser.ts:78`), `enhanceForms` 394 (`platform/src/enhance-forms.ts:120`), `purity` 301 (`vite-plugin/src/index.ts:254`), `component` 285 (`core/src/elements.ts:218`), `resource` 284 (`core/src/resource.ts:123`), `resetControl` 259, `loadStack` 213, `devicePixelRatioSignal` 242. None is wrong, but each mixes several phases (option normalisation, hook wiring, teardown) that reviewers must hold at once. Splitting `purity()` into `createTransform`, `createRoutesHooks`, `createDevtoolsHooks` and `parse` into tag/attribute/text phases would also make CQ-06/CQ-09 cheaper.

<a id="cq-12"></a>

**CQ-12 · Signal graph: allocation on every CHECK resolution and every write that reaches a computed.** `packages/signals/src/signals.ts:311-324` (`markCheck` allocates a stack per write), `357-365` (`resolveCheck` allocates a frame object and `?? []` fallbacks per pull). Not a measured bottleneck — Purity is level with or ahead of Solid on computed-chain and diamond — so this is optional: a depth-0 fast path (sources all CLEAN or states) avoids the frame allocation in the common case, and a module-level reusable stack suits `markCheck` because no user code runs inside it. `pendingEffects` can also hold the same effect twice (CHECK → DIRTY re-push, lines 299 and 318); harmless because the flush skips CLEAN entries.

<a id="cq-13"></a>

**CQ-13 · Tooling inconsistencies.** `benchmark/tools/profile.ts:92` calls `chromium.launch()` and ignores `CHROMIUM_PATH`, which `run-bench.ts:947` honours; profiling on a machine with a system Chrome needs a local patch. The `Populate 10k filtered` memory row retains 0.7 MB after the operation versus Solid's 0.3 MB — worth one heap diff with `tools/resource-heap.ts`-style tooling before SV2-015 publishes a memory table.

## 4. Suggested order

1. **CQ-06, CQ-07, CQ-10** — one PR, no behaviour change: alias the compiler in vitest, delete the duplicate signals suite, fix both `CLAUDE.md`s and record the rc.20 baseline. Removes the blind spot before any codegen work.
2. **CQ-04 + CQ-03** — codegen/runtime PR with a `MutationObserver` mutation-count test per binding kind. Expected: fewer DOM writes per update, and the editing-state scenario for SV2-008 becomes testable.
3. **CQ-01 + CQ-02** — `each()` reconcile PR: keys array, head/tail trimming, incremental owner update. Re-run swap/sort/filter rows and the owned-list probe; keep `each-move-before`, `row-detach-sharing` and the fixture-parity browser check as the correctness gate.
4. **CQ-05** — shared accessor methods and lazy row ownership; measure Create/Clear 10k and heap delta.
5. **CQ-09** — test type-check job for every package and typed plugin surface; this is the bounded SV2-014 slice the gap analysis already asks for.
6. **CQ-11 – CQ-13** opportunistically, inside the PRs that touch those files.

None of this replaces the capability rows (SV2-003 async derivation, SV2-005 stores, SV2-006 boundaries) that the roadmap sequences next; items 1–2 are small enough to land before them, and item 3 is the measured bottleneck SV2-015 says to select from.

## 5. Reproduction

```bash
# baseline
npm ci && npm run check && npm run build:packages && npm test && npm run check:bundle

# benchmark (Purity vs Solid, all pages)
cd benchmark
npm run build
npm run preview -- --port 4173 &   # only the server is backgrounded
until curl -s -o /dev/null http://localhost:4173/; do sleep 1; done
CHROMIUM_PATH=/usr/bin/google-chrome FRAMEWORKS=purity,solid WARMUP=3 ITERATIONS=5 \
  node --conditions=development --experimental-strip-types run-bench.ts
cd ..

# CQ-06: core tests resolve the compiler from dist
mv packages/compiler/dist packages/compiler/dist.bak && (cd packages/core && npx vitest run tests/compiler.test.ts); mv packages/compiler/dist.bak packages/compiler/dist
```

The jsdom probes for CQ-02 and CQ-03 are ~40-line scripts (`JSDOM` + `html` from `src/compiler/jit.ts` + `state` from `@purityjs/signals`, run with `node --conditions=development --experimental-strip-types` from `packages/core`); they are worth promoting to regression tests in the PRs above rather than keeping as scripts.
