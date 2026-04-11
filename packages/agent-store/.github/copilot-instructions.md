# @purityjs/agent-store — Copilot Instructions

SQLite persistence package for the self-improving agent system.

## Key Rules

- Prefer direct SQL and typed boundary mapping.
- Use `node:sqlite`, not a third-party ORM.
- Keep retrieval bounded by explicit limits.
- Preserve schema compatibility and make migrations forward-only.
