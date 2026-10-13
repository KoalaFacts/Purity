# 0052: Register server resource handling at SSR entry

**Status:** Proposed
**Date:** 2026-10-13

## Context

After ADR 0051, client resources still retain server promise registration,
boundary cancellation, and multipass cache handling. These implementations
are referenced directly by `resource` and `lazyResource`, so moving public
exports alone cannot remove them from client applications.

## Decision

Move server resource handling into `resource/ssr.ts`. Install its stateless
dispatch table inside `pushSSRRenderContext`, alongside server control-flow
registration. The table never stores the active context, request, or resource.
Pass the current context explicitly on each dispatch, preserving nested
render ownership. Registration must not run at module evaluation time.

Share retry normalization and execution through `resource/retry.ts`. Keep
option reads, hydration-cache consumption, state initialization, client
watching, polling, mutation, and component-state binding in their current
order. Server resource accessors keep their existing no-op mutation,
refresh, and disposal methods. Lazy server fetching still requires a key
and retains its existing retry behavior.

Preserve request and boundary cancellation, late-rejection observation,
boundary-scoped pending keys, source-error handling, and cached error/initial
value behavior. No public import or renderer integration changes are needed.

## Consequences

Client root, router, and query entries shrink. Their budgets are lowered;
the combined API retains its original limits. The combined API grows
slightly because it includes the dispatch mechanism as well as the server
implementation. This is client dependency removal, not an execution-speed
claim or elimination of all SSR coordination from client code.

Existing resource, hydration, cancellation, and streaming tests cover the
preserved behaviors. A nested-context test checks registration ownership and
the return to client behavior. A production resource fixture measures eager
and lazy loading in both JIT and AOT modes, with browser interaction checks.
Streaming retention checks verify settled resources are still released.
