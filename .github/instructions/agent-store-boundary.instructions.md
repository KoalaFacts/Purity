---
description: "Use when editing SQLite store logic, migrations, retrieval ranking, extraction/review flows, or agent-store tests."
applyTo: "packages/agent-store/**"
---

# Agent Store Package Boundary

- Scope changes to [packages/agent-store](../../packages/agent-store).
- Follow package rules in [packages/agent-store/.github/copilot-instructions.md](../../packages/agent-store/.github/copilot-instructions.md).
- Use persistence and retrieval details from [packages/agent-store/CLAUDE.md](../../packages/agent-store/CLAUDE.md).
- Validate store changes with: vp run --filter @purityjs/agent-store test.
- Keep SQL explicit and reviewable; avoid opaque abstraction over core data flow.
