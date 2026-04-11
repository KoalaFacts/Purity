import { afterEach, describe, expect, it } from "vite-plus/test";
import type {
  EvalRun,
  MemoryRecord,
  SessionRecord,
  SkillInvocationRecord,
  SkillRecord,
  SkillVersionRecord,
  TaskEvent,
  TaskRecord,
  UserProfileRecord,
} from "@purityjs/agent-types";
import { AGENT_STORE_SCHEMA_VERSION, AgentStore, getAgentStoreSchemaVersion } from "../src/index";

describe("@purityjs/agent-store", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("creates the schema on initialization", () => {
    store = new AgentStore();
    expect(getAgentStoreSchemaVersion(store.db)).toBe(AGENT_STORE_SCHEMA_VERSION);
  });

  it("persists sessions, tasks, events, and user profiles", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "session_1",
      projectId: "purity",
      userId: "user_1",
      startedAt: "2026-04-10T10:00:00.000Z",
      summary: "migration session",
      createdAt: "2026-04-10T10:00:00.000Z",
    };

    const task: TaskRecord = {
      id: "task_1",
      sessionId: session.id,
      title: "Pin GitHub Action SHAs",
      prompt: "use immutable tags in github actions",
      status: "completed",
      success: true,
      outcomeSummary: "Pinned mutable GitHub Action refs to immutable SHAs.",
      createdAt: "2026-04-10T10:00:01.000Z",
      completedAt: "2026-04-10T10:00:04.000Z",
    };

    const event: TaskEvent = {
      id: "event_1",
      taskId: task.id,
      seq: 1,
      type: "file_edit",
      payload: { path: ".github/workflows/ci.yml", action: "pin_sha" },
      createdAt: "2026-04-10T10:00:02.000Z",
    };

    const profile: UserProfileRecord = {
      userId: "user_1",
      profile: { prefersImmutableShas: true },
      updatedAt: "2026-04-10T10:00:05.000Z",
    };

    store.putSession(session);
    store.putTask(task);
    store.appendTaskEvent(event);
    store.putUserProfile(profile);

    expect(store.getSession(session.id)).toEqual(session);
    expect(store.getTask(task.id)).toEqual(task);
    expect(store.listTasksBySession(session.id)).toEqual([task]);
    expect(store.listTaskEvents(task.id)).toEqual([event]);
    expect(store.getUserProfile(profile.userId)).toEqual(profile);
  });

  it("retrieves memories by repo, project, user, then global priority", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "session_2",
      projectId: "purity",
      startedAt: "2026-04-10T11:00:00.000Z",
      createdAt: "2026-04-10T11:00:00.000Z",
    };
    store.putSession(session);

    const memories: MemoryRecord[] = [
      {
        id: "mem_global",
        scope: "global",
        kind: "policy",
        fact: "Always validate generated skills before promotion.",
        confidence: 0.95,
        source: "system",
        status: "active",
        createdAt: "2026-04-10T11:00:01.000Z",
      },
      {
        id: "mem_user",
        scope: "user",
        userId: "user_2",
        kind: "preference",
        fact: "User prefers autonomous execution.",
        confidence: 0.8,
        source: "trajectory",
        status: "active",
        createdAt: "2026-04-10T11:00:02.000Z",
      },
      {
        id: "mem_project",
        scope: "project",
        projectId: "purity",
        kind: "repo",
        fact: "This repo uses Vite+ via vp.",
        confidence: 0.7,
        source: "trajectory",
        status: "active",
        createdAt: "2026-04-10T11:00:03.000Z",
      },
      {
        id: "mem_repo",
        scope: "repo_path",
        projectId: "purity",
        repoPath: ".github/workflows",
        kind: "repo",
        fact: "Workflow files should use immutable action SHAs.",
        confidence: 0.6,
        source: "trajectory",
        status: "active",
        createdAt: "2026-04-10T11:00:04.000Z",
      },
      {
        id: "mem_rejected",
        scope: "project",
        projectId: "purity",
        kind: "repo",
        fact: "Ignore me",
        confidence: 0.99,
        source: "trajectory",
        status: "rejected",
        createdAt: "2026-04-10T11:00:05.000Z",
      },
    ];

    for (const memory of memories) {
      store.putMemory(memory);
    }

    const result = store.retrieve({
      projectId: "purity",
      userId: "user_2",
      repoPath: ".github/workflows",
      query: "github workflow shas",
      maxMemories: 4,
    });

    expect(result.memories.map((memory) => memory.id)).toEqual([
      "mem_repo",
      "mem_project",
      "mem_user",
      "mem_global",
    ]);
  });

  it("retrieves active skill versions and recent matching summaries", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "session_3",
      projectId: "purity",
      startedAt: "2026-04-10T12:00:00.000Z",
      createdAt: "2026-04-10T12:00:00.000Z",
    };
    store.putSession(session);

    const task: TaskRecord = {
      id: "task_3",
      sessionId: session.id,
      title: "Migrate workflows",
      prompt: "pin github workflow refs",
      status: "completed",
      success: true,
      outcomeSummary: "Pinned workflow refs and updated matching documentation.",
      createdAt: "2026-04-10T12:00:01.000Z",
      completedAt: "2026-04-10T12:00:04.000Z",
    };
    store.putTask(task);

    store.appendTaskEvent({
      id: "event_3_1",
      taskId: task.id,
      seq: 1,
      type: "tool_call",
      payload: { tool: "run_in_terminal", command: "vp check" },
      createdAt: "2026-04-10T12:00:02.500Z",
    });

    store.appendTaskEvent({
      id: "event_3_2",
      taskId: task.id,
      seq: 2,
      type: "file_edit",
      payload: { path: ".github/workflows/ci.yml" },
      createdAt: "2026-04-10T12:00:03.000Z",
    });

    const skill: SkillRecord = {
      id: "skill_1",
      name: "Pin GitHub Action SHAs",
      description: "Replace floating action tags with immutable release SHAs.",
      domain: "github workflow",
      status: "active",
      createdAt: "2026-04-10T12:00:01.000Z",
    };
    const activeVersion: SkillVersionRecord = {
      id: "skill_version_1",
      skillId: skill.id,
      version: 2,
      bodyMarkdown: "Use immutable release commit SHAs in GitHub Actions workflows.",
      status: "active",
      evalScore: 0.93,
      createdAt: "2026-04-10T12:00:02.000Z",
    };
    const inactiveVersion: SkillVersionRecord = {
      id: "skill_version_2",
      skillId: skill.id,
      version: 1,
      bodyMarkdown: "Old draft",
      status: "candidate",
      evalScore: 0.2,
      createdAt: "2026-04-10T12:00:01.500Z",
    };

    store.putSkill(skill);
    store.putSkillVersion(activeVersion);
    store.putSkillVersion(inactiveVersion);

    const result = store.retrieve({
      projectId: "purity",
      query: "github workflow action pinning",
    });

    expect(result.skills).toEqual([activeVersion]);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]).toContain("Task: Migrate workflows");
    expect(result.summaries[0]).toContain("Tools: run_in_terminal");
    expect(result.summaries[0]).toContain(".github/workflows/ci.yml");
  });

  it("retrieves related summaries by matching trajectory details", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "session_trajectory_search",
      projectId: "purity",
      startedAt: "2026-04-10T13:00:00.000Z",
      createdAt: "2026-04-10T13:00:00.000Z",
    };
    store.putSession(session);

    const task: TaskRecord = {
      id: "task_trajectory_search",
      sessionId: session.id,
      title: "Refine workflow checks",
      prompt: "tighten validation",
      status: "completed",
      success: true,
      outcomeSummary: "Updated automation validation flow.",
      createdAt: "2026-04-10T13:00:01.000Z",
      completedAt: "2026-04-10T13:00:04.000Z",
    };
    store.putTask(task);

    store.appendTaskEvent({
      id: "event_search_1",
      taskId: task.id,
      seq: 1,
      type: "tool_call",
      payload: {
        tool: "runTests",
        file: "packages/core/tests/compiler.test.ts",
      },
      createdAt: "2026-04-10T13:00:02.000Z",
    });

    store.appendTaskEvent({
      id: "event_search_2",
      taskId: task.id,
      seq: 2,
      type: "file_edit",
      payload: { path: "packages/core/tests/compiler.test.ts" },
      createdAt: "2026-04-10T13:00:03.000Z",
    });

    const result = store.retrieve({
      projectId: "purity",
      query: "compiler.test.ts runTests",
    });

    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]).toContain("packages/core/tests/compiler.test.ts");
    expect(result.summaries[0]).toContain("Tools: runTests");
  });

  it("stores and lists eval runs for a target", () => {
    store = new AgentStore();

    store.putEvalDataset({
      id: "dataset_1",
      name: "baseline",
      scope: "project",
      createdAt: "2026-04-10T12:59:00.000Z",
    });
    store.putEvalDataset({
      id: "dataset_2",
      name: "regression",
      scope: "project",
      createdAt: "2026-04-10T13:59:00.000Z",
    });

    const runA: EvalRun = {
      id: "eval_1",
      targetType: "skill_version",
      targetId: "skill_version_1",
      datasetId: "dataset_1",
      passed: true,
      score: 0.91,
      metrics: { successRate: 1, regressions: 0 },
      createdAt: "2026-04-10T13:00:00.000Z",
    };
    const runB: EvalRun = {
      id: "eval_2",
      targetType: "skill_version",
      targetId: "skill_version_1",
      datasetId: "dataset_2",
      passed: false,
      score: 0.4,
      metrics: { successRate: 0.5, regressions: 2 },
      createdAt: "2026-04-10T14:00:00.000Z",
    };

    store.putEvalRun(runA);
    store.putEvalRun(runB);

    expect(store.listEvalRunsForTarget("skill_version", "skill_version_1")).toEqual([runB, runA]);
  });

  it("supports task completion workflow with sequencing and summary generation", () => {
    store = new AgentStore();

    const session: SessionRecord = {
      id: "session_4",
      projectId: "purity",
      startedAt: "2026-04-11T09:00:00.000Z",
      createdAt: "2026-04-11T09:00:00.000Z",
    };

    const task: TaskRecord = {
      id: "task_4",
      sessionId: session.id,
      title: "Migrate benchmark scripts",
      prompt: "switch benchmark scripts to vp",
      status: "running",
      success: false,
      createdAt: "2026-04-11T09:00:01.000Z",
    };

    store.putSession(session);
    store.putTask(task);

    const firstSeq = store.nextTaskEventSeq(task.id);
    expect(firstSeq).toBe(1);

    store.appendTaskEvent({
      id: "event_4_1",
      taskId: task.id,
      seq: firstSeq,
      type: "tool_call",
      payload: { tool: "run_in_terminal", command: "vp check" },
      createdAt: "2026-04-11T09:00:02.000Z",
    });

    const secondSeq = store.nextTaskEventSeq(task.id);
    expect(secondSeq).toBe(2);

    store.appendTaskEvent({
      id: "event_4_2",
      taskId: task.id,
      seq: secondSeq,
      type: "file_edit",
      payload: { path: "benchmark/run-bench.ts", action: "replace" },
      createdAt: "2026-04-11T09:00:03.000Z",
    });

    store.completeTask(task.id, {
      success: true,
      outcomeSummary: "Migrated benchmark scripts to vp and validated checks.",
      completedAt: "2026-04-11T09:00:04.000Z",
      updatedAt: "2026-04-11T09:00:04.000Z",
    });

    const completed = store.getTask(task.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.success).toBe(true);
    expect(completed.outcomeSummary).toContain("Migrated benchmark scripts");

    const summary = store.summarizeTask(task.id);
    expect(summary).toContain("Task: Migrate benchmark scripts");
    expect(summary).toContain("Events: tool_call:1, file_edit:1");
    expect(summary).toContain("Tools: run_in_terminal");
    expect(summary).toContain("benchmark/run-bench.ts");
  });

  it("supports candidate review status transitions", () => {
    store = new AgentStore();

    const memory: MemoryRecord = {
      id: "mem_candidate_1",
      scope: "project",
      projectId: "purity",
      kind: "repo",
      fact: "Use vp for all package operations.",
      confidence: 0.84,
      source: "trajectory",
      status: "candidate",
      createdAt: "2026-04-11T10:00:00.000Z",
    };

    const skill: SkillRecord = {
      id: "skill_candidate_1",
      name: "Migrate npm scripts to vp",
      description: "Normalize scripts and docs to Vite+ commands.",
      domain: "repo-tooling",
      status: "approved",
      createdAt: "2026-04-11T10:00:01.000Z",
    };

    const version: SkillVersionRecord = {
      id: "skill_version_candidate_1",
      skillId: skill.id,
      version: 1,
      bodyMarkdown: "Procedure to replace npm/npx usage with vp equivalents.",
      status: "candidate",
      createdAt: "2026-04-11T10:00:02.000Z",
    };

    store.putMemory(memory);
    store.putSkill(skill);
    store.putSkillVersion(version);

    expect(store.listCandidateMemories().map((m) => m.id)).toEqual([memory.id]);
    expect(store.listCandidateSkillVersions().map((v) => v.id)).toEqual([version.id]);

    store.setMemoryStatus(memory.id, "active", "2026-04-11T10:01:00.000Z");
    store.setSkillStatus(skill.id, "active", "2026-04-11T10:01:00.000Z");
    store.setSkillVersionStatus(version.id, "active", {
      evalScore: 0.92,
      updatedAt: "2026-04-11T10:01:00.000Z",
    });

    const updatedMemory = store.getMemory(memory.id)!;
    const updatedSkill = store.getSkill(skill.id)!;
    const updatedVersion = store.getSkillVersion(version.id)!;

    expect(updatedMemory.status).toBe("active");
    expect(updatedSkill.status).toBe("active");
    expect(updatedVersion.status).toBe("active");
    expect(updatedVersion.evalScore).toBe(0.92);
  });

  it("uses FTS5 to search task summaries after completeTask indexes them", () => {
    store = new AgentStore();

    store.putSession({
      id: "session_fts",
      projectId: "purity",
      startedAt: "2026-04-12T10:00:00.000Z",
      createdAt: "2026-04-12T10:00:00.000Z",
    });
    store.putTask({
      id: "task_fts_1",
      sessionId: "session_fts",
      title: "Fix oxlint warnings",
      prompt: "resolve all linter warnings in the core package",
      status: "running",
      success: false,
      createdAt: "2026-04-12T10:00:01.000Z",
    });
    store.appendTaskEvent({
      id: "evt_fts_1",
      taskId: "task_fts_1",
      seq: 1,
      type: "tool_call",
      payload: { tool: "vp_lint", file: "packages/core/src/signals.ts" },
      createdAt: "2026-04-12T10:00:02.000Z",
    });
    store.appendTaskEvent({
      id: "evt_fts_2",
      taskId: "task_fts_1",
      seq: 2,
      type: "file_edit",
      payload: { path: "packages/core/src/signals.ts" },
      createdAt: "2026-04-12T10:00:03.000Z",
    });
    store.completeTask("task_fts_1", {
      success: true,
      outcomeSummary: "Resolved 12 oxlint warnings in signals module.",
    });

    const summaries = store.searchTaskSummaries("purity", "oxlint signals", 5);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain("oxlint");
  });

  it("returns schema version 2 after migration", () => {
    store = new AgentStore();
    expect(getAgentStoreSchemaVersion(store.db)).toBe(2);
  });

  it("lists skills by status", () => {
    store = new AgentStore();
    const session: SessionRecord = {
      id: "s1",
      projectId: "p1",
      startedAt: "2026-04-10T00:00:00Z",
      createdAt: "2026-04-10T00:00:00Z",
    };
    store.putSession(session);

    const active: SkillRecord = {
      id: "sk1",
      name: "Migrate to Vite+",
      description: "Handles migration",
      domain: "tooling",
      status: "active",
      createdAt: "2026-04-10T00:00:01Z",
    };
    const archived: SkillRecord = {
      id: "sk2",
      name: "Old Skill",
      description: "Deprecated",
      domain: "tooling",
      status: "archived",
      createdAt: "2026-04-10T00:00:02Z",
    };
    store.putSkill(active);
    store.putSkill(archived);

    const all = store.listSkills();
    expect(all.length).toBe(2);

    const activeOnly = store.listSkillsByStatus("active");
    expect(activeOnly.length).toBe(1);
    expect(activeOnly[0]!.id).toBe("sk1");

    const archivedOnly = store.listSkillsByStatus("archived");
    expect(archivedOnly.length).toBe(1);
    expect(archivedOnly[0]!.id).toBe("sk2");
  });

  it("stores and reads skill invocations by version and task", () => {
    store = new AgentStore();
    const session: SessionRecord = {
      id: "s1",
      projectId: "p1",
      startedAt: "2026-04-10T00:00:00Z",
      createdAt: "2026-04-10T00:00:00Z",
    };
    store.putSession(session);

    const task: TaskRecord = {
      id: "t1",
      sessionId: "s1",
      title: "Test task",
      prompt: "test",
      status: "completed",
      success: true,
      createdAt: "2026-04-10T00:00:01Z",
    };
    store.putTask(task);

    const skill: SkillRecord = {
      id: "sk1",
      name: "Test Skill",
      description: "desc",
      domain: "testing",
      status: "active",
      createdAt: "2026-04-10T00:00:00Z",
    };
    store.putSkill(skill);

    const sv: SkillVersionRecord = {
      id: "sv1",
      skillId: "sk1",
      version: 1,
      bodyMarkdown: "# Test",
      status: "active",
      createdAt: "2026-04-10T00:00:01Z",
    };
    store.putSkillVersion(sv);

    const inv1: SkillInvocationRecord = {
      id: "inv1",
      skillVersionId: "sv1",
      taskId: "t1",
      usedAt: "2026-04-10T00:00:02Z",
      outcome: "success",
      userAccepted: true,
      rollbackRequired: false,
      notes: "worked well",
    };
    const inv2: SkillInvocationRecord = {
      id: "inv2",
      skillVersionId: "sv1",
      taskId: "t1",
      usedAt: "2026-04-10T00:00:03Z",
      outcome: "partial",
      userAccepted: false,
    };
    store.putSkillInvocation(inv1);
    store.putSkillInvocation(inv2);

    const got = store.getSkillInvocation("inv1");
    expect(got).toBeDefined();
    expect(got!.outcome).toBe("success");
    expect(got!.userAccepted).toBe(true);
    expect(got!.rollbackRequired).toBe(false);
    expect(got!.notes).toBe("worked well");

    const byVersion = store.listSkillInvocationsByVersion("sv1");
    expect(byVersion.length).toBe(2);

    const byTask = store.listSkillInvocationsByTask("t1");
    expect(byTask.length).toBe(2);
  });

  it("lists sessions by project", () => {
    store = new AgentStore();
    store.putSession({
      id: "s1",
      projectId: "purity",
      startedAt: "2026-04-10T00:00:00Z",
      createdAt: "2026-04-10T00:00:00Z",
    });
    store.putSession({
      id: "s2",
      projectId: "purity",
      startedAt: "2026-04-10T01:00:00Z",
      createdAt: "2026-04-10T01:00:00Z",
    });
    store.putSession({
      id: "s3",
      projectId: "other",
      startedAt: "2026-04-10T02:00:00Z",
      createdAt: "2026-04-10T02:00:00Z",
    });

    const puritySessions = store.listSessionsByProject("purity");
    expect(puritySessions.length).toBe(2);

    const otherSessions = store.listSessionsByProject("other");
    expect(otherSessions.length).toBe(1);
    expect(otherSessions[0]!.id).toBe("s3");
  });

  it("gets an eval run by ID", () => {
    store = new AgentStore();
    store.putEvalDataset({
      id: "ds_1",
      name: "Test Dataset",
      scope: "project",
      createdAt: "2026-04-10T00:00:00Z",
    });

    const run: EvalRun = {
      id: "run_1",
      targetType: "skill_version",
      targetId: "sv_1",
      datasetId: "ds_1",
      passed: true,
      score: 0.95,
      metrics: { cases: 5, passed: 5 },
      createdAt: "2026-04-10T00:00:00Z",
    };
    store.putEvalRun(run);

    const got = store.getEvalRun("run_1");
    expect(got).toBeDefined();
    expect(got!.score).toBe(0.95);
    expect(got!.passed).toBe(true);

    const missing = store.getEvalRun("nonexistent");
    expect(missing).toBeUndefined();
  });
});
