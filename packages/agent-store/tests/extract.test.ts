import { afterEach, describe, expect, it } from "vite-plus/test";
import type { SessionRecord, TaskRecord } from "@purityjs/agent-types";
import { AgentStore, extractCandidatesForTask } from "../src/index";

describe("post-task extraction", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("creates candidate memory + skill draft from successful non-trivial task", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "session_extract_1",
      projectId: "purity",
      userId: "user_extract",
      startedAt: "2026-04-11T11:00:00.000Z",
      createdAt: "2026-04-11T11:00:00.000Z",
    };

    const task: TaskRecord = {
      id: "task_extract_1",
      sessionId: session.id,
      title: "Pin CI action SHAs",
      prompt: "pin all github actions to immutable SHAs",
      status: "completed",
      success: true,
      outcomeSummary: "Updated CI workflows and docs to immutable action SHAs.",
      createdAt: "2026-04-11T11:00:01.000Z",
      completedAt: "2026-04-11T11:00:10.000Z",
    };

    store.putSession(session);
    store.putTask(task);

    store.appendTaskEvent({
      id: "evt_extract_1",
      taskId: task.id,
      seq: 1,
      type: "tool_call",
      payload: { tool: "run_in_terminal", command: "vp check" },
      createdAt: "2026-04-11T11:00:02.000Z",
    });

    store.appendTaskEvent({
      id: "evt_extract_2",
      taskId: task.id,
      seq: 2,
      type: "file_edit",
      payload: { path: ".github/workflows/ci.yml" },
      createdAt: "2026-04-11T11:00:03.000Z",
    });

    store.appendTaskEvent({
      id: "evt_extract_3",
      taskId: task.id,
      seq: 3,
      type: "validation",
      payload: { command: "vp check" },
      createdAt: "2026-04-11T11:00:04.000Z",
    });

    let idCounter = 0;
    const result = extractCandidatesForTask(store, task.id, {
      now: "2026-04-11T11:00:20.000Z",
      idFactory: () => {
        idCounter += 1;
        return String(idCounter);
      },
    });

    expect(result.skipped).toBe(false);
    expect(result.memoryRecords).toHaveLength(1);
    expect(result.skillRecords).toHaveLength(1);
    expect(result.skillVersionRecords).toHaveLength(1);

    expect(result.memoryRecords[0]?.status).toBe("candidate");
    expect(result.memoryRecords[0]?.fact).toContain("immutable action SHAs");

    expect(result.skillRecords[0]?.status).toBe("candidate");
    expect(result.skillVersionRecords[0]?.extractionTaskId).toBe(task.id);
    expect(result.skillVersionRecords[0]?.bodyMarkdown).toContain("Procedure:");
    expect(result.skillVersionRecords[0]?.bodyMarkdown).toContain("Edit .github/workflows/ci.yml");

    expect(store.listCandidateMemories().map((item) => item.id)).toEqual(["mem_1"]);
    expect(store.listCandidateSkillVersions().map((item) => item.id)).toEqual(["skill_version_3"]);
  });

  it("skips extraction for failed tasks", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "session_extract_2",
      projectId: "purity",
      startedAt: "2026-04-11T12:00:00.000Z",
      createdAt: "2026-04-11T12:00:00.000Z",
    };

    const task: TaskRecord = {
      id: "task_extract_2",
      sessionId: session.id,
      title: "Failing task",
      prompt: "do something failing",
      status: "failed",
      success: false,
      createdAt: "2026-04-11T12:00:01.000Z",
      completedAt: "2026-04-11T12:00:02.000Z",
    };

    store.putSession(session);
    store.putTask(task);

    const result = extractCandidatesForTask(store, task.id);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("task_not_successful");
    expect(store.listCandidateMemories()).toHaveLength(0);
    expect(store.listCandidateSkillVersions()).toHaveLength(0);
  });

  it("skips extraction for trivial tasks", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "session_extract_3",
      projectId: "purity",
      startedAt: "2026-04-11T13:00:00.000Z",
      createdAt: "2026-04-11T13:00:00.000Z",
    };

    const task: TaskRecord = {
      id: "task_extract_3",
      sessionId: session.id,
      title: "Tiny success",
      prompt: "small task",
      status: "completed",
      success: true,
      outcomeSummary: "Very small task",
      createdAt: "2026-04-11T13:00:01.000Z",
      completedAt: "2026-04-11T13:00:02.000Z",
    };

    store.putSession(session);
    store.putTask(task);

    store.appendTaskEvent({
      id: "evt_extract_4",
      taskId: task.id,
      seq: 1,
      type: "assistant_message",
      payload: { text: "done" },
      createdAt: "2026-04-11T13:00:03.000Z",
    });

    const result = extractCandidatesForTask(store, task.id);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("task_too_trivial");
  });
});
