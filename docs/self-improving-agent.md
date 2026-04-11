# Self-Improving Agent Design for Purity

## Why this belongs in this repo

Purity does not currently have an application backend or agent runtime package. The monorepo is a library/tooling repo:

- `@purityjs/core`
- `@purityjs/vite-plugin`
- `@purityjs/cli`

That means a realistic first step is not "build an autonomous learning agent inside the framework." The realistic first step is:

1. define the system clearly,
2. keep the data model simple,
3. add strict promotion gates,
4. build the smallest control plane that can learn reusable skills safely.

This document is the design for that system.

## Goals

- Learn from completed tasks across sessions.
- Turn repeated successful trajectories into reusable skills.
- Improve retrieval over time with memory and user/project profiles.
- Evaluate generated skills before they affect future runs.
- Keep the system auditable and reversible.

## Non-goals

- Self-modifying model weights.
- Unreviewed prompt mutation in production.
- Permanent memory writes for every interaction.
- Automatic production code changes without evaluation or approval.

## System overview

The self-improving loop should be built around external state, not hidden model behavior.

The loop:

1. Capture task trajectories.
2. Extract candidate memories and skills from successful work.
3. Score those candidates with offline evals.
4. Promote only passing candidates.
5. Retrieve promoted skills and memories in future runs.
6. Prune or demote low-value artifacts over time.

## Recommended monorepo shape

Because this repo is currently libraries only, the cleanest future layout is:

```text
packages/
  core/
  vite-plugin/
  cli/
apps/
  agent-control-plane/   API + scheduler + review UI
packages/
  agent-types/           shared TS types for memory, skills, evals
  agent-store/           DB access layer
  agent-evals/           replay + scoring harness
```

The first shared package has been scaffolded as `packages/agent-types`. No runtime control plane is scaffolded yet.
The data and evaluation layers now exist as `packages/agent-store` and `packages/agent-evals`.

## Core concepts

### Trajectory

A trajectory is the full record of a task:

- prompt,
- relevant context,
- tool calls,
- edits,
- validations,
- final outcome,
- user corrections.

This is the raw material for later learning.

### Memory

A memory is a compact, retrievable fact that should influence future behavior.

Examples:

- "User prefers immutable GitHub Action SHAs."
- "This repo uses Vite+ via `vp`, not raw `vite`/`npm`."
- "Package-level docs and workflow files tend to drift together."

### Skill

A skill is a reusable instruction bundle derived from repeated successful work.

Examples:

- "Migrate a repo from Biome/npm scripts to Vite+."
- "Normalize GitHub Actions to immutable SHAs and update matching docs."
- "Generate or repair Purity package scaffolding to use `vite-plus`."

### Eval

An eval is a replay or benchmark proving a skill helps rather than harms.

Examples:

- exact-match checks for generated file edits,
- regression task suites,
- lint/test pass rate,
- user-accepted suggestion rate,
- rollback frequency.

## Data model

The safest MVP storage choice is SQLite plus local files.

Why:

- easy to inspect,
- easy to back up,
- zero infrastructure dependency,
- good enough until concurrency becomes a real problem.

### Tables

#### `sessions`

Tracks each user session.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT
);
```

#### `tasks`

One row per user request or agent task.

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  outcome_summary TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

#### `task_events`

Append-only event log for the trajectory.

```sql
CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

Suggested `type` values:

- `user_message`
- `assistant_message`
- `tool_call`
- `tool_result`
- `file_edit`
- `validation`
- `error`
- `user_feedback`

#### `memories`

Stores durable retrieval facts.

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id TEXT,
  user_id TEXT,
  repo_path TEXT,
  kind TEXT NOT NULL,
  fact TEXT NOT NULL,
  evidence_task_id TEXT,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Suggested `scope` values:

- `global`
- `project`
- `user`
- `repo_path`

Suggested `status` values:

- `candidate`
- `active`
- `demoted`
- `rejected`

#### `skills`

Represents a reusable skill family.

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `skill_versions`

Each generated or edited version of a skill.

```sql
CREATE TABLE skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_markdown TEXT NOT NULL,
  extraction_task_id TEXT,
  generator_model TEXT,
  status TEXT NOT NULL,
  eval_score REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES skills(id)
);
```

Suggested `status` values:

- `candidate`
- `approved`
- `active`
- `archived`
- `failed_eval`

#### `skill_invocations`

Tracks whether a skill actually helps in production use.

```sql
CREATE TABLE skill_invocations (
  id TEXT PRIMARY KEY,
  skill_version_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  user_accepted INTEGER,
  rollback_required INTEGER,
  notes TEXT,
  FOREIGN KEY (skill_version_id) REFERENCES skill_versions(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

#### `eval_datasets`

Named task sets used for regression.

```sql
CREATE TABLE eval_datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

#### `eval_cases`

The actual replayable tasks.

```sql
CREATE TABLE eval_cases (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  title TEXT NOT NULL,
  input_json TEXT NOT NULL,
  expected_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES eval_datasets(id)
);
```

#### `eval_runs`

Stores eval results for candidate skills and retrieval strategies.

```sql
CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  score REAL NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES eval_datasets(id)
);
```

#### `user_profiles`

Compact, curated preferences only.

```sql
CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## Storage layout

Recommended filesystem layout:

```text
.agent/
  agent.db
  trajectories/
    2026/
      04/
        task-<id>.json
  evals/
    datasets/
    runs/
  skills/
    drafts/
    active/
```

Use the database for indexing and state. Use JSON files for full-fidelity artifacts.

## Runtime flow

### 1. During a task

At task start:

- create `task`,
- attach current project and user scope,
- retrieve active memories and relevant active skill versions.

During task execution:

- append `task_events`,
- mark validations and user corrections explicitly,
- capture file diffs or command summaries.

At completion:

- mark `success`,
- generate a compact task summary,
- queue post-task extraction jobs.

### 2. Post-task extraction

Only run extraction if the task is:

- successful,
- non-trivial,
- not a pure one-off,
- not explicitly marked sensitive.

The extractor should emit:

- candidate memories,
- candidate skills,
- anti-pattern notes,
- possible user profile updates.

### 3. Evaluation

Every candidate skill version should run through:

- static checks,
- replay evals,
- regression tasks in the same domain,
- comparison against current baseline skill version.

If it loses to baseline, reject it.

### 4. Promotion

Promotion policy for MVP:

- memory candidates can auto-promote only above a high confidence threshold and only for low-risk categories,
- skill candidates require review plus passing evals,
- user profile changes require repeated evidence across multiple tasks.

## Retrieval strategy

At runtime, retrieval should be shallow and cheap.

Order:

1. current repo/project memories,
2. user preference memories,
3. active domain skills,
4. recent related task summaries,
5. only then full-text/semantic search over older trajectories.

Hard limits:

- maximum 3 promoted skills loaded by default,
- maximum 10 memories injected,
- maximum 2 prior trajectory summaries unless user asks for deep recall.

This avoids bloated prompts and false certainty.

## Skill generation policy

A generated skill must include:

- a name,
- a trigger condition,
- the reusable procedure,
- safety boundaries,
- validation steps,
- known failure modes.

### Good generated skill

```md
# Migrate GitHub workflows to immutable action SHAs

Use when:

- repo has GitHub Actions workflows using floating `@vN` tags

Procedure:

1. list every `uses:` entry
2. resolve exact release commit SHAs
3. patch workflows and matching documentation snippets
4. verify no `uses: ...@vN` references remain

Validate:

- `rg "uses:\\s+[^@\\s]+@v[0-9]" .github`

Do not use when:

- org policy requires major tags instead of SHAs
```

### Bad generated skill

- generic advice,
- no trigger,
- no validation,
- no stop conditions,
- no evidence.

## Eval design

The eval loop should test both usefulness and safety.

### Metrics

- task success rate,
- lint/test/build pass rate,
- diff size,
- user correction rate,
- rollback rate,
- repeated follow-up rate,
- retrieval precision,
- time-to-completion.

### Eval classes

#### Replay evals

Re-run historical tasks with the candidate skill loaded and compare against the accepted outcome.

#### Regression evals

Ensure old successful tasks do not degrade after new memory or skill promotion.

#### Safety evals

Test whether the system over-applies a skill outside its valid domain.

## Background jobs

The system only needs a few jobs at first.

### `post_task_extract`

Trigger:

- after successful tasks

Work:

- summarize trajectory,
- emit candidate memories,
- emit candidate skills,
- emit candidate user profile changes.

### `nightly_eval`

Trigger:

- nightly

Work:

- evaluate all new candidate skills,
- compare against active baseline,
- mark pass/fail.

### `weekly_prune`

Trigger:

- weekly

Work:

- remove duplicate candidate memories,
- demote low-value memories,
- archive inactive skills,
- compact old trajectories into summaries.

### `monthly_review_digest`

Trigger:

- monthly

Work:

- list best promoted skills,
- list rejected skills and why,
- show drift and stale memory hotspots.

## Safety rules

These should be enforced from day one.

- Never let generated skills overwrite core system instructions automatically.
- Never auto-promote skills based only on a single success.
- Never store secrets in memory.
- Never store permanent user profile facts from one ambiguous interaction.
- Keep full lineage from skill version to source task.
- Every promoted artifact must be reversible.

## MVP implementation plan

This is the smallest version worth building.

### Phase 1: Capture and review

Build:

- SQLite schema,
- task and event logger,
- post-task summarizer,
- candidate memory table,
- candidate skill drafts,
- simple review CLI or web page.

Success criteria:

- every non-trivial task can be replayed as a structured trajectory,
- candidate skills can be reviewed before activation.

Current status in this repo:

- implemented in `packages/agent-store`: SQLite schema, task/event logging, task completion helpers, post-task summaries, candidate extraction, single-item review helpers, and batch review reporting
- implemented in `apps/agent-control-plane`: CLI (`agent-cp`) with subcommands for `extract`, `review`, `evaluate`, `prune`, `digest`, `validate`, `retrieve`, and `status` — wires together store and eval primitives
- full-pipeline integration test in `packages/agent-evals/tests/pipeline.test.ts` exercises the complete loop: capture → extract → review → evaluate → retrieve → prune → digest
- still missing: a web-based review UI for richer candidate inspection

### Phase 2: Retrieval

Build:

- retrieval service for active memories and skills,
- project/user scoping,
- full-text search over summaries.

Success criteria:

- future tasks load only relevant high-signal context,
- prompt size stays bounded.

Current status in this repo:

- implemented in `packages/agent-store`: scoped retrieval for active memories and skills, trajectory-aware summary lookup, and FTS5 full-text search index over task titles, prompts, outcome summaries, and event payloads (schema v2). Tasks are auto-indexed on completion via `completeTask`, and pre-existing tasks are back-filled during migration.
- exposed via CLI: `agent-cp retrieve` command queries the retrieval service for scoped memories, skills, and FTS summaries given a project/user/query context
- still missing: semantic (embedding-based) indexing for larger datasets

### Phase 3: Evals and promotion

Build:

- eval dataset format,
- replay harness,
- pass/fail thresholds,
- promotion workflow.

Success criteria:

- no candidate skill becomes active without measured improvement.

Current status in this repo:

- implemented in `packages/agent-store`: eval datasets/cases/runs storage, threshold-based review helpers, and candidate-to-active or failed-eval transitions
- implemented in `packages/agent-evals`: scoring harness (`runSkillVersionEval`) with per-case scoring, aggregate pass/fail, baseline comparison (`compareSkillVersionToBaseline`), and promotion orchestrator (`promoteWithEval`, `promoteWithBaselineComparison`) that chains eval runs to automatic promotion decisions
- still missing: replay execution logic (the scorer is caller-provided) and automated nightly evaluation scheduling

### Phase 4: Scheduled maintenance

Build:

- nightly eval runner,
- weekly prune runner,
- review digests.

Success criteria:

- system quality improves without unbounded state growth.

Current status in this repo:

- implemented in `packages/agent-store`: prune primitives (`deduplicateMemories`, `demoteStaleCandidates`, `archiveInactiveSkills`, `compactOldTasks`), combined `pruneStore` runner, and review digest generation (`generateReviewDigest`)
- implemented in `packages/agent-evals`: post-prune validation (`validateActiveSkills`) that re-evaluates all active skill versions against their latest eval dataset and detects regressions
- still missing: scheduled execution (nightly/weekly cron)

## What to implement first in this repo

The first concrete package in this repo should be:

```text
packages/agent-types
```

Why first:

- no infra commitment,
- immediately useful,
- stabilizes the vocabulary before implementation,
- gives later packages a shared contract.

That package now exists and should remain the shared contract layer for everything that follows.

After that:

```text
packages/agent-store
packages/agent-evals
apps/agent-control-plane
```

The store layer has now been scaffolded as `packages/agent-store` using SQLite and typed repositories.
The eval layer now exists as `packages/agent-evals` with replay-case generation and dataset scoring helpers.

## Recommendation

Do not start with "full self-improving agent."

Start with:

- trajectory capture,
- candidate skill generation,
- strict eval gate,
- reviewed promotion,
- bounded retrieval.

That is the smallest architecture that produces compounding value without turning into prompt drift or garbage-memory accumulation.
