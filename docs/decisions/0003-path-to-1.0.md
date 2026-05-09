# 0003: Path to 1.0

**Status:** Proposed
**Date:** 2026-05-09

## Context

Purity is at `0.1.0`. The README correctly states the API may break
between minor versions and there are no known production users. There
is no documented versioning policy, no browser support matrix, no
explicit "what blocks 1.0" checklist. Without these, it is impossible
for a prospective user to evaluate whether the framework is a
reasonable bet for their team.

## Decision

### Versioning policy

- **Pre-1.0:** Any minor version (`0.X.0`) may include breaking
  changes. Patch versions (`0.X.Y`) are bug fixes only. We will
  document breaking changes in `CHANGELOG.md` per minor.
- **At 1.0 and beyond:** Strict semver.
  - **Major** (`X.0.0`): breaking API changes (signature, semantics,
    or removal of any public export).
  - **Minor** (`x.X.0`): backwards-compatible additions
    (new functions, new options, new types).
  - **Patch** (`x.x.X`): backwards-compatible bug fixes.
- Public API surface is everything exported from
  `packages/core/src/index.ts` and `packages/vite-plugin/src/index.ts`.
  Internal modules (`signals.ts`, `compiler/*`, etc.) are not subject
  to semver — refactors within them are patches.

### Deprecation policy

- Deprecating a public export requires: (1) a `@deprecated` JSDoc tag
  with the replacement and target removal version, (2) a one-time
  `console.warn` on first use in development builds (gated by
  `process.env.NODE_ENV !== 'production'` or equivalent), (3) at
  least one minor release with the warning before the removal major.
- Adding a new deprecation warning is itself a **minor** release —
  the existing call sites still work, they just log.
- Removing a deprecated export is a **major** release.

### Security policy

- **Pre-1.0:** Security fixes are only released against the latest
  pre-1.0 minor. Earlier `0.x` versions do not get backports.
- **Post-1.0:** Security fixes are backported to the **current major
  and the previous major** for 12 months after the previous major's
  last release, whichever comes first. Older majors do not get
  backports.
- Security advisories are published via GitHub Security Advisories
  and tagged in `CHANGELOG.md`.

### Browser support matrix

Targets at 1.0. **Note:** these baselines are derived from
source-code review (every public API in `packages/core/src/**` was
checked for the most-modern feature it requires). They have not yet
been independently tested in each browser; verifying every cell is
on the 1.0 checklist below.

| Browser                 | Minimum | Why                                                                                                |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Chrome / Edge           | 100+    | `adoptedStyleSheets` (Chrome 73+) + native ES2022 (Chrome 94+); 100 is a clean baseline above both |
| Firefox                 | 105+    | `adoptedStyleSheets` (Firefox 101+) + native ES2022 (Firefox 105+)                                 |
| Safari                  | 16.4+   | `adoptedStyleSheets` first shipped — Safari is the gating browser here                             |
| Node (for tooling only) | 24+     | Tooling (`@purityjs/cli`, vite-plugin builds) — runtime is browser-only                            |

We **do not** target IE, Safari < 16.4, Firefox < 105, or Chrome < 100.
No polyfills will be added to the core bundle.

### "What blocks 1.0" checklist

A 1.0 release commits us to the API surface. The following must be
true before we cut it:

- [ ] All public exports in `packages/core/src/index.ts` have JSDoc
      with at least one usage example.
- [ ] Every API in the README compiles in `tsc --strict` against the
      `examples/dashboard` setup.
- [ ] `npm run check` passes; `npm test --workspaces` passes; the
      benchmark workflow runs end-to-end on a recent commit.
- [ ] No `TODO` / `FIXME` / `XXX` comments in `packages/*/src/**`.
- [ ] At least 1 production user (internal or external) signs off
      that they're shipping `0.x` to real traffic.
- [ ] [ADR-0001](./0001-ssr-strategy.md) and
      [ADR-0002](./0002-devtools.md) are accepted, not proposed.
- [ ] `CHANGELOG.md` covers the path from `0.1.0` to the cut.
- [ ] A `MIGRATION.md` exists if any `0.x` users will hit breaking
      changes — even one.
- [ ] Bundle size measured on the cut commit; the README number
      matches.
- [ ] `docs/accessibility.md` has been reviewed by someone who has
      shipped a screen-reader-tested production app.
- [ ] Each cell of the browser support matrix above has been verified
      against an actual browser of that minimum version (or an
      explicit decision recorded if any are dropped/relaxed).

### Communication

- Each minor pre-1.0 release gets a brief release note (GitHub
  Releases) listing breaking changes.
- The 1.0 cut gets a longer write-up: what changed since `0.1.0`,
  what's intentionally NOT in scope (per ADR-0001 and 0002), what
  we'll commit to NOT changing without a major.

## Consequences

**Positive:**

- Prospective users can decide whether `0.x` is a reasonable risk.
- The checklist makes "are we ready for 1.0?" a discrete question
  with a discrete answer, not a vibes call.
- Browser matrix lets users price the framework against their own
  audience analytics.

**Negative:**

- The "1 production user signs off" gate may be hard to satisfy
  pre-1.0. We accept this — better to delay 1.0 than ship a v1 no
  one has tested under load.
- Strict semver post-1.0 means we'll be living with current
  decisions for longer. Each pre-1.0 minor is a chance to fix what's
  uncomfortable.

**Neutral:**

- The browser matrix excludes some long-tail audiences (~3% of global
  users on Safari < 16.4, < 1% on Chrome < 100 per usual stats).
  Users with those audiences should pick a different framework.

## Alternatives considered

- **No formal policy; cut 1.0 when it feels right.** Rejected: leaves
  users guessing whether `0.5.0` will break them. The whole point of
  semver is to make that question tractable.

- **Aggressive 1.0 (cut now).** Tempting to anchor adoption, but
  premature: there are no production users and several open ADRs.
  Cutting 1.0 now would either lock in current shape forever (bad) or
  burn 2.0 within a year (worse).

- **Target older browsers.** Each row in the support matrix that drops
  a year of browser baseline costs us features (`adoptedStyleSheets`
  for shadow CSS, modern `AbortSignal` ergonomics, etc.). Better to
  draw the line clean and be honest.

- **Drop semver entirely; calendar-version (CalVer) instead.**
  Rejected: CalVer is good for tools (Ubuntu, Vite), poor for
  libraries with breaking-change cost. Users want to know whether
  upgrading will break their build, not when we shipped it.
