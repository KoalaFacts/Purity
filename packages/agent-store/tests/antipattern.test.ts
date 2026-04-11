import { afterEach, describe, expect, it } from "vite-plus/test";
import type { SessionRecord, TaskRecord } from "@purityjs/agent-types";
import { AgentStore, extractAntiPatternsForTask, listAntiPatterns } from "../src/index";

describe("anti-pattern extraction", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  function seedFailedTask(
    s: AgentStore,
    taskId: string,
    opts: { sessionId?: string; title?: string; outcomeSummary?: string } = {},
  ): void {
    const sessionId = opts.sessionId ?? "sess_ap";

    if (!s.getSession(sessionId)) {
      const session: SessionRecord = {
        id: sessionId,
        projectId: "purity",
        userId: "user_ap",
        startedAt: "2026-04-11T10:00:00.000Z",
        createdAt: "2026-04-11T10:00:00.000Z",
      };
      s.putSession(session);
    }

    const task: TaskRecord = {
      id: taskId,
      sessionId,
      title: opts.title ?? "Broken migration",
      prompt: "apply migration to production schema",
      status: "completed",
      success: false,
      outcomeSummary: opts.outcomeSummary ?? "Migration failed due to FK violation.",
      createdAt: "2026-04-11T10:00:01.000Z",
      completedAt: "2026-04-11T10:00:10.000Z",
    };
    s.putTask(task);
  }

  it("extracts anti-pattern from a failed task with error events", () => {
    store = new AgentStore();
    seedFailedTask(store, "task_ap1");

    store.appendTaskEvent({
      id: "evt_ap1_1",
      taskId: "task_ap1",
      seq: 1,
      type: "tool_call",
      payload: { tool: "run_in_terminal", command: "vp run migrate" },
      createdAt: "2026-04-11T10:00:02.000Z",
    });

    store.appendTaskEvent({
      id: "evt_ap1_2",
      taskId: "task_ap1",
      seq: 2,
      type: "error",
      payload: { message: "FOREIGN KEY constraint failed on column user_id" },
      createdAt: "2026-04-11T10:00:03.000Z",
    });

    let idCounter = 0;
    const result = extractAntiPatternsForTask(store, "task_ap1", {
      now: "2026-04-11T10:00:20.000Z",
      idFactory: () => {
        idCounter += 1;
        return String(idCounter);
      },
    });

    expect(result.skipped).toBe(false);
    expect(result.antiPatterns).toHaveLength(1);

    const ap = result.antiPatterns[0]!;
    expect(ap.kind).toBe("anti_pattern");
    expect(ap.status).toBe("candidate");
    expect(ap.evidenceTaskId).toBe("task_ap1");
    expect(ap.fact).toContain("Avoid: Broken migration");
    expect(ap.fact).toContain("FOREIGN KEY constraint failed");
    expect(ap.fact).toContain("run_in_terminal");
  });

  it("skips successful tasks", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "sess_ap_ok",
      projectId: "purity",
      startedAt: "2026-04-11T10:00:00.000Z",
      createdAt: "2026-04-11T10:00:00.000Z",
    };
    store.putSession(session);

    const task: TaskRecord = {
      id: "task_ap_ok",
      sessionId: session.id,
      title: "Good task",
      prompt: "do something well",
      status: "completed",
      success: true,
      createdAt: "2026-04-11T10:00:01.000Z",
    };
    store.putTask(task);

    const result = extractAntiPatternsForTask(store, "task_ap_ok");
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("task_not_failed");
  });

  it("skips unknown task", () => {
    store = new AgentStore();
    const result = extractAntiPatternsForTask(store, "nonexistent");
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("task_not_found");
  });

  it("includes failed validation details", () => {
    store = new AgentStore();
    seedFailedTask(store, "task_ap_val");

    store.appendTaskEvent({
      id: "evt_apv_1",
      taskId: "task_ap_val",
      seq: 1,
      type: "validation",
      payload: { passed: false, message: "Type check failed: 12 errors" },
      createdAt: "2026-04-11T10:00:02.000Z",
    });

    const result = extractAntiPatternsForTask(store, "task_ap_val", {
      now: "2026-04-11T10:00:20.000Z",
    });

    expect(result.skipped).toBe(false);
    expect(result.antiPatterns[0]!.fact).toContain("Type check failed: 12 errors");
  });

  it("includes user feedback", () => {
    store = new AgentStore();
    seedFailedTask(store, "task_ap_fb");

    store.appendTaskEvent({
      id: "evt_apfb_1",
      taskId: "task_ap_fb",
      seq: 1,
      type: "tool_call",
      payload: { tool: "replace_string_in_file" },
      createdAt: "2026-04-11T10:00:02.000Z",
    });

    store.appendTaskEvent({
      id: "evt_apfb_2",
      taskId: "task_ap_fb",
      seq: 2,
      type: "user_feedback",
      payload: { text: "Never delete production data without a backup" },
      createdAt: "2026-04-11T10:00:03.000Z",
    });

    const result = extractAntiPatternsForTask(store, "task_ap_fb", {
      now: "2026-04-11T10:00:20.000Z",
    });

    expect(result.skipped).toBe(false);
    expect(result.antiPatterns[0]!.fact).toContain("Never delete production data without a backup");
  });

  it("extracts repo path from file edits", () => {
    store = new AgentStore();
    seedFailedTask(store, "task_ap_path");

    store.appendTaskEvent({
      id: "evt_app_1",
      taskId: "task_ap_path",
      seq: 1,
      type: "file_edit",
      payload: { path: "packages/core/src/signals.ts" },
      createdAt: "2026-04-11T10:00:02.000Z",
    });

    store.appendTaskEvent({
      id: "evt_app_2",
      taskId: "task_ap_path",
      seq: 2,
      type: "error",
      payload: { message: "Cannot read properties of undefined" },
      createdAt: "2026-04-11T10:00:03.000Z",
    });

    const result = extractAntiPatternsForTask(store, "task_ap_path", {
      now: "2026-04-11T10:00:20.000Z",
    });

    expect(result.antiPatterns[0]!.repoPath).toBe("packages/core/src");
  });

  it("skips running tasks (not completed)", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "sess_ap_run",
      projectId: "purity",
      startedAt: "2026-04-11T10:00:00.000Z",
      createdAt: "2026-04-11T10:00:00.000Z",
    };
    store.putSession(session);

    const task: TaskRecord = {
      id: "task_ap_run",
      sessionId: session.id,
      title: "Running task",
      prompt: "still running",
      status: "running",
      success: false,
      createdAt: "2026-04-11T10:00:01.000Z",
    };
    store.putTask(task);

    const result = extractAntiPatternsForTask(store, "task_ap_run");
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("task_not_failed");
  });
});

describe("listAntiPatterns", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("lists only anti-pattern memories", () => {
    store = new AgentStore();

    store.putMemory({
      id: "mem_ap_1",
      scope: "project",
      projectId: "purity",
      kind: "anti_pattern",
      fact: "Avoid: bad thing",
      confidence: 0.6,
      source: "anti_pattern_extract",
      status: "active",
      createdAt: "2026-04-11T10:00:00.000Z",
    });

    store.putMemory({
      id: "mem_normal",
      scope: "project",
      projectId: "purity",
      kind: "trajectory_outcome",
      fact: "Good approach",
      confidence: 0.8,
      source: "post_task_extract",
      status: "active",
      createdAt: "2026-04-11T10:00:00.000Z",
    });

    const patterns = listAntiPatterns(store, "active");
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.id).toBe("mem_ap_1");
    expect(patterns[0]!.kind).toBe("anti_pattern");
  });

  it("returns empty when no anti-patterns exist", () => {
    store = new AgentStore();
    const patterns = listAntiPatterns(store);
    expect(patterns).toHaveLength(0);
  });
});
