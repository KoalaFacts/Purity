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

| #                              | Title                | Status   |
| ------------------------------ | -------------------- | -------- |
| [0001](./0001-ssr-strategy.md) | SSR strategy for 1.0 | Proposed |
| [0002](./0002-devtools.md)     | Devtools approach    | Proposed |
| [0003](./0003-path-to-1.0.md)  | Path to 1.0          | Proposed |

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
