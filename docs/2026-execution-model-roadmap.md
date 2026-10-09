# Execution-model roadmap: modes Purity doesn't cover yet

**Status:** Research note — not an ADR. Survey of execution modes that
competing frameworks ship and Purity currently does not, produced while
scoping cross-framework benchmark comparisons.
**Date:** 2026-10-09

## Purpose

Purity's current execution surface is: client-side reactive rendering,
string/streaming SSR with Suspense boundaries, islands (opt-in partial
hydration), and conventional hydration (the client re-runs component
factories and walks the SSR DOM via `DeferredTemplate` — see
[`packages/core/src/compiler/hydrate-runtime.ts`](../packages/core/src/compiler/hydrate-runtime.ts)).

This note inventories execution modes other frameworks offer that
Purity does not, so the gap is a documented, falsifiable list instead
of a vague "be more capable" aspiration. Nothing here is scheduled or
designed. Each item needs its own `superpowers:brainstorming` pass —
sized, scoped, and reviewed against the "Three similar lines is better
than a premature abstraction" principle in [`CLAUDE.md`](../CLAUDE.md)
— before any implementation starts. Do not treat the execution-plan
sketches below as approved designs.

## How to use this document

1. Pick one item.
2. Re-verify the "why it's different" claim against the current source
   of the comparison framework — these move fast and this is a
   snapshot.
3. Run a dedicated brainstorming session to turn the sketch into a real
   design: what changes in `packages/core`, what's the bundle-size
   budget impact, what's the opt-in/opt-out story, what breaks.
4. Only then draft an ADR and start implementation.

## Gap 1 — Resumability (Qwik's model)

**What it is:** Qwik serializes application state and event-handler
references into the SSR HTML itself. The client ships no component
"setup" code up front; on first interaction it lazy-loads only the
handler chunk needed (a QRL), resolves closures from the serialized
state, and never re-runs component factories wholesale. There is no
hydration pass in the conventional sense — nothing walks the whole
tree re-attaching listeners before the page is interactive.

**Why Purity doesn't have this:** Purity's hydration
(`hydrate-runtime.ts`) re-runs the compiled component factory against
the SSR DOM subtree it owns, via `DeferredTemplate`/`HydrateFactory`.
That's conventional hydration — cheaper than non-island frameworks
because of islands' trigger-based partial hydration, but every
hydrated island still re-executes its own setup code. There's no
closure-serialization or lazy per-handler chunk loading.

**Why this is a real gap, not a detail:** Resumability changes the
asymptotic cost model — time-to-interactive stops scaling with
component-tree size. Islands narrow Purity's hydration cost but don't
change that scaling; a resumable island of the same size has flatter
cost growth. This is architecturally the biggest single item on this
list.

**Rough scope if ever pursued:** New serialization format for
closures/state in SSR output, a lazy-chunk-loading client runtime
distinct from the current hydration runtime, compiler support for
splitting event handlers into independently loadable chunks, and a
story for how this composes with (or replaces) islands. This is not an
incremental patch to `hydrate-runtime.ts` — it is close to a second
execution mode living alongside the first.

**Needs brainstorming on:** whether this is opt-in per-island (coexists
with current hydration) or a wholesale replacement; how it interacts
with the existing compiler pipeline (`packages/core/src/compiler`);
bundle-size budget impact of a second runtime path; whether Purity's
"21 functions" surface-area goal survives the new API this requires.

## Gap 2 — Server-driven interactivity (Blazor Interactive Server's model)

**What it is:** The component tree runs entirely on the server. The
client is a thin terminal: user events go over a persistent connection
(Blazor uses SignalR/WebSocket) to the server, which re-renders and
sends back a DOM diff. No framework runtime logic executes
client-side beyond applying diffs and forwarding events.

**Why Purity doesn't have this:** Purity has no persistent-connection
transport and no server-side "apply this diff to the live client DOM"
protocol. `renderToStream`/`renderToString` produce a one-shot
response; after that, interactivity is entirely local (plain
hydration or islands) or absent (`renderStatic`).

**Why this is a real gap:** This is a genuinely different
latency/cost trade: every interaction pays a network round trip, but
the client ships near-zero framework code and the server holds all
state. It suits weak clients and data-sensitive UIs; it does not suit
offline-tolerant or latency-sensitive interactions. Purity's lineage
(signals + local reactive graph) doesn't naturally decompose into this
model — the entire point of the current design is that updates
propagate without a server round trip.

**Rough scope if ever pursued:** A persistent transport (WebSocket or
SSE-plus-POST), a server-side process holding one live reactive graph
per connected client, a diffing/patch protocol, and explicit
backpressure/reconnect/session-affinity handling for the
scaling story (this is the operationally hardest part — it requires
sticky sessions or a shared-state store, unlike the current stateless
SSR model).

**Needs brainstorming on:** whether this is in scope for Purity at all
given it inverts the framework's core local-first premise; if pursued,
whether it's a separate package (`@purityjs/live`?) rather than
touching `@purityjs/core`/`@purityjs/ssr`; session/scaling story before
any prototype is worth building.

## Gap 3 — Hybrid start-server-then-upgrade (Blazor Interactive Auto's model)

**What it is:** Starts in the server-driven mode above, then swaps to
a fully client-resident mode once the client-side runtime finishes
downloading in the background — trading an initial network-latency
interaction cost for a smaller first payload, converging to local
execution.

**Why Purity doesn't have this:** This mode is downstream of Gap 2 —
it requires the server-driven transport to exist as a starting state,
then a handoff protocol to the existing client-local execution. It is
not meaningfully separable from Gap 2.

**Needs brainstorming on:** not worth scoping independently until/unless
Gap 2 is pursued and lands.

## Explicitly out of scope for this note

- **Implementing any of these now.** This is an inventory, not a plan.
- **Qwik/Blazor benchmark numbers.** Cross-paradigm comparisons (local
  signal graph vs. resumability vs. server-driven diffing) measure
  different things; see the apples-to-apples framing in
  [`framework-capabilities.md`](./framework-capabilities.md) before
  trying to put these on one chart.

## Re-verify cadence

Re-check each "why it's different" claim against the comparison
framework's current source before starting a brainstorming session for
that item — Qwik and Blazor are both under active development and
their execution models can shift (e.g. Blazor added `RenderInfo` mode
detection and forced-static-in-interactive-context in .NET 9).
