# 0061: Inspector owner and source attribution

**Status:** Proposed (SV2-013; implementation slices tracked in
[the surpass-Solid ledger](../plans/surpass-solid.md))
**Date:** 2026-11-08

## Context

`globalThis.__purity_inspect__` ([ADR 0002](./0002-devtools.md),
[debugging guide](../debugging.md)) shows every live `state` / `compute` /
`watch` node with its value, status and edges, but not which component
created it or where in the source it was created. A stale binding is
visible in the graph and still hard to trace
([SV2-013](../solid-v2-gap-analysis.md#sv2-013)). Solid v2 attributes graph
nodes to their owner and to compiler-provided source locations.

## Decision

Two optional, development-only fields on `InspectorNode`, plus one switch:

```ts
interface InspectorNode {
  // …existing fields…
  owner?: readonly string[]; // e.g. ['app-shell', 'todo-item']
  source?: string; // e.g. 'TodoItem (src/todo-item.ts:12:17)'
}

__purity_inspect__.captureSources(true); // record creation sites from now on
```

- `owner` is recorded for every node created while a component is the
  current owner. Custom element instances are named by their composed
  shadow-host chain, outermost first. Components called as factories
  (`Child({})`) and other non-element owners (`errorBoundary()`, `loading()`
  outside a custom element) have no tag of their own and appear as `#owner`;
  a `mount()` / `hydrate()` root is `#root`. The walk follows owner links
  outwards and, at the first custom element, appends its shadow-host chain. Nodes created outside any
  component have no `owner`.
- The path is a snapshot of names shared per component instance: a node never
  holds its owner context (or that context's DOM) alive, and the names stay
  readable after the owner unmounts.
- `source` is the first creation-stack frame outside Purity: frames from
  `@purityjs/…` installs, Vite's `@purityjs_*` deps, this repository's
  `packages/<name>/{src,dist}` and the signals module's own file URL (which
  covers bundles that inline Purity under another name, such as Vite's shared
  `.vite/deps/<chunk>.js`) are skipped. V8's stack limit is raised to 64 frames
  for the capture. Capture is off by default because each creation then pays for
  one `new Error().stack`; `captureSources(true)` turns it on for nodes created
  afterwards, `captureSources(false)` turns it off, and a non-boolean argument
  throws `TypeError`.
- `version` stays `1`: the fields are additive and optional, so existing
  readers (the Vite devtools panel checks `version === 1`) keep working.
- Everything lives in the `__DEV__` block of `@purityjs/signals`; production
  builds drop it, and no `@purityjs/core` entry changes size.

## Intentional differences from Solid

- Names come from the custom element tag, not a `name` option on each
  primitive; Purity components are custom elements, so the tag is the name a
  developer already searches for. A per-primitive `name` option is not added.
- Source locations come from the runtime stack (opt-in), not compiler
  injection, so the JIT path and the strict AOT path behave the same and no
  build output changes.

## Acceptance tests

`packages/core/tests/inspect-attribution.test.ts`: nested custom elements
report `['outer', 'inner']` on the state and on the text-binding effect that
reads it; factory-called components report `['#root', '#owner']` at a root and keep the host chain above them inside a custom element; nodes
outside components have no owner; the path survives unmount; no source by
default; sources point at the test file (not Purity's `src`) while capture is
on and stop after it is turned off; a non-boolean argument throws.

## Later slices

The Vite devtools panel shows `owner` / `source`; a real transformed
application journey (seeded stale binding found through the panel); HMR
preserve-versus-reload behaviour for components, routes and shared state.

## Alternatives considered

**Compiler-injected locations.** Exact and free at run time, but only for AOT
templates and only for template bindings, not for `state()` calls in
component bodies; it would also change build output for every app.

**Holding a `WeakRef` to the owner context.** Gives a live tree, but the names
disappear once the context is collected, which is exactly when a leaked node
needs explaining.

**Always capturing stacks in development.** Simplest, but turns every signal
creation in dev into a stack capture; large lists would slow down noticeably.
