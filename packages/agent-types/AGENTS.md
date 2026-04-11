# @purityjs/agent-types — AI Agent Context

Shared contracts for Purity's self-improving agent system.

## Purpose

Defines TypeScript-only records for:

- sessions and tasks,
- task event trajectories,
- memories,
- skills and skill versions,
- eval datasets and runs,
- user profiles,
- retrieval context and results.

## Commands

```bash
vp build
```

## Important

- Keep this package dependency-free unless runtime validation becomes necessary.
- Prefer additive changes to preserve cross-package compatibility.
- Keep field names aligned with [docs/self-improving-agent.md](../../docs/self-improving-agent.md).
