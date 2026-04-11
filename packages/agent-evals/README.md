# @purityjs/agent-evals

Replay and scoring helpers for Purity's self-improving agent control plane.

## Scope

- build replayable eval cases from stored tasks
- execute eval datasets against candidate skill versions
- persist aggregate eval runs back into `@purityjs/agent-store`
- compare candidate skills to active baselines
- orchestrate eval-gated promotion workflows

## Commands

```bash
vp build
vp test run
```

## API

### Eval primitives

- `createEvalCaseFromTask(store, taskId, options)` — converts a completed task into a replayable eval case
- `runSkillVersionEval(store, options)` — runs a caller-provided executor against all cases in a dataset, persists an `EvalRun`
- `compareSkillVersionToBaseline(store, options)` — head-to-head comparison of candidate vs baseline skill version

### Promotion orchestrator

- `promoteWithEval(store, options)` — runs eval then auto-promotes or rejects the candidate via `reviewCandidateSkillVersion`
- `promoteWithBaselineComparison(store, options)` — runs comparative eval, only promotes if candidate outperforms baseline; auto-discovers active baseline when `baselineSkillVersionId` is omitted
