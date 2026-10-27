# Client-first AOT implementation plan

> Execute inline, one work package, using the existing TypeScript/Vite+/Vitest/Playwright toolchain. The user explicitly authorized major breaking changes on 2026-10-28 and waived backward compatibility. Do not ask again for routine development approval.

**Goal:** Stop generating and shipping hydration template machinery in applications that only create client DOM, without removing hydration from applications that need it.

**Architecture:** `purity()` becomes strict, client-only AOT by default. A `hydratable: true` build emits the existing DOM factory plus hydration walker; client-only builds call the DOM factory directly with the shared `watch` implementation. Existing hydration runtime is a required SSR feature, not a compatibility shim. JIT fallback requires explicit `strictAot: false`.

**Approaches:** Adding another JIT alias saved only tens of bytes and is rejected as the primary approach. Splitting npm names without removing implementation dependencies cannot demonstrate savings. The chosen approach specializes the generated program at build time, retains one reactive graph and preserves explicit hydration capability.

## Constraints

- TypeScript, direct DOM, Web Components and Shadow DOM remain supported. No new runtime dependencies.
- Exact Node 24.21.0 and repository lockfile; Vite+/Oxfmt formatting before formal CI.
- Frozen `core-all` Brotli baseline 40,679 B and goal <=34,577 B remain. Original package caps stay unchanged, including core-actions <=5,248 B and core-all <=40,704 B.
- Keep all original 14 current package entries and 12 application profiles; new client-only variants use the same application sources and must account for all JS chunks.
- Label same-workload build-mode savings separately from whole-core reduction or Solid v2 parity. No allocation, speed or memory claim without measurement.
- No npm publication, extra production deployment, Vercel Sandbox, license change or scheduled-task change.

## Review focus

- Nested templates and collision-safe generated names in client-only output.
- Form binding, URL single coercion and unsafe scheme rejection.
- Ownership/disposal and execution with runtime code generation disabled.
- Explicit hydration keeps node identity, state, markers and SSR behavior.
- Repository scaffolds, browser checks, examples and old report inventories remain executable and correctly labelled.

## Task 1 — Compiler mode boundary

- [x] Add default-client and explicit-hydration contract tests in `packages/vite-plugin/tests/client-first-aot.test.ts`.
- [x] Observe intended failure on unchanged source under Node24: run 40591881426, job 122497938596; default output contains hydration walkers.
- [ ] Implement `hydratable?: boolean` and strict-AOT default in `packages/vite-plugin/src/index.ts`.
- [ ] Emit direct create calls with shared `watch` for client-only compilation; retain existing SSR output and opt-in hydration.
- [ ] Execute new behavior/security/disposal tests and the existing suite; no skipped or deleted regressions.

## Task 2 — Consumers and full applications

- [ ] Explicitly select hydration for SSR consumers and hydration-specific tests; leave client applications on the new default.
- [ ] Preserve historical full-hydration size profiles and add same-source client-only AOT profiles, including every emitted chunk and browser verification.
- [ ] Document the breaking migration and keep historical report schemas/budgets immutable.
- [ ] Run formatter, lint, types, all workspace tests, builds and full size preflight before opening the single implementation PR.

## Task 3 — Acceptance

- [ ] Exact-source full CI: Vitest, Playwright three engines, security, retention, packaged consumers and unchanged budgets.
- [ ] Independent exact-head source review; resolve findings with evidence.
- [ ] Re-read head/base/checks/comments, normal expected-SHA squash merge, then verify new main CI/Docs/quality/security.
- [ ] Record measured application deltas and remaining frozen-core/Solid comparison work in Issue #276.

## Execution environment

The local container initially had Node22 and no public DNS; after a toolchain archive was fetched it returned ClientError for both shell and Python calls. Development preflight therefore runs on the existing repository Actions service with Node24.21.0. Temporary recovery/preflight files must not remain in the final product diff. A preflight job is not a substitute for exact-head formal CI or independent review.
