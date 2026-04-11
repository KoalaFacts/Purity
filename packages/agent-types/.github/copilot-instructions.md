# @purityjs/agent-types — Copilot Instructions

Shared TypeScript contracts for the self-improving agent system.

## Key Rules

- Prefer serializable records and string unions.
- Do not add runtime dependencies unless validation becomes necessary.
- Keep names aligned with the control-plane design in `docs/self-improving-agent.md`.
- Favor additive schema evolution over breaking renames.
