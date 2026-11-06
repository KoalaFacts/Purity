# Decisions

Architecture Decision Records (ADRs) for Purity. Each ADR captures a
significant choice, the context that drove it, and the consequences we
accept. Numbered sequentially.

## How ADRs are used here

- **Status** is one of:
  - **Proposed** — written, open for discussion, not yet committed to.
  - **Accepted** — the project is operating under this decision.
  - **Rejected** — proposed and discarded; kept for the historical record.
  - **Superseded by NNNN** — replaced by a later ADR.
  - **Deprecated** — abandoned without replacement.
- ADRs are not specifications; they're snapshots of the reasoning at
  decision time. If reality changes, write a new ADR superseding the old
  one rather than editing history.
- Pre-1.0 ADRs default to **Proposed**. They become **Accepted** at
  the 1.0 cut.

## Index

| #                                                | Title                                                                         | Status                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------- |
| [0001](./0001-ssr-strategy.md)                   | SSR strategy for 1.0                                                          | Superseded by 0004      |
| [0002](./0002-devtools.md)                       | Devtools approach                                                             | Proposed                |
| [0003](./0003-path-to-1.0.md)                    | Path to 1.0                                                                   | Proposed                |
| [0004](./0004-ssr-mvp.md)                        | SSR MVP via Declarative Shadow DOM                                            | Accepted (partial 0005) |
| [0005](./0005-non-lossy-hydration.md)            | Marker-walking, non-lossy hydration                                           | Accepted                |
| [0006](./0006-streaming-suspense.md)             | Streaming SSR with Suspense boundaries                                        | Proposed                |
| [0007](./0007-text-rewrite-on-mismatch.md)       | Opt-in static text-content rewriting on hydration mismatch                    | Accepted                |
| [0008](./0008-head-meta-management.md)           | Per-component head / meta tag management                                      | Accepted                |
| [0009](./0009-request-context.md)                | Request context for SSR components                                            | Accepted                |
| [0010](./0010-static-site-generation.md)         | Static site generation driver                                                 | Accepted                |
| [0011](./0011-router-primitives.md)              | Router primitives                                                             | Accepted                |
| [0012](./0012-server-actions.md)                 | Server actions / form-enhancement primitive                                   | Accepted                |
| [0013](./0013-link-interception.md)              | Link auto-interception                                                        | Accepted                |
| [0014](./0014-url-search-hash-signals.md)        | URL search and hash signals                                                   | Accepted                |
| [0015](./0015-nav-scroll-management.md)          | Navigation scroll management                                                  | Accepted                |
| [0016](./0016-nav-focus-management.md)           | Navigation focus management                                                   | Accepted                |
| [0017](./0017-view-transitions.md)               | View Transitions API integration                                              | Accepted                |
| [0018](./0018-server-module-strip.md)            | Server-only module strip from client bundles                                  | Accepted                |
| [0019](./0019-file-system-routing.md)            | File-system routing — manifest generation                                     | Accepted                |
| [0020](./0020-layouts.md)                        | File-system layouts — `_layout` per directory                                 | Accepted                |
| [0021](./0021-error-boundaries-404.md)           | Error boundaries + 404 — `_error` per directory, root `_404`                  | Accepted                |
| [0022](./0022-data-loaders.md)                   | Data loaders — `loader` named export per route + layout                       | Accepted                |
| [0023](./0023-isomorphic-control-flow.md)        | Isomorphic conditional primitives — `when` / `match` / `each` SSR auto-detect | Accepted                |
| [0024](./0024-ssr-aware-lazy-resource.md)        | SSR-aware `lazyResource.fetch()` — register pending promises with multipass   | Accepted                |
| [0025](./0025-async-route-composer.md)           | `asyncRoute` runtime composer — manifest-driven view assembly                 | Accepted                |
| [0026](./0026-loader-data-accessor.md)           | `loaderData()` context accessor — per-component loader-data slot              | Accepted                |
| [0027](./0027-configure-navigation.md)           | `configureNavigation()` — single setup for the four `manageNav*` opt-ins      | Accepted                |
| [0028](./0028-nested-404-chain.md)               | Per-directory `_404.ts` — nested not-found chain                              | Accepted                |
| [0029](./0029-hover-prefetch.md)                 | `prefetchManifestLinks()` — hover-prefetch route modules                      | Accepted                |
| [0030](./0030-reactive-title.md)                 | `manageTitle(fn)` — reactive `<title>` sync                                   | Accepted                |
| [0031](./0031-typed-route-params.md)             | `RouteParams<P>` — template-literal-derived route params                      | Accepted                |
| [0032](./0032-on-disk-manifest-emit.md)          | `emitTo` — on-disk manifest emit                                              | Accepted                |
| [0033](./0033-eager-manifest-emit.md)            | Eager manifest emit for non-Vite consumers                                    | Accepted                |
| [0034](./0034-typed-loader-data.md)              | `LoaderDataOf<P, R>` — typed loader data from the manifest                    | Accepted                |
| [0035](./0035-element-internals-states.md)       | ElementInternals.states for component lifecycle                               | Proposed                |
| [0036](./0036-form-associated-components.md)     | Form-associated components via options bag                                    | Proposed                |
| [0037](./0037-move-before-each-reorder.md)       | moveBefore in each() reorder                                                  | Proposed                |
| [0038](./0038-islands.md)                        | Islands — opt-in per-subtree hydration                                        | Proposed                |
| [0039](./0039-persistence-lifecycle-signals.md)  | Persistence + lifecycle signal primitives                                     | Proposed                |
| [0040](./0040-observer-signal-primitives.md)     | Observer-as-signal primitives                                                 | Proposed                |
| [0041](./0041-environment-preference-signals.md) | Environment + system preference signals                                       | Proposed                |
| [0042](./0042-capability-permission-signals.md)  | Capability + permission signals                                               | Proposed                |
| [0043](./0043-smart-server-action-strip.md)      | Smart serverAction() body-only stripping                                      | Proposed                |
| [0044](./0044-virtual-routes-typed-dts.md)       | Sibling routes.d.ts with typed importFn                                       | Proposed                |
| [0045](./0045-aria-nav-announce.md)              | ARIA live-region announce on navigate                                         | Proposed                |
| [0046](./0046-async-view-transitions.md)         | Async-aware view transitions                                                  | Proposed                |
| [0047](./0047-live-data-signals.md)              | Live data signals (eventSource + webSocket)                                   | Proposed                |
| [0048](./0048-query-swr.md)                      | `query()` — stale-while-revalidate over `resource()`                          | Proposed                |
| [0049](./0049-optimistic.md)                     | `optimistic()` — optimistic-update server-action wrapper                      | Proposed                |
| [0050](./0050-core-entry-points.md)              | Core feature entry points and ownership boundary                              | Proposed                |
| [0051](./0051-server-control-boundary.md)        | Register server control-flow rendering at SSR entry                           | Proposed                |
| [0052](./0052-server-resource-boundary.md)       | Register server resource handling at SSR entry                                | Proposed                |
| [0053](./0053-ordinary-list-specialization.md)   | Compile proven ordinary list calls to a smaller runtime                       | Superseded              |
| [0054](./0054-property-store.md)                 | Add a property-granular store as an opt-in core entry                         | Proposed                |

## Template

A minimal ADR has six sections:

```markdown
# NNNN: Title (verb + object, e.g. "Adopt X for Y")

**Status:** Proposed | Accepted | Superseded by NNNN | Deprecated
**Date:** YYYY-MM-DD

## Context

What forces are at play? What problem are we trying to solve? What
constraints exist (technical, organizational, time, scope)?

## Decision

The choice we made, in one or two paragraphs. Active voice, present
tense. "We will / we do not."

## Consequences

What follows from the decision — positive, negative, and neutral. Be
honest about the costs.

## Alternatives considered

What else was on the table, and why we didn't pick it. One paragraph
per option is plenty.
```
