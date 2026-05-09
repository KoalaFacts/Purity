# 0001: SSR strategy for 1.0

**Status:** Proposed
**Date:** 2026-05-09

## Context

Purity is currently client-rendered only. The role-play first-impressions
review flagged "no SSR / hydration" as the loudest missing feature: any
team that needs SEO, social-preview metadata, or fast first-paint on
low-end devices will move on within seconds of reading the README.

Three forces are in tension:

1. **Engineering cost.** Full SSR + hydration is a multi-month project.
   It requires: a server-side template renderer that produces HTML
   strings, a hydration runtime that adopts existing DOM into the
   reactive graph, serializable component state, transport for that
   state, and per-component opt-in for client-only behavior. Every
   primitive (`state`, `compute`, `watch`, `resource`, `lazyResource`,
   `debounced`, `component()`) needs an SSR-aware story.

2. **Bundle-size discipline.** The framework's main differentiator is
   ~5.8 kB gz with zero runtime deps. SSR + hydration typically adds
   10–20 kB to the runtime (matching keys, identity preservation,
   suspense boundaries, etc.). Defaulting it on would change what the
   framework is.

3. **Use-case fit.** Custom Elements + Shadow DOM (the current
   `component()` model) compose poorly with traditional SSR. The
   platform's [Declarative Shadow DOM](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template/shadowrootmode)
   serializes shadow trees as HTML, but the supporting CSSOM
   (`adoptedStyleSheets`) doesn't have a clean serialization story
   yet. Hydration into a shadow root has additional ID-scope concerns
   (see `docs/accessibility.md`).

## Decision

**For 1.0: Purity is client-rendered only, by design.** We ship no
server renderer, no hydration runtime, no `renderToString`. The README
already states this; we commit to it formally here.

**For 1.x (post-1.0): scope a static-prerender path** — a build-time
mode that renders the initial DOM to HTML once and ships it
alongside the bundle, then re-renders client-side with no hydration.
This gives apps SEO and first-paint without the complexity of true
hydration. One plausible implementation is a Vite plugin that:

- Walks `mount()` sites at build time
- Snapshots the initial light-DOM tree (no Shadow DOM serialization)
- Inlines the snapshot into the HTML
- Lets the client bundle re-render on load (the snapshot is a
  visual-only placeholder; the reactive graph rebuilds from scratch)

**Implementation is genuinely TBD.** The above sketch picks one
approach (AST walk + Vite plugin) but a Node-sandbox approach that
actually executes `mount()` against a DOM emulator is also viable
and has different limitations. The 1.x ADR that supersedes this one
will pin the approach.

**For 2.x and beyond: full SSR + hydration is not committed to.** We
will revisit only if (a) several production users request it (we'll
take the number as a judgment call when it happens — there's no
magic threshold), (b) the Shadow-DOM SSR story matures in browsers,
and (c) someone signs up to own the implementation through to 1.0
of the SSR layer.

## Consequences

**Positive:**

- We can stop apologizing for the missing SSR story. "Client-only by
  design" is a real positioning, not a gap.
- Bundle size stays small. No SSR-aware codepath in the runtime.
- All current primitives stay simple. No serialization protocols, no
  hydration boundaries, no isomorphic guards.
- The static-prerender path (1.x) buys 80% of the SEO/first-paint
  benefit at 10% of the engineering cost.

**Negative:**

- Excludes the framework from any project where JS-disabled or
  no-JS-yet rendering is a hard requirement (gov, enterprise CMS,
  some marketing sites).
- "Client-only" lands hard against React/Solid/Vue/Svelte all having
  SSR stories. Comparison conversations get awkward.
- The `mount()` API stays inside-the-component-context: there is no
  `renderToString(component)` exit point. Any future SSR work
  starts from scratch.

**Neutral:**

- Custom Elements + Shadow DOM compose with Declarative Shadow DOM at
  the HTML level if we ever want it; the runtime just doesn't emit
  DSD today. That door stays open without commitment.

## Alternatives considered

- **(b) Full SSR + hydration for 1.0.** Rejected on cost: 2–4 months
  of engineering for a feature with no current paying user.

- **(c-now) Static prerender for 1.0.** Tempting (lower cost than full
  SSR, real SEO benefit), but the implementation work pushes 1.0 by
  ~6 weeks. We'd rather ship 1.0 with the current scope and a
  documented client-only stance than delay further. Static prerender
  goes into the 1.x roadmap.

- **No SSR, ever.** Defensible but closes a door we don't need to
  close yet. The post-1.0 trigger keeps the option live without
  committing engineering today.
