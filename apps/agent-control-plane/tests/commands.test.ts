import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AgentStore } from "@purityjs/agent-store";
import { extract } from "../src/commands/extract";
import { review } from "../src/commands/review";
import { prune } from "../src/commands/prune";
import { digest } from "../src/commands/digest";
import { status } from "../src/commands/status";
import { retrieve } from "../src/commands/retrieve";
import { loop } from "../src/commands/loop";
import { createEvalCase } from "../src/commands/create-eval-case";

describe("control-plane commands", () => {
  let store: AgentStore | undefined;
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  afterEach(() => {
    store?.close();
    store = undefined;
    logSpy.mockClear();
  });

  function seedSuccessfulTask(s: AgentStore): void {
    s.putSession({
      id: "sess_smoke",
      projectId: "proj_smoke",
      userId: "user_smoke",
      startedAt: "2026-04-11T10:00:00.000Z",
      createdAt: "2026-04-11T10:00:00.000Z",
    });

    s.putTask({
      id: "task_smoke",
      sessionId: "sess_smoke",
      title: "Smoke test task",
      prompt: "run the smoke test scenario",
      status: "completed",
      success: true,
      outcomeSummary: "Smoke test completed successfully.",
      createdAt: "2026-04-11T10:00:01.000Z",
      completedAt: "2026-04-11T10:05:00.000Z",
    });

    s.appendTaskEvent({
      id: "evt_smoke_1",
      taskId: "task_smoke",
      seq: 1,
      type: "tool_call",
      payload: { tool: "grep_search" },
      createdAt: "2026-04-11T10:01:00.000Z",
    });

    s.appendTaskEvent({
      id: "evt_smoke_2",
      taskId: "task_smoke",
      seq: 2,
      type: "file_edit",
      payload: { path: "src/main.ts" },
      createdAt: "2026-04-11T10:02:00.000Z",
    });

    s.appendTaskEvent({
      id: "evt_smoke_3",
      taskId: "task_smoke",
      seq: 3,
      type: "validation",
      payload: { command: "vp test" },
      createdAt: "2026-04-11T10:03:00.000Z",
    });
  }

  it("extract prints candidates from a successful task", async () => {
    store = new AgentStore();
    seedSuccessfulTask(store);

    await extract(store, ["task_smoke"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Extraction complete");
    expect(output).toContain("Memories extracted: 1");
    expect(output).toContain("Skills extracted:   1");
  });

  it("extract reports skipped for unknown task", async () => {
    store = new AgentStore();

    await extract(store, ["nonexistent"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("skipped");
  });

  it("review runs on empty store without error", async () => {
    store = new AgentStore();

    await review(store, []);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Review report:");
    expect(output).toContain("Memories reviewed:  0");
  });

  it("prune runs on empty store without error", async () => {
    store = new AgentStore();

    await prune(store, []);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Prune report:");
  });

  it("digest runs on empty store without error", async () => {
    store = new AgentStore();

    await digest(store, []);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Review Digest");
  });

  it("status shows counts on empty store", async () => {
    store = new AgentStore();

    await status(store, []);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Agent Store Status");
    expect(output).toContain("Active:      0");
  });

  it("status shows counts after extraction and promotion", async () => {
    store = new AgentStore();
    seedSuccessfulTask(store);

    await extract(store, ["task_smoke"]);
    logSpy.mockClear();

    await status(store, []);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Candidate:   1");
  });

  it("retrieve finds promoted context", async () => {
    store = new AgentStore();
    seedSuccessfulTask(store);

    // Extract then review to promote memory
    await extract(store, ["task_smoke"]);
    await review(store, []);
    logSpy.mockClear();

    await retrieve(store, ["--project", "proj_smoke", "smoke"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Memories");
  });

  it("retrieve shows no results for unknown project", async () => {
    store = new AgentStore();

    await retrieve(store, ["--project", "unknown", "query"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No relevant context found");
  });

  it("loop runs extract→review→skip eval for a task", async () => {
    store = new AgentStore();
    seedSuccessfulTask(store);

    await loop(store, ["task_smoke"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("[1/4] Extracting");
    expect(output).toContain("[2/4] Skipping eval case creation");
    expect(output).toContain("[3/4] Reviewing");
    expect(output).toContain("[4/4] Skipping evaluation");
    expect(output).toContain("Loop complete");
  });

  it("loop with --dataset creates eval case and evaluates", async () => {
    store = new AgentStore();
    seedSuccessfulTask(store);

    store.putEvalDataset({
      id: "ds_loop",
      name: "loop test dataset",
      scope: "project",
      createdAt: "2026-04-11T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
    });

    await loop(store, ["task_smoke", "--dataset", "ds_loop"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("[1/4] Extracting");
    expect(output).toContain("[2/4] Creating eval case");
    expect(output).toContain("[3/4] Reviewing");
    expect(output).toContain("[4/4] Evaluating");
    expect(output).toContain("Loop complete");
  });

  it("create-eval-case creates a case from a completed task", async () => {
    store = new AgentStore();
    seedSuccessfulTask(store);

    store.putEvalDataset({
      id: "ds_eval",
      name: "eval case test",
      scope: "project",
      createdAt: "2026-04-11T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
    });

    await createEvalCase(store, ["task_smoke", "--dataset", "ds_eval"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Eval case created:");
    expect(output).toContain("Dataset:  ds_eval");
    expect(output).toContain("Task:     task_smoke");
  });
});
