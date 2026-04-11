# @purityjs/agent-types

Shared TypeScript contracts for the self-improving agent control plane.

## Scope

- task/session records
- trajectory events
- memory and skill records
- eval datasets and runs
- retrieval contracts

## Rules

- Keep the package dependency-free.
- Prefer plain serializable types.
- Avoid mixing storage concerns with domain naming.
- Keep field names stable once other packages depend on them.
