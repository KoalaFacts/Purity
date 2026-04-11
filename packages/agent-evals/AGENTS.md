# @purityjs/agent-evals - AI Agent Context

Replay and scoring harness for Purity's self-improving agent system.

## Scope

- build replay cases from stored trajectories
- run eval datasets against skill versions
- compare candidate skills to baselines
- persist eval results through `@purityjs/agent-store`

## Commands

```bash
vp build
vp test run
```

## Important

- Keep eval execution explicit and deterministic.
- Treat `@purityjs/agent-store` as the persistence boundary; do not duplicate storage logic here.
- Keep metrics serializable and aligned with [docs/self-improving-agent.md](../../docs/self-improving-agent.md).
