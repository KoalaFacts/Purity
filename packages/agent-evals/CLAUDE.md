# @purityjs/agent-evals

Replay and scoring harness for Purity's self-improving agent system.

## Purpose

Implements:

- task-to-eval-case conversion
- skill-version dataset execution
- baseline comparisons for promotion gates
- aggregate scoring suitable for persisted eval runs

## Commands

```bash
vp build
vp test run
```

## Important

- Keep eval behavior deterministic and easy to audit.
- Reuse `@purityjs/agent-store` for persisted datasets, cases, and runs.
- Keep the package focused on evaluation mechanics, not scheduling or UI.
