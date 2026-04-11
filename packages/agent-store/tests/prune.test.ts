import { afterEach, describe, expect, it } from "vite-plus/test";
import type { MemoryRecord, SkillRecord, SkillVersionRecord } from "@purityjs/agent-types";
import { AgentStore } from "../src/store";
import {
  archiveInactiveSkills,
  compactOldTasks,
  deduplicateMemories,
  demoteStaleCandidates,
  pruneStore,
} from "../src/prune";

describe("prune", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  function putCandidateMemory(
    target: AgentStore,
    id: string,
    fact: string,
    opts: { scope?: string; projectId?: string; createdAt?: string } = {},
  ): void {
    const memory: MemoryRecord = {
      id,
      scope: (opts.scope ?? "project") as MemoryRecord["scope"],
      projectId: opts.projectId ?? "purity",
      kind: "repo",
      fact,
      confidence: 0.7,
      source: "trajectory",
      status: "candidate",
      createdAt: opts.createdAt ?? "2026-03-01T00:00:00.000Z",
    };
    target.putMemory(memory);
  }

  it("removes duplicate candidate memories keeping the newest", () => {
    store = new AgentStore();

    putCandidateMemory(store, "mem_old", "Use vp commands.", {
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    putCandidateMemory(store, "mem_new", "Use vp commands.", {
      createdAt: "2026-03-05T00:00:00.000Z",
    });
    putCandidateMemory(store, "mem_unique", "Run tests before pushing.", {
      createdAt: "2026-03-02T00:00:00.000Z",
    });

    const result = deduplicateMemories(store, {
      now: "2026-04-10T00:00:00.000Z",
    });

    expect(result.scanned).toBe(3);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.removedIds).toEqual(["mem_old"]);

    const kept = store.getMemory("mem_new");
    expect(kept?.status).toBe("candidate");

    const rejected = store.getMemory("mem_old");
    expect(rejected?.status).toBe("rejected");
  });

  it("demotes stale candidates older than maxAgeDays", () => {
    store = new AgentStore();

    putCandidateMemory(store, "mem_stale", "Old fact.", {
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    putCandidateMemory(store, "mem_fresh", "New fact.", {
      createdAt: "2026-04-05T00:00:00.000Z",
    });

    const skill: SkillRecord = {
      id: "skill_stale",
      name: "Stale skill",
      description: "desc",
      domain: "test",
      status: "candidate",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const staleVersion: SkillVersionRecord = {
      id: "sv_stale",
      skillId: skill.id,
      version: 1,
      bodyMarkdown: "body",
      status: "candidate",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    store.putSkill(skill);
    store.putSkillVersion(staleVersion);

    const result = demoteStaleCandidates(store, {
      maxAgeDays: 30,
      now: "2026-04-10T00:00:00.000Z",
    });

    expect(result.memoriesDemoted).toBe(1);
    expect(result.demotedMemoryIds).toEqual(["mem_stale"]);
    expect(result.skillVersionsDemoted).toBe(1);
    expect(result.demotedSkillVersionIds).toEqual(["sv_stale"]);

    expect(store.getMemory("mem_fresh")?.status).toBe("candidate");
    expect(store.getMemory("mem_stale")?.status).toBe("demoted");
    expect(store.getSkillVersion("sv_stale")?.status).toBe("demoted");
  });

  it("archives inactive skill versions older than threshold", () => {
    store = new AgentStore();

    const skill: SkillRecord = {
      id: "skill_archive",
      name: "Old skill",
      description: "desc",
      domain: "test",
      status: "active",
      createdAt: "2025-12-01T00:00:00.000Z",
    };
    store.putSkill(skill);

    store.putSkillVersion({
      id: "sv_old_active",
      skillId: skill.id,
      version: 1,
      bodyMarkdown: "body",
      status: "active",
      createdAt: "2025-12-01T00:00:00.000Z",
    });
    store.putSkillVersion({
      id: "sv_recent_active",
      skillId: skill.id,
      version: 2,
      bodyMarkdown: "body v2",
      status: "active",
      createdAt: "2026-04-01T00:00:00.000Z",
    });

    const result = archiveInactiveSkills(store, {
      maxInactiveDays: 90,
      now: "2026-04-10T00:00:00.000Z",
    });

    expect(result.archived).toBe(1);
    expect(result.archivedIds).toEqual(["sv_old_active"]);
    expect(store.getSkillVersion("sv_old_active")?.status).toBe("archived");
    expect(store.getSkillVersion("sv_recent_active")?.status).toBe("active");
  });

  it("compacts events for old failed tasks", () => {
    store = new AgentStore();

    store.putSession({
      id: "session_compact",
      projectId: "purity",
      startedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    store.putTask({
      id: "task_old_failed",
      sessionId: "session_compact",
      title: "Failed old task",
      prompt: "do something",
      status: "failed",
      success: false,
      createdAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
    });
    store.appendTaskEvent({
      id: "event_compact_1",
      taskId: "task_old_failed",
      seq: 1,
      type: "tool_call",
      payload: { tool: "test" },
      createdAt: "2026-01-01T00:00:02.000Z",
    });

    store.putTask({
      id: "task_old_success",
      sessionId: "session_compact",
      title: "Successful old task",
      prompt: "do something good",
      status: "completed",
      success: true,
      createdAt: "2026-01-01T00:00:06.000Z",
      completedAt: "2026-01-01T00:00:10.000Z",
    });
    store.appendTaskEvent({
      id: "event_compact_2",
      taskId: "task_old_success",
      seq: 1,
      type: "file_edit",
      payload: { path: "src/foo.ts" },
      createdAt: "2026-01-01T00:00:07.000Z",
    });

    const result = compactOldTasks(store, {
      maxAgeDays: 60,
      preserveSuccessful: true,
      now: "2026-04-10T00:00:00.000Z",
    });

    expect(result.tasksCompacted).toBe(1);
    expect(result.eventsDeleted).toBe(1);

    expect(store.listTaskEvents("task_old_failed")).toHaveLength(0);
    expect(store.getTask("task_old_failed")).toBeDefined();

    expect(store.listTaskEvents("task_old_success")).toHaveLength(1);
  });

  it("runs all prune operations via pruneStore", () => {
    store = new AgentStore();

    putCandidateMemory(store, "mem_dup_a", "Same fact.", {
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    putCandidateMemory(store, "mem_dup_b", "Same fact.", {
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const report = pruneStore(store, {
      now: "2026-04-10T00:00:00.000Z",
    });

    expect(report.dedup.duplicatesRemoved).toBe(1);
    expect(report.staleCandidates).toBeDefined();
    expect(report.archivedSkills).toBeDefined();
    expect(report.compactedTasks).toBeDefined();
  });
});
