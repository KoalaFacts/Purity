# @purityjs/agent-store

SQLite persistence layer for Purity's self-improving agent control plane.

## Purpose

This package stores and retrieves:

- sessions and tasks,
- task event trajectories,
- memories,
- skills and skill versions,
- eval runs,
- user profiles,
- retrieval context results.

It is designed as the first runtime package on top of `@purityjs/agent-types`.

## Runtime

The implementation uses Node's built-in `node:sqlite` module, which is available in the Node 24 runtime this monorepo targets.

## Install

```bash
vp add @purityjs/agent-store
```

## Example

```ts
import { AgentStore, extractCandidatesForTask } from "@purityjs/agent-store";

const store = new AgentStore({ filename: ".agent/agent.db" });

store.putSession({
  id: "session_1",
  projectId: "purity",
  startedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
});

store.putMemory({
  id: "memory_1",
  scope: "project",
  projectId: "purity",
  kind: "repo",
  fact: "This repo uses Vite+ via vp.",
  confidence: 0.95,
  source: "trajectory",
  status: "active",
  createdAt: new Date().toISOString(),
});

const extraction = extractCandidatesForTask(store, "task_1");
if (!extraction.skipped) {
  console.log("candidate memories:", extraction.memoryRecords.length);
  console.log("candidate skills:", extraction.skillVersionRecords.length);
}
```

## Exports

- `AgentStore`
- `openAgentStore`
- `extractCandidatesForTask`
- `reviewCandidateSkillVersion`
- `reviewCandidateMemory`
- `migrateAgentStore`
- `getAgentStoreSchemaVersion`
- `AGENT_STORE_SCHEMA_VERSION`

## License

MIT
