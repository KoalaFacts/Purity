# @purityjs/agent-store

SQLite-backed persistence for the self-improving agent control plane.

## Rules

- Prefer explicit SQL over abstraction layers.
- Keep writes idempotent with `ON CONFLICT` upserts.
- Store structured payloads as JSON strings and parse them at the boundary.
- Retrieval should stay bounded and predictable; do not over-inject context.
