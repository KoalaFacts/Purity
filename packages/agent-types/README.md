# @purityjs/agent-types

Shared TypeScript contracts for Purity's self-improving agent control plane.

## Purpose

This package defines the common vocabulary for future agent packages:

- task trajectories,
- memories,
- skills,
- eval datasets and runs,
- user profiles,
- retrieval inputs and outputs, including repo-path scoped memories.

It is intentionally dependency-free and runtime-light.

## Install

```bash
vp add @purityjs/agent-types
```

## Example

```ts
import type {
  EvalRun,
  MemoryRecord,
  RetrievalContext,
  SkillVersionRecord,
  TaskEvent,
  TaskRecord,
} from "@purityjs/agent-types";

const task: TaskRecord = {
  id: "task_123",
  sessionId: "session_1",
  title: "Pin GitHub Action SHAs",
  prompt: "use immutable tags in github actions",
  status: "completed",
  success: true,
  createdAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
};

const event: TaskEvent = {
  id: "evt_1",
  taskId: task.id,
  seq: 1,
  type: "file_edit",
  payload: { path: ".github/workflows/ci.yml" },
  createdAt: new Date().toISOString(),
};
```

## Exports

- `TaskRecord`
- `TaskEvent`
- `MemoryRecord`
- `SkillRecord`
- `SkillVersionRecord`
- `SkillInvocationRecord`
- `EvalDatasetRecord`
- `EvalCase`
- `EvalRun`
- `UserProfileRecord`
- `RetrievalContext`
- `RetrievalResult`

## License

MIT
