# 0051: Register server control-flow rendering at SSR entry

**Status:** Proposed
**Date:** 2026-10-13

## Context

ADR 0050 separates public entry points, but client `each`, `match`, `when`,
and `suspense` still referenced their server implementations directly.
Tree-shaking could not remove server string builders and streaming boundary
handling while retaining these client functions.

## Decision

Move the server control-flow implementations into `control/ssr.ts` and the
shared duplicate-key diagnostic into `control/keys.ts`. Keep client DOM
reconciliation and hydration in `control.ts`. Preserve public imports:
explicit server variants remain available from `@purityjs/core/internal`.

Initialize a typed dispatch table inside `pushSSRRenderContext`, before the
context becomes active. Client control functions consult the table only when
an SSR context is active. The table contains stateless functions, never a
request or boundary context; nested and concurrent render passes continue to
use the existing context stack. Do not register at module evaluation time,
because a side effect would keep the server implementations in client bundles.

Preserve the existing rendering bodies and their ordering: comment markers,
raw-text spans, duplicate keys, error reporting, fallback ownership, streaming
registration, and cancellation all retain their prior behavior. Client
`suspense` still calls only its view. Client `list` is unchanged; its explicit
server counterpart moves with the other server builders.

## Consequences

The root and control-flow application bundles become smaller. The combined
API grows slightly from the dispatch mechanism and stays within its existing
budget. Lower the root budget to retain the measured improvement. All other
limits remain unchanged.

Server resource handling and component rendering are separate remaining
boundaries. This decision does not move their implementations or change the
SSR npm package's API. Existing conformance, streaming/cancellation, and
browser hydration tests validate the extraction.

## Alternatives considered

Top-level registration would defeat tree-shaking. Environment checks against
`window` or `document` would break SSR in DOM-enabled environments. Separate
client/server public control APIs would change user code and duplicate the
existing internal server variants unnecessarily.
