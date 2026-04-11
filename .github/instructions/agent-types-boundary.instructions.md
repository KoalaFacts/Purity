---
description: "Use when editing self-improving agent contract types, shared records, retrieval types, or serialization-safe interfaces."
applyTo: "packages/agent-types/**"
---

# Agent Types Package Boundary

- Scope changes to [packages/agent-types](../../packages/agent-types).
- Follow package rules in [packages/agent-types/.github/copilot-instructions.md](../../packages/agent-types/.github/copilot-instructions.md).
- Use schema and compatibility notes from [packages/agent-types/CLAUDE.md](../../packages/agent-types/CLAUDE.md).
- Validate contract changes with: vp run --filter @purityjs/agent-types test.
- Keep contracts serializable and backwards-compatible where possible.
