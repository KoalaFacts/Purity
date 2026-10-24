# Roadmap: make Purity a strong Solid v2 competitor

**Status:** Execution roadmap; individual API and support-policy decisions still require their own ADRs.
**Direction updated:** 2026-10-25, Australia/Sydney: Solid **v2** is the primary competitor.
**Current gap audit:** `58ff714`; [comparison and acceptance contracts](./solid-v2-gap-analysis.md), [machine-readable ledger](./solid-v2-gaps.json), and [frozen rc.18 target](../benchmark/solid-v2/target.json). The original `50c80b3` inventory remains historical evidence, not the current status.

## Goal and position

Purity's goal is to become a strong SolidJS competitor: a framework a team can choose for a demanding reactive application, with predictable behavior, usable tooling, reproducible performance evidence, and a credible upgrade and deployment path.

The position is **fine-grained reactivity and direct DOM updates, Web Components with Shadow DOM, modular feature entries, optional AOT compilation, and zero runtime dependencies**. These choices already shape the project; the work is to make their application-level benefits dependable. A team should be able to combine Purity components with platform code, ship only the features it imports, and choose an audited AOT build when its CSP forbids runtime compilation. Bundle and execution costs must be measured for that application and build mode.

Competitive strength means completing real journeys: editing and reordering stateful rows without losing input state; cancelling obsolete work; showing and recovering from failures; delivering usable SSR output; debugging a stale view; and upgrading a published application. A matching API name, test count, or single benchmark win does not establish those properties. This roadmap does not declare Solid parity or a universal speed/size ranking.

### Decisions this goal preserves

| Choice                                                | Classification          | Competitive consequence                                                                                                                                                           |
| ----------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct DOM templates and a custom signal graph        | Core design             | Improve their correctness and cost before proposing a core rewrite. A different graph or renderer needs a concrete failing contract or measured bottleneck.                       |
| Custom Elements and Shadow DOM                        | Intentional alternative | Prove property, event, slot, form, focus, styling, and SSR behavior across boundaries. Solid-style function components and light-DOM composition are not a mandatory replacement. |
| Tagged templates, optional JIT, optional AOT          | Intentional alternative | Keep the no-build development path; make the AOT production contract explicit. JSX compatibility is not a prerequisite for competing.                                             |
| Modular entries and a separate SSR package            | Core design             | Preserve shared ownership state across entries and avoid retaining compiler/server code in client profiles. See [entry-point boundaries](./core-entry-points.md).                 |
| Small primitive surface and zero runtime dependencies | Design constraint       | Add capabilities when they remove demonstrated application complexity. Copying every Solid export or helper is not an acceptance criterion.                                       |
| Conventional hydration plus opt-in islands            | Current execution model | Improve identity preservation and delivery behavior. Resumability and server-driven UI remain separate research in the [execution-model note](./2026-execution-model-roadmap.md). |

## Comparison tracks and evidence rules

### Solid v2 is the primary behavior and application reference

Use the exact **2.0.0-rc.18** core/signals/web baseline and separately versioned build/router inputs in the [target manifest](../benchmark/solid-v2/target.json). The [gap analysis](./solid-v2-gap-analysis.md) records application impact, priority, evidence and executable acceptance for each stable `SV2-*` ID. Registry identity is recorded; a full application comparison still needs its own resolved lockfile and actual client/server entry verification.

Compare v2's async graph, coherent pending updates, structured stores, error recovery, transactional actions, keyed list modes, SSR/hydration and developer workflows. Use the [v2 documentation](https://v2.solidjs.com/) and the selected release's source, resolving any moving-preview contradictions against that release. A green Purity test suite or API-name match cannot establish those contracts.

The existing benchmark remains on core/signals rc.15 and web/compiler rc.14. Preserve its measurements with their original inputs. Refresh the comparator in a deliberate, verified baseline change; do not reinterpret old runs as rc.18 results. Stable 1.x is only historical/compatibility background, not this project's primary acceptance target.

Purity may preserve intentional differences, including immediate signal reads, template syntax and Web Components. Verify the chosen application outcome and explain its cost. Fullstack comparisons must name the v2-compatible router/build/server stack; the major number of `@solidjs/start` does not identify a Solid v2 runtime.

### What counts as evidence

- **Implemented:** an API/path exists in source. This does not imply all competitive contracts are satisfied.
- **Evidence:** a named test, browser run, package-consumer run, or deployment artifact checks a stated behavior at a recorded revision and environment. Test files are verification paths; a passing run needs its own log.
- **Accepted:** the explicit exit criteria below pass for the claimed release and support targets, with intentional differences documented. A roadmap item stays open until that evidence exists.

The [baseline CI run](https://github.com/KoalaFacts/Purity/actions/runs/39935450471) recorded **2,891 workspace tests and 13 release tests passing**. This is useful regression evidence for that checkout; it is not a measure of Solid parity, browser support, accessibility, production adoption, or future commits. The [capability audit](./framework-capabilities.md) remains the implementation/evidence inventory.

## Current comparison and work selection

The [Solid v2 gap ledger](./solid-v2-gaps.json) is the current status source. Its [readable analysis](./solid-v2-gap-analysis.md) distinguishes missing capability, partial behavior and missing evidence; it also credits existing functionality and delivered regressions. The old baseline matrix is preserved in the [original foundation revision](https://github.com/KoalaFacts/Purity/blob/315532d11ea9a208b9804863ecae3fbe84becc1b/docs/solid-competitor-roadmap.md#behavior-matrix-at-the-baseline).

| Work group                                  | Gap IDs                            | Selection purpose                                                                                                 |
| ------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Comparison integrity and runtime foundation | SV2-001, SV2-002, SV2-014, SV2-015 | Close the active correctness PR, establish versioned contracts, enforce types and obtain comparable measurements. |
| Async applications and structured state     | SV2-003 through SV2-007            | Close the largest compositional capability gaps using real loading, recovery, editing and mutation journeys.      |
| Keyed interaction and owner composition     | SV2-008, SV2-017                   | Preserve editing state and support explicit reusable lifetime management.                                         |
| Server progress and hydration               | SV2-009, SV2-010                   | Make ready server regions progress and become usable without unrelated slow work.                                 |
| Application, tooling and release acceptance | SV2-011 through SV2-013, SV2-016   | Prove installed fullstack/CSP/debugging/host journeys.                                                            |

Finish one bounded implementation and its review/CI/main loop before the next implementation PR. A newly discovered correctness or security issue can preempt the sequence, but unrelated cleanup must not replace the capability and evidence milestones. Every substantive result names its gap ID, before/after evidence, remaining acceptance and next slice.

## First foundation slice

[PR #288](https://github.com/KoalaFacts/Purity/pull/288) implemented two bounded parts of the roadmap:

- Later scheduled watch/effect failures enter the live component's existing
  `onError` chain after failed-run cleanup. Handlers run under the component
  receiving the error, including a parent boundary, so recovery work has a
  disposal owner. Initial watch failures remain synchronous. The
  [ownership regressions](../packages/core/tests/reactive-error-ownership.test.ts)
  cover dispatch, cleanup, recovery, and owner lifetime. This does not add a
  client async boundary or complete the broader M1 contract inventory.
- Opt-in [`strictAot`](../packages/vite-plugin/README.md#strict-aot-builds)
  rejects failed transformations and retained Purity runtime compilation in
  client build output. The [strict build regressions](../packages/vite-plugin/tests/strict-aot.test.ts)
  cover retained and removed JIT paths, real distribution code, and server
  behavior. The five existing AOT bundle/CSP profiles now enable this option.
  This enforces the Purity compiler boundary; it does not audit arbitrary
  application or third-party code for CSP compliance.

Subsequent bounded fixes (#289, #291, #292 and #293) are recorded in the [gap analysis](./solid-v2-gap-analysis.md#7-bounded-progress-already-delivered). Implementation/test links describe those slices; release and comparative acceptance still require their own executed evidence. The milestones below retain their broader exit criteria.

## Prioritized milestones

The order addresses trust in the current model before broadening its surface. Each milestone produces a reviewable evidence set. Work may overlap where independent, but a later feature or faster result cannot waive an earlier correctness gate. There are no calendar guarantees or completion percentages.

### M0 — Establish the contract and release evidence ledger

**Priority:** First; defines what subsequent changes must preserve.

1. Turn the selected SV2-001/SV2-002 observations into an executable contract inventory: same outcome, intentional alternative, unsupported, or future target. Record scheduling and index differences explicitly.
2. Resolve the frozen Solid v2 rc.18 comparison tuple into an executable fixture lockfile. The target metadata is recorded; the application baseline remains open. Record every package/compiler version, lockfile and revision, and preserve older RC artifacts separately.
3. Reproduce the checkout/release gates and attach logs. Record published 0.4.0 separately from main's unreleased 0.5.0, and PressFloor's installed 0.3.4 separately from both.

**Exit:** Every comparison has a named contract and versioned input. The evidence ledger links a run or an explicit open gap; no table marks an implementation or a proposed decision as passed acceptance.

**Artifacts:** Contract matrix; exact-version manifests/lockfiles; CI/release run links; consumer inventory; migration/license summary.

### M1 — Make ownership, keyed rendering and reactive failures dependable

**Priority:** Runtime foundation for stores, async UI and tools.

1. Pin dynamic tracking, batching, watcher scheduling, cleanup and error behavior with focused regressions for real failure modes. Preserve sibling progress when one computation fails.
2. Complete the owner-scoped reactive failure design with documented fallback/reset and unhandled-error behavior. The first slice above covers scheduled watch/effect dispatch; verify the broader boundary contract, including cleanup if fallback rendering fails.
3. Close the keyed identity and index-contract acceptance rows. If numeric creation indexes remain intentional, make that explicit in the public guide and provide a safe current-position recipe or a separately designed capability.
4. Run production browser identity/input-state checks and targeted cleanup/retention checks; compare application observations with the selected Solid v2 track (SV2-002/SV2-008).

**Exit:** All selected contracts have deterministic tests and production browser evidence where DOM state matters. Removed/disposed owners stop their work; failures cannot silently strand sibling UI; documented row identity and index behavior hold through structural changes.

**Artifacts:** Runtime contract guide; owner/error ADR; regression logs; three-engine identity/interaction records; retention reports with cleanup-disabled controls.

### M2 — Make modular AOT a verifiable production choice

**Priority:** Deliver the CSP and dependency-boundary differentiator.

1. Finish strict-AOT as an explicit opt-in contract; specify supported forms and diagnostic behavior. Preserve default optional compilation behavior unless a separate decision changes it.
2. For client, SSR and hydration consumers, verify static/dynamic template forms, import aliases, helper composition, generated output and transform source maps. Unsupported strict input must fail with a usable location.
3. Inspect every production chunk, including dynamically imported routes. Enforce the absence of runtime compiler/Function-constructor paths in the strict profile and verify behavior under a real restrictive CSP.
4. Preserve entry budgets and paired runtime/AOT behavior for counter, controls, forms, hydration and resources. Extend only where a real application exposes an uncovered dependency path.

**Exit:** A strict consumer either produces a working CSP-compliant build or fails actionably. Evidence covers the full chunk graph and installed package boundary; smaller root imports cannot hide growth in required feature chunks. No general speedup is claimed from size reduction.

**Artifacts:** Strict-AOT guide and diagnostics catalog; transform/source-map regressions; chunk and bundle reports; CSP browser run; packaged client/SSR consumers.

### M3 — Complete structured state and client async application journeys

**Priority:** Close everyday application gaps after runtime contracts are fixed.

1. Design optional structured state against nested forms, editable collections and normalized entities. Compare fine-grained update behavior and authoring cost with the selected v2 store contract (SV2-005). Decide ownership, identity, mutation/reconciliation, serialization and typing before selecting an API.
2. Design client async boundaries for loading, stale data, error recovery and transitions. Establish how resources, queries, route loaders and owner-scoped failures compose. Use the selected v2 async model as the main reference, with explicit Purity decisions for SV2-003/SV2-004/SV2-006/SV2-007.
3. Exercise rapid search, route changes during loading, mutation followed by refresh, overlapping requests, rejection/reset and unmount. Assert visible state and accepted writes as well as cancellation signals.

**Exit:** The example journeys work without ad hoc duplicated loading/error state or obsolete completions overwriting newer state. Fine-grained store claims have update-isolation evidence. Every intentional limit has a documented alternative and cost; an omitted capability remains explicitly unsupported.

**Artifacts:** Store/async ADRs; typed application examples; state-transition contract tests; browser recovery/cancellation recordings; versioned v2 comparison notes and explicit intentional differences.

### M4 — Remove SSR delivery limits that block target applications

**Priority:** Server correctness and usability; requires M1/M3 ownership semantics.

1. Preserve existing streaming cancellation, backpressure, deadlines, resource-cache and request-isolation behavior while designing independent completion. Use a blocked first sibling, a fast later sibling, nesting, rejection and disconnect as required cases.
2. Decide whether target applications need hydration before full stream completion. If so, design boundary coordination, event behavior, DOM ownership and CSP together. Selective hydration and event replay are distinct capabilities with distinct costs.
3. Verify compatible DOM identity and user edits under production SSR/AOT/island paths. Retest mismatch fallbacks and typed component properties in all claimed engines.
4. Validate router/action journeys on the same serving path, including no-JS submission, server-only stripping, statuses/redirects and stale navigation cancellation.

**Exit:** The documented stream schedule matches observed bytes and usable UI. Independent completion is claimed only when later content progresses past a blocked sibling. Hydration timing remains explicitly limited until its own acceptance passes. Aborted requests and boundaries release owned work without cross-request state leakage.

**Artifacts:** Streaming/hydration ADRs; byte-order and browser interaction traces; nonce/CSP checks; request-isolation and retention logs; installed SSR/router/action consumer.

### M5 — Prove developer and release readiness outside the repository

**Priority:** Required before positioning the result as a dependable production choice.

1. Complete a debugging journey from a stale view to a signal's source location and component/owner context. Verify HMR teardown and strict consumer types; record the supported toolchain versions.
2. Upgrade PressFloor using the published npm release, with a normal lockfile and no source overrides. Run and archive its critical production build/browser/deployment journeys. Keep the currently installed version visible until that migration succeeds.
3. Run fresh published CLI consumers for client, SSR and mixed delivery. Verify emitted declarations, package exports, coordinated versions and release license notices. Require at least one application serving real traffic with maintainer/operator sign-off before calling production adoption established.
4. Complete the browser and assistive-technology rows, or narrow the declared support scope by an explicit decision. Publish per-host deployment evidence for the hosts actually supported.
5. Review and adopt or supersede ADR 0003; update its public surface and checklist for feature subpaths, SSR, licensing and current accepted decisions. Publish upgrade/deprecation/security terms that match the project's actual maintenance capacity.

**Exit:** A developer can install, build, debug, deploy and upgrade the supported package set using published instructions. Supported browsers/hosts and accessibility claims have recorded runs. Release policies are explicitly adopted, migration evidence exists, and a real traffic operator has signed off; the roadmap alone satisfies none of these gates.

**Artifacts:** Debugging walkthrough; type/toolchain matrix; registry consumer logs and lockfiles; PressFloor migration report; deployment receipts/runbooks; AT/browser acceptance reports; adopted policy and release checklist.

## Performance track: issue #276

Continue matched-workload measurement in [issue #276](https://github.com/KoalaFacts/Purity/issues/276), using the [benchmark verification guide](../benchmark/tools/README.md) and [bundle methodology](../benchmark/bundle-size/README.md). This work runs alongside the milestones; it cannot substitute for their behavior gates.

For each report:

1. Identify the Purity commit or published version; the exact selected Solid v2 packages; every other compared framework; compiler/bundler/runtime; browser build; OS/hardware; workload sizes; sampling/warmup; and timing boundaries. Archive lockfiles, commands, raw samples and complete chunk sizes.
2. Check rendered content and interaction parity before collecting timing. Keep labels, object identity, data generation and framework-native update strategies equivalent. A faster fixture with a missing binding or different state model is a different workload.
3. Separate ordinary lists from opt-in virtualization, production timing from instrumented profiles/heap runs, and runtime from AOT builds. Keep correctness checks and performance measurements independent.
4. Report dispersion and repeated-run behavior alongside central values. Describe regressions and tradeoffs by workload. A justified optimization gets a retained regression case and a same-environment before/after report; it does not acquire a universal framework ranking.

**Exit for a performance claim:** A reader can reproduce the specific result from the archived inputs, verify the same visible behavior, and identify its version/build/workload limits. New measurements supersede only their matching scenario; historical results retain their original SHA and methodology.

## Maintaining the roadmap

Update a gap row only with a linked implementation, acceptance run, or explicit design decision. Keep the readable analysis and machine-readable ledger consistent; a bounded regression does not close a whole capability row. Changes to behavior and support commitments belong in an ADR and release notes. Use each ADR file's status: the [ADR index](./decisions/README.md) is not a complete status inventory. Accepted SSR/hydration/routing decisions remain the architectural starting point; the [proposed 1.0 policy](./decisions/0003-path-to-1.0.md) and proposed optimization ADRs do not become accepted merely because code exists.

At each release candidate, reconcile this roadmap with the [capability audit](./framework-capabilities.md), [changelog](../CHANGELOG.md), package-consumer evidence and the actual release artifacts. Keep source implementation, passing evidence, published availability and production usage separate. That discipline is part of becoming a strong SolidJS competitor.
