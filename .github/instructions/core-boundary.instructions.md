---
description: "Use when editing Purity core runtime/compiler code, templates, signals, controls, components, or core tests."
applyTo: "packages/core/**"
---

# Core Package Boundary

- Scope changes to [packages/core](../../packages/core).
- Follow package rules in [packages/core/.github/copilot-instructions.md](../../packages/core/.github/copilot-instructions.md).
- Use implementation details and examples from [packages/core/CLAUDE.md](../../packages/core/CLAUDE.md).
- Validate core-only changes with: vp run --filter @purityjs/core test.
- For syntax/operator behavior, preserve Purity template conventions documented by the package.
