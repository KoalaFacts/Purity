import { afterEach, describe, expect, it } from "vite-plus/test";
import type { SessionRecord, TaskRecord } from "@purityjs/agent-types";
import {
  AgentStore,
  getPendingObservations,
  observeProfileFromSession,
  observeProfileFromTask,
} from "../src/index";

describe("profile auto-update", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  const SESSION_ID = "sess_profile";
  const USER_ID = "user_profile";
  const NOW = "2026-04-11T12:00:00.000Z";

  function seedSession(s: AgentStore, sessionId = SESSION_ID): void {
    if (s.getSession(sessionId)) return;
    const session: SessionRecord = {
      id: sessionId,
      projectId: "purity",
      userId: USER_ID,
      startedAt: "2026-04-11T10:00:00.000Z",
      createdAt: "2026-04-11T10:00:00.000Z",
    };
    s.putSession(session);
  }

  function seedCompletedTask(
    s: AgentStore,
    taskId: string,
    opts: { sessionId?: string; success?: boolean } = {},
  ): void {
    const sessionId = opts.sessionId ?? SESSION_ID;
    seedSession(s, sessionId);

    const task: TaskRecord = {
      id: taskId,
      sessionId,
      title: `Task ${taskId}`,
      prompt: "do the thing",
      status: "completed",
      success: opts.success ?? true,
      outcomeSummary: "Done.",
      createdAt: "2026-04-11T10:00:01.000Z",
      completedAt: "2026-04-11T10:00:10.000Z",
    };
    s.putTask(task);
  }

  function addFileEdits(s: AgentStore, taskId: string, paths: string[]): void {
    for (let i = 0; i < paths.length; i++) {
      s.appendTaskEvent({
        id: `evt_${taskId}_fe_${i}`,
        taskId,
        seq: i + 1,
        type: "file_edit",
        payload: { path: paths[i]! },
        createdAt: "2026-04-11T10:00:02.000Z",
      });
    }
  }

  function addToolCalls(s: AgentStore, taskId: string, tools: string[], startSeq = 1): void {
    for (let i = 0; i < tools.length; i++) {
      s.appendTaskEvent({
        id: `evt_${taskId}_tc_${i}`,
        taskId,
        seq: startSeq + i,
        type: "tool_call",
        payload: { tool: tools[i]! },
        createdAt: "2026-04-11T10:00:03.000Z",
      });
    }
  }

  it("observes preferred language from file edits", () => {
    store = new AgentStore();
    seedCompletedTask(store, "task_p1");
    addFileEdits(store, "task_p1", ["src/main.ts", "src/utils.ts", "src/index.ts"]);

    const result = observeProfileFromTask(store, USER_ID, "task_p1", {
      now: NOW,
    });

    expect(result.skipped).toBe(false);
    expect(result.observed).toContain("preferredLanguage");

    const pending = getPendingObservations(store, USER_ID);
    const langObs = pending.find((p) => p.key === "preferredLanguage");
    expect(langObs).toBeDefined();
    expect(langObs!.observation.value).toBe("typescript");
    expect(langObs!.observation.count).toBe(1);
  });

  it("observes preferred tools from tool calls", () => {
    store = new AgentStore();
    seedCompletedTask(store, "task_p2");
    addToolCalls(store, "task_p2", ["grep_search", "read_file", "replace_string_in_file"]);

    const result = observeProfileFromTask(store, USER_ID, "task_p2", {
      now: NOW,
    });

    expect(result.skipped).toBe(false);
    expect(result.observed).toContain("preferredTools");

    const pending = getPendingObservations(store, USER_ID);
    const toolObs = pending.find((p) => p.key === "preferredTools");
    expect(toolObs).toBeDefined();
    expect(toolObs!.observation.value).toEqual([
      "grep_search",
      "read_file",
      "replace_string_in_file",
    ]);
  });

  it("promotes observation after evidence threshold is met", () => {
    store = new AgentStore();

    // Create 3 tasks each with TypeScript file edits
    for (let i = 1; i <= 3; i++) {
      const taskId = `task_promo_${i}`;
      seedCompletedTask(store, taskId);
      addFileEdits(store, taskId, [`src/file${i}.ts`]);
      observeProfileFromTask(store, USER_ID, taskId, {
        now: NOW,
        evidenceThreshold: 3,
      });
    }

    const result = store.getUserProfile(USER_ID);
    expect(result).toBeDefined();
    expect(result!.profile.preferredLanguage).toBe("typescript");
    // _pending should no longer contain the promoted key
    const pending = getPendingObservations(store, USER_ID);
    expect(pending.find((p) => p.key === "preferredLanguage")).toBeUndefined();
  });

  it("does not promote before threshold is reached", () => {
    store = new AgentStore();

    for (let i = 1; i <= 2; i++) {
      const taskId = `task_nopro_${i}`;
      seedCompletedTask(store, taskId);
      addFileEdits(store, taskId, [`src/mod${i}.ts`]);
      observeProfileFromTask(store, USER_ID, taskId, {
        now: NOW,
        evidenceThreshold: 3,
      });
    }

    const profile = store.getUserProfile(USER_ID);
    expect(profile).toBeDefined();
    // Not yet promoted
    expect(profile!.profile.preferredLanguage).toBeUndefined();
    // Still in pending with count=2
    const pending = getPendingObservations(store, USER_ID);
    const langObs = pending.find((p) => p.key === "preferredLanguage");
    expect(langObs).toBeDefined();
    expect(langObs!.observation.count).toBe(2);
  });

  it("resets count when observed value changes", () => {
    store = new AgentStore();

    // Two TypeScript tasks
    for (let i = 1; i <= 2; i++) {
      const taskId = `task_reset_ts_${i}`;
      seedCompletedTask(store, taskId);
      addFileEdits(store, taskId, [`src/file${i}.ts`]);
      observeProfileFromTask(store, USER_ID, taskId, { now: NOW });
    }

    let pending = getPendingObservations(store, USER_ID);
    expect(pending.find((p) => p.key === "preferredLanguage")!.observation.count).toBe(2);

    // Now a Python task — should reset the count
    seedCompletedTask(store, "task_reset_py");
    addFileEdits(store, "task_reset_py", ["src/main.py", "src/utils.py"]);
    observeProfileFromTask(store, USER_ID, "task_reset_py", { now: NOW });

    pending = getPendingObservations(store, USER_ID);
    const langObs = pending.find((p) => p.key === "preferredLanguage");
    expect(langObs!.observation.value).toBe("python");
    expect(langObs!.observation.count).toBe(1);
  });

  it("skips non-completed tasks", () => {
    store = new AgentStore();
    seedSession(store);
    store.putTask({
      id: "task_running",
      sessionId: SESSION_ID,
      title: "Running task",
      prompt: "still going",
      status: "running",
      success: false,
      createdAt: "2026-04-11T10:00:01.000Z",
    });

    const result = observeProfileFromTask(store, USER_ID, "task_running", {
      now: NOW,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("task_not_completed");
  });

  it("skips unknown task", () => {
    store = new AgentStore();
    const result = observeProfileFromTask(store, USER_ID, "nonexistent", {
      now: NOW,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("task_not_found");
  });

  it("skips task with no recognizable events", () => {
    store = new AgentStore();
    seedCompletedTask(store, "task_noobs");
    // Only add a user_message event — no file edits or tool calls
    store.appendTaskEvent({
      id: "evt_noobs_1",
      taskId: "task_noobs",
      seq: 1,
      type: "user_message",
      payload: { text: "Hello" },
      createdAt: "2026-04-11T10:00:02.000Z",
    });

    const result = observeProfileFromTask(store, USER_ID, "task_noobs", {
      now: NOW,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_observations");
  });
});

describe("observeProfileFromSession", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  const NOW = "2026-04-11T12:00:00.000Z";

  it("processes all completed tasks in a session", () => {
    store = new AgentStore();

    store.putSession({
      id: "sess_multi",
      projectId: "purity",
      userId: "user_sess",
      startedAt: "2026-04-11T10:00:00.000Z",
      createdAt: "2026-04-11T10:00:00.000Z",
    });

    // Two completed tasks with TS file edits
    for (let i = 1; i <= 2; i++) {
      store.putTask({
        id: `task_sess_${i}`,
        sessionId: "sess_multi",
        title: `Task ${i}`,
        prompt: "work",
        status: "completed",
        success: true,
        createdAt: "2026-04-11T10:00:01.000Z",
        completedAt: "2026-04-11T10:00:10.000Z",
      });
      store.appendTaskEvent({
        id: `evt_sess_${i}`,
        taskId: `task_sess_${i}`,
        seq: 1,
        type: "file_edit",
        payload: { path: `src/mod${i}.ts` },
        createdAt: "2026-04-11T10:00:02.000Z",
      });
    }

    const result = observeProfileFromSession(store, "sess_multi", { now: NOW });
    expect(result.skipped).toBe(false);
    expect(result.observed).toContain("preferredLanguage");

    // Count should be 2 (one per task)
    const pending = getPendingObservations(store, "user_sess");
    const langObs = pending.find((p) => p.key === "preferredLanguage");
    expect(langObs).toBeDefined();
    expect(langObs!.observation.count).toBe(2);
  });

  it("skips session without userId", () => {
    store = new AgentStore();

    store.putSession({
      id: "sess_nouser",
      projectId: "purity",
      startedAt: "2026-04-11T10:00:00.000Z",
      createdAt: "2026-04-11T10:00:00.000Z",
    });

    const result = observeProfileFromSession(store, "sess_nouser", {
      now: NOW,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_user_id");
  });

  it("skips unknown session", () => {
    store = new AgentStore();
    const result = observeProfileFromSession(store, "nonexistent", {
      now: NOW,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("session_not_found");
  });
});

describe("getPendingObservations", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("returns empty for unknown user", () => {
    store = new AgentStore();
    expect(getPendingObservations(store, "nobody")).toEqual([]);
  });
});
