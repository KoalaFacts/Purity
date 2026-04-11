/**
 * Seeds the agent database with a realistic completed task
 * so the control-plane CLI can be exercised end-to-end.
 *
 * Usage: vp exec tsx scripts/seed-agent-db.ts [--db <path>]
 */
import { openAgentStore } from "@purityjs/agent-store";

const args = process.argv.slice(2);
const dbIdx = args.indexOf("--db");
const dbPath = dbIdx >= 0 && args[dbIdx + 1] ? args[dbIdx + 1] : ".agent/agent.db";

const store = openAgentStore({ filename: dbPath, migrate: true });

try {
  // 1. Create a session
  store.putSession({
    id: "sess_demo_001",
    projectId: "proj_purity",
    userId: "developer",
    startedAt: "2026-04-11T09:00:00.000Z",
    createdAt: "2026-04-11T09:00:00.000Z",
  });
  console.log("✓ Session created: sess_demo_001");

  // 2. Create a completed task
  store.putTask({
    id: "task_demo_001",
    sessionId: "sess_demo_001",
    title: "Add signal batch update API",
    prompt:
      "Add a batchUpdate() function to the signals module that defers effect execution until all writes complete, preventing glitches during multi-signal updates.",
    status: "completed",
    success: true,
    outcomeSummary:
      "Added batchUpdate() to signals.ts. It wraps writes in a transaction scope that defers watcher notifications. All 24 signal tests pass. Diamond dependency test confirms glitch-free behavior.",
    createdAt: "2026-04-11T09:00:01.000Z",
    completedAt: "2026-04-11T09:15:00.000Z",
  });
  console.log("✓ Task created: task_demo_001");

  // 3. Append realistic events
  store.appendTaskEvent({
    id: "evt_001",
    taskId: "task_demo_001",
    seq: 1,
    type: "tool_call",
    payload: { tool: "grep_search", query: "batch.*update|transaction" },
    createdAt: "2026-04-11T09:01:00.000Z",
  });

  store.appendTaskEvent({
    id: "evt_002",
    taskId: "task_demo_001",
    seq: 2,
    type: "tool_call",
    payload: { tool: "read_file", path: "packages/core/src/signals.ts" },
    createdAt: "2026-04-11T09:02:00.000Z",
  });

  store.appendTaskEvent({
    id: "evt_003",
    taskId: "task_demo_001",
    seq: 3,
    type: "file_edit",
    payload: { path: "packages/core/src/signals.ts", lines: 12 },
    createdAt: "2026-04-11T09:05:00.000Z",
  });

  store.appendTaskEvent({
    id: "evt_004",
    taskId: "task_demo_001",
    seq: 4,
    type: "file_edit",
    payload: { path: "packages/core/tests/signals.test.ts", lines: 20 },
    createdAt: "2026-04-11T09:08:00.000Z",
  });

  store.appendTaskEvent({
    id: "evt_005",
    taskId: "task_demo_001",
    seq: 5,
    type: "validation",
    payload: { command: "vp test run", passed: true, tests: 24, duration: 52 },
    createdAt: "2026-04-11T09:12:00.000Z",
  });
  console.log("✓ 5 events appended");

  // 4. Complete the task (triggers FTS indexing)
  store.completeTask("task_demo_001", {
    success: true,
    outcomeSummary:
      "Added batchUpdate() to signals.ts. Defers watcher notifications during multi-signal writes. All 24 signal tests pass.",
    completedAt: "2026-04-11T09:15:00.000Z",
  });
  console.log("✓ Task completed and FTS-indexed");

  // 5. Create an eval dataset for later use
  store.putEvalDataset({
    id: "ds_core_signals",
    name: "Core signals regression suite",
    scope: "project",
    createdAt: "2026-04-11T09:16:00.000Z",
    updatedAt: "2026-04-11T09:16:00.000Z",
  });
  console.log("✓ Eval dataset created: ds_core_signals");

  console.log("\nSeed complete. Run agent-cp commands now:");
  console.log("  vp exec tsx apps/agent-control-plane/src/cli.ts status");
  console.log(
    "  vp exec tsx apps/agent-control-plane/src/cli.ts loop task_demo_001 --dataset ds_core_signals",
  );
} finally {
  store.close();
}
