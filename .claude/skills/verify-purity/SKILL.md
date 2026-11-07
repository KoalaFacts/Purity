---
name: verify-purity
description: How to exercise Purity for real (built packages in headless Chromium, SSR then hydration, CLI app scaffold, benchmark pages against Solid) before claiming a change works; pairs with verification-first.
---

# Verify Purity

Use with `.claude/skills/verification-first/SKILL.md`. The real boundary here is a **built** package or app running in headless Chromium: the benchmark pages (strict AOT production build of `benchmark/apps/*`), the islands example, the packaged CLI `--app` scaffold, and SSR output hydrated in the browser. jsdom/vitest runs are the gate, not the verification.

## Setup

- Node >= 24 and npm 11 (`.nvmrc` pins 24). If the machine has older ones: `npm i node@24 npm@11` in a scratch folder and put its `node_modules/.bin` first on `PATH`.
- `npm ci`, then `npm run build:packages` (every browser check consumes `dist/`, not `src/`).
- Browser: the repo pins `playwright` in the root lockfile; its Chromium revision may differ from the browsers installed on the machine (`Executable doesn't exist at …chromium_headless_shell-NNNN…`). Either run `npx playwright install chromium`, or point `PLAYWRIGHT_BROWSERS_PATH` at a scratch folder holding symlinks named with the revision the error asks for (`chromium-NNNN`, `chromium_headless_shell-NNNN`, `ffmpeg-NNNN`) to the installed ones. `CHROMIUM_PATH` alone is honoured only by `run-bench.ts`, `tools/profile.ts`, `tools/sanity.ts` and `tools/memory-leak-check.ts`.
- Benchmark pages: `npm run build -w benchmark`, then `npm run preview -w benchmark -- --port 4173 &` and wait until `http://localhost:4173/Purity/apps/purity/index.html` answers 200 before running `run-bench.ts` (a bare `npx vite preview` may first download a different Vite and start late).

## Feature map

Commands run from the repo root unless noted. "chromium" as a trailing argument selects one engine in scripts built on `benchmark/tools/browser-engines.ts`.

| Feature | Code entry points | How to exercise it for real | Evidence to capture | Neighbours at risk |
| --- | --- | --- | --- | --- |
| Template bindings (strict AOT, production) | `packages/compiler/src/` (`generate`), `packages/core/src/compiler/`, `packages/vite-plugin/src/index.ts` (`strictAot`) | `cd benchmark && npm run build && node tools/binding-browser-check.ts chromium` | JSON lines `{"engine":"chromium","framework":"purity","fields":100,"clearAfterUserInput":"passed"}` for purity and solid | input focus/selection, per-binding memo (CQ-03), `each()` rows |
| Rendered DOM parity with Solid | `benchmark/apps/purity/*`, `benchmark/apps/solid/*` | `cd benchmark && node tools/fixture-parity-browser-check.ts chromium` (after the build above) | exit 0; per scene/step `semanticSHA256` lines; a mismatch names the diff file under `benchmark/dist/fixture-parity` | every page in `benchmark/apps` |
| DOM mutation counts per binding kind | `packages/core/tests/binding-memo.test.ts`, `each-reconcile.test.ts`, `hydration-commit.test.ts` (MutationObserver) | `cd packages/core && npx vitest run tests/binding-memo.test.ts tests/each-reconcile.test.ts` | the mutation-count assertions passing; quote counts from the test names | keyed `each()`, hydration commit |
| SSR then hydration (packaged) | `packages/ssr/src/`, `packages/core/src/hydrate*`, `generateSSR` / `generateHydrate` | `npm run test:browser:ssr-retention -- chromium` | `chromium: packaged client production preview and first click passed` and `chromium: SSR button retained and first click passed` | streaming boundaries, resource priming, DSD components |
| SSR security in the browser | `packages/ssr/src/`, hydration URL checks | `node --experimental-strip-types packages/ssr/tests/browser-security.ts` | the three `chromium: …` lines (forged markup blocked, cross-origin form blocked JS=false/true) | `serverAction`, form enhancement |
| Islands | `packages/platform/src/` (islands), `examples/islands-blog` | `PURITY_BROWSER=chromium node --experimental-strip-types examples/islands-blog/browser-check.ts` | `chromium …: first click, keyboard, forms, external submitter, and SVG passed` | hydration bridge, forms |
| CLI `--app` scaffold (dev + production) | `packages/cli/src/index.ts`, `packages/cli/template/`, router, platform actions | `npm run test:browser:app-actions` (packs packages, scaffolds, runs dev and `start`) | `Checking start`, the `HTTP …passed` lines and `chromium: native no-JS forms, … passed` | vite-plugin routes, server-module strip, loaders |
| Keyed `each()` current position (ADR 0058) | `packages/core/src/control.ts` (`eachRowOps`, `EachMapFn`), `control/position.ts` (`rowPosition`), `control/hydrate.ts`, `packages/ssr/src/control.ts` | `cd packages/core && npx vitest run tests/each-position.test.ts` and `cd packages/ssr && npx vitest run tests/control-flow.test.ts`; in the browser, mount a keyed `each()` from built `core/dist/browser/index.js` whose rows render `${() => position()}` and an `<input>`, type into one, prepend and reverse | labels follow the new order, the same `<li>`/`<input>` nodes, the typed value kept | `each()` move paths, hydration adoption, `core`/`core-csr` budgets |
| Virtual lists | `packages/core/src/virtual*` (`@purityjs/core/virtual`) | `node --conditions=development --experimental-strip-types benchmark/tools/virtual-browser-check.ts` | `chromium: 18 initial and 18 bottom virtual rows; 10,000 regular rows; shadow scroll reached Row 9999` and `multiRootReorder: passed` | `each()` move paths |
| Memory / disposal | `packages/core/src/` mount/unmount, `packages/signals/src/signals.ts` | `node --conditions=development --experimental-strip-types benchmark/tools/memory-leak-check.ts` | `retained hosts 0/100, rows 0/100, states 0/100` per scenario and `Positive control: … detected` | scopes, `each()`, components |
| Performance against Solid | `benchmark/run-bench.ts`, `benchmark/apps/{purity,solid}` | with the preview running: `cd benchmark && FRAMEWORKS=purity,solid PAGES=<page> WARMUP=3 ITERATIONS=5 npx tsx run-bench.ts` before and after the change | the result table rows, the `Raw evidence: …benchmark-runs/<file>.json` path, Solid version from `benchmark/package.json` (`solid-js`), Purity commit, Chromium version, machine | all scenarios on the same page |
| Async derivation (`@purityjs/core/async`) | `packages/core/src/async.ts`, ADR 0054 | after `npm run build:packages`, import `asyncCompute`/`isPending` from `@purityjs/core/async` in a temporary `.ts` file under the repo root (resolves the export map to `dist/`) and run it with `node`: read a `compute()` over it before settling, after settling, after two quick source writes, and after they settle; also `cd packages/core && npx vitest run tests/async-compute.test.ts` | `{"first":"pending","settled":"Hello, user1","retained":"Hello, user1","latest":"Hello, user3","aborted":[1]}`-shaped output (pending before first value, retained value while in flight, only the latest run current) | `compute()` caching, scope disposal, `resource()` |
| Loading boundary (`@purityjs/core/loading`) | `packages/core/src/loading.ts`, `hosted-context.ts`, ADR 0057 | after `npm run build -w @purityjs/core`, serve `packages/` over a local HTTP server with an import map `{"@purityjs/signals":"/signals/dist/index.js"}`, import `mount` from `/core/dist/browser/index.js`, `asyncCompute` from `/core/dist/browser/async/index.js` and `loading` from `/core/dist/browser/loading/index.js` in headless Chromium; mount a `loading()` whose view binds an unresolved value and holds an `<input>`; resolve; type in and focus the input; change the source; resolve again; also `cd packages/core && npx vitest run tests/loading.test.ts` and `cd packages/ssr && npx vitest run tests/control-flow.test.ts` | `<!--ld--><p>Loading…</p><!--/ld-->` → `<!--ld--><div><span>one</span><input></div><!--/ld-->`; during the refetch the text stays `one`, `pending()` is true and the input is the same node; after it `two`, same node, value `edited`, still focused, 2 view renders | `errorBoundary()` (shared `hosted-context.ts`), `asyncCompute()` (`PendingError.source`), `core-boundary`/`core-async` budgets |
| Bundle size | `benchmark/bundle-size/measure.ts`, budgets in that folder | `npm run check:bundle` | `Budget checks: passed.` and the row for each touched entry | every core entry |

Last run of every row: see "Last verified".

## Gate

```bash
npm ci
npm run check            # oxfmt + oxlint --deny-warnings + check-docs
npm run typecheck        # CI runs it too
npm run build:packages
npm test                 # all workspaces
npm run check:bundle
```

Add the feature-map rows the change touches. CI (`.github/workflows/ci.yml`) also runs all three browser engines.

## Traps

- `test:browser:app-actions`, `benchmark/tools/virtual-browser-check.ts` and `packages/ssr/tests/browser-security.ts` loop over chromium, firefox and webkit with no selector; on a machine with only Chromium they fail after the Chromium lines print. Read the Chromium lines as the evidence, or limit the loop to `[chromium]` in a local, uncommitted edit and restore it; never commit that edit.
- Scripts that read `npm_execpath` (`ssr/tests/browser-retention.ts`, the CLI smoke) throw `Run through npm` when started with plain `node`; use the npm script.
- Benchmark pages import `html` from `@purityjs/core/jit` but the Vite plugin AOT-compiles them (`strictAot` defaults to true), so they verify strict AOT, not runtime JIT. Runtime JIT is covered by the jsdom suites in `packages/core/tests`; say so when JIT behaviour is the claim.
- `run-bench.ts` reports `ERR` for every row when the preview is not up yet (`ERR_CONNECTION_REFUSED`); the exit code is non-zero and the raw file lists evidence validation errors — that is not a measurement.
- One benchmark run on a busy sandbox is noise: rerun when the difference is under ~10%, and never compare runs from different machines.
- The three codegen modes must agree: a change verified only in the client build can still break `generateSSR` / `generateHydrate`; run the SSR-then-hydration row for any template change.
- Tests that only assert "did not throw" or check a mock prove nothing here; DOM state, mutation counts or retained-object counts do.

## Last verified

2026-11-06, commit `68c12f9` (main): every feature-map row run once in headless Chromium 153.0.8010.12 on a cloud Linux sandbox (Node 24.22.2, npm 11.21.2; app-actions and virtual with the local chromium-only loop edit described in Traps; browser-security printed its Chromium lines then failed on the missing firefox). `run-bench.ts` diamond page, purity vs solid-js 2.0.0-rc.20, warmup 3, iterations 5: 0.3/0.3/0.8/5.4 ms vs 0.4/0.5/1.1/6.3 ms (one run, a smoke check, not a performance claim).
