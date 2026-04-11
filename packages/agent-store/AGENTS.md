# @purityjs/agent-store — AI Agent Context

SQLite persistence layer for Purity's self-improving agent system.

## Scope

- schema migration
- session, task, and event persistence
- memory and skill persistence
- eval and profile persistence
- bounded retrieval for runtime context injection

## Commands

```bash
vp build
vp test run
```

## Important

- Use `node:sqlite`; do not add an ORM.
- Keep schema names aligned with [docs/self-improving-agent.md](../../docs/self-improving-agent.md).
- Preserve additive schema evolution and keep migration entry points explicit.
