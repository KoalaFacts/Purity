# Copilot Instructions For @purityjs/agent-evals

## Purpose

`@purityjs/agent-evals` owns replay-case generation and dataset scoring for Purity's self-improving agent flow.

## Rules

- Read and write persisted datasets, eval cases, and eval runs through `@purityjs/agent-store`.
- Keep eval execution deterministic, serializable, and easy to audit.
- Prefer small aggregate metrics over free-form logs in persisted eval runs.
- Do not add scheduling, background jobs, or UI concerns to this package.

## Validation

- `vp run --filter @purityjs/agent-evals build`
- `vp run --filter @purityjs/agent-evals test`
