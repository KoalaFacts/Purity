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

| #                                                | Title                                           | Status                  |
| ------------------------------------------------ | ----------------------------------------------- | ----------------------- |
| [0001](./0001-ssr-strategy.md)                   | SSR strategy for 1.0                            | Superseded by 0004      |
| [0002](./0002-devtools.md)                       | Devtools approach                               | Proposed                |
| [0003](./0003-path-to-1.0.md)                    | Path to 1.0                                     | Proposed                |
| [0004](./0004-ssr-mvp.md)                        | SSR MVP via Declarative Shadow DOM              | Accepted (partial 0005) |
| [0005](./0005-non-lossy-hydration.md)            | Marker-walking, non-lossy hydration             | Accepted                |
| [0006](./0006-streaming-suspense.md)             | Streaming SSR with Suspense boundaries          | Proposed                |
| [0035](./0035-element-internals-states.md)       | ElementInternals.states for component lifecycle | Proposed                |
| [0036](./0036-form-associated-components.md)     | Form-associated components via options bag      | Proposed                |
| [0037](./0037-move-before-each-reorder.md)       | moveBefore in each() reorder                    | Proposed                |
| [0038](./0038-islands.md)                        | Islands — opt-in per-subtree hydration          | Proposed                |
| [0039](./0039-persistence-lifecycle-signals.md)  | Persistence + lifecycle signal primitives       | Proposed                |
| [0040](./0040-observer-signal-primitives.md)     | Observer-as-signal primitives                   | Proposed                |
| [0041](./0041-environment-preference-signals.md) | Environment + system preference signals         | Proposed                |
| [0042](./0042-capability-permission-signals.md)  | Capability + permission signals                 | Proposed                |
| [0043](./0043-smart-server-action-strip.md)      | Smart serverAction() body-only stripping        | Proposed                |
| [0044](./0044-virtual-routes-typed-dts.md)       | Sibling routes.d.ts with typed importFn         | Proposed                |
| [0045](./0045-aria-nav-announce.md)              | ARIA live-region announce on navigate           | Proposed                |
| [0046](./0046-async-view-transitions.md)         | Async-aware view transitions                    | Proposed                |

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
