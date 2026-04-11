---
description: "Use when editing Vite plugin transform logic, html template compilation hooks, plugin tests, or plugin type declarations."
applyTo: "packages/vite-plugin/**"
---

# Vite Plugin Package Boundary

- Scope changes to [packages/vite-plugin](../../packages/vite-plugin).
- Follow package rules in [packages/vite-plugin/.github/copilot-instructions.md](../../packages/vite-plugin/.github/copilot-instructions.md).
- Use transform and test guidance from [packages/vite-plugin/CLAUDE.md](../../packages/vite-plugin/CLAUDE.md).
- Validate plugin changes with: vp run --filter @purityjs/vite-plugin test.
- Keep plugin behavior aligned with core compiler contracts; avoid duplicating core logic in plugin tests.
