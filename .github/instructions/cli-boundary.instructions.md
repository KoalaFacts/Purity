---
description: "Use when editing CLI scaffolding, project templates, command handling, or CLI package tests/build scripts."
applyTo: "packages/cli/**"
---

# CLI Package Boundary

- Scope changes to [packages/cli](../../packages/cli).
- Follow package rules in [packages/cli/.github/copilot-instructions.md](../../packages/cli/.github/copilot-instructions.md).
- Use generator and local-dev patterns from [packages/cli/CLAUDE.md](../../packages/cli/CLAUDE.md).
- Validate CLI changes with: vp run --filter @purityjs/cli test.
- Keep generated templates consistent with workspace-wide Vite+ conventions.
