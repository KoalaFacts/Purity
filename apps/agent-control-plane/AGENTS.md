# @purityjs/agent-control-plane — AI Agent Context

CLI entry point for Purity's self-improving agent loop.

## Scope

- wires `@purityjs/agent-store` and `@purityjs/agent-evals` into runnable subcommands
- no domain logic of its own — delegates to library primitives

## Commands

```bash
vp test run                       # smoke tests
vp run --filter @purityjs/agent-control-plane test
```

## CLI usage

```text
agent-cp <command> [--db <path>] [args...]
```

| Command            | Purpose                                  |
| ------------------ | ---------------------------------------- |
| `extract`          | Extract candidates from a completed task |
| `review`           | Review pending candidates                |
| `evaluate`         | Run evals for a skill version            |
| `prune`            | Run maintenance pruning                  |
| `digest`           | Generate a review digest                 |
| `validate`         | Validate active skills for regressions   |
| `retrieve`         | Query retrieval service for task context |
| `loop`             | Run extract→review→evaluate in one step  |
| `create-eval-case` | Create eval case from a completed task   |
| `status`           | Show store summary                       |

## Important

- All domain logic lives in `@purityjs/agent-store` or `@purityjs/agent-evals`. Commands here are thin wrappers.
- Workspace deps use `"*"` versions, not `workspace:*` or semver pins.
- The `--db` flag defaults to `.agent/agent.db`.
