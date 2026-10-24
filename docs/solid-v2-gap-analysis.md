# PurityJS versus Solid v2: gaps that drive the next work

**Audit date:** 2026-10-25, Australia/Sydney. **Purity source:** [`58ff714`](https://github.com/KoalaFacts/Purity/tree/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f), unreleased 0.5.0. **Primary comparator:** Solid **2.0.0-rc.18**, upstream [`225014b`](https://github.com/solidjs/solid/tree/225014bf8757421a2ea0a9c6ddc148b965eed000).

The main competitive capability gaps are async derivation and coherent client boundaries, property-granular structured state, async mutation coordination, and independent streaming/interactivity. The highest-priority evidence gap is a current, reproducible comparison against the selected v2 inputs. A series of correct watcher fixes improves the foundation, but does not by itself close those application contracts.

This is a source-and-contract audit with explicitly attached observations. It is **not** a complete framework conformance run, a new performance ranking, or a parity percentage. Existing Purity tests and CI runs retain their own scopes. The [machine-readable ledger](./solid-v2-gaps.json) is the status source; the [roadmap](./solid-competitor-roadmap.md) selects the sequence.

## 1. Freeze the thing being compared

The user selected **Solid v2** as the primary target on 2026-10-25. The earlier roadmap's stable-1.9-primary strategy is superseded. v1 can inform an explicitly labelled compatibility discussion; it is not this acceptance baseline.

| Layer                               | Selected comparison input                                       | Existing benchmark input at this audit            |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| Framework / reactive engine         | `solid-js` and `@solidjs/signals` **2.0.0-rc.18**               | Both rc.15                                        |
| DOM / SSR                           | `@solidjs/web` **2.0.0-rc.18**                                  | rc.14                                             |
| Compiler / Babel transform          | `@solidjs/compiler` and `@solidjs/babel-plugin` **2.0.0-rc.18** | Both rc.14                                        |
| Vite integration / start mode       | `@solidjs/vite-plugin` **3.0.0-next.51**                        | next.50                                           |
| Router, when that workload needs it | `@solidjs/router` **2.0.0-next.42**                             | Must be added to an explicit ecosystem comparison |

The [target manifest](../benchmark/solid-v2/target.json) records official registry URLs, publication times, package integrity, upstream commits when supplied, and the existing resolved benchmark tuple. The selected release is a **prerelease**, published on 2026-10-23. This manifest is identity evidence, **not an installed comparison lockfile**. An executable app comparison must also freeze its resolved transitive and platform compiler packages. The existing benchmark manifest and lockfile are unchanged by this audit.

Do not select packages by a floating tag or a major number alone. For example, registry `@solidjs/start@2.1.0` declares Solid 1 peers; the Solid 2 fullstack surface instead includes web server functions, the Vite plugin's start mode, and separately versioned routing. The manifest records Start only to document its exclusion. [Official v2 migration](https://v2.solidjs.com/migration/from-solid-1) · [v2 build integration](https://v2.solidjs.com/reference/vite-plugin-solid) · [v2 router](https://v2.solidjs.com/reference/solid-router)

Mutable preview documentation is secondary to the selected release's actual source when they disagree. In rc.18, effect application is not gated by equality of the compute result, and `from(source)` exists even though an older migration summary describes Observable adapters as removed. Resolve such contradictions before adding a gap or a test expectation. [Release](https://github.com/solidjs/solid/releases/tag/solid-js@2.0.0-rc.18) · [Effect source](https://github.com/solidjs/solid/blob/225014bf8757421a2ea0a9c6ddc148b965eed000/packages/signals/src/core/effect.ts)

## 2. Read status and priority correctly

- **Capability:** the stated compositional capability is absent from the audited source.
- **Partial:** useful pieces exist, with a specific remaining behavior or application contract.
- **Evidence:** implementation may exist, but the current comparative or release claim is unproved.
- **P0:** close current correctness failures or establish comparison integrity. This label is a work-order rule, not a security severity.
- **P1:** an important application capability or proof needed for a demanding reactive application.
- **P2:** broader composition, developer and release acceptance after its prerequisites.

Priorities reflect application impact, prerequisites and regression risk. They are not guessed effort estimates. A scheduling or platform difference is not automatically a defect. It may be an intentional alternative if the application outcome and its cost are explicit and verified.

`dependsOn` names prerequisites for **whole-row acceptance**, not a ban on starting a bounded slice. A correctness or evidence slice may run earlier when its own inputs are sufficient. In particular, finish the already active #294 before taking another implementation slice; SV2-001 remaining open does not block that repair.

| ID                  | Work to close                                                       | Classification                              | Priority | Acceptance workload |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------- | -------- | ------------------- |
| [SV2-001](#sv2-001) | Frozen comparator and reproducible comparison inputs                | Evidence gap                                | P0       | W0                  |
| [SV2-002](#sv2-002) | Reactive correctness, scheduling and effect observations            | Partial / contract work — active slice #294 | P0       | W0                  |
| [SV2-003](#sv2-003) | Async derivation through the reactive graph                         | Missing compositional capability            | P1       | W1                  |
| [SV2-004](#sv2-004) | Client loading, retained content and coordinated reveal             | Missing compositional capability            | P1       | W1                  |
| [SV2-005](#sv2-005) | Property-granular structured state and keyed adoption               | Missing compositional capability            | P1       | W2                  |
| [SV2-006](#sv2-006) | Reactive error fallback and retry/reset boundaries                  | Partial / contract work                     | P1       | W1                  |
| [SV2-007](#sv2-007) | Async transaction visibility and optimistic overlays                | Partial / contract work                     | P1       | W2                  |
| [SV2-008](#sv2-008) | Current keyed position and editing-state preservation               | Partial / contract work                     | P1       | W2                  |
| [SV2-009](#sv2-009) | Independent SSR boundary progress                                   | Partial / contract work                     | P1       | W3                  |
| [SV2-010](#sv2-010) | Interactivity during streaming and hydration source policies        | Partial / contract work                     | P1       | W3                  |
| [SV2-011](#sv2-011) | Router, server functions and application composition                | Partial / contract work                     | P2       | W4                  |
| [SV2-012](#sv2-012) | Compiler-free client builds and complete CSP application evidence   | Evidence gap                                | P1       | W4                  |
| [SV2-013](#sv2-013) | Source/owner diagnostics and predictable HMR                        | Partial / contract work                     | P2       | W4                  |
| [SV2-014](#sv2-014) | Enforced public declaration and negative typing contracts           | Evidence gap                                | P1       | W0                  |
| [SV2-015](#sv2-015) | Matched current runtime, allocation, retention and payload evidence | Evidence gap                                | P0       | W5                  |
| [SV2-016](#sv2-016) | Published consumer, host and accessibility acceptance               | Evidence gap                                | P2       | W4                  |
| [SV2-017](#sv2-017) | Public owner composition and external-source lifetime               | Partial / contract work                     | P2       | W1                  |

All rows remain open at the broad acceptance level. That does **not** mean Purity has no implementation in those areas. The detailed rows credit existing behavior and the bounded fixes already delivered.

## 3. What Purity already has

Purity already implements dynamic dependency tracking, equality-aware state/memos, lazy derivations, batching, owned cleanup, computed error recovery, keyed DOM reuse, same-key object replacement and initialization rollback. Its resource/query layer already provides cancellation signals, stale-result suppression, retained data during refresh, retry, mutation and shared caching. Those are foundations to preserve, not new absence claims. [Signals](../packages/core/src/signals.ts) · [Resources](../packages/core/src/resource.ts) · [Query ownership](../packages/core/tests/query-ownership.test.ts)

Strict AOT, DOM-preserving hydration, typed DSD properties, island first-activation replay, route loaders/cancellation, native and enhanced actions, production bundle budgets, and client/SSR retention checks also exist. Candidate tarball checks and actual registry client/SSR checks are different evidence sets. [Capability audit](./framework-capabilities.md) · [Islands](./islands.md) · [Strict AOT](../packages/vite-plugin/README.md#strict-aot-builds)

Web Components, Shadow DOM, direct DOM templates, optional JIT/AOT, modular entries and zero runtime dependencies remain Purity's design choices. JSX spelling, one identical scheduler, or matching every upstream export is not the goal. Their practical benefits must be demonstrated in the workloads below.

### First executed observations

The [reproducible observation package](../benchmark/solid-v2/observations/README.md) and [archived trace](../benchmark/solid-v2/observations/trace.json) add four actual observations at the frozen Purity source and exact rc.18 client runtime. Node v24.21.0 runs Purity TypeScript source directly and the explicit Solid client production entry. Fixed package integrity, actual entry resolution and selected source hashes are checked before execution.

| Observation                                      | Purity at `58ff714`                                   | Solid v2 rc.18                                               | Meaning for the gap                                                                   |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Read state/memo immediately after writing 0 to 1 | Same-stack values are 1 / 2                           | Same-stack values are 0 / 0; next microtask values are 1 / 2 | Observable commit-timing difference in SV2-002; not proof of absent reactivity        |
| First user-effect application                    | Auto-watch applies before creation returns            | Effect apply follows creation return                         | Initial-phase contract must be deliberate; this does not establish DOM phase ordering |
| Read an unrelated signal only in callback/apply  | Changing that signal alone does not call the callback | Changing that signal alone does not call apply               | Bounded isolation evidence for SV2-002; initial callback behavior still differs       |
| Nested disposable-owner cleanup                  | Parent A, parent B, child A, child B                  | Child B, child A, parent B, parent A                         | Observed watch/root ownership difference relevant to SV2-017                          |

The cleanup case compares source-free Purity watches with nested Solid roots. It does **not** describe Purity component DOM unmount order. These observations do not include #294, a browser, async boundaries, stores, SSR/hydration, or performance. They attach evidence to SV2-001, SV2-002 and SV2-017 without accepting any whole row.

## 4. Detailed gap contracts

<a id="sv2-001"></a>

### SV2-001 — Frozen comparator and reproducible comparison inputs

**P0; Evidence gap; open.** Prerequisites: none. Workload: W0.

**Solid v2 target:** The selected target is rc.18 for core, signals and web, with separately versioned build and router packages.

**Purity at the audited source:** Existing benchmark resolves core/signals rc.15, web/compiler/babel-plugin rc.14 and Vite plugin next.50. Its historical results remain valid only for those inputs.

**Application consequence:** Without matched versioned inputs, changes cannot establish progress against the agreed Solid v2 target.

**Acceptance:**

- Resolve and archive exact rc.18 framework/build package versions and integrities in an executable comparison lockfile.
- Verify selected client/server export conditions and baseline behavior before collecting results.
- Keep old result identities; record changes caused by upgrading the comparator separately from Purity improvements.

**Next bounded action:** Create an isolated rc.18 comparison fixture using the target metadata; retain the existing benchmark until its adapter and parity checks pass.

Purity evidence paths: [benchmark/package.json](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/package.json) · [package-lock.json](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/package-lock.json) · [benchmark/tools/README.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/tools/README.md).

Solid / comparison references: [1](https://github.com/solidjs/solid/releases/tag/solid-js@2.0.0-rc.18).

Executed bounded evidence: [four-observation trace](../benchmark/solid-v2/observations/trace.json) and [reproduction instructions](../benchmark/solid-v2/observations/README.md). Two fixed rc.18 tarballs and their actual client/engine entries execute four Node observations; the full application/compiler fixture and transitive lockfile remain open.

<a id="sv2-002"></a>

### SV2-002 — Reactive correctness, scheduling and effect observations

**P0; Partial / contract work; in_progress.** Prerequisites: SV2-001. Workload: W0.

**Solid v2 target:** Writes normally stage until commit; user effect application is queued and untracked. Effects do not equality-filter a rerun's returned value; a memo can do that.

**Purity at the audited source:** State and computed reads update immediately; auto-watch starts eagerly, explicit callbacks skip the first run, and later effects flush in a microtask. The frozen main still samples an explicit source twice during setup; PR #294 addresses that defect.

**Application consequence:** Hidden parent subscriptions can lose child callbacks. Intentional same-stack and effect-phase differences affect migrations and DOM-reading effects.

**Acceptance:**

- Close PR #294 using its exact-head review and original CI gates, then verify main.
- Record state/derived/DOM observations after a write, after a microtask and at explicit synchronization points in both implementations.
- Exercise diamond dependencies, source-only callback tracking, nested owners, error recovery and disposal; document intentional differences instead of copying API names.

**Next bounded action:** Finish #294, then retain a small paired contract suite for observable scheduling and ownership behavior.

Purity evidence paths: [packages/core/src/signals.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/signals.ts) · [packages/core/tests/signals.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/signals.test.ts) · [packages/core/tests/effect-ownership.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/effect-ownership.test.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/reactivity/create-signal) · [2](https://v2.solidjs.com/reference/solid-js/reactivity/create-effect) · [3](https://v2.solidjs.com/reference/solid-js/reactivity/flush) · [4](https://github.com/solidjs/solid/blob/225014bf8757421a2ea0a9c6ddc148b965eed000/packages/signals/src/core/effect.ts).

Executed bounded evidence: [four-observation trace](../benchmark/solid-v2/observations/trace.json) and [reproduction instructions](../benchmark/solid-v2/observations/README.md). Same-stack versus microtask reads, first/followup effect timing, and callback-only dependency isolation at frozen main 58ff714. No DOM phase claim; excludes PR294.

<a id="sv2-003"></a>

### SV2-003 — Async derivation through the reactive graph

**P1; Missing compositional capability; open.** Prerequisites: SV2-002. Workload: W1.

**Solid v2 target:** Async memos accept PromiseLike or AsyncIterable computation results and propagate unresolved reads through downstream derivations.

**Purity at the audited source:** compute caches its direct return, including a Promise. resource separately exposes data, loading and error accessors; downstream code handles unresolved values and flags explicitly.

**Application consequence:** A fetched value cannot transparently feed an ordinary derived calculation and a pending-aware consumer without application coordination.

**Acceptance:**

- Use source -> async derivation -> synchronous derivation -> view/effect, with no undefined or Promise delivered as resolved application data.
- Supersede A with B and resolve A last; only B may become current.
- Define rejection, cancellation, iterator closure and disposal behavior before selecting an API.

**Next bounded action:** Specify and implement the smallest owned async-derivation contract with deterministic settlement traces.

Purity evidence paths: [packages/core/src/signals.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/signals.ts) · [packages/core/src/resource.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/resource.ts) · [packages/core/tests/resource-request-ownership.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/resource-request-ownership.test.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/reactivity/create-memo) · [2](https://v2.solidjs.com/concepts/async-reactivity).

<a id="sv2-004"></a>

### SV2-004 — Client loading, retained content and coordinated reveal

**P1; Missing compositional capability; open.** Prerequisites: SV2-003, SV2-006. Workload: W1.

**Solid v2 target:** Loading handles unresolved reads and retains committed content on ordinary refetch; Reveal coordinates boundary slots. isPending describes unrevealed changed state, not every network request.

**Purity at the audited source:** Client suspense directly calls view() and does not use its fallback. Resources can already retain prior data during refresh, but applications assemble loading and cross-region consistency themselves.

**Application consequence:** A selector and several async panels can expose mismatched versions or lose local state unless the application coordinates them.

**Acceptance:**

- Initial load shows a fallback; refresh retains a complete prior view and its edited input state.
- Two panels settle in reverse order under an explicit reveal policy without mixing subject versions.
- Nested rejection, supersession and unmount release owned work; pending feedback has a defined visible contract.

**Next bounded action:** Build one client async boundary journey after SV2-003; retain explicit limitations for later reveal policies.

Purity evidence paths: [packages/core/src/control.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/control.ts) · [packages/core/src/resource.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/resource.ts) · [packages/core/src/query.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/query.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/components-jsx/loading) · [2](https://v2.solidjs.com/reference/solid-js/components-jsx/reveal) · [3](https://v2.solidjs.com/reference/solid-js/reactivity/is-pending).

<a id="sv2-005"></a>

### SV2-005 — Property-granular structured state and keyed adoption

**P1; Missing compositional capability; open.** Prerequisites: SV2-002. Workload: W2.

**Solid v2 target:** Stores track property reads through proxies and use draft updates. Derived stores reconcile snapshots by a selected key; ordinary setter replacement is not keyed reconciliation.

**Purity at the audited source:** A state is one Object.is-compared value. Nested objects work through replacement or manually composed field signals; there is no public property-granular store/draft/reconciliation facility.

**Application consequence:** Nested forms and entity collections require more application state plumbing and can cause broader dependency invalidation.

**Acceptance:**

- Update one nested property without rerunning unrelated field or row computations.
- Add/delete keys and resize/reorder arrays with correct structural subscriptions.
- Adopt new server objects with stable IDs while preserving the intended nested identities; enforce public types and disposal behavior.

**Next bounded action:** Design an optional structured-state entry around a nested form and editable collection, keeping core runtime dependency constraints.

Purity evidence paths: [packages/core/src/signals.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/signals.ts) · [packages/core/src/index.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/index.ts) · [packages/core/package.json](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/package.json) · [packages/core/tests/types.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/types.test.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/stores/create-store) · [2](https://v2.solidjs.com/reference/solid-js/stores/create-projection).

<a id="sv2-006"></a>

### SV2-006 — Reactive error fallback and retry/reset boundaries

**P1; Partial / contract work; open.** Prerequisites: SV2-002, SV2-003. Workload: W1.

**Solid v2 target:** Errored replaces a failed reactive/render subtree, supplies reset, and lets fallback failures reach a parent boundary. Event errors are a separate responsibility.

**Purity at the audited source:** Owned later watch failures reach onError, recovery work is owned, computeds can recover, and resources expose error/retry. There is no general client fallback/reset subtree boundary; handler throws are logged.

**Application consequence:** Applications must compose retry UI, subtree replacement and nested fallback escalation themselves.

**Acceptance:**

- A rejected derived value selects the nearest error fallback while sibling UI continues.
- A changed input or explicit reset restores the subtree and disposes failed/recovery work once.
- A throwing fallback reaches a defined outer boundary; event-handler failures are tested separately.

**Next bounded action:** Extend the existing ownership/error contract to one explicit client fallback/reset journey.

Purity evidence paths: [packages/core/src/scope.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/scope.ts) · [packages/core/src/component.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/component.ts) · [packages/core/src/signals.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/signals.ts) · [packages/core/tests/reactive-error-ownership.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/reactive-error-ownership.test.ts) · [packages/core/tests/match-error-recovery.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/match-error-recovery.test.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/components-jsx/errored) · [2](https://v2.solidjs.com/concepts/boundaries). Existing bounded/historical records: [bounded_implementation](https://github.com/KoalaFacts/Purity/pull/288) · [bounded_implementation](https://github.com/KoalaFacts/Purity/pull/289).

<a id="sv2-007"></a>

### SV2-007 — Async transaction visibility and optimistic overlays

**P1; Partial / contract work; open.** Prerequisites: SV2-002, SV2-003. Workload: W2.

**Solid v2 target:** Generator-based actions hold normal writes across transaction-safe yields; optimistic signals/stores expose tentative overlays that settle with the action.

**Purity at the audited source:** optimistic already offers apply/rollback, invalidation and settlement callbacks; resource.mutate invalidates an old fetch. batch controls synchronous scheduling, not graph-wide writes across async work.

**Application consequence:** Keeping related authoritative values coherent while showing tentative edits is application code.

**Acceptance:**

- Two authoritative values changed around async work remain a coherent committed view.
- An explicit tentative value appears promptly and settles or rolls back exactly once.
- Define overlapping operations and disposal without claiming general server-side business conflict resolution.

**Next bounded action:** Add a controlled two-field mutation journey and document which transaction guarantees Purity will provide.

Purity evidence paths: [packages/core/src/optimistic.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/optimistic.ts) · [packages/core/src/resource.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/resource.ts) · [packages/core/src/signals.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/signals.ts) · [packages/core/src/query.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/query.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/lifecycle-actions/action) · [2](https://v2.solidjs.com/reference/solid-js/stores/create-optimistic-store).

<a id="sv2-008"></a>

### SV2-008 — Current keyed position and editing-state preservation

**P1; Partial / contract work; open.** Prerequisites: SV2-002. Workload: W2.

**Solid v2 target:** Custom-key For supplies item and current-index accessors; positional mode supplies an item accessor and fixed slot index.

**Purity at the audited source:** each preserves keyed row identity and updates item accessors, but its renderer receives a creation-time numeric index. Position-keyed reuse is expressible with the index as key. Multi-root native movement was fixed in #291; focus preservation has a documented fallback limit.

**Application consequence:** Ordinal labels or position-based callbacks can become stale after a keyed reorder; editing focus needs a platform-specific contract.

**Acceptance:**

- Prepend, reverse and replace same-ID objects while node references, local input values and current-position actions stay correct.
- Cover both native moveBefore and fragment fallback with explicit focus/selection expectations.
- Verify reorder does not dispose retained rows and removal/unmount releases owned work once.

**Next bounded action:** Specify current-position usage and add the focused-editing scenario to existing production fixtures.

Purity evidence paths: [packages/core/src/control.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/control.ts) · [packages/core/tests/control.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/control.test.ts) · [packages/core/tests/each-move-before.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/each-move-before.test.ts) · [benchmark/tools/virtual-browser-check.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/tools/virtual-browser-check.ts) · [docs/reactivity.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/docs/reactivity.md).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/components-jsx/for). Existing bounded/historical records: [bounded_implementation](https://github.com/KoalaFacts/Purity/pull/291).

<a id="sv2-009"></a>

### SV2-009 — Independent SSR boundary progress

**P1; Partial / contract work; open.** Prerequisites: SV2-002. Workload: W3.

**Solid v2 target:** The streaming renderer flushes a shell and emits settled boundary fragments; reveal policy must be selected when checking sibling progress.

**Purity at the audited source:** Deferred SSR views are queued and awaited sequentially. An earlier blocked boundary delays starting a later view, while request cancellation, deadlines and backpressure controls already exist.

**Application consequence:** A fast summary or sidebar can wait behind unrelated slow work.

**Acceptance:**

- Keep the first sibling blocked and let a later sibling become usable before releasing it under the natural-progress contract.
- Exercise nesting, rejection, deadlines, request abort, slow readers and serialization failure.
- Preserve bounded buffering, request-local resource state and existing retention controls.

**Next bounded action:** Add a blocked-first/fast-second stream trace, then implement independent scheduling without weakening request lifetime guarantees.

Purity evidence paths: [packages/ssr/src/render-to-stream.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/ssr/src/render-to-stream.ts) · [packages/core/src/control/ssr.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/control/ssr.ts) · [packages/ssr/tests/render-to-stream.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/ssr/tests/render-to-stream.test.ts) · [packages/ssr/tests/stream-backpressure.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/ssr/tests/stream-backpressure.test.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-web/rendering-ssr/render-to-stream) · [2](https://v2.solidjs.com/reference/solid-js/components-jsx/reveal).

<a id="sv2-010"></a>

### SV2-010 — Interactivity during streaming and hydration source policies

**P1; Partial / contract work; open.** Prerequisites: SV2-009, SV2-004. Workload: W3.

**Solid v2 target:** Hydration adopts server DOM and serialized state with explicit server/hybrid/client source policies. The selected streaming integration must be exercised for early interactivity.

**Purity at the audited source:** DOM adoption and resource priming exist. The supported full-page path hydrates after the stream closes; the starter sends its client module in the suffix after the body. Islands already replay ordinary first activation, with manually supplied entry thunks.

**Application consequence:** An early-painted shell may wait for the final slow region before its handlers are available.

**Acceptance:**

- With one boundary still pending, an already painted shell control and ready region respond correctly.
- Preserve node identity, pre-hydration input edits, resource fetch counts, nonce/CSP behavior and mismatch diagnostics.
- Exercise conditional/lazy/streamed islands without duplicate imports or wrong view selection; record trusted-activation limits.

**Next bounded action:** Specify a supported early-hydration protocol and prove one blocked-stream interaction before widening the claim.

Purity evidence paths: [packages/ssr/README.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/ssr/README.md) · [packages/cli/template/app/server.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/cli/template/app/server.ts) · [packages/cli/template/app/index.html](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/cli/template/app/index.html) · [packages/core/src/component.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/component.ts) · [packages/core/src/island-mount.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/island-mount.ts) · [packages/ssr/tests/hydrate-parity.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/ssr/tests/hydrate-parity.test.ts) · [docs/islands.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/docs/islands.md).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-web/rendering-ssr/hydrate) · [2](https://v2.solidjs.com/reference/solid-js/reactivity/create-memo).

<a id="sv2-011"></a>

### SV2-011 — Router, server functions and application composition

**P2; Partial / contract work; open.** Prerequisites: SV2-004, SV2-007. Workload: W4.

**Solid v2 target:** Compare the named v2 router, web server-function support and Vite start-mode stack. SolidStart 2.1.0 targets Solid 1 and is excluded from this v2 baseline.

**Purity at the audited source:** Route manifests, layouts, loaders, cancellation, native/enhanced forms, server actions and invalidation exist. The mixed-delivery starter deliberately uses document navigation; applications assemble SPA navigation when wanted.

**Application consequence:** A team needs a coherent installed application journey, not a list of separate primitives.

**Acceptance:**

- Run back/forward, stale navigation, route errors/redirects/statuses and header handling in the same installed application.
- Verify no-JS POST, enhanced field errors/retry/input retention, write invalidation and server-only stripping.
- Choose document or SPA navigation explicitly and pin the v2-compatible ecosystem packages used for comparison.

**Next bounded action:** Use one realistic installed application for matched navigation and mutation acceptance.

Purity evidence paths: [packages/core/src/async-route.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/async-route.ts) · [packages/core/src/router-configure.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/router-configure.ts) · [packages/cli/template/app/src/entry.server.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/cli/template/app/src/entry.server.ts) · [packages/cli/scripts/app-actions-smoke.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/cli/scripts/app-actions-smoke.ts) · [docs/server-rendering.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/docs/server-rendering.md).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-router) · [2](https://v2.solidjs.com/reference/solid-web/server-functions) · [3](https://v2.solidjs.com/reference/vite-plugin-solid).

<a id="sv2-012"></a>

### SV2-012 — Compiler-free client builds and complete CSP application evidence

**P1; Evidence gap; open.** Prerequisites: SV2-001. Workload: W4.

**Solid v2 target:** The v2 build/compiler stack is part of the selected comparison input. An application-level CSP claim still requires its emitted graph and runtime behavior.

**Purity at the audited source:** strictAot is implemented and checks failed transforms plus retained Purity client compiler paths. Five paired production AOT fixtures exist; SSR compiler support is legitimate. The bundle fixture runner rejects dynamic imports.

**Application consequence:** A compiler-free positioning needs proof across real lazy routes, islands and dependencies, beyond static fixture sizes.

**Acceptance:**

- Install candidate or published packages outside the monorepo and build client/SSR/hydration with lazy routes and islands.
- Inspect all emitted chunks and exercise the application under its real restrictive CSP.
- Keep actionable negative cases and preserve supported server compilation; do not claim to audit arbitrary third-party code.

**Next bounded action:** Extend installed-consumer acceptance to one strict-AOT lazy application and archive its complete chunk inventory.

Purity evidence paths: [packages/vite-plugin/src/index.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/vite-plugin/src/index.ts) · [packages/vite-plugin/README.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/vite-plugin/README.md) · [packages/vite-plugin/tests/strict-aot.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/vite-plugin/tests/strict-aot.test.ts) · [benchmark/bundle-size/measure.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/bundle-size/measure.ts) · [benchmark/bundle-size/verify.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/bundle-size/verify.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/vite-plugin-solid) · [2](https://github.com/solidjs/solid/releases/tag/@solidjs/compiler@2.0.0-rc.18). Existing bounded/historical records: [bounded_implementation](https://github.com/KoalaFacts/Purity/pull/288).

<a id="sv2-013"></a>

### SV2-013 — Source/owner diagnostics and predictable HMR

**P2; Partial / contract work; open.** Prerequisites: SV2-002. Workload: W4.

**Solid v2 target:** The v2 development surface includes source attribution, owner/graph diagnostics and compiler-provided source locations. Exact HMR behavior belongs to the selected tooling.

**Purity at the audited source:** The graph inspector and development panel expose values/dependencies but no source locations or component tree. Source-map and route HMR paths exist; a complete owner/resource application HMR journey is not established.

**Application consequence:** A stale view is harder to trace to its creation site and owning component; edits need explicit state/cleanup expectations.

**Acceptance:**

- Find a seeded stale binding's source and owner through the debugger in a real transformed application.
- Edit a component, route and shared state while requests/listeners/effects are active; document preserve-state versus reload behavior.
- Verify no duplicate work and no diagnostics retained in production.

**Next bounded action:** Add source and owner attribution for one end-to-end debugging journey before considering optional time travel.

Purity evidence paths: [packages/core/src/signals.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/signals.ts) · [docs/debugging.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/docs/debugging.md) · [packages/vite-plugin/src/index.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/vite-plugin/src/index.ts) · [packages/vite-plugin/tests/devtools-browser.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/vite-plugin/tests/devtools-browser.ts) · [packages/vite-plugin/tests/sourcemap.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/vite-plugin/tests/sourcemap.test.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/advanced/diagnostics-dev-hooks/attribution).

<a id="sv2-014"></a>

### SV2-014 — Enforced public declaration and negative typing contracts

**P1; Evidence gap; open.** Prerequisites: SV2-001. Workload: W0.

**Solid v2 target:** Compare actual public declarations and generated route APIs for the pinned v2 stack with an explicitly selected TypeScript version.

**Purity at the audited source:** Public declarations and strict scaffold builds exist. Core/plugin tsconfigs exclude tests; ordinary Vitest runs do not type-check compile-shaped cases or enforce their negative assertions.

**Application consequence:** A green runtime suite can miss public API type regressions.

**Acceptance:**

- Run tsc --strict on positive and negative consumers against built/published declarations without source aliases.
- Cover overloaded watches, props/slots/events, resources, generated routes and action payloads.
- Prove an intended type error makes the negative test pass, and a removed diagnostic makes it fail.

**Next bounded action:** Create a small declaration-consumer type gate with real negative cases using the existing compiler.

Purity evidence paths: [packages/core/tsconfig.json](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tsconfig.json) · [packages/core/vitest.config.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/vitest.config.ts) · [packages/core/tests/types.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/types.test.ts) · [packages/vite-plugin/tsconfig.json](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/vite-plugin/tsconfig.json) · [packages/vite-plugin/tests/loader-data-of.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/vite-plugin/tests/loader-data-of.test.ts) · [packages/cli/src/index.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/cli/src/index.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js) · [2](https://v2.solidjs.com/reference/solid-router).

<a id="sv2-015"></a>

### SV2-015 — Matched current runtime, allocation, retention and payload evidence

**P0; Evidence gap; open.** Prerequisites: SV2-001. Workload: W5.

**Solid v2 target:** Performance must be measured for the exact rc.18 application and workload; no release-level universal speed/size claim is used.

**Purity at the audited source:** Historical #280 measurements show mixed outcomes at older versions. Row/binding semantic parity and internal bundle/memory gates exist. The normal timing runner does not persist its raw arrays, and no new matched rc.18 result was produced by this audit.

**Application consequence:** Without current comparable samples, the next performance optimization has no defensible bottleneck or regression baseline.

**Acceptance:**

- Pass per-scenario DOM/data/state-strategy parity before timing ordinary lists; keep virtualization separate.
- Archive raw samples, dispersion, run order, full environment and separate uninstrumented timing, allocation and retained-heap evidence.
- Record initial-route plus full lazy application raw/gzip/Brotli totals and publish regressions as well as improvements.

**Next bounded action:** Persist existing runner samples after the timed region, refresh a matched rc.18 row/binding baseline, then select one measured bottleneck.

Purity evidence paths: [benchmark/run-bench.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/run-bench.ts) · [benchmark/tools/fixture-parity-browser-check.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/tools/fixture-parity-browser-check.ts) · [benchmark/tools/binding-browser-check.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/tools/binding-browser-check.ts) · [benchmark/tools/README.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/tools/README.md) · [benchmark/bundle-size/measure.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/benchmark/bundle-size/measure.ts).

Solid / comparison references: [1](https://github.com/KoalaFacts/Purity/issues/276). Existing bounded/historical records: [historical_report_not_rerun](https://github.com/KoalaFacts/Purity/pull/280) · [bounded_fixture_parity](https://github.com/KoalaFacts/Purity/pull/279).

<a id="sv2-016"></a>

### SV2-016 — Published consumer, host and accessibility acceptance

**P2; Evidence gap; open.** Prerequisites: SV2-011, SV2-012, SV2-014. Workload: W4.

**Solid v2 target:** Production-choice comparisons must name the actual package stack, hosts and accessibility journeys. No ecosystem-size or reliability ranking is inferred from package names.

**Purity at the audited source:** The audited main is unreleased 0.5.0; registry 0.4.0 client/SSR and candidate tarball app checks have different scopes. Node deployment and isolated Edge checks exist. Per-host live evidence and specified assistive-technology journeys remain incomplete.

**Application consequence:** Repository success alone does not establish a usable upgrade and deployment path for the version customers install.

**Acceptance:**

- Record actual registry/candidate versions, integrity and lockfiles separately, including mixed-delivery consumers and any real app upgrade.
- Verify the claimed host's streaming, cancellation, actions, headers and CSP behavior.
- Complete or explicitly narrow supported browser/assistive-technology commitments with recorded application journeys.

**Next bounded action:** Maintain an installed-consumer evidence ledger and add the missing mixed-delivery release journey without publishing automatically.

Purity evidence paths: [README.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/README.md) · [packages/cli/scripts/published-smoke.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/cli/scripts/published-smoke.ts) · [packages/ssr/tests/browser-retention.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/ssr/tests/browser-retention.ts) · [packages/cli/scripts/app-actions-smoke.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/cli/scripts/app-actions-smoke.ts) · [docs/accessibility.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/docs/accessibility.md) · [docs/framework-capabilities.md](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/docs/framework-capabilities.md).

Solid / comparison references: [1](https://github.com/solidjs/solid/releases/tag/solid-js@2.0.0-rc.18).

<a id="sv2-017"></a>

### SV2-017 — Public owner composition and external-source lifetime

**P2; Partial / contract work; open.** Prerequisites: SV2-002, SV2-003. Workload: W1.

**Solid v2 target:** v2 exposes owner capture/re-entry and explicitly detached roots. When iteration starts under a live synchronous owner/computation, rc.18 from(source) closes the source on supersession or owner disposal; plain iteration or iteration begun after await relies on iterator closure. Ownership is synchronous on re-entry.

**Purity at the audited source:** Automatic component/effect/branch/row ownership and manual stop/dispose exist. General capture/re-entry/detached scope APIs are internal. Per-scope disposer registration order is FIFO, an observable difference from v2 owner LIFO.

**Application consequence:** Reusable integrations that create reactive work in later callbacks need manual teardown wiring and a clear contract after parent disposal.

**Acceptance:**

- A later callback creates work explicitly bound to a live parent and is rejected or safely disposed after that parent dies.
- A deliberately detached cache has an explicit lifetime and is released exactly once.
- Record nested cleanup order and subscription/iterator teardown under replacement, error and unmount.

**Next bounded action:** Define the minimal public ownership composition needed by an external subscription adapter; keep cache ownership deliberate.

Purity evidence paths: [packages/core/src/scope.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/scope.ts) · [packages/core/src/signals.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/signals.ts) · [packages/core/src/index.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/index.ts) · [packages/core/src/query.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/src/query.ts) · [packages/core/tests/query-ownership.test.ts](https://github.com/KoalaFacts/Purity/blob/58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f/packages/core/tests/query-ownership.test.ts).

Solid / comparison references: [1](https://v2.solidjs.com/reference/solid-js/advanced/owner-introspection/create-root) · [2](https://v2.solidjs.com/reference/solid-js/advanced/owner-introspection/run-with-owner) · [3](https://github.com/solidjs/solid/releases/tag/solid-js@2.0.0-rc.18).

Executed bounded evidence: [four-observation trace](../benchmark/solid-v2/observations/trace.json) and [reproduction instructions](../benchmark/solid-v2/observations/README.md). Cleanup order for source-free nested Purity watches versus nested Solid roots only. Does not establish Purity component DOM unmount or external-adapter teardown.

## 5. The first work sequence

1. **Finish the existing correctness slice, SV2-002 / #294.** At the audit checkpoint it is still open on `e22120e`. [CI #961](https://github.com/KoalaFacts/Purity/actions/runs/40115313478) failed the original size gate in both full jobs: core-all Brotli **40,747 B > 40,704 B**; core-actions **5,248 B** meets its **5,248 B** cap. These are actual job-log results, not a pending workflow-summary assumption. Repair this same PR without relaxing the gate. Re-read current head, all reviews and actual CI before normal merge/main verification.
2. **Make SV2-001 and SV2-015 executable.** Use the pinned rc.18 tuple, prove adapter/DOM/data/state parity, and persist raw samples after the existing timed region. This produces a defensible optimization baseline. Add the small public-declaration gate from SV2-014 as a bounded API-confidence slice.
3. **Deliver W1 in small capability slices: SV2-003, SV2-006, then SV2-004.** Start with one owned async derivation and failure path, then complete the visible loading/retained-content journey. Write down lifecycle and update semantics before changing the graph.
4. **Deliver W2: SV2-005 and the required SV2-008 behavior.** Prove nested update isolation and stateful row editing; then tackle the transaction scope in SV2-007 using that application's actual mutation needs.
5. **Deliver W3: SV2-009, then SV2-010.** Independent server progress precedes a broader early-hydration promise. Keep existing request isolation, backpressure, deadlines and retention gates.
6. **Complete W4 readiness and broaden W5 only with evidence.** Router/actions, strict installed builds, diagnostics, types, hosts and published consumers must be exercised together. Select performance work from measured bottlenecks, retaining every regression result.

This sequence does not forbid fixing a newly discovered severe correctness or security issue. It prevents an unlimited stream of unrelated micro-fixes from substituting for the named capability and measurement milestones. Finish the active implementation PR before taking another implementation slice.

## 6. Application workloads and measurements

| Workload                                  | Observable scenario                                                                                                                                | What to record                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **W0 — reactive contract / types**        | Same-stack versus committed reads, first and subsequent effects, dynamic branches, callback tracking, owner teardown, strict declaration consumers | Ordered traces; concrete expected type diagnostics; actual runtime entry selection; source/package hashes                        |
| **W1 — async detail view**                | Rapidly select A then B; two dependent panels settle out of order; retain an edited input; reject/retry; navigate away                             | Visible subject/data consistency; accepted writes; fallback/retained-state transitions; cleanup and cancellation                 |
| **W2 — nested editor / keyed collection** | Edit one nested field; insert/delete/reorder rows; replace objects with stable IDs; submit an optimistic mutation                                  | Computation/DOM update fan-out; node and proxy identity; current position; input/focus/selection; rollback and owned cleanup     |
| **W3 — streaming page**                   | Block the first boundary while a later region is ready; interact with the shell; disconnect or backpressure the reader                             | Shell and fragment order; time to each usable region; source/fetch counts; nonce/CSP; aborted request retention                  |
| **W4 — installed application**            | Static and lazy routes, SSR/hydration/islands, no-JS and enhanced forms, debugger/HMR, package upgrade                                             | Complete chunk graph; build/type/runtime logs; navigation/action behavior; source/owner attribution; actual installed versions   |
| **W5 — controlled performance**           | Existing ordinary row/binding operations first; broaden only after matching each new scenario                                                      | Raw samples and dispersion; run order/environment; separate allocation/retained-heap/DOM measures; initial and full-app payloads |

The present benchmark timer covers action dispatch, one microtask and forced layout. It does not measure paint completion. Forced-GC heap deltas measure live/retained heap, not allocation totals. Instrumented CPU/allocation profiles must stay separate from uninstrumented timing. [Runner](../benchmark/run-bench.ts) · [Methodology](../benchmark/tools/README.md)

Historical [#280](https://github.com/KoalaFacts/Purity/pull/280) reported 44 operations with seven timing samples per source, separate heap cases, allocation profiles and row-page payloads. Its outcomes were mixed. This audit read the report and source methodology, not its external raw archive, and does not republish those numbers as a new result. [#276](https://github.com/KoalaFacts/Purity/issues/276) remains the current comparison work item.

The internal bundle runner already sums all emitted chunks for its static fixtures, compressing each separately, and rejects dynamic imports. That is a useful internal gate. A matched application comparison must additionally inventory lazy routes/islands and separate initial-route from full-application bytes. Do not add overlapping feature-entry budgets and call the sum an application size.

## 7. Bounded progress already delivered

| Record                                                                | What it closes                                                                                             | What it does not close                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [#288](https://github.com/KoalaFacts/Purity/pull/288)                 | Owned scheduled reactive error dispatch; strict-AOT enforcement; dependency repair within original budgets | General client loading/error boundary model or whole-framework parity                                  |
| [#289](https://github.com/KoalaFacts/Purity/pull/289)                 | Retry after failed `match()` branch/fallback rendering                                                     | Every error recovery journey                                                                           |
| [#291](https://github.com/KoalaFacts/Purity/pull/291)                 | Multi-root row order in the native move path, with retained-node checks                                    | Reactive current indices or every browser's focus-preservation contract                                |
| [#292](https://github.com/KoalaFacts/Purity/pull/292)                 | Callback-only signal reads do not subscribe explicit watchers                                              | The remaining double initial source read                                                               |
| [#293](https://github.com/KoalaFacts/Purity/pull/293)                 | Tuple callback snapshots remain stable, including the error path                                           | All watcher timing/ownership contracts                                                                 |
| [#294](https://github.com/KoalaFacts/Purity/pull/294) — open at audit | Proposed single initial source sampling and parent-subscription fix                                        | Latest audited `e22120e` fails core-all Brotli: 40,747 B > 40,704 B in CI #961; not merged or accepted |

These are bounded implementation records. Named tests are evidence paths, not assertions that this audit executed every test. The observed or measured result must always identify the commit and environment that actually ran.

## 8. Monitor and completion rules

Each substantive monitor result and competitive PR should name:

- the gap ID and the particular acceptance item being attempted;
- the application failure or cost before the change;
- the new behavior or measured result, including regressions and uncertainty;
- the exact inputs and evidence links;
- the remaining acceptance items and the next bounded slice.

Move a whole row to accepted only after all its stated acceptance conditions have executed evidence, intentional differences are explicit, independent review is addressed, normal CI passes, and the merged main is verified. A documentation change, API addition, test count or one microbenchmark cannot do that.

Keep the **5,248 B core-actions / 40,704 B core-all Brotli** limits and the existing correctness, memory and security gates. Update comparator versions deliberately in a separate baseline change, preserving prior reports. Re-audit the source and active PRs before each run; the snapshot's open/merged labels are dated facts, not permanent instructions.
