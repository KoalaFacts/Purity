# Roadmap: make Purity a strong SolidJS competitor

**Status:** Execution roadmap; individual API and support-policy decisions still require their own ADRs.
**Baseline:** `50c80b3`, reviewed on 2026-10-24. This is a dated starting point, not a claim about later commits or published packages.

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

### Stable Solid 1.9.x is the primary behavior reference

Use the stable 1.9.x contracts for the first comparison suite: signals/memos/effects, ownership and cleanup, item-identity lists versus position-identity lists, structured stores, resources, Suspense/error boundaries, and SSR/hydration. The [Solid reference](https://docs.solidjs.com/reference/basic-reactivity/create-signal) and the selected stable release's source/tests define the reference behavior. Before an executable comparison, select and record one exact 1.9.x patch, its package integrity, and any router/metaframework versions. “1.9.x” is a scope label, never a sufficient measurement version.

API differences are allowed. For example, Solid's [`For`](https://docs.solidjs.com/reference/components/for) preserves item identity and provides a reactive index; [`Index`](https://docs.solidjs.com/reference/components/index-component) preserves positions and provides reactive items. Purity's keyed `each()` takes item accessors and a numeric callback index. Those signatures must not be presented as interchangeable. Compare the resulting application behavior, document the difference, and decide whether an additional capability is needed.

Router, actions, application serving, and deployment comparisons must name the Solid ecosystem packages involved. They are not all contracts of the stable `solid-js` core package.

### Solid 2.0 RC is a separate forward target

Track the [official 2.0 RC direction](https://github.com/solidjs/solid/discussions/2995) separately: async computations and structured state, loading/error recovery, stale content during revalidation, coordinated reveal, and the associated application/tooling changes. Recheck the selected RC's source and documentation before designing against it. An RC's behavior can change; it must not silently redefine the stable 1.9.x acceptance suite.

The repository's [benchmark manifest](../benchmark/package.json) at this baseline pins `solid-js@2.0.0-rc.15` and `@solidjs/web@2.0.0-rc.14`. These are the existing benchmark inputs, not a statement that they are the latest RCs or a validated stable comparison. Record the actual resolved transitive versions and compiler/plugin versions as well. Run a stable track and an RC track separately, with separately labelled artifacts. No measurements were produced for this roadmap.

### What counts as evidence

- **Implemented:** an API/path exists in source. This does not imply all competitive contracts are satisfied.
- **Evidence:** a named test, browser run, package-consumer run, or deployment artifact checks a stated behavior at a recorded revision and environment. Test files are verification paths; a passing run needs its own log.
- **Accepted:** the explicit exit criteria below pass for the claimed release and support targets, with intentional differences documented. A roadmap item stays open until that evidence exists.

The [baseline CI run](https://github.com/KoalaFacts/Purity/actions/runs/39935450471) recorded **2,891 workspace tests and 13 release tests passing**. This is useful regression evidence for that checkout; it is not a measure of Solid parity, browser support, accessibility, production adoption, or future commits. The [capability audit](./framework-capabilities.md) remains the implementation/evidence inventory.

## Behavior matrix at the baseline

Each remaining-acceptance cell is work to complete or a decision to record. It must not be read as a claim that the entire area is absent.

| Area and reference contract                                                                    | Implemented in Purity                                                                                                                              | Existing evidence and its boundary                                                                                                                                                                                                                                                                                                                       | Remaining competitive acceptance                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signals and computations: dynamic dependencies, equality, batching, propagation, effect timing | `state`, `compute`, `watch`, `batch`; custom push-pull graph                                                                                       | [Signal tests](../packages/core/tests/signals.test.ts); audit baseline above. Purity's scheduling is its own contract.                                                                                                                                                                                                                                   | Publish a behavioral contract for first/subsequent watch runs, nested batches, read-after-write, branch switching, thrown computations, cycles, and disposal during propagation. Run equivalent application observations against an exact stable Solid version; explain intentional timing differences.                                                                                                                |
| Ownership and lifecycle: work belongs to a disposable owner                                    | Component, watcher, and row scopes; disposal; resource ownership/cancellation                                                                      | [Ownership boundary](./decisions/0050-core-entry-points.md), [initialization rollback tests](../packages/core/tests/initialization-rollback.test.ts), [resource ownership tests](../packages/core/tests/resource-request-ownership.test.ts), and audit retention checks. ADR 0050 remains Proposed despite implementation.                               | Demonstrate nested owners, rerun cleanup, failed initialization, row removal, unmount, and late async completion. Cleanup must run once, stop owned work, and release retained graphs. Specify how deliberately detached work is disposed.                                                                                                                                                                             |
| Keyed DOM: preserve row identity through structural updates                                    | `each()` with explicit keys or item identity; per-row data signals; keyed reconciliation; optional virtualization                                  | [List tests](../packages/core/tests/list.test.ts), [control implementation](../packages/core/src/control.ts), [fixture/browser checks](../benchmark/tools/README.md). Virtual lists are a separate workload.                                                                                                                                             | In production browser builds, assert node/component identity, focus, selection, form values, row cleanup, and current data across prepend, remove, swap, reverse, and replacement objects with stable keys. Define duplicate-key behavior. Performance work must retain these observations.                                                                                                                            |
| Index semantics: item identity and position identity serve different workloads                 | `each()` passes an item accessor and numeric index captured when the row renderer runs; retained rows update their data                            | [Reactivity guide](./reactivity.md#render-a-keyed-list) and `eachRowOps` in [controls](../packages/core/src/control.ts). Numeric callback index is not Solid `For`'s reactive index or a complete Solid `Index` equivalent.                                                                                                                              | Specify creation index versus current position. Exercise reorder and replacement with position-derived labels/events. Decide whether to add a reactive position accessor or a separate positional primitive; document an intentional alternative if the use case can be served safely without either.                                                                                                                  |
| Structured stores: property-granular nested updates                                            | Object/array values can live in signals; applications can compose signals and derived values                                                       | [Signal/type tests](../packages/core/tests/types.test.ts). There is **no deep store** equivalent to Solid's [property-tracked store](https://docs.solidjs.com/reference/store-utilities/create-store).                                                                                                                                                   | Design an optional structured-state story using nested object/array forms and normalized entities. Measure update fan-out and ergonomics. Either deliver scoped fine-grained store behavior or explicitly document its unsupported cases and costs; whole-object replacement is not evidence of deep-store equivalence.                                                                                                |
| Async and errors: pending/stale/resolved/failed work, owner-scoped recovery                    | Resources, cancellation, retry, polling, SWR, lazy resources, query refresh, optimistic updates; route error handling and component error hooks    | [Resource tests](../packages/core/tests/resource.test.ts), [async route tests](../packages/core/tests/async-route.test.ts), [server guide](./server-rendering.md). At this baseline client `suspense()` only invokes its view; later watcher failures are console-reported, not a complete owner-boundary recovery system.                               | Specify and test pending UI, stale content, rapid source changes, rejection/retry/reset, nested boundaries, fallback failure, and unmount during pending work. Route/resource error accessors must not be described as a general reactive error boundary. Design owner-scoped error routing and client async boundaries; in-flight work is not accepted yet.                                                           |
| AOT and CSP: production templates compile completely or report unsupported input               | Optional Vite AOT for client/SSR/hydration; modular runtime/compiler entries; runtime fallback is possible                                         | [Compiler/plugin tests](../packages/vite-plugin/tests/plugin.test.ts), [equivalence tests](../packages/vite-plugin/tests/equivalence.test.ts), [bundle fixture budgets](../benchmark/bundle-size/README.md). Existing AOT fixtures enforce zero direct Function constructors.                                                                            | Finish opt-in strict-AOT enforcement with actionable file/location diagnostics, define transform coverage and exclusions, and verify aliases/re-exports/dynamic forms. A strict production build must fail instead of retaining an unexpected JIT path. Prove CSP behavior and absence of compiler code across the complete generated chunk graph. Strict mode is under implementation, not accepted at this baseline. |
| SSR and streaming: useful shell, independent async regions, bounded request lifetime           | Buffered and streaming SSR, DSD, resource cache payloads, deadlines, cancellation and backpressure                                                 | Accepted [ADR 0006](./decisions/0006-streaming-suspense.md), [stream tests](../packages/ssr/tests/render-to-stream.test.ts), [cancellation tests](../packages/ssr/tests/suspense-cancellation.test.ts), [backpressure tests](../packages/ssr/tests/stream-backpressure.test.ts). Boundaries drain sequentially; hydration waits until the stream closes. | Document head-of-line behavior. Design and verify independent boundary completion if claimed; a fast later sibling must become usable despite an earlier blocked sibling. Preserve nested ownership, request isolation, deadlines, abort/error handling, resource release, and CSP nonce handling. Do not equate chunked output with selective hydration.                                                              |
| Hydration: compatible server DOM retains identity and usable state                             | Marker walking, DSD adoption, property restoration, keyed resources, opt-in islands, mismatch diagnostics/text rewrite                             | Accepted [ADR 0005](./decisions/0005-non-lossy-hydration.md) and [ADR 0007](./decisions/0007-text-rewrite-on-mismatch.md); [hydration parity tests](../packages/ssr/tests/hydrate-parity.test.ts) and bundle browser fixtures                                                                                                                            | Record node identity, typed properties, user edits, focus/selection, event attachment, nested control flow, and mismatches in production browser runs. Selective/in-flight boundary hydration and event replay require a separate design and explicit evidence before being claimed.                                                                                                                                   |
| Router and actions: navigation and writes behave as a coherent application                     | File manifests, layouts, loaders, route errors/404s, search/hash signals, navigation helpers, native POST and enhanced forms, query invalidation   | Accepted routing/action ADRs [0011](./decisions/0011-router-primitives.md) through [0034](./decisions/0034-typed-loader-data.md); [packaged action smoke](../packages/cli/scripts/app-actions-smoke.ts) and [security boundaries](./security.md). These are distinct capabilities, not proof of a Solid Router/Start replacement.                        | Run back/forward, stale navigation cancellation, nested errors, redirect/status/header handling, focus/scroll, no-JS forms, failed/duplicate submissions, and post-write refresh in an installed consumer. Verify server-only code stripping, trusted origins, authentication examples, and host integration. Name exact comparison packages.                                                                          |
| Tooling and debugging: follow a bad value to its source and owner                              | CLI starters, Vite integration/HMR, console graph hook, development panel                                                                          | [Debugging guide](./debugging.md) and [panel browser check](../packages/vite-plugin/tests/devtools-browser.ts). Panel has no source locations, component hierarchy, or time travel.                                                                                                                                                                      | A developer must trace a stale DOM binding through dependencies to source and component ownership in a real app. Verify source maps after transforms and owner disposal across HMR. Source/owner context is prioritized; time travel needs a demonstrated debugging requirement.                                                                                                                                       |
| Types and authoring: correct applications compile and mistakes fail usefully                   | Public declarations; strict-mode examples; route params, emitted manifests and inferred loader-data helpers                                        | [TypeScript guide](./typescript.md), [type tests](../packages/core/tests/types.test.ts), accepted [ADR 0034](./decisions/0034-typed-loader-data.md). Inference depends on the documented manifest workflow.                                                                                                                                              | Compile consumer examples against built/published declarations with `tsc --strict`; verify positive and negative cases for overloads, custom-element properties/events, resources, routes/actions and generated files. Record supported TypeScript/Vite/Node versions and useful diagnostics.                                                                                                                          |
| Browsers and accessibility: interactions work for the supported audience                       | Three-engine fixtures for keyboard, forms, Shadow DOM and automated accessibility; documented component patterns                                   | [Accessibility audit](./accessibility.md#browser-audit-2026-09-25). Minimum browser versions, NVDA/VoiceOver, actual zoom and OS contrast remain unverified; the WebKit multiple-select contrast check is incomplete.                                                                                                                                    | Run each adopted minimum engine or revise the matrix with a decision. Record NVDA and VoiceOver journeys, real zoom/OS contrast, labels, focus, validation, announcements and navigation in an application. Automated scans alone cannot close this gate.                                                                                                                                                              |
| Published consumers: installed packages work outside the monorepo                              | Published 0.4.0; packaged CLI/application checks; the PressFloor consumer still uses npm 0.3.4 at the audit baseline                               | [Published CLI command](../README.md#development), [migration guide](./core-entry-points.md) and [release status](../README.md#status). Neither local source tests nor a consumer on 0.3.4 validate a newer npm release.                                                                                                                                 | Upgrade PressFloor through published npm packages and record its installed lockfile, build/type checks, critical browser journeys and deployment result. Add fresh client, SSR and mixed-delivery consumers using registry packages. Candidate tarballs test packaging; only installed registry versions prove a published release. No source aliases, workspace links, or app-source shortcuts in that evidence.      |
| Deployment: documented host paths actually serve the application                               | Node scaffold/local production startup; Cloudflare Workers, Vercel Edge and Deno adapter examples                                                  | [Deployment guide](./server-rendering.md#deploy-to-a-node-host) and audit. Examples are not live deployment evidence.                                                                                                                                                                                                                                    | For each claimed supported host, archive build/runtime versions and a live run of SSR, streaming, hydration, actions, cancellation and headers/CSP. Capture provider buffering limits and a repeatable deployment recipe. Limit support claims to verified hosts.                                                                                                                                                      |
| Versions and support: users know what upgrades and maintenance mean                            | Changelog, entry-point migration, security/licensing documentation; 0.4.0 published under MIT, 0.5.0 unreleased with Apache-2.0 licensing prepared | [Licensing scope](./licensing.md), [changelog](../CHANGELOG.md), **Proposed** [ADR 0003](./decisions/0003-path-to-1.0.md)                                                                                                                                                                                                                                | Adopt or supersede versioning, deprecation, security/backport, public-export and browser policies. Reconcile the old checklist with current modular/SSR exports and superseded ADR 0001. Verify the release's actual package contents, coordinated versions and license notices. A roadmap cannot adopt the policy implicitly.                                                                                         |

## First foundation slice

The accompanying source change implements two bounded parts of the roadmap:

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

The matrix above preserves the dated audit baseline. These implementation and
test links describe this slice; passing release evidence still requires the
corresponding revision's CI and published-consumer records. The milestones
below retain their broader acceptance criteria.

## Prioritized milestones

The order addresses trust in the current model before broadening its surface. Each milestone produces a reviewable evidence set. Work may overlap where independent, but a later feature or faster result cannot waive an earlier correctness gate. There are no calendar guarantees or completion percentages.

### M0 — Establish the contract and release evidence ledger

**Priority:** First; defines what subsequent changes must preserve.

1. Turn the matrix's runtime observations into a stable contract inventory with a disposition for each: same observable behavior, intentional alternative, unsupported, or future target. Record scheduling and index differences explicitly.
2. Select one exact stable Solid 1.9.x patch for conformance runs and keep the current RC fixture track separately labelled. Record every package/compiler version, lockfile and revision.
3. Reproduce the checkout/release gates and attach logs. Record published 0.4.0 separately from main's unreleased 0.5.0, and PressFloor's installed 0.3.4 separately from both.

**Exit:** Every comparison has a named contract and versioned input. The evidence ledger links a run or an explicit open gap; no table marks an implementation or a proposed decision as passed acceptance.

**Artifacts:** Contract matrix; exact-version manifests/lockfiles; CI/release run links; consumer inventory; migration/license summary.

### M1 — Make ownership, keyed rendering and reactive failures dependable

**Priority:** Runtime foundation for stores, async UI and tools.

1. Pin dynamic tracking, batching, watcher scheduling, cleanup and error behavior with focused regressions for real failure modes. Preserve sibling progress when one computation fails.
2. Complete the owner-scoped reactive failure design with documented fallback/reset and unhandled-error behavior. The first slice above covers scheduled watch/effect dispatch; verify the broader boundary contract, including cleanup if fallback rendering fails.
3. Close the keyed identity and index-contract acceptance rows. If numeric creation indexes remain intentional, make that explicit in the public guide and provide a safe current-position recipe or a separately designed capability.
4. Run production browser identity/input-state checks and targeted cleanup/retention checks; compare application observations with the stable Solid track.

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

1. Design optional structured state against nested forms, editable collections and normalized entities. Compare fine-grained update behavior and authoring cost with the stable store contract. Decide ownership, identity, mutation/reconciliation, serialization and typing before selecting an API.
2. Design client async boundaries for loading, stale data, error recovery and transitions. Establish how resources, queries, route loaders and owner-scoped failures compose. Keep the 2.0 RC's async model in a separate forward-looking assessment.
3. Exercise rapid search, route changes during loading, mutation followed by refresh, overlapping requests, rejection/reset and unmount. Assert visible state and accepted writes as well as cancellation signals.

**Exit:** The example journeys work without ad hoc duplicated loading/error state or obsolete completions overwriting newer state. Fine-grained store claims have update-isolation evidence. Every intentional limit has a documented alternative and cost; an omitted capability remains explicitly unsupported.

**Artifacts:** Store/async ADRs; typed application examples; state-transition contract tests; browser recovery/cancellation recordings; stable-versus-RC comparison notes.

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

1. Identify the Purity commit or published version; exact Solid stable or RC packages; every other compared framework; compiler/bundler/runtime; browser build; OS/hardware; workload sizes; sampling/warmup; and timing boundaries. Archive lockfiles, commands, raw samples and complete chunk sizes.
2. Check rendered content and interaction parity before collecting timing. Keep labels, object identity, data generation and framework-native update strategies equivalent. A faster fixture with a missing binding or different state model is a different workload.
3. Separate ordinary lists from opt-in virtualization, production timing from instrumented profiles/heap runs, and runtime from AOT builds. Keep correctness checks and performance measurements independent.
4. Report dispersion and repeated-run behavior alongside central values. Describe regressions and tradeoffs by workload. A justified optimization gets a retained regression case and a same-environment before/after report; it does not acquire a universal framework ranking.

**Exit for a performance claim:** A reader can reproduce the specific result from the archived inputs, verify the same visible behavior, and identify its version/build/workload limits. New measurements supersede only their matching scenario; historical results retain their original SHA and methodology.

## Maintaining the roadmap

Update a row only with a linked implementation, acceptance run, or explicit design decision. Changes to behavior and support commitments belong in an ADR and release notes. Use each ADR file's status: the [ADR index](./decisions/README.md) is not a complete status inventory. Accepted SSR/hydration/routing decisions remain the architectural starting point; the [proposed 1.0 policy](./decisions/0003-path-to-1.0.md) and proposed optimization ADRs do not become accepted merely because code exists.

At each release candidate, reconcile this roadmap with the [capability audit](./framework-capabilities.md), [changelog](../CHANGELOG.md), package-consumer evidence and the actual release artifacts. Keep source implementation, passing evidence, published availability and production usage separate. That discipline is part of becoming a strong SolidJS competitor.
