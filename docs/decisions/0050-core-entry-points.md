# 0050: Core feature entry points and ownership boundary

**Status:** Proposed
**Date:** 2026-10-13

## Context

The root API exported optional browser integrations, routing, actions, and
SSR internals alongside component rendering and the JIT compiler. The compiler
entry mixed build-time generation with client hydration and server helpers.
Moving only `html` did not originally isolate the compiler: control-flow
hydration reached JIT compilation through deferred templates. That coupling
was removed before this change by registering JIT factories only when needed.

The reactive graph also imported its ownership stack from `component.ts`,
which imported reactivity and SSR coordination back. This made basic ownership
depend on higher-level rendering modules.

## Decision

Keep the responsive rendering API at the root and publish feature subpaths
within the same package, as listed in the [import guide](../core-entry-points.md).
Use `/jit` for optional runtime template compilation, `/runtime` for precompiled
client helpers, `/compiler` for build-time generation, and `/internal` for
the SSR package boundary. Export each optional feature from its own entry.
Remove the old exports directly in 0.4; do not maintain duplicate compatibility
entry points.

Put the context stack, component owner shape, and ownership attachment in
`scope.ts`, which has no runtime imports. Put disposal alongside reactivity
because it must suppress dependency tracking while running cleanups. Keep
cleanup order, exception handling, component parentage, and nested ownership
unchanged. Import these primitives directly instead of through the component
rendering module.

Update the Vite plugin's server-action stripping to recognize `/actions` in
the same change as the public export migration. Update generated imports,
SSR consumers, scaffolds, examples, and test aliases together. All published
entries are built in one library build so they share graph/context modules.

Enforce smaller per-entry budgets and preserve the previous root budget for
the equivalent combined API. Retain the AOT fixtures' zero-Function-constructor
gate and verify their production behavior in browsers.

## Consequences

Imports change for optional features and template compilation. Application
authors must upgrade the coordinated packages and rebuild generated output.
The lower-level ownership module no longer depends on DOM rendering or SSR.
Shared state is preserved across feature entries within each module format.

The smaller root measurement describes the root API, not all framework
features. Shared server branches in controls and resources remain; extracting
those requires a separate behavior-preserving change with streaming and
cancellation evidence. No size reduction is claimed merely for renaming an
import.

## Alternatives considered

Separate npm packages would add version coordination and increase the chance
of duplicate state. Keeping all exports at the root would leave compiler and
feature boundaries implicit. Raising the original bundle limits would hide
growth instead of validating the restructure.
