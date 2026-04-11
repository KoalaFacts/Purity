---
description: "Use when editing agent control-plane CLI commands, CLI entry point, or control-plane build scripts."
applyTo: "apps/agent-control-plane/**"
---

# Agent Control-Plane Boundary

- Scope changes to [apps/agent-control-plane](../../apps/agent-control-plane).
- Commands wire together primitives from `@purityjs/agent-store` and `@purityjs/agent-evals` — do not duplicate library logic.
- Keep command handlers thin: parse args, call library, print results.
- Validate with: `vp run --filter @purityjs/agent-control-plane test` and `vp check --fix`.
- Use `*` version references for workspace dependencies.
- Refer to store API in [packages/agent-store/CLAUDE.md](../../packages/agent-store/CLAUDE.md) and evals API in [packages/agent-evals/CLAUDE.md](../../packages/agent-evals/CLAUDE.md).
